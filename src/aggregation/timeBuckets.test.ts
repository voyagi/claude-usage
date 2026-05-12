/**
 * Unit tests for timeBuckets
 *
 * Covers:
 * - aggregateUsage: empty input, single record, same-session merge, multi-day split, modelWeekly keys
 * - mergeTimeBuckets: non-overlapping, overlapping (additive), firstMessage/lastMessage, immutability
 * - getTimeBucketSummary: session count, day count, cost, messages
 * - serializeTimeBuckets / deserializeTimeBuckets: round-trip, Date restoration, backward compat
 */

import type {
	AggregatedUsage,
	SerializedTimeBuckets,
	TokenUsage,
} from "../types";
import {
	aggregateUsage,
	deserializeTimeBuckets,
	getTimeBucketSummary,
	mergeTimeBuckets,
	serializeTimeBuckets,
} from "./timeBuckets";

/** Helper: build a TokenUsage record with sensible defaults */
function makeRecord(overrides: Partial<TokenUsage> = {}): TokenUsage {
	return {
		timestamp: new Date("2026-03-15T10:30:00Z"),
		model: "claude-sonnet-4-5",
		sessionId: "sess-1",
		inputTokens: 1000,
		outputTokens: 500,
		cacheCreationTokens: 200,
		cacheReadTokens: 100,
		cacheCreation5m: 100,
		cacheCreation1h: 100,
		cost: 0.05,
		...overrides,
	};
}

