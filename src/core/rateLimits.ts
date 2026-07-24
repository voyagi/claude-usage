/**
 * Rate limit calculation engine
 * Computes rate limit percentages from time buckets and plan configuration
 */

import {
	addDays,
	addHours,
	differenceInHours,
	differenceInMinutes,
	format,
	startOfWeek,
	subHours,
} from "date-fns";
import {
	dailyBucketKey,
	parseHourlyBucketKey,
	sumModelOutputTokensInWindow,
	sumOutputTokensInWindow,
	weeklyBucketKey,
} from "../aggregation/timeBuckets.js";
import { getStaleness } from "../api/usageCache.js";
import { getPlanConfig } from "../pricing/plans.js";
import type {
	AggregatedUsage,
	ApiUsageData,
	PlanType,
	RateLimitInfo,
	RateLimitStatus,
	RefinedLimits,
	StatusBarData,
	TimeBuckets,
} from "../types.js";
import { projectWeeklyCycle } from "./weeklyAnchor.js";

/**
 * Match a scoped-limit display label (e.g. "Fable") against a model id
 * (e.g. "claude-fable-5"). The API labels the scoped model by display name, so
 * a case-insensitive containment check is the only stable link between the two.
 */
export function modelMatchesScopeLabel(model: string, label: string): boolean {
	const needle = label.trim().toLowerCase();
	if (!needle) return false;
	return model.toLowerCase().includes(needle);
}

/**
 * Facts about the account that only the API can tell us, carried across polls.
 *
 * Grouped rather than passed as two adjacent nullable strings: in positional
 * form a caller could swap them and every type check would still pass.
 */
export interface LearnedApiFacts {
	/**
	 * Display name of the model the weekly scoped limit applies to (e.g.
	 * "Fable"). When absent the scoped limit is reported as null rather than
	 * guessed -- Anthropic changes which model is scoped, so assuming one
	 * produces a confidently wrong bar.
	 */
	scopedModel?: string | null;
	/**
	 * A weekly reset instant the API supplied, ISO. Anchors the account's real
	 * cycle. When absent the calendar week is used, which is a guess: it is the
	 * right length and almost certainly the wrong phase.
	 */
	weeklyAnchor?: string | null;
}

/**
 * Whether an hourly-grained level can answer for the cycle window.
 *
 * A level that predates the persisted state being read deserializes to an
 * empty map, and summing an empty map yields zero -- which reads as "no usage
 * this cycle" rather than "not parsed yet". Falling back to the calendar-week
 * bucket for that one render is wrong by a few days of phase; reporting zero is
 * wrong by the entire cycle.
 */
function canMeasureCycle(
	level: Map<string, AggregatedUsage> | undefined,
	fallback: Map<string, AggregatedUsage>,
): level is Map<string, AggregatedUsage> {
	if (!level) return false;
	return level.size > 0 || fallback.size === 0;
}

/**
 * Calculate rate limit status for the session, weekly, and model-scoped limits.
 */
