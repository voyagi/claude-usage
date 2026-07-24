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
 * Key for the daily bucket containing a given moment.
 *
 * Every reader and writer of `buckets.daily` must derive this the same way, so
 * it lives here rather than being spelled out at each site. It is LOCAL-date
 * based, and a site that hand-rolls a UTC key instead silently misses a day
 * whenever the two calendars disagree -- which is a window as wide as the UTC
 * offset, once per day, and invisible to a UTC-running CI.
 */
export function dailyBucketKey(when: Date): string {
	return format(startOfDay(when), "yyyy-MM-dd");
}

/**
 * Key for the weekly bucket containing a given moment.
 *
 * `RRRR` is the ISO week-numbering year, not `yyyy` (the calendar year). Pairing
 * a calendar year with an ISO week number is not merely inconsistent, it
 * collides: the Monday of ISO 2025-W01 falls on 2024-12-30, whose calendar year
 * is 2024, so it formats as "2024-W01" -- the same key ISO 2024-W01 already
 * owns. Two weeks 52 apart then share one bucket, and since calculateRateLimits
 * reads that key, the weekly usage bar reports a year-old week's tokens on top
 * of the current one. Verified over 2022-2027: `yyyy` produces exactly one such
 * collision and disagrees with an ISO-derived reader on 14 days; `RRRR`
 * produces none and agrees everywhere.
 */
export function weeklyBucketKey(when: Date): string {
	return format(startOfWeek(when, { weekStartsOn: 1 }), "RRRR-'W'II");
}

/**
 * Key for the hourly bucket containing a given moment, in LOCAL time.
 *
 * Extracted for the reason given on the two above: this format was written
 * here as a literal and read back in `calculateRateLimits` by concatenating
 * ":00:00" onto it, so the writer and the reader agreed only by coincidence.
 */
export function hourlyBucketKey(when: Date): string {
	return format(when, "yyyy-MM-dd'T'HH");
}

/**
 * The local instant an hourly key starts at, or null if the key is malformed.
 *
 * The key carries no zone, so this parses as local time, matching the local
 * `format` that produced it. A UTC-based reader would drift by the offset.
 */
