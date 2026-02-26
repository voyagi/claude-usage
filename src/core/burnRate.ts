/**
 * Burn Rate Calculator with EMA Smoothing
 *
 * Pure data module - no VS Code dependencies
 */

import { differenceInMinutes, subMinutes } from "date-fns";
import type { TimeBuckets } from "../types";

/**
 * Burn rate tracker state
 */
export interface BurnRateTracker {
	ema: number; // Current EMA value (tokens/min)
	lastUpdate: Date; // Last calculation timestamp
	alpha: number; // Smoothing factor (0-1)
}

/**
 * Create a new burn rate tracker
 * @param alpha Smoothing factor (default 0.2). Higher = more responsive to recent changes
 */
export function createBurnRateTracker(alpha: number = 0.2): BurnRateTracker {
	return {
		ema: 0,
		lastUpdate: new Date(),
		alpha,
	};
}

/**
 * Calculate burn rate with EMA smoothing
 *
 * @param buckets Time buckets with session data
 * @param tracker Current tracker state
 * @param lookbackMinutes How far back to look for activity (e.g., 300 for 5 hours)
 * @returns Updated rate and tracker (immutable - new tracker object)
 */
export function calculateBurnRateEMA(
	buckets: TimeBuckets,
	tracker: BurnRateTracker,
	lookbackMinutes: number,
): { rate: number; tracker: BurnRateTracker } {
	const now = new Date();
	const cutoffTime = subMinutes(now, lookbackMinutes);

	// Sum output tokens from sessions with activity in lookback window
	let totalOutputTokens = 0;
	let earliestActiveMessage: Date | null = null;
	let latestActiveMessage: Date | null = null;

	for (const session of buckets.session.values()) {
		if (session.lastMessage && session.lastMessage >= cutoffTime) {
			totalOutputTokens += session.outputTokens;

			// Track time span of active sessions
			if (session.firstMessage) {
				if (
					!earliestActiveMessage ||
					session.firstMessage < earliestActiveMessage
				) {
					earliestActiveMessage = session.firstMessage;
				}
			}
			if (session.lastMessage) {
				if (!latestActiveMessage || session.lastMessage > latestActiveMessage) {
					latestActiveMessage = session.lastMessage;
				}
			}
		}
	}

	// No activity in window
	if (
		totalOutputTokens === 0 ||
		!earliestActiveMessage ||
		!latestActiveMessage
	) {
		return {
			rate: 0,
			tracker: {
				...tracker,
				ema: 0,
				lastUpdate: now,
			},
		};
	}

	// Calculate current rate: tokens per minute over actual time span
	const timeSpanMinutes = differenceInMinutes(now, earliestActiveMessage);
	const currentRate =
		timeSpanMinutes > 0 ? totalOutputTokens / timeSpanMinutes : 0;

	// Apply EMA: newEma = alpha * currentRate + (1 - alpha) * oldEma
	const newEma =
		tracker.alpha * currentRate + (1 - tracker.alpha) * tracker.ema;

	return {
		rate: Math.max(0, newEma), // Never negative
		tracker: {
			...tracker,
			ema: newEma,
			lastUpdate: now,
		},
	};
}

/**
 * Predict minutes until rate limit is hit
 *
 * @param currentTokens Tokens consumed so far
 * @param limitTokens Estimated limit
 * @param burnRatePerMin Current burn rate (tokens/min)
 * @returns Minutes remaining, 0 if at/over limit, null if burn rate is 0
 */
export function predictTimeUntilLimit(
	currentTokens: number,
	limitTokens: number,
	burnRatePerMin: number,
): number | null {
	// Can't predict if no burn rate
	if (burnRatePerMin === 0) {
		return null;
	}

	// Already at or over limit
	if (currentTokens >= limitTokens) {
		return 0;
	}

	// Calculate minutes remaining
	const tokensRemaining = limitTokens - currentTokens;
	const minutesRemaining = tokensRemaining / burnRatePerMin;

	// Cap at reasonable max to avoid displaying Infinity
	return Math.min(minutesRemaining, 999999);
}
