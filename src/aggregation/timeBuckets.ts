/**
 * Time bucket aggregation for session, daily, weekly, and monthly rollups
 */

import { format, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import {
	addToAggregation,
	createEmptyAggregatedUsage,
} from "../parser/tokenCounter";
import type {
	AggregatedUsage,
	SerializedTimeBuckets,
	TimeBuckets,
	TokenUsage,
} from "../types";

/**
 * Aggregate TokenUsage records into time buckets
 * Groups records by session, calendar day, ISO week, and calendar month
 * Uses local timezone for calendar boundaries (matches user expectations)
 *
 * @param records Array of TokenUsage records to aggregate
 * @returns TimeBuckets with aggregated usage for each time granularity
 */
export function aggregateUsage(records: TokenUsage[]): TimeBuckets {
	const buckets: TimeBuckets = {
		session: new Map(),
		daily: new Map(),
		weekly: new Map(),
		monthly: new Map(),
		modelWeekly: new Map(),
	};

	for (const record of records) {
		// Session bucket: key = sessionId
		const sessionKey = record.sessionId;
		if (!buckets.session.has(sessionKey)) {
			buckets.session.set(sessionKey, createEmptyAggregatedUsage());
		}
		addToAggregation(buckets.session.get(sessionKey)!, record);

		// Daily bucket: key = YYYY-MM-DD (local timezone)
		const dayStart = startOfDay(record.timestamp);
		const dayKey = format(dayStart, "yyyy-MM-dd");
		if (!buckets.daily.has(dayKey)) {
			buckets.daily.set(dayKey, createEmptyAggregatedUsage());
		}
		addToAggregation(buckets.daily.get(dayKey)!, record);

		// Weekly bucket: key = YYYY-'W'II (ISO week, Monday start)
		const weekStart = startOfWeek(record.timestamp, { weekStartsOn: 1 });
		const weekKey = format(weekStart, "yyyy-'W'II");
		if (!buckets.weekly.has(weekKey)) {
			buckets.weekly.set(weekKey, createEmptyAggregatedUsage());
		}
		addToAggregation(buckets.weekly.get(weekKey)!, record);

		// Model-specific weekly bucket: key = "YYYY-'W'II:model-name"
		const modelWeekKey = `${weekKey}:${record.model}`;
		if (!buckets.modelWeekly.has(modelWeekKey)) {
			buckets.modelWeekly.set(modelWeekKey, createEmptyAggregatedUsage());
		}
		addToAggregation(buckets.modelWeekly.get(modelWeekKey)!, record);

		// Monthly bucket: key = YYYY-MM
		const monthStart = startOfMonth(record.timestamp);
		const monthKey = format(monthStart, "yyyy-MM");
		if (!buckets.monthly.has(monthKey)) {
			buckets.monthly.set(monthKey, createEmptyAggregatedUsage());
		}
		addToAggregation(buckets.monthly.get(monthKey)!, record);
	}

	return buckets;
}

/**
 * Merge two TimeBuckets together (additive)
 * For matching keys: adds values together
 * For non-matching keys: includes both
 * Updates firstMessage/lastMessage correctly (min/max)
 *
 * @param a First TimeBuckets
 * @param b Second TimeBuckets
 * @returns Merged TimeBuckets
 */
export function mergeTimeBuckets(a: TimeBuckets, b: TimeBuckets): TimeBuckets {
	const merged: TimeBuckets = {
		session: new Map(a.session),
		daily: new Map(a.daily),
		weekly: new Map(a.weekly),
		monthly: new Map(a.monthly),
		modelWeekly: new Map(a.modelWeekly),
	};

	// Helper to merge a bucket level
	const mergeBucket = (
		target: Map<string, AggregatedUsage>,
		source: Map<string, AggregatedUsage>,
	) => {
		for (const [key, sourceAgg] of source.entries()) {
			if (!target.has(key)) {
				// New key: deep copy sourceAgg
				target.set(key, { ...sourceAgg });
			} else {
				// Existing key: merge values
				const targetAgg = target.get(key)!;
				targetAgg.inputTokens += sourceAgg.inputTokens;
				targetAgg.outputTokens += sourceAgg.outputTokens;
				targetAgg.cacheCreationTokens += sourceAgg.cacheCreationTokens;
				targetAgg.cacheReadTokens += sourceAgg.cacheReadTokens;
				targetAgg.totalCost += sourceAgg.totalCost;
				targetAgg.messageCount += sourceAgg.messageCount;

				// Update timestamp range
				if (sourceAgg.firstMessage !== null) {
					if (
						targetAgg.firstMessage === null ||
						sourceAgg.firstMessage < targetAgg.firstMessage
					) {
						targetAgg.firstMessage = sourceAgg.firstMessage;
					}
				}
				if (sourceAgg.lastMessage !== null) {
					if (
						targetAgg.lastMessage === null ||
						sourceAgg.lastMessage > targetAgg.lastMessage
					) {
						targetAgg.lastMessage = sourceAgg.lastMessage;
					}
				}
			}
		}
	};

	mergeBucket(merged.session, b.session);
	mergeBucket(merged.daily, b.daily);
	mergeBucket(merged.weekly, b.weekly);
	mergeBucket(merged.monthly, b.monthly);
	mergeBucket(merged.modelWeekly, b.modelWeekly);

	return merged;
}

/**
 * Get summary statistics from TimeBuckets
 *
 * @param buckets TimeBuckets to summarize
 * @returns Summary statistics
 */
export function getTimeBucketSummary(buckets: TimeBuckets): {
	totalSessions: number;
	totalDays: number;
	totalCost: number;
	totalMessages: number;
} {
	let totalCost = 0;
	let totalMessages = 0;

	for (const agg of buckets.daily.values()) {
		totalCost += agg.totalCost;
		totalMessages += agg.messageCount;
	}

	return {
		totalSessions: buckets.session.size,
		totalDays: buckets.daily.size,
		totalCost,
		totalMessages,
	};
}

/**
 * Serialize TimeBuckets for JSON storage (globalState)
 * Converts Maps to [key, value][] arrays
 *
 * @param buckets TimeBuckets to serialize
 * @returns SerializedTimeBuckets
 */
export function serializeTimeBuckets(
	buckets: TimeBuckets,
): SerializedTimeBuckets {
	return {
		session: Array.from(buckets.session.entries()),
		daily: Array.from(buckets.daily.entries()),
		weekly: Array.from(buckets.weekly.entries()),
		monthly: Array.from(buckets.monthly.entries()),
		modelWeekly: Array.from(buckets.modelWeekly.entries()),
	};
}

/**
 * Deserialize TimeBuckets from JSON storage (globalState)
 * Converts [key, value][] arrays back to Maps
 * Reconstructs Date objects from ISO strings
 *
 * @param serialized SerializedTimeBuckets from globalState
 * @returns TimeBuckets
 */
export function deserializeTimeBuckets(
	serialized: SerializedTimeBuckets,
): TimeBuckets {
	const deserializeAgg = (agg: AggregatedUsage): AggregatedUsage => ({
		...agg,
		firstMessage: agg.firstMessage ? new Date(agg.firstMessage) : null,
		lastMessage: agg.lastMessage ? new Date(agg.lastMessage) : null,
	});

	return {
		session: new Map(
			serialized.session.map(([key, agg]) => [key, deserializeAgg(agg)]),
		),
		daily: new Map(
			serialized.daily.map(([key, agg]) => [key, deserializeAgg(agg)]),
		),
		weekly: new Map(
			serialized.weekly.map(([key, agg]) => [key, deserializeAgg(agg)]),
		),
		monthly: new Map(
			serialized.monthly.map(([key, agg]) => [key, deserializeAgg(agg)]),
		),
		modelWeekly: new Map(
			(serialized.modelWeekly ?? []).map(([key, agg]) => [
				key,
				deserializeAgg(agg),
			]),
		),
	};
}