export function calculateRateLimits(
	buckets: TimeBuckets,
	planType: PlanType,
	refinedLimits?: RefinedLimits | null,
	learned?: LearnedApiFacts | null,
): RateLimitStatus {
	const scopedModelLabel = learned?.scopedModel;
	const plan = getPlanConfig(planType);
	const now = new Date();

	// Merge refined limits with plan config (refined overrides plan defaults)
	const effectiveSessionLimit =
		refinedLimits?.sessionTokenLimit ?? plan.sessionTokenLimit;
	const effectiveWeeklyLimit =
		refinedLimits?.weeklyTokenLimit ?? plan.weeklyTokenLimit;
	const effectiveScopedLimit =
		refinedLimits?.weeklyScopedLimit ?? plan.weeklyScopedLimit;

	// Session 5hr limit: Sum output tokens from hourly buckets within the last 5 hours
	// Using hourly buckets instead of session aggregates avoids over-counting
	// sessions that started before the 5hr window
	const fiveHoursAgo = subHours(now, 5);
	let sessionTokens = 0;
	let oldestSessionTime: Date | null = null;

	for (const [hourKey, agg] of buckets.hourly.entries()) {
		const hourDate = parseHourlyBucketKey(hourKey);
		if (hourDate && hourDate >= fiveHoursAgo) {
			sessionTokens += agg.outputTokens;
			if (!oldestSessionTime || hourDate < oldestSessionTime) {
				oldestSessionTime = hourDate;
			}
		}
	}

	const session5h: RateLimitInfo = {
		name: "Session (5hr)",
		currentTokens: sessionTokens,
		estimatedLimit: effectiveSessionLimit ?? 0,
		percentage: effectiveSessionLimit
			? Math.min(100, Math.round((sessionTokens / effectiveSessionLimit) * 100))
			: 0,
		resetTime: oldestSessionTime ? addHours(oldestSessionTime, 5) : null,
		isHit: effectiveSessionLimit
			? sessionTokens / effectiveSessionLimit >= 1.0
			: false,
	};

	// Weekly limit.
	//
	// Anthropic resets this on a fixed instant assigned to the account, not on a
	// calendar boundary: two captured payloads a week apart both reset at 08:00
	// UTC on a Friday. So when the API has told us that instant, both the window
	// we count over and the reset we report come from it. The Monday-to-Sunday
	// ISO week below is the fallback for an account we have never had a reading
	// for, and it can be out of phase by as much as six days.
	const weekStart = startOfWeek(now, { weekStartsOn: 1 }); // Monday
	const weekKey = weeklyBucketKey(now);
	const cycle = projectWeeklyCycle(learned?.weeklyAnchor, now);

	const weeklyTokens =
		cycle && canMeasureCycle(buckets.hourly, buckets.weekly)
			? sumOutputTokensInWindow(
					buckets.hourly,
					cycle.cycleStart,
					cycle.nextReset,
				)
			: (buckets.weekly.get(weekKey)?.outputTokens ?? 0);

	const weekly: RateLimitInfo = {
		name: "Weekly",
		currentTokens: weeklyTokens,
		estimatedLimit: effectiveWeeklyLimit ?? 0,
		percentage: effectiveWeeklyLimit
			? Math.min(100, Math.round((weeklyTokens / effectiveWeeklyLimit) * 100))
			: 0,
		resetTime: cycle ? cycle.nextReset : addDays(weekStart, 7),
		isHit: effectiveWeeklyLimit
			? weeklyTokens / effectiveWeeklyLimit >= 1.0
			: false,
	};

	// Weekly scoped limit: output tokens for the model the API says is scoped.
	// Without that label we cannot know which model counts, so we report nothing
	// instead of defaulting to a model that may no longer be the scoped one.
	let weeklyScoped: RateLimitInfo | null = null;
	if (scopedModelLabel) {
		const matchesScope = (model: string) =>
			modelMatchesScopeLabel(model, scopedModelLabel);

		let scopedTokens: number;
		if (cycle && canMeasureCycle(buckets.modelHourly, buckets.modelWeekly)) {
			scopedTokens = sumModelOutputTokensInWindow(
				buckets.modelHourly,
				cycle.cycleStart,
				cycle.nextReset,
				matchesScope,
			);
		} else {
			scopedTokens = 0;
			for (const [key, agg] of buckets.modelWeekly.entries()) {
				// Key format: "RRRR-WII:model-name" (see weeklyBucketKey)
				if (!key.startsWith(`${weekKey}:`)) continue;
				if (matchesScope(key.slice(weekKey.length + 1))) {
					scopedTokens += agg.outputTokens;
				}
			}
		}

		weeklyScoped = {
			name: `Weekly ${scopedModelLabel}`,
			currentTokens: scopedTokens,
			estimatedLimit: effectiveScopedLimit ?? 0,
			percentage: effectiveScopedLimit
				? Math.min(100, Math.round((scopedTokens / effectiveScopedLimit) * 100))
				: 0,
			// Same instant as the weekly limit above: the captured payloads show
			// the scoped limit sharing the account's anchor, not carrying its own.
			resetTime: cycle ? cycle.nextReset : addDays(weekStart, 7),
			isHit: effectiveScopedLimit
				? scopedTokens / effectiveScopedLimit >= 1.0
				: false,
		};
	}

	const worstPercentage = Math.max(
		session5h.percentage,
		weekly.percentage,
		weeklyScoped?.percentage ?? 0,
	);

	return {
		session5h,
		weekly,
		weeklyScoped,
		worstPercentage,
	};
}