export function parseHourlyBucketKey(key: string): Date | null {
	const parsed = new Date(`${key}:00:00`);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Key for the per-model hourly bucket. Mirrors the modelWeekly convention. */
export function modelHourlyBucketKey(when: Date, model: string): string {
	return `${hourlyBucketKey(when)}:${model}`;
}

/**
 * Split a modelHourly key back into its hour and model halves.
 *
 * The hour key contains no colon, so the first one is always the separator.
 * Model ids may contain anything after it, including further colons.
 */
function splitModelHourlyKey(
	key: string,
): { hourKey: string; model: string } | null {
	const separator = key.indexOf(":");
	if (separator === -1) return null;
	return { hourKey: key.slice(0, separator), model: key.slice(separator + 1) };
}

/**
 * Whether an hourly bucket overlaps the half-open window [from, to).
 *
 * Buckets are whole local hours, so a window edge landing inside an hour cannot
 * split it, and the whole hour counts. That over-counts by at most one hour of
 * usage at each edge, which is the deliberate direction: this feeds a limit
 * warning, and warning early is recoverable where warning late is not.
 *
 * The over-count is the normal case rather than an edge case. Real reset
 * instants carry sub-second precision (`...T08:00:00.383291Z`), so the boundary
 * hour is partially covered even in a whole-hour timezone, and the whole hour
 * is counted regardless.
 */
function hourOverlapsWindow(hourKey: string, from: Date, to: Date): boolean {
	const hourStart = parseHourlyBucketKey(hourKey);
	if (!hourStart) return false;
	const hourEnd = hourStart.getTime() + 60 * 60 * 1000;
	return hourEnd > from.getTime() && hourStart.getTime() < to.getTime();
}

/**
 * Output tokens recorded in [from, to), summed from hourly buckets.
 *
 * This is how a usage window that does not align to a calendar boundary gets
 * measured. Anthropic resets the weekly limit on a fixed instant assigned to
 * the account (Friday 08:00 UTC on the account this was built against), which
 * no ISO week bucket can express.
 */
export function sumOutputTokensInWindow(
	hourly: Map<string, AggregatedUsage>,
	from: Date,
	to: Date,
): number {
	let total = 0;
	for (const [hourKey, agg] of hourly.entries()) {
		if (hourOverlapsWindow(hourKey, from, to)) total += agg.outputTokens;
	}
	return total;
}

/**
 * Output tokens in [from, to) for the models `modelMatches` accepts.
 *
 * The predicate is supplied by the caller because matching a scope label to a
 * model id is rate-limit knowledge, not bucket knowledge.
 */
export function sumModelOutputTokensInWindow(
	modelHourly: Map<string, AggregatedUsage>,
	from: Date,
	to: Date,
	modelMatches: (model: string) => boolean,
): number {
	let total = 0;
	for (const [key, agg] of modelHourly.entries()) {
		const split = splitModelHourlyKey(key);
		if (!split || !modelMatches(split.model)) continue;
		if (hourOverlapsWindow(split.hourKey, from, to)) total += agg.outputTokens;
	}
	return total;
}

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
		hourly: new Map(),
		modelHourly: new Map(),
		project: new Map(),
	};

	for (const record of records) {
		// Session bucket: key = sessionId
		const sessionKey = record.sessionId;
		if (!buckets.session.has(sessionKey)) {
			buckets.session.set(sessionKey, createEmptyAggregatedUsage());
		}
		addToAggregation(buckets.session.get(sessionKey)!, record);

		// Daily bucket: key = YYYY-MM-DD (local timezone)
		const dayKey = dailyBucketKey(record.timestamp);
		if (!buckets.daily.has(dayKey)) {
			buckets.daily.set(dayKey, createEmptyAggregatedUsage());
		}
		addToAggregation(buckets.daily.get(dayKey)!, record);

		// Weekly bucket: key = RRRR-'W'II (ISO week-year + ISO week, Monday start)
		const weekKey = weeklyBucketKey(record.timestamp);
		if (!buckets.weekly.has(weekKey)) {
			buckets.weekly.set(weekKey, createEmptyAggregatedUsage());
		}
		addToAggregation(buckets.weekly.get(weekKey)!, record);

		// Model-specific weekly bucket: key = "RRRR-'W'II:model-name"
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

		// Hourly bucket: key = YYYY-MM-DDTHH (for sliding window calculations)
		const hourKey = hourlyBucketKey(record.timestamp);
		if (!buckets.hourly.has(hourKey)) {
			buckets.hourly.set(hourKey, createEmptyAggregatedUsage());
		}
		addToAggregation(buckets.hourly.get(hourKey)!, record);

		// Per-model hourly bucket: lets a model-scoped limit be measured over the
		// account's real reset cycle, which modelWeekly's ISO week cannot express.
		const modelHourKey = `${hourKey}:${record.model}`;
		if (!buckets.modelHourly!.has(modelHourKey)) {
			buckets.modelHourly!.set(modelHourKey, createEmptyAggregatedUsage());
		}
		addToAggregation(buckets.modelHourly!.get(modelHourKey)!, record);

		// Per-project bucket: key = friendly project name (basename of cwd)
		const projectKey = record.projectName || "unknown";
		if (!buckets.project!.has(projectKey)) {
			buckets.project!.set(projectKey, createEmptyAggregatedUsage());
		}
		addToAggregation(buckets.project!.get(projectKey)!, record);
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
	// Deep-copy a's entries so += mutations don't affect the original
	const deepCopyMap = (m: Map<string, AggregatedUsage>) =>
		new Map(Array.from(m.entries(), ([k, v]) => [k, { ...v }]));

	const merged: TimeBuckets = {
		session: deepCopyMap(a.session),
		daily: deepCopyMap(a.daily),
		weekly: deepCopyMap(a.weekly),
		monthly: deepCopyMap(a.monthly),
		modelWeekly: deepCopyMap(a.modelWeekly),
		hourly: deepCopyMap(a.hourly),
		modelHourly: deepCopyMap(
			a.modelHourly ?? new Map<string, AggregatedUsage>(),
		),
		project: deepCopyMap(a.project ?? new Map<string, AggregatedUsage>()),
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
	mergeBucket(merged.hourly, b.hourly);
	if (merged.modelHourly) {
		mergeBucket(
			merged.modelHourly,
			b.modelHourly ?? new Map<string, AggregatedUsage>(),
		);
	}
	if (merged.project) {
		mergeBucket(
			merged.project,
			b.project ?? new Map<string, AggregatedUsage>(),
		);
	}

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
		hourly: Array.from(buckets.hourly.entries()),
		modelHourly: Array.from(
			(buckets.modelHourly ?? new Map<string, AggregatedUsage>()).entries(),
		),
		project: Array.from(
			(buckets.project ?? new Map<string, AggregatedUsage>()).entries(),
		),
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
		hourly: new Map(
			(serialized.hourly ?? []).map(([key, agg]) => [key, deserializeAgg(agg)]),
		),
		modelHourly: new Map(
			(serialized.modelHourly ?? []).map(([key, agg]) => [
				key,
				deserializeAgg(agg),
			]),
		),
		project: new Map(
			(serialized.project ?? []).map(([key, agg]) => [
				key,
				deserializeAgg(agg),
			]),
		),
	};
}
