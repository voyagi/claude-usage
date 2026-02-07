/**
 * Tier Detection from Credentials
 *
 * Pure data module - no VS Code dependencies
 * Auto-detects Claude plan tier from ~/.claude/.credentials.json
 */

import { PlanType } from '../types';

/**
 * Parsed credentials structure
 */
export interface CredentialsData {
  rateLimitTier?: string;
  subscriptionType?: string;
}

/**
 * Parse credentials file content
 *
 * @param content JSON string from credentials file
 * @returns Parsed credentials or null if invalid JSON
 */
export function parseCredentialsFile(content: string): CredentialsData | null {
  try {
    const parsed = JSON.parse(content);
    const result: CredentialsData = {};

    if (parsed.rateLimitTier) {
      result.rateLimitTier = parsed.rateLimitTier;
    }
    if (parsed.subscriptionType) {
      result.subscriptionType = parsed.subscriptionType;
    }

    return result;
  } catch (error) {
    // Invalid JSON - return null for graceful degradation
    return null;
  }
}

/**
 * Detect plan tier from credentials
 *
 * @param credentials Parsed credentials data (or null if file missing/invalid)
 * @param fallback Default tier to use if detection fails
 * @returns Detected plan type
 */
export function detectTierFromCredentials(
  credentials: CredentialsData | null,
  fallback: PlanType
): PlanType {
  if (!credentials) {
    return fallback;
  }

  // Check rateLimitTier field (case-insensitive)
  if (credentials.rateLimitTier) {
    const tier = credentials.rateLimitTier.toLowerCase();

    if (tier.includes('max_20')) {
      return 'max20';
    }
    if (tier.includes('max_5')) {
      return 'max5';
    }
  }

  // Check subscriptionType field
  if (credentials.subscriptionType === 'pro') {
    return 'pro';
  }

  // No match - use fallback
  return fallback;
}
