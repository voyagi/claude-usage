/**
 * Claude plan configurations
 */

import { PlanType, PlanConfig } from '../types';

/**
 * Plan configurations with display names, monthly prices, and estimated token limits
 *
 * NOTE: Token limits are OUTPUT token estimates based on community reports.
 * Exact limits are not publicly documented. Users can override via settings.
 * Phase 4 will refine estimates via observed rate-limit events.
 */
export const PLAN_CONFIGS: Record<PlanType, PlanConfig> = {
  pro: {
    type: 'pro',
    displayName: 'Pro ($20/mo)',
    monthlyPrice: 20,
    sessionTokenLimit: 45_000,      // ~45K output tokens per 5hr session
    weeklyTokenLimit: 500_000,      // ~500K output tokens per week
    weeklySonnetLimit: 500_000,     // ~500K Sonnet output tokens per week
  },
  max5: {
    type: 'max5',
    displayName: 'Max 5x ($100/mo)',
    monthlyPrice: 100,
    sessionTokenLimit: 225_000,     // ~225K output tokens per 5hr session (5x Pro)
    weeklyTokenLimit: 2_500_000,    // ~2.5M output tokens per week (5x Pro)
    weeklySonnetLimit: 2_500_000,   // ~2.5M Sonnet output tokens per week (5x Pro)
  },
  max20: {
    type: 'max20',
    displayName: 'Max 20x ($200/mo)',
    monthlyPrice: 200,
    sessionTokenLimit: 900_000,     // ~900K output tokens per 5hr session (20x Pro)
    weeklyTokenLimit: 10_000_000,   // ~10M output tokens per week (20x Pro)
    weeklySonnetLimit: 10_000_000,  // ~10M Sonnet output tokens per week (20x Pro)
  },
};

/**
 * Get plan configuration by type
 */
export function getPlanConfig(type: PlanType): PlanConfig {
  return PLAN_CONFIGS[type];
}
