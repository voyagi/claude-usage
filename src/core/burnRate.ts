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
 * @returns Minutes remaining, 0 if at/over limit, null if burn rate <= 0 or any input is NaN
 */
export function predictTimeUntilLimit(
	currentTokens: number,
	limitTokens: number,
	burnRatePerMin: number,
): number | null {
	// Can't predict from NaN inputs (they propagate to a NaN result).
	// Infinity is allowed through: it resolves to 0 or the 999999 cap below.
	if (
		Number.isNaN(currentTokens) ||
		Number.isNaN(limitTokens) ||
		Number.isNaN(burnRatePerMin)
	) {
		return null;
	}

	// Can't predict without a positive burn rate or a known limit
	if (burnRatePerMin <= 0 || limitTokens <= 0) {
		return null;
	}

	// Already at or over limit
	if (currentTokens >= limitTokens) {
		return 0;
	}

	// Calculate minutes remaining
	const tokensRemaining = limitTokens - currentTokens;
	const minutesRemaining = tokensRemaining / burnRatePerMin;

	// Cap at reasonable max to avoid displaying Infinity. Infinity inputs can
	// make minutesRemaining Infinity or NaN (e.g. Infinity / Infinity); clamp
	// those to the cap so the `number | null` contract is always honored.
	if (!Number.isFinite(minutesRemaining)) {
		return 999999;
	}
	return Math.min(minutesRemaining, 999999);
}

/**
 * Forecast for the weekly cap. Uses recent DAILY consumption rather than the
 * short-window burn rate — extrapolating a 15-minute tokens/min rate across a
 * 7-day window would be wildly misleading (nobody codes 24/7). Answers the
 * under-served question "will I hit my weekly cap before it resets?".
 */
export interface WeeklyCapForecast {
	daysUntilCap: number; // days to exhaust the remaining weekly budget at that pace
	daysUntilReset: number; // days until the weekly window resets
	willExceedBeforeReset: boolean; // daysUntilCap < daysUntilReset
	/**
	 * Recent average daily output tokens. Only set for the local-estimate
	 * forecast; null when the projection came from the API, where there is no
	 * token figure to quote.
	 */
	avgDailyTokens: number | null;
	/**
	 * True when derived from the API's own utilization. A local forecast is a
	 * guess against a community-estimated plan cap and must say so.
	 */
	isFromApi: boolean;
}

/** A weekly limit window is 7 days. */
const WEEKLY_WINDOW_DAYS = 7;

/**
 * How much of the window must have elapsed before a pace is worth extrapolating.
 *
 * The firing rule reduces to `used% > 100 * elapsed / 7`, which is scale-free:
 * the less time has elapsed, the less usage it takes to project an overrun. Half
 * an hour into a window, 1% used extrapolates to 48%/day and predicts the cap in
 * two days. That is arithmetically true and practically meaningless -- one large
 * request right after a reset should not raise an alarm. Below this threshold no
 * forecast is offered at all, which is the honest answer rather than a confident
 * one from a sample too short to mean anything.
 */
const MIN_ELAPSED_DAYS_FOR_FORECAST = 1;

/**
 * Forecast the weekly cap from the API's own utilization.
 *
 * Preferred over the local-token version whenever the API is reachable, because
 * the two disagree badly: local output tokens are counted over an ISO calendar
 * week and compared against a community-estimated plan cap, while the API
 * reports a true percentage over its own rolling window. On a real account the
 * local view read 373% of cap ("you will hit the cap within the hour") while the
 * API read 65% with two days left -- the warning was pure artefact.
 *
 * Pace is the average across the elapsed part of the window, which is the only
 * rate derivable from a single utilization reading. It therefore under-reacts to
 * a burst that started recently.
 *
 * @param utilization Fraction of the weekly limit consumed (0-1)
 * @param daysUntilReset Days until the weekly window resets
 * @returns Forecast, or null when a pace cannot be derived yet
 */
export function forecastWeeklyCapFromUtilization(
	utilization: number,
	daysUntilReset: number,
): WeeklyCapForecast | null {
	if (Number.isNaN(utilization) || Number.isNaN(daysUntilReset)) {
		return null;
	}

	const elapsedDays = WEEKLY_WINDOW_DAYS - daysUntilReset;
	// Too early in the window to extrapolate, or nothing used yet. The upper
	// guard also covers a reset instant, clock skew, and a window that turns out
	// not to be 7 days, all of which would otherwise divide by <= 0.
	if (
		elapsedDays < MIN_ELAPSED_DAYS_FOR_FORECAST ||
		daysUntilReset <= 0 ||
		utilization <= 0
	) {
		return null;
	}

	const usedPercent = Math.min(100, utilization * 100);
	const percentPerDay = usedPercent / elapsedDays;
	if (percentPerDay <= 0) {
		return null;
	}

	const daysUntilCap = Math.min((100 - usedPercent) / percentPerDay, 999);

	return {
		daysUntilCap,
		daysUntilReset,
		willExceedBeforeReset: daysUntilCap < daysUntilReset,
		avgDailyTokens: null,
		isFromApi: true,
	};
}

/**
 * Compute the weekly-cap forecast from already-derived inputs.
 *
 * @param currentWeeklyTokens Output tokens used in the current weekly window
 * @param weeklyLimitTokens Estimated weekly output-token cap
 * @param avgDailyTokens Recent average daily output tokens (e.g. last 7 days / 7)
 * @param daysUntilReset Days until the weekly window resets
 * @returns Forecast, or null when it can't be computed (no limit / no recent pace / NaN)
 */
export function forecastWeeklyCap(
	currentWeeklyTokens: number,
	weeklyLimitTokens: number,
	avgDailyTokens: number,
	daysUntilReset: number,
): WeeklyCapForecast | null {
	if (
		Number.isNaN(currentWeeklyTokens) ||
		Number.isNaN(weeklyLimitTokens) ||
		Number.isNaN(avgDailyTokens) ||
		Number.isNaN(daysUntilReset)
	) {
		return null;
	}

	// Need a known cap and a positive recent pace to project anything
	if (weeklyLimitTokens <= 0 || avgDailyTokens <= 0) {
		return null;
	}

	const remaining = Math.max(0, weeklyLimitTokens - currentWeeklyTokens);
	// Cap the projection so an essentially-idle pace doesn't render as Infinity
	const daysUntilCap = Math.min(remaining / avgDailyTokens, 999);

	return {
		avgDailyTokens,
		daysUntilCap,
		daysUntilReset,
		willExceedBeforeReset: daysUntilCap < daysUntilReset,
		isFromApi: false,
	};
}
