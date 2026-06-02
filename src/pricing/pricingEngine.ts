/**
 * Pricing engine for cost calculations
 */

import * as vscode from "vscode";
import { z } from "zod";
import type { ModelPricing, TokenUsage } from "../types";
import { Logger } from "../utils/logger";

const logger = Logger.create("PricingEngine");

/**
 * Standard Anthropic prompt-cache multipliers, identical across all current
 * Claude models: 5-minute cache write 1.25x base input, 1-hour cache write 2x,
 * cache read 0.1x. Verified against platform.claude.com/docs/en/about-claude/pricing
 * (June 2026).
 */
const STD_CACHE = {
	cache5mWriteMultiplier: 1.25,
	cache1hWriteMultiplier: 2.0,
	cacheReadMultiplier: 0.1,
} as const;

/** Build a ModelPricing row from base input/output rates + the standard cache multipliers. */
function priced(
	inputPerMillion: number,
	outputPerMillion: number,
): ModelPricing {
	return { inputPerMillion, outputPerMillion, ...STD_CACHE };
}

/**
 * Default per-million-token USD pricing, verified against Anthropic's official
 * pricing page (June 2026). Opus 4.5-4.8 share $5/$25; Sonnet 4.5/4.6 $3/$15;
 * Haiku 4.5 $1/$5; Haiku 3.5 (retired) $0.80/$4. Unknown/newer model strings are
 * resolved by family in resolveModelPricing().
 */
const DEFAULT_PRICING: Record<string, ModelPricing> = {
	"claude-opus-4-8": priced(5.0, 25.0),
	"claude-opus-4-7": priced(5.0, 25.0),
	"claude-opus-4-6": priced(5.0, 25.0),
	"claude-opus-4-5": priced(5.0, 25.0),
	"claude-sonnet-4-6": priced(3.0, 15.0),
	"claude-sonnet-4-5": priced(3.0, 15.0),
	"claude-haiku-4-5": priced(1.0, 5.0),
	"claude-haiku-3-5": priced(0.8, 4.0),
};

/**
 * Newest known model per family — used to price unknown/newer model strings
 * (e.g. a future opus version) at the correct family rate instead of mis-pricing.
 */
const FAMILY_FALLBACK: Record<"opus" | "sonnet" | "haiku", string> = {
	opus: "claude-opus-4-8",
	sonnet: "claude-sonnet-4-6",
	haiku: "claude-haiku-4-5",
};

/**
 * Zod schema for validating ModelPricing structure
 */
const ModelPricingSchema = z.object({
	inputPerMillion: z.number().nonnegative(),
	outputPerMillion: z.number().nonnegative(),
	cache5mWriteMultiplier: z.number().nonnegative(),
	cache1hWriteMultiplier: z.number().nonnegative(),
	cacheReadMultiplier: z.number().nonnegative(),
});

/**
 * Get default pricing table
 */
export function getDefaultPricing(): Record<string, ModelPricing> {
	return JSON.parse(JSON.stringify(DEFAULT_PRICING));
}

/**
 * Load pricing from VS Code configuration with user overrides
 */
export function loadPricingFromConfig(): Record<string, ModelPricing> {
	const config = vscode.workspace.getConfiguration("claude-usage");
	const userOverrides =
		config.get<Record<string, Partial<ModelPricing>>>("pricing");

	if (!userOverrides || Object.keys(userOverrides).length === 0) {
		return getDefaultPricing();
	}

	const merged = getDefaultPricing();

	for (const [modelName, override] of Object.entries(userOverrides)) {
		try {
			// Validate partial override and merge with defaults
			const validated = ModelPricingSchema.partial().parse(override);
			const base = merged[modelName] ?? DEFAULT_PRICING["claude-sonnet-4-5"];
			merged[modelName] = { ...base, ...validated };
			logger.info(`Applied pricing override for model: ${modelName}`);
		} catch (error) {
			logger.warn(
				`Invalid pricing override for ${modelName}, using defaults. Error: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	return merged;
}

/**
 * Resolve the pricing row for a model string.
 *
 * Resolution order: exact match -> billability gate -> prefix match (handles
 * dated ids like "claude-opus-4-8-20260514") -> newest-in-family fallback.
 * Returns null for NON-BILLABLE models (e.g. "<synthetic>", title generation,
 * embeddings) so they contribute 0 cost instead of being mis-priced as a real
 * model — the old blanket Sonnet fallback inflated totals with such noise.
 */
export function resolveModelPricing(
	model: string,
	pricing: Record<string, ModelPricing>,
): ModelPricing | null {
	// 1. Exact match (the common case once the model is in the table)
	const exact = pricing[model];
	if (exact) {
		return exact;
	}

	// 2. Billability gate: only Claude opus/sonnet/haiku models have a token cost
	const lower = model.toLowerCase();
	const family = lower.includes("opus")
		? "opus"
		: lower.includes("sonnet")
			? "sonnet"
			: lower.includes("haiku")
				? "haiku"
				: null;
	if (family === null) {
		return null;
	}

	// 3. Prefix match in either direction (dated / suffixed model ids)
	for (const [key, value] of Object.entries(pricing)) {
		if (model.startsWith(key) || key.startsWith(model)) {
			return value;
		}
	}

	// 4. Family fallback: price an unknown/newer version as the newest known
	//    model in the same family (e.g. a future opus -> claude-opus-4-8)
	return pricing[FAMILY_FALLBACK[family]] ?? null;
}

/**
 * Calculate cost for a single TokenUsage record
 */
export function calculateCost(
	usage: TokenUsage,
	pricing: Record<string, ModelPricing>,
): number {
	const modelPricing = resolveModelPricing(usage.model, pricing);

	// Non-billable model (e.g. "<synthetic>") -> no cost
	if (!modelPricing) {
		return 0;
	}

	// Input tokens cost
	const inputCost =
		(usage.inputTokens / 1_000_000) * modelPricing.inputPerMillion;

	// Output tokens cost
	const outputCost =
		(usage.outputTokens / 1_000_000) * modelPricing.outputPerMillion;

	// Cache creation cost
	let cacheCreationCost = 0;

	if (usage.cacheCreation5m > 0 || usage.cacheCreation1h > 0) {
		// We have breakdown data, use specific multipliers
		const cache5mCost =
			(usage.cacheCreation5m / 1_000_000) *
			modelPricing.inputPerMillion *
			modelPricing.cache5mWriteMultiplier;

		const cache1hCost =
			(usage.cacheCreation1h / 1_000_000) *
			modelPricing.inputPerMillion *
			modelPricing.cache1hWriteMultiplier;

		cacheCreationCost = cache5mCost + cache1hCost;
	} else if (usage.cacheCreationTokens > 0) {
		// No breakdown, default to 5m multiplier
		cacheCreationCost =
			(usage.cacheCreationTokens / 1_000_000) *
			modelPricing.inputPerMillion *
			modelPricing.cache5mWriteMultiplier;
	}

	// Cache read cost
	const cacheReadCost =
		(usage.cacheReadTokens / 1_000_000) *
		modelPricing.inputPerMillion *
		modelPricing.cacheReadMultiplier;

	return inputCost + outputCost + cacheCreationCost + cacheReadCost;
}
