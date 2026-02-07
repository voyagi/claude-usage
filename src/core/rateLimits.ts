/**
 * Rate limit calculation engine
 * Computes rate limit percentages from time buckets and plan configuration
 */

import { startOfWeek, addDays, addHours, differenceInMinutes, differenceInHours, subHours } from 'date-fns';
import type { TimeBuckets, RateLimitInfo, RateLimitStatus, StatusBarData, PlanType } from '../types.js';
import { getPlanConfig } from '../pricing/plans.js';
import { format } from 'date-fns';

/**
 * Calculate rate limit status for all three limits
 */
export function calculateRateLimits(
  buckets: TimeBuckets,
  planType: PlanType
): RateLimitStatus {
  const plan = getPlanConfig(planType);
  const now = new Date();

  // Session 5hr limit: Sum output tokens from sessions with lastMessage in last 5 hours
  const fiveHoursAgo = subHours(now, 5);
  let sessionTokens = 0;
  let oldestSessionTime: Date | null = null;

  for (const [sessionId, agg] of buckets.session.entries()) {
    if (agg.lastMessage && agg.lastMessage >= fiveHoursAgo) {
      sessionTokens += agg.outputTokens;
      if (!oldestSessionTime || (agg.firstMessage && agg.firstMessage < oldestSessionTime)) {
        oldestSessionTime = agg.firstMessage;
      }
    }
  }

  const session5h: RateLimitInfo = {
    name: 'Session (5hr)',
    currentTokens: sessionTokens,
    estimatedLimit: plan.sessionTokenLimit ?? 0,
    percentage: plan.sessionTokenLimit
      ? Math.min(100, Math.round((sessionTokens / plan.sessionTokenLimit) * 100))
      : 0,
    resetTime: oldestSessionTime ? addHours(oldestSessionTime, 5) : null,
    isHit: plan.sessionTokenLimit ? (sessionTokens / plan.sessionTokenLimit) >= 1.0 : false,
  };

  // Weekly limit: Sum output tokens from current ISO week
  const weekStart = startOfWeek(now, { weekStartsOn: 1 }); // Monday
  const weekKey = format(weekStart, "yyyy-'W'II");
  const weekData = buckets.weekly.get(weekKey);
  const weeklyTokens = weekData?.outputTokens ?? 0;

  const weekly: RateLimitInfo = {
    name: 'Weekly',
    currentTokens: weeklyTokens,
    estimatedLimit: plan.weeklyTokenLimit ?? 0,
    percentage: plan.weeklyTokenLimit
      ? Math.min(100, Math.round((weeklyTokens / plan.weeklyTokenLimit) * 100))
      : 0,
    resetTime: addDays(weekStart, 7),
    isHit: plan.weeklyTokenLimit ? (weeklyTokens / plan.weeklyTokenLimit) >= 1.0 : false,
  };

  // Weekly Sonnet limit: Same as weekly for now (no per-model aggregation yet)
  // TODO: Filter by model name once per-model weekly aggregation exists in TimeBuckets
  const weeklySonnetTokens = weekData?.outputTokens ?? 0;

  const weeklySonnet: RateLimitInfo = {
    name: 'Weekly Sonnet',
    currentTokens: weeklySonnetTokens,
    estimatedLimit: plan.weeklySonnetLimit ?? 0,
    percentage: plan.weeklySonnetLimit
      ? Math.min(100, Math.round((weeklySonnetTokens / plan.weeklySonnetLimit) * 100))
      : 0,
    resetTime: addDays(weekStart, 7),
    isHit: plan.weeklySonnetLimit ? (weeklySonnetTokens / plan.weeklySonnetLimit) >= 1.0 : false,
  };

  const worstPercentage = Math.max(
    session5h.percentage,
    weekly.percentage,
    weeklySonnet.percentage
  );

  return {
    session5h,
    weekly,
    weeklySonnet,
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

  for (const [sessionId, agg] of buckets.session.entries()) {
    if (agg.lastMessage && agg.lastMessage >= tenMinutesAgoDate) {
      recentTokens += agg.outputTokens;
      if (agg.firstMessage && (!earliestTime || agg.firstMessage < earliestTime)) {
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
 */
export function buildStatusBarData(
  buckets: TimeBuckets,
  stats: { filesProcessed: number; linesSkipped: number },
  planType: PlanType,
  burnRateOverride?: number
): StatusBarData {
  const now = new Date();
  const today = format(now, 'yyyy-MM-dd');
  const thisMonth = format(now, 'yyyy-MM');

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

  return {
    totalInputTokens,
    totalOutputTokens,
    totalCost,
    todayCost: todayData?.totalCost ?? 0,
    monthCost: monthData?.totalCost ?? 0,
    burnRate: burnRateOverride !== undefined ? burnRateOverride : calculateBurnRate(buckets),
    rateLimits: calculateRateLimits(buckets, planType),
    lastUpdated: now,
    filesProcessed: stats.filesProcessed,
    linesSkipped: stats.linesSkipped,
  };
}