describe("timeBuckets", () => {
	// ── aggregateUsage ──────────────────────────────────────────────

	describe("aggregateUsage", () => {
		it("returns empty maps for an empty array", () => {
			const buckets = aggregateUsage([]);
			expect(buckets.session.size).toBe(0);
			expect(buckets.daily.size).toBe(0);
			expect(buckets.weekly.size).toBe(0);
			expect(buckets.monthly.size).toBe(0);
			expect(buckets.modelWeekly.size).toBe(0);
			expect(buckets.hourly.size).toBe(0);
		});

		it("populates all bucket types for a single record", () => {
			const buckets = aggregateUsage([makeRecord()]);

			expect(buckets.session.size).toBe(1);
			expect(buckets.daily.size).toBe(1);
			expect(buckets.weekly.size).toBe(1);
			expect(buckets.monthly.size).toBe(1);
			expect(buckets.modelWeekly.size).toBe(1);
			expect(buckets.hourly.size).toBe(1);

			// Verify session values
			const sessAgg = buckets.session.get("sess-1")!;
			expect(sessAgg.inputTokens).toBe(1000);
			expect(sessAgg.outputTokens).toBe(500);
			expect(sessAgg.messageCount).toBe(1);
			expect(sessAgg.totalCost).toBe(0.05);
		});

		it("aggregates multiple records in the same session", () => {
			const records = [
				makeRecord({ inputTokens: 400, outputTokens: 200, cost: 0.02 }),
				makeRecord({ inputTokens: 600, outputTokens: 300, cost: 0.03 }),
			];

			const buckets = aggregateUsage(records);

			expect(buckets.session.size).toBe(1);
			const sessAgg = buckets.session.get("sess-1")!;
			expect(sessAgg.inputTokens).toBe(1000);
			expect(sessAgg.outputTokens).toBe(500);
			expect(sessAgg.messageCount).toBe(2);
			expect(sessAgg.totalCost).toBeCloseTo(0.05);
		});

		it("creates separate daily buckets for records on different days", () => {
			const records = [
				makeRecord({ timestamp: new Date("2026-03-15T10:00:00Z") }),
				makeRecord({ timestamp: new Date("2026-03-16T10:00:00Z") }),
			];

			const buckets = aggregateUsage(records);

			expect(buckets.daily.size).toBe(2);
		});

		it("creates modelWeekly keys with weekKey:model format", () => {
			const records = [
				makeRecord({ model: "claude-opus-4-6" }),
				makeRecord({ model: "claude-sonnet-4-5" }),
			];

			const buckets = aggregateUsage(records);

			const keys = Array.from(buckets.modelWeekly.keys());
			expect(keys.length).toBe(2);
			// Each key should contain the model name after a colon
			for (const key of keys) {
				expect(key).toMatch(/:\w/);
			}
			expect(keys.some((k) => k.endsWith(":claude-opus-4-6"))).toBe(true);
			expect(keys.some((k) => k.endsWith(":claude-sonnet-4-5"))).toBe(true);
		});
	});

	// ── mergeTimeBuckets ────────────────────────────────────────────

	describe("mergeTimeBuckets", () => {
		it("includes keys from both sides when they don't overlap", () => {
			const a = aggregateUsage([makeRecord({ sessionId: "sess-a" })]);
			const b = aggregateUsage([makeRecord({ sessionId: "sess-b" })]);

			const merged = mergeTimeBuckets(a, b);

			expect(merged.session.has("sess-a")).toBe(true);
			expect(merged.session.has("sess-b")).toBe(true);
		});

		it("sums values for overlapping keys", () => {
			const a = aggregateUsage([
				makeRecord({ inputTokens: 300, outputTokens: 100, cost: 0.01 }),
			]);
			const b = aggregateUsage([
				makeRecord({ inputTokens: 700, outputTokens: 400, cost: 0.04 }),
			]);

			const merged = mergeTimeBuckets(a, b);

			const sessAgg = merged.session.get("sess-1")!;
			expect(sessAgg.inputTokens).toBe(1000);
			expect(sessAgg.outputTokens).toBe(500);
			expect(sessAgg.totalCost).toBeCloseTo(0.05);
			expect(sessAgg.messageCount).toBe(2);
		});

		it("picks the earliest firstMessage and latest lastMessage", () => {
			const early = new Date("2026-03-15T08:00:00Z");
			const late = new Date("2026-03-15T20:00:00Z");

			const a = aggregateUsage([makeRecord({ timestamp: late })]);
			const b = aggregateUsage([makeRecord({ timestamp: early })]);

			const merged = mergeTimeBuckets(a, b);

			const sessAgg = merged.session.get("sess-1")!;
			expect(sessAgg.firstMessage).toEqual(early);
			expect(sessAgg.lastMessage).toEqual(late);
		});

		it("does not mutate the original TimeBuckets", () => {
			const a = aggregateUsage([makeRecord({ inputTokens: 100 })]);
			const b = aggregateUsage([makeRecord({ inputTokens: 200 })]);

			const aInputBefore = a.session.get("sess-1")!.inputTokens;
			const bInputBefore = b.session.get("sess-1")!.inputTokens;

			mergeTimeBuckets(a, b);

			expect(a.session.get("sess-1")!.inputTokens).toBe(aInputBefore);
			expect(b.session.get("sess-1")!.inputTokens).toBe(bInputBefore);
		});
	});

	// ── getTimeBucketSummary ────────────────────────────────────────

	describe("getTimeBucketSummary", () => {
		it("counts sessions, days, cost, and messages", () => {
			const records = [
				makeRecord({
					sessionId: "s1",
					timestamp: new Date("2026-03-15T10:00:00Z"),
					cost: 0.1,
				}),
				makeRecord({
					sessionId: "s2",
					timestamp: new Date("2026-03-15T14:00:00Z"),
					cost: 0.2,
				}),
				makeRecord({
					sessionId: "s2",
					timestamp: new Date("2026-03-16T09:00:00Z"),
					cost: 0.3,
				}),
			];

			const buckets = aggregateUsage(records);
			const summary = getTimeBucketSummary(buckets);

			expect(summary.totalSessions).toBe(2);
			expect(summary.totalDays).toBe(2);
			expect(summary.totalCost).toBeCloseTo(0.6);
			expect(summary.totalMessages).toBe(3);
		});
	});

	// ── serialize / deserialize ─────────────────────────────────────

	describe("serializeTimeBuckets", () => {
		it("converts maps to arrays", () => {
			const buckets = aggregateUsage([makeRecord()]);
			const serialized = serializeTimeBuckets(buckets);

			expect(Array.isArray(serialized.session)).toBe(true);
			expect(Array.isArray(serialized.daily)).toBe(true);
			expect(Array.isArray(serialized.weekly)).toBe(true);
			expect(Array.isArray(serialized.monthly)).toBe(true);
			expect(Array.isArray(serialized.modelWeekly)).toBe(true);
			expect(Array.isArray(serialized.hourly)).toBe(true);

			// Each entry is a [key, AggregatedUsage] tuple
			expect(serialized.session[0]).toHaveLength(2);
			expect(typeof serialized.session[0][0]).toBe("string");
		});
	});

	describe("deserializeTimeBuckets", () => {
		it("round-trips with serializeTimeBuckets", () => {
			const original = aggregateUsage([
				makeRecord({ sessionId: "s1", cost: 0.1 }),
				makeRecord({
					sessionId: "s2",
					timestamp: new Date("2026-03-16T12:00:00Z"),
					cost: 0.2,
				}),
			]);

			const serialized = serializeTimeBuckets(original);
			// Simulate JSON persistence (converts Dates to strings)
			const jsonCopy = JSON.parse(JSON.stringify(serialized));
			const restored = deserializeTimeBuckets(jsonCopy);

			expect(restored.session.size).toBe(original.session.size);
			expect(restored.daily.size).toBe(original.daily.size);
			expect(restored.weekly.size).toBe(original.weekly.size);
			expect(restored.monthly.size).toBe(original.monthly.size);
			expect(restored.modelWeekly.size).toBe(original.modelWeekly.size);
			expect(restored.hourly.size).toBe(original.hourly.size);

			// Verify numeric values survived
			const origSess = original.session.get("s1")!;
			const resSess = restored.session.get("s1")!;
			expect(resSess.inputTokens).toBe(origSess.inputTokens);
			expect(resSess.totalCost).toBeCloseTo(origSess.totalCost);
		});

		it("restores Date objects from ISO strings", () => {
			const original = aggregateUsage([makeRecord()]);
			const serialized = serializeTimeBuckets(original);
			const jsonCopy = JSON.parse(JSON.stringify(serialized));

			const restored = deserializeTimeBuckets(jsonCopy);

			const agg = restored.session.get("sess-1")!;
			expect(agg.firstMessage).toBeInstanceOf(Date);
			expect(agg.lastMessage).toBeInstanceOf(Date);
		});

		it("handles missing modelWeekly and hourly for backward compat", () => {
			const original = aggregateUsage([makeRecord()]);
			const serialized = serializeTimeBuckets(original);

			// Simulate old persisted data without modelWeekly/hourly
			const legacy: SerializedTimeBuckets = {
				session: serialized.session,
				daily: serialized.daily,
				weekly: serialized.weekly,
				monthly: serialized.monthly,
				// modelWeekly and hourly intentionally omitted
			};

			const restored = deserializeTimeBuckets(legacy);

			expect(restored.modelWeekly).toBeInstanceOf(Map);
			expect(restored.modelWeekly.size).toBe(0);
			expect(restored.hourly).toBeInstanceOf(Map);
			expect(restored.hourly.size).toBe(0);
		});
	});
});
