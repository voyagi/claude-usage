/**
 * Tests for persisted usage state.
 *
 * The version gate is the only thing standing between a user upgrading into
 * this build and their old weekly buckets, which merged two calendar weeks into
 * one key. If it stops rejecting version 1, those buckets load silently and the
 * weekly usage bar reports a year-old week's tokens on top of the current one.
 * That path had no test at all.
 */

// UsageStore logs through Logger, which opens an output channel on first use.
jest.mock(
	"vscode",
	() => ({
		window: {
			createOutputChannel: () => ({
				appendLine: () => {},
				dispose: () => {},
			}),
		},
	}),
	{ virtual: true },
);

import { aggregateUsage } from "../aggregation/timeBuckets.js";
import type { PersistedState, TokenUsage } from "../types.js";
import { UsageStore } from "./usageStore.js";

/**
 * globalState stand-in.
 *
 * Values are round-tripped through JSON on write, because that is what VS Code
 * actually does: storing the object by reference would let a Date survive as a
 * Date and a Map survive as a Map, hiding exactly the serialization mistakes
 * this store exists to get right.
 */
function fakeContext(initial?: unknown) {
	const store = new Map<string, unknown>();
	const persist = (value: unknown): unknown =>
		JSON.parse(JSON.stringify(value));
	if (initial !== undefined) store.set("claudeUsage", persist(initial));
	return {
		globalState: {
			get: <T>(key: string): T | undefined => store.get(key) as T | undefined,
			update: async (key: string, value: unknown): Promise<void> => {
				if (value === undefined) store.delete(key);
				else store.set(key, persist(value));
			},
		},
		_store: store,
	};
}

function makeStore(initial?: unknown): {
	store: UsageStore;
	ctx: ReturnType<typeof fakeContext>;
} {
	const ctx = fakeContext(initial);
	return {
		store: new UsageStore(ctx as unknown as never),
		ctx,
	};
}

function record(timestamp: Date, outputTokens: number): TokenUsage {
	return {
		timestamp,
		model: "claude-opus-4-8",
		sessionId: "s1",
		messageId: `m-${timestamp.getTime()}`,
		inputTokens: 0,
		outputTokens,
		cacheCreationTokens: 0,
		cacheReadTokens: 0,
		cacheCreation5m: 0,
		cacheCreation1h: 0,
		cost: 0,
	};
}

const stats = { filesProcessed: 1, linesSkipped: 0 };

describe("UsageStore version gate", () => {
	it("round-trips what it just wrote", async () => {
		const { store } = makeStore();
		const buckets = aggregateUsage([record(new Date(2026, 5, 10), 500)]);

		await store.saveUsageData(buckets, stats);
		const loaded = await store.loadUsageData();

		expect(loaded).not.toBeNull();
		expect(loaded?.stats).toEqual(stats);
		expect([...(loaded?.buckets.weekly.keys() ?? [])]).toEqual([
			...buckets.weekly.keys(),
		]);

		// The payload too, not just the key list: a deserializer that preserved
		// every key while zeroing its contents would otherwise pass this.
		const [key] = buckets.weekly.keys();
		expect(loaded?.buckets.weekly.get(key)?.outputTokens).toBe(500);
		expect(loaded?.buckets.weekly.get(key)?.messageCount).toBe(1);
		expect(loaded?.buckets.daily.size).toBe(1);

		// And the Date revival, which is the whole reason the fake round-trips
		// through JSON: timestamps cross that boundary as ISO strings, so a
		// deserializer that forgot to rebuild them would hand back a string
		// typed as a Date and every date operation downstream would fail.
		expect(loaded?.buckets.session.get("s1")?.lastMessage).toBeInstanceOf(Date);
	});

	it("refuses version 1, whose weekly buckets merged two calendar weeks", async () => {
		// A realistic v1 payload: the colliding key, holding the summed tokens
		// of ISO 2024-W01 and ISO 2025-W01.
		const v1: PersistedState = {
			version: 1,
			lastParseTimestamp: "2025-01-02T00:00:00.000Z",
			totalFilesProcessed: 9,
			totalLinesSkipped: 0,
			timeBuckets: {
				session: [],
				daily: [],
				weekly: [
					[
						"2024-W01",
						{
							inputTokens: 0,
							outputTokens: 333,
							cacheCreationTokens: 0,
							cacheReadTokens: 0,
							totalCost: 0,
							messageCount: 2,
							firstMessage: null,
							lastMessage: null,
						},
					],
				],
				monthly: [],
			},
		};

		const { store } = makeStore(v1);
		expect(await store.loadUsageData()).toBeNull();
	});

	it("refuses a future version rather than guessing at its shape", async () => {
		const { store } = makeStore({ version: 99, timeBuckets: {} });
		expect(await store.loadUsageData()).toBeNull();
	});

	it("returns null on a first run with nothing persisted", async () => {
		const { store } = makeStore();
		expect(await store.loadUsageData()).toBeNull();
	});

	it("writes the current version, so a reparse replaces rejected state", async () => {
		const { store, ctx } = makeStore();
		await store.saveUsageData(aggregateUsage([]), stats);

		const written = ctx._store.get("claudeUsage") as PersistedState;
		expect(written.version).toBe(2);
	});

	it("does not report a parse time from state it would refuse to load", async () => {
		// Otherwise the UI dates buckets that are about to be discarded
		const { store } = makeStore({
			version: 1,
			lastParseTimestamp: "2025-01-02T00:00:00.000Z",
			timeBuckets: {},
		});

		expect(store.getLastParseTimestamp()).toBeNull();
	});

	it("reports the parse time once the state is current", async () => {
		const { store } = makeStore();
		await store.saveUsageData(aggregateUsage([]), stats);

		expect(store.getLastParseTimestamp()).not.toBeNull();
	});

	it("clears everything, so the next load starts fresh", async () => {
		const { store } = makeStore();
		await store.saveUsageData(aggregateUsage([]), stats);
		await store.clearUsageData();

		expect(await store.loadUsageData()).toBeNull();
		expect(store.getLastParseTimestamp()).toBeNull();
	});
});
