import type { TokenUsage } from "../types";
import {
	aggregateUsage,
	deserializeTimeBuckets,
	serializeTimeBuckets,
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
