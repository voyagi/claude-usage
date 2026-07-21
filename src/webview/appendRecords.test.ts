/**
 * Tests for DashboardProvider.appendRecords, the path that keeps the usage
 * attribution card current between full parses.
 *
 * These pin the two ways it can silently corrupt the record set: mishandling a
 * top-up delta (which carries only the EXTRA tokens for a message counted on an
 * earlier read) and re-appending a message after a reset replays it.
 */

jest.mock("vscode", () => ({}), { virtual: true });

import type { TokenUsage } from "../types.js";
import { DashboardProvider } from "./DashboardProvider.js";

/** A provider with no VS Code plumbing; only the record methods are exercised. */
function makeProvider(): DashboardProvider {
	return Object.create(DashboardProvider.prototype, {
		_records: { value: [], writable: true },
		_recordsByMessageId: { value: new Map(), writable: true },
		_attribution: { value: null, writable: true },
	}) as DashboardProvider;
}

function record(overrides: Partial<TokenUsage> = {}): TokenUsage {
	return {
		timestamp: new Date(),
		model: "claude-opus-4-8",
		sessionId: "s1",
		messageId: "msg_1",
		inputTokens: 10,
		outputTokens: 100,
		cacheCreationTokens: 0,
		cacheReadTokens: 0,
		cacheCreation5m: 0,
		cacheCreation1h: 0,
		cost: 1,
		...overrides,
	};
}

/** Read the private record array without widening the public surface. */
function recordsOf(provider: DashboardProvider): TokenUsage[] {
	return (provider as unknown as { _records: TokenUsage[] })._records;
}

describe("DashboardProvider.appendRecords", () => {
	it("appends new records", () => {
		const provider = makeProvider();
		provider.setRecords([record({ messageId: "a" })]);
		provider.appendRecords([record({ messageId: "b" })]);

		expect(recordsOf(provider).map((r) => r.messageId)).toEqual(["a", "b"]);
	});

	it("folds a top-up delta into the message it tops up", () => {
		const provider = makeProvider();
		provider.setRecords([
			record({ messageId: "a", outputTokens: 100, cost: 1 }),
		]);

		// The watcher emits only the EXTRA tokens for an already-counted message
		provider.appendRecords([
			record({ messageId: "a", outputTokens: 40, cost: 0.4, isTopUp: true }),
		]);

		const records = recordsOf(provider);
		expect(records).toHaveLength(1);
		// Not dropped (which would under-report) and not appended (which would
		// inflate the record count and the subagent-request tally)
		expect(records[0].outputTokens).toBe(140);
		expect(records[0].cost).toBeCloseTo(1.4, 5);
	});

	it("ignores a top-up for a message it does not hold", () => {
		const provider = makeProvider();
		provider.setRecords([]);
		provider.appendRecords([
			record({ messageId: "orphan", outputTokens: 40, isTopUp: true }),
		]);

		// A bare delta cannot stand in for the message it belongs to
		expect(recordsOf(provider)).toHaveLength(0);
	});

	it("replaces rather than duplicates when a message id arrives again", () => {
		const provider = makeProvider();
		provider.setRecords([record({ messageId: "a", outputTokens: 100 })]);

		// After a reset the watcher re-reads a file from byte 0 and replays it
		provider.appendRecords([record({ messageId: "a", outputTokens: 100 })]);

		const records = recordsOf(provider);
		expect(records).toHaveLength(1);
		expect(records[0].outputTokens).toBe(100);
	});

	it("keeps records that carry no message id", () => {
		const provider = makeProvider();
		provider.setRecords([]);
		provider.appendRecords([
			record({ messageId: "" }),
			record({ messageId: "" }),
		]);

		// Without an id they cannot be deduped, so both are counted
		expect(recordsOf(provider)).toHaveLength(2);
	});

	it("does nothing when handed an empty batch", () => {
		const provider = makeProvider();
		provider.setRecords([record({ messageId: "a" })]);
		provider.appendRecords([]);

		expect(recordsOf(provider)).toHaveLength(1);
	});

	it("rebuilds attribution so the card reflects live usage", () => {
		const provider = makeProvider();
		provider.setRecords([]);
		provider.appendRecords([
			record({
				messageId: "a",
				cost: 10,
				attribution: { skill: "suggest-run" },
			}),
		]);

		const attribution = (
			provider as unknown as {
				_attribution: { day: { skills: { name: string }[] } } | null;
			}
		)._attribution;
		expect(attribution?.day.skills[0]?.name).toBe("suggest-run");
	});

	it("drops everything when records are reset", () => {
		const provider = makeProvider();
		provider.setRecords([record({ messageId: "a" })]);
		provider.setRecords([]);
		// A replay after the reset must not resurrect the old copy alongside it
		provider.appendRecords([record({ messageId: "a" })]);

		expect(recordsOf(provider)).toHaveLength(1);
	});
});
