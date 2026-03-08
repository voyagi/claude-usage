/**
 * Pricing engine for cost calculations
 */

import * as vscode from "vscode";
import { z } from "zod";
import type { ModelPricing, TokenUsage } from "../types";
import { Logger } from "../utils/logger";

const logger = Logger.create("PricingEngine");

/**
 * Default pricing as of Feb 2026 (from Claude.ai documentation)
 */
const DEFAULT_PRICING: Record<string, ModelPricing> = {
	"claude-opus-4-6": {
		inputPerMillion: 5.0,
		outputPerMillion: 25.0,
		cache5mWriteMultiplier: 1.25,
		cache1hWriteMultiplier: 2.0,
		cacheReadMultiplier: 0.1,
	},
	"claude-sonnet-4-5": {
		inputPerMillion: 3.0,
		outputPerMillion: 15.0,
		cache5mWriteMultiplier: 1.25,
		cache1hWriteMultiplier: 2.0,
		cacheReadMultiplier: 0.1,
	},
	"claude-haiku-3-5": {
		inputPerMillion: 0.8,
		outputPerMillion: 4.0,
		cache5mWriteMultiplier: 1.25,
		cache1hWriteMultiplier: 2.0,
		cacheReadMultiplier: 0.1,
	},
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
 * Calculate cost for a single TokenUsage record
 */
export function calculateCost(
	usage: TokenUsage,
	pricing: Record<string, ModelPricing>,
): number {
	let modelPricing = pricing[usage.model];

	// Fallback to claude-sonnet-4-5 if model not found (most common in Claude Code)
	if (!modelPricing) {
		logger.warn(
			`Model ${usage.model} not found in pricing table, using claude-sonnet-4-5 as fallback`,
		);
		modelPricing = pricing["claude-sonnet-4-5"];
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
