/**
 * Claude plan configurations
 */

import type { PlanConfig, PlanType } from "../types";

/**
 * Plan configurations with display names, monthly prices, and estimated token limits
 *
 * NOTE: Token limits are OUTPUT token estimates based on community reports (2026).
 * "5x" and "20x" refer to overall monthly capacity, NOT per-session multipliers.
 * Per-session limits scale roughly ~2x/~5x from Pro, not 5x/20x.
 * Users can override via settings. Auto-learning refines from observed 429 events.
 *
 * `weeklyScopedLimit` covers the model-scoped weekly limit. Which model it
 * applies to is chosen by Anthropic and has changed over time (Sonnet -> Opus ->
 * Fable as of 2026-07), so the estimate is deliberately model-agnostic; the API
 * supplies the real percentage and the model's name when it is reachable.
 */
export const PLAN_CONFIGS: Record<PlanType, PlanConfig> = {
	pro: {
		type: "pro",
		displayName: "Pro ($20/mo)",
		monthlyPrice: 20,
		sessionTokenLimit: 44_000, // ~44K output tokens per 5hr session
		weeklyTokenLimit: 500_000, // ~500K output tokens per week
		weeklyScopedLimit: 500_000, // ~500K scoped-model output tokens per week
	},
	max5: {
		type: "max5",
		displayName: "Max 5x ($100/mo)",
		monthlyPrice: 100,
		sessionTokenLimit: 80_000, // ~80K output tokens per 5hr session (~2x Pro)
		weeklyTokenLimit: 900_000, // ~900K output tokens per week
		weeklyScopedLimit: 900_000, // ~900K scoped-model output tokens per week
	},
	max20: {
		type: "max20",
		displayName: "Max 20x ($200/mo)",
		monthlyPrice: 200,
		sessionTokenLimit: 220_000, // ~220K output tokens per 5hr session (~5x Pro)
		weeklyTokenLimit: 4_000_000, // ~4M output tokens per week
		weeklyScopedLimit: 4_000_000, // ~4M scoped-model output tokens per week
	},
};

/**
 * Get plan configuration by type
 */
export function getPlanConfig(type: PlanType): PlanConfig {
	return PLAN_CONFIGS[type];
}
