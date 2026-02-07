/**
 * Claude plan configurations
 */

import { PlanType, PlanConfig } from '../types';

/**
 * Plan configurations with display names and monthly prices
 */
export const PLAN_CONFIGS: Record<PlanType, PlanConfig> = {
  pro: {
    type: 'pro',
    displayName: 'Pro ($20/mo)',
    monthlyPrice: 20,
  },
  max5: {
    type: 'max5',
    displayName: 'Max 5x ($100/mo)',
    monthlyPrice: 100,
  },
  max20: {
    type: 'max20',
    displayName: 'Max 20x ($200/mo)',
    monthlyPrice: 200,
  },
};

/**
 * Get plan configuration by type
 */
export function getPlanConfig(type: PlanType): PlanConfig {
  return PLAN_CONFIGS[type];
}
