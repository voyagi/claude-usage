import type { TokenUsage } from "../types";
import {
	aggregateUsage,
	deserializeTimeBuckets,
	modelHourlyBucketKey,
	serializeTimeBuckets,
	sumModelOutputTokensInWindow,
	sumOutputTokensInWindow,
} from "./timeBuckets";

function rec(
	projectName: string | undefined,
	over: Partial<TokenUsage> = {},
): TokenUsage {
	return {
		timestamp: new Date("2026-06-01T12:00:00.000Z"),
		model: "claude-opus-4-8",
		sessionId: "s1",
		projectName,
		inputTokens: 100,
		outputTokens: 50,
		cacheCreationTokens: 0,
		cacheReadTokens: 0,
		cacheCreation5m: 0,
		cacheCreation1h: 0,
		cost: 1,
		...over,
	};
}

describe("aggregateUsage — per-project bucket", () => {
	it("groups records by projectName and sums their usage", () => {
		const buckets = aggregateUsage([
			rec("alpha", { inputTokens: 10 }),
			rec("alpha", { inputTokens: 5 }),
			rec("beta", { inputTokens: 7 }),
		]);
		expect(buckets.project?.size).toBe(2);
		expect(buckets.project?.get("alpha")?.inputTokens).toBe(15);
		expect(buckets.project?.get("alpha")?.messageCount).toBe(2);
		expect(buckets.project?.get("beta")?.inputTokens).toBe(7);
	});

	it("buckets records without a project name under 'unknown'", () => {
		const buckets = aggregateUsage([rec(undefined), rec("")]);
		expect(buckets.project?.get("unknown")?.messageCount).toBe(2);
	});
});

describe("serialize/deserialize round-trip — project bucket", () => {
	it("preserves the project bucket through a round-trip", () => {
		const buckets = aggregateUsage([rec("alpha", { inputTokens: 42 })]);
		const round = deserializeTimeBuckets(serializeTimeBuckets(buckets));
		expect(round.project?.get("alpha")?.inputTokens).toBe(42);
	});

	it("tolerates legacy serialized data with no project field", () => {
		const legacy = {
			session: [],
			daily: [],
			weekly: [],
			monthly: [],
		} as unknown as Parameters<typeof deserializeTimeBuckets>[0];
		const round = deserializeTimeBuckets(legacy);
		expect(round.project?.size).toBe(0);
	});
});

describe("modelHourly bucket and the cycle window", () => {
	const HOUR = 60 * 60 * 1000;
	const T0 = new Date("2026-07-24T12:00:00.000Z");

	it("splits an hour's usage by model", () => {
		const buckets = aggregateUsage([
			rec("alpha", { model: "claude-fable-5", outputTokens: 30 }),
			rec("alpha", { model: "claude-opus-4-8", outputTokens: 70 }),
		]);
		const keys = [...buckets.modelHourly!.keys()];
		expect(keys).toHaveLength(2);
		expect(
			buckets.modelHourly?.get(
				modelHourlyBucketKey(
					new Date("2026-06-01T12:00:00.000Z"),
					"claude-fable-5",
				),
			)?.outputTokens,
		).toBe(30);
	});

	it("preserves modelHourly through a round-trip", () => {
		const buckets = aggregateUsage([
			rec("alpha", { model: "claude-fable-5", outputTokens: 30 }),
		]);
		const round = deserializeTimeBuckets(serializeTimeBuckets(buckets));
		expect(round.modelHourly?.size).toBe(1);
	});

	it("deserializes legacy data with no modelHourly to an empty map", () => {
		// Empty here means "written before this level existed", which readers must
		// distinguish from zero usage. The map exists so they can tell.
		const legacy = {
			session: [],
			daily: [],
			weekly: [],
			monthly: [],
		} as unknown as Parameters<typeof deserializeTimeBuckets>[0];
		expect(deserializeTimeBuckets(legacy).modelHourly?.size).toBe(0);
	});

	it("sums only the hours overlapping the window", () => {
		const buckets = aggregateUsage([
			rec("a", { timestamp: new Date(T0.getTime() - 3 * HOUR) }),
			rec("a", { timestamp: new Date(T0.getTime() - HOUR) }),
			rec("a", { timestamp: T0 }),
		]);
		// [T0-2h, T0): the hour holding T0 starts exactly at the upper edge and is
		// out, and the -3h hour ends exactly at the lower edge and is also out.
		// Both edges are half-open, so an hour touching a boundary does not count.
		expect(
			sumOutputTokensInWindow(
				buckets.hourly,
				new Date(T0.getTime() - 2 * HOUR),
				T0,
			),
		).toBe(50);

		// Widened by one hour, the -3h record now overlaps and joins.
		expect(
			sumOutputTokensInWindow(
				buckets.hourly,
				new Date(T0.getTime() - 3 * HOUR),
				T0,
			),
		).toBe(100);
	});

	it("filters the model window by the caller's predicate", () => {
		const buckets = aggregateUsage([
			rec("a", { model: "claude-fable-5", outputTokens: 30, timestamp: T0 }),
			rec("a", { model: "claude-opus-4-8", outputTokens: 70, timestamp: T0 }),
		]);
		const fable = sumModelOutputTokensInWindow(
			buckets.modelHourly!,
			new Date(T0.getTime() - HOUR),
			new Date(T0.getTime() + HOUR),
			(model) => model.includes("fable"),
		);
		expect(fable).toBe(30);
	});

	it("keeps a model id containing a colon intact", () => {
		// The hour key has no colon, so the first one separates. A model id with
		// its own colons must survive the split or it silently stops matching.
		const buckets = aggregateUsage([
			rec("a", { model: "vendor:model:v2", outputTokens: 11, timestamp: T0 }),
		]);
		const total = sumModelOutputTokensInWindow(
			buckets.modelHourly!,
			new Date(T0.getTime() - HOUR),
			new Date(T0.getTime() + HOUR),
			(model) => model === "vendor:model:v2",
		);
		expect(total).toBe(11);
	});
});

describe("aggregateUsage — top-up deltas don't inflate messageCount", () => {
	it("counts a message once across every bucket dimension even with a top-up delta", () => {
		// A normal record (first sight of a message) plus a straddle top-up delta
		// for the SAME message. The delta must add tokens but never be counted as
		// a second message in any bucket. End-to-end guard so a future change to
		// aggregateUsage that dropped isTopUp would fail loudly, not silently
		// reintroduce the double-count.
		const buckets = aggregateUsage([
			rec("alpha", { inputTokens: 100, outputTokens: 50 }),
			rec("alpha", { inputTokens: 5, outputTokens: 30, isTopUp: true }),
		]);
		// Read by value (not date-keyed) so the assertion is timezone-independent.
		const dims = [
			buckets.session.get("s1"),
			[...buckets.daily.values()][0],
			[...buckets.weekly.values()][0],
			[...buckets.monthly.values()][0],
			buckets.project?.get("alpha"),
		];
		for (const dim of dims) {
			expect(dim?.messageCount).toBe(1); // one message, not two
			expect(dim?.inputTokens).toBe(105); // tokens topped up
			expect(dim?.outputTokens).toBe(80);
		}
	});
});