/**
 * Calculate urgency score for a rate limit
 * Higher score = more urgent (high percentage + imminent reset)
 * Formula: percentage * (1 / sqrt(max(1, hoursUntilReset)))
 * Returns 0 if limit is idle or no reset time
 */
export function calculateUrgencyScore(limit: RateLimitInfo, now: Date): number {
	if (limit.percentage === 0 || !limit.resetTime) {
		return 0;
	}

	const hoursUntilReset = differenceInHours(limit.resetTime, now);
	if (hoursUntilReset <= 0) {
		return 0;
	}

	return limit.percentage * (1 / Math.sqrt(Math.max(1, hoursUntilReset)));
}

/**
 * Calculate burn rate (tokens per minute) from recent session activity
 */
export function calculateBurnRate(buckets: TimeBuckets): number {
	const now = new Date();
	const tenMinutesAgo = subHours(now, 0).setMinutes(now.getMinutes() - 10);
	const tenMinutesAgoDate = new Date(tenMinutesAgo);

	let recentTokens = 0;
	let earliestTime: Date | null = null;

	for (const [_sessionId, agg] of buckets.session.entries()) {
		if (agg.lastMessage && agg.lastMessage >= tenMinutesAgoDate) {
			recentTokens += agg.outputTokens;
			if (
				agg.firstMessage &&
				(!earliestTime || agg.firstMessage < earliestTime)
			) {
				earliestTime = agg.firstMessage;
			}
		}
	}

	if (recentTokens === 0 || !earliestTime) {
		return 0;
	}

	const minutesElapsed = differenceInMinutes(now, earliestTime);
	if (minutesElapsed === 0) {
		return 0;
	}

	return recentTokens / minutesElapsed;
}

/**
 * Build complete StatusBarData from time buckets
 * @param burnRateOverride - Optional EMA-smoothed burn rate (defaults to simple 10-min calculation)
 * @param learned - Facts persisted from earlier API readings, used when the API
 *   is unreachable so the scoped bar does not vanish and the weekly window does
 *   not fall back to a calendar week that is out of phase with the account
 */
export function buildStatusBarData(
	buckets: TimeBuckets,
	stats: { filesProcessed: number; linesSkipped: number },
	planType: PlanType,
	burnRateOverride?: number,
	refinedLimits?: RefinedLimits | null,
	apiUsage?: ApiUsageData | null,
	learned?: LearnedApiFacts | null,
): StatusBarData {
	const now = new Date();
	const today = dailyBucketKey(now);
	const thisMonth = format(now, "yyyy-MM");

	// Aggregate totals from all daily buckets
	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let totalCost = 0;

	for (const agg of buckets.daily.values()) {
		totalInputTokens += agg.inputTokens;
		totalOutputTokens += agg.outputTokens;
		totalCost += agg.totalCost;
	}

	const todayData = buckets.daily.get(today);
	const monthData = buckets.monthly.get(thisMonth);

	/** All four token kinds, matching what the dashboard's breakdown shows. */
	const allTokens = (agg: AggregatedUsage | undefined): number =>
		agg
			? agg.inputTokens +
				agg.outputTokens +
				agg.cacheCreationTokens +
				agg.cacheReadTokens
			: 0;

	return {
		totalInputTokens,
		totalOutputTokens,
		totalCost,
		todayCost: todayData?.totalCost ?? 0,
		monthCost: monthData?.totalCost ?? 0,
		todayTokens: allTokens(todayData),
		monthTokens: allTokens(monthData),
		burnRate:
			burnRateOverride !== undefined
				? burnRateOverride
				: calculateBurnRate(buckets),
		rateLimits: calculateRateLimits(buckets, planType, refinedLimits, {
			// A live reading outranks the persisted one for both facts.
			scopedModel: apiUsage?.scopedWeekly[0]?.label ?? learned?.scopedModel,
			weeklyAnchor: apiUsage?.sevenDay?.resetsAt ?? learned?.weeklyAnchor,
		}),
		apiUsage: apiUsage ?? null,
		staleness: getStaleness(apiUsage?.fetchedAt ?? null),
		lastUpdated: now,
		filesProcessed: stats.filesProcessed,
		linesSkipped: stats.linesSkipped,
	};
}
