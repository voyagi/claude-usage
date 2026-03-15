/**
 * Tier Detection from Credentials
 *
 * Pure data module - no VS Code dependencies
 * Auto-detects Claude plan tier from ~/.claude/.credentials.json
 */

import type { PlanType } from "../types";

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
	} catch (_error) {
		// Invalid JSON - return null for graceful degradation
		return null;
	}
}

/**
 * Map a tier string (from API or credentials) to a PlanType
 * Returns null if the string doesn't match any known tier
 */
export function mapTierStringToPlanType(tier: string): PlanType | null {
	const lower = tier.toLowerCase();
	if (lower.includes("max_20") || lower.includes("max20")) return "max20";
	if (lower.includes("max_5") || lower.includes("max5")) return "max5";
	if (lower.includes("pro") || lower.includes("standard")) return "pro";
	return null;
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
	fallback: PlanType,
): PlanType {
	if (!credentials) {
		return fallback;
	}

	// Check rateLimitTier field
	if (credentials.rateLimitTier) {
		const mapped = mapTierStringToPlanType(credentials.rateLimitTier);
		if (mapped) return mapped;
	}

	// Check subscriptionType field
	if (credentials.subscriptionType) {
		const mapped = mapTierStringToPlanType(credentials.subscriptionType);
		if (mapped) return mapped;
	}

	// No match - use fallback
	return fallback;
}
