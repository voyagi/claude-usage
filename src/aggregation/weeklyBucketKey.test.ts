/**
 * Tests for the weekly bucket key.
 *
 * The key pairs a year with an ISO week number, and the two must come from the
 * same calendar or they collide: the Monday of ISO 2025-W01 falls in calendar
 * 2024, so a calendar-year key files it under "2024-W01" -- a bucket ISO
 * 2024-W01 already owns. Both weeks' tokens then land in one bucket, and the
 * weekly usage bar reports a year-old week on top of the current one.
 */

import { addDays, getISOWeek, getISOWeekYear, startOfWeek } from "date-fns";
import type { TokenUsage } from "../types.js";
import { aggregateUsage, weeklyBucketKey } from "./timeBuckets.js";

/** The ISO identity of the week containing a date, derived independently. */
function isoWeekOf(when: Date): string {
	return `${getISOWeekYear(when)}-W${String(getISOWeek(when)).padStart(2, "0")}`;
}

function record(timestamp: Date, outputTokens: number): TokenUsage {
	return {
		timestamp,
		model: "claude-opus-4-8",
		sessionId: "s1",
		messageId: `msg-${timestamp.getTime()}`,
		inputTokens: 0,
		outputTokens,
		cacheCreationTokens: 0,
		cacheReadTokens: 0,
		cacheCreation5m: 0,
		cacheCreation1h: 0,
		cost: 0,
	};
}

describe("weeklyBucketKey", () => {
	it("agrees with the ISO week identity of the date", () => {
		// Walk every day of 2022-2027. A calendar-year key disagrees on 14 of
		// them, all in the last days of December and first of January.
		let when = new Date(2022, 0, 1);
		const end = new Date(2028, 0, 1);
		const disagreements: string[] = [];

		while (when < end) {
			if (weeklyBucketKey(when) !== isoWeekOf(when)) {
				disagreements.push(
					`${when.toISOString().slice(0, 10)}: ${weeklyBucketKey(when)} vs ${isoWeekOf(when)}`,
				);
			}
			when = addDays(when, 1);
		}

		expect(disagreements).toEqual([]);
	});

	it("never gives two different weeks the same key", () => {
		// The collision is rare -- exactly one key across 2022-2027 under the
		// old derivation -- so a handful of spot checks would miss it.
		const keyToWeek = new Map<string, string>();
		const collisions: string[] = [];

		let monday = startOfWeek(new Date(2022, 0, 3), { weekStartsOn: 1 });
		const end = new Date(2028, 0, 1);
		while (monday < end) {
			const key = weeklyBucketKey(monday);
			const iso = isoWeekOf(monday);
			const seen = keyToWeek.get(key);
			if (seen !== undefined && seen !== iso) {
				collisions.push(`${key} <- ${seen} and ${iso}`);
			}
			keyToWeek.set(key, iso);
			monday = addDays(monday, 7);
		}

		expect(collisions).toEqual([]);
	});

	it("puts every day of a week in that week's bucket", () => {
		const monday = startOfWeek(new Date(2024, 5, 12), { weekStartsOn: 1 });
		const keys = new Set<string>();
		for (let i = 0; i < 7; i++) keys.add(weeklyBucketKey(addDays(monday, i)));

		expect(keys.size).toBe(1);
	});
});

describe("aggregateUsage: weekly buckets across the year boundary", () => {
	it("keeps ISO 2024-W01 and ISO 2025-W01 in separate buckets", () => {
		// The exact collision: these are 52 weeks apart. Under a calendar-year
		// key both landed in "2024-W01" and their tokens were summed, so the
		// weekly bar during ISO 2025-W01 read a year-old week's usage too.
		const in2024W01 = new Date(2024, 0, 3); // Wed of ISO 2024-W01
		const in2025W01 = new Date(2025, 0, 2); // Thu of ISO 2025-W01
		expect(isoWeekOf(in2024W01)).toBe("2024-W01");
		expect(isoWeekOf(in2025W01)).toBe("2025-W01");

		const buckets = aggregateUsage([
			record(in2024W01, 111),
			record(in2025W01, 222),
		]);

		expect(buckets.weekly.size).toBe(2);
		expect(buckets.weekly.get("2024-W01")?.outputTokens).toBe(111);
		expect(buckets.weekly.get("2025-W01")?.outputTokens).toBe(222);
	});

	it("keeps model-scoped weekly buckets separate across the same boundary", () => {
		// modelWeekly keys are built from the weekly key, so the collision
		// propagated there too -- and that is what the scoped limit bar reads.
		const buckets = aggregateUsage([
			record(new Date(2024, 0, 3), 111),
			record(new Date(2025, 0, 2), 222),
		]);

		const keys = [...buckets.modelWeekly.keys()].sort();
		expect(keys).toEqual([
			"2024-W01:claude-opus-4-8",
			"2025-W01:claude-opus-4-8",
		]);
	});
});
