import type { TokenUsage } from "../types";
import { parseAssistantMessage } from "./schemas";
import {
	addToAggregation,
	createEmptyAggregatedUsage,
	dedupeByMessageId,
	projectNameFromCwd,
	pruneSeenUsage,
	reconcileBatch,
	reconcileSeenUsage,
} from "./tokenCounter";

function rec(
	messageId: string | undefined,
	over: Partial<TokenUsage> = {},
): TokenUsage {
	return {
		timestamp: new Date("2026-06-01T12:00:00.000Z"),
		model: "claude-opus-4-8",
		sessionId: "s1",
		messageId,
		inputTokens: 100,
		outputTokens: 200,
		cacheCreationTokens: 0,
		cacheReadTokens: 0,
		cacheCreation5m: 0,
		cacheCreation1h: 0,
		cost: 0,
		...over,
	};
}

describe("dedupeByMessageId", () => {
	it("collapses many re-logged copies of one message id into a single record", () => {
		// Mirrors the real transcript: one assistant response re-logged 39x with
		// identical usage. Summing all 39 would multiply the response's tokens.
		const records = Array.from({ length: 39 }, () =>
			rec("msg_abc", { inputTokens: 5347, outputTokens: 23286 }),
		);
		const out = dedupeByMessageId(records);
		expect(out).toHaveLength(1);
		expect(out[0].inputTokens).toBe(5347);
		expect(out[0].outputTokens).toBe(23286);
	});

	it("keeps every distinct message id", () => {
		const records = [rec("msg_a"), rec("msg_b"), rec("msg_c")];
		expect(dedupeByMessageId(records)).toHaveLength(3);
	});

	it("keeps the largest-usage record per id (streamed output grows to the final total)", () => {
		const records = [
			rec("msg_a", { outputTokens: 1 }),
			rec("msg_a", { outputTokens: 999 }),
		];
		const out = dedupeByMessageId(records);
		expect(out).toHaveLength(1);
		expect(out[0].outputTokens).toBe(999);
	});

	it("keeps the largest even when it is not the last occurrence", () => {
		const records = [
			rec("msg_a", { outputTokens: 999 }),
			rec("msg_a", { outputTokens: 5 }),
		];
		expect(dedupeByMessageId(records)[0].outputTokens).toBe(999);
	});

	it("deliberately keeps the larger usage even if a later line reports less (inverse-risk tradeoff)", () => {
		// Pins the keep-largest heuristic: on the ~0.02% of ids where a later
		// re-log carries SMALLER usage, we treat it as an out-of-order/stale write
		// and keep the larger total. This can theoretically over-count a genuine
		// downward correction, but matches the streaming-growth model that holds
		// for 99.98% of ids; flipping to keep-last would reintroduce undercounts.
		const records = [
			rec("msg_a", { inputTokens: 100, outputTokens: 900 }),
			rec("msg_a", { inputTokens: 100, outputTokens: 100 }),
		];
		const out = dedupeByMessageId(records);
		expect(out).toHaveLength(1);
		expect(out[0].outputTokens).toBe(900);
	});

	it("passes through records with no message id (each must be counted)", () => {
		const records = [rec(undefined), rec(""), rec(undefined)];
		expect(dedupeByMessageId(records)).toHaveLength(3);
	});

	it("handles a mix of duplicated, distinct, and id-less records", () => {
		const records = [
			rec("msg_a"),
			rec("msg_a"),
			rec("msg_b"),
			rec(undefined),
			rec(""),
		];
		// msg_a -> 1, msg_b -> 1, two id-less -> 2  => 4
		expect(dedupeByMessageId(records)).toHaveLength(4);
	});

	it("returns an empty array for empty input", () => {
		expect(dedupeByMessageId([])).toEqual([]);
	});
});

describe("parseAssistantMessage — message id extraction", () => {
	const base = {
		type: "assistant",
		timestamp: "2026-06-01T12:00:00.000Z",
		sessionId: "s1",
		message: {
			id: "msg_xyz",
			model: "claude-opus-4-8",
			usage: { input_tokens: 10, output_tokens: 20 },
		},
	};

	it("extracts message.id into messageId", () => {
		const out = parseAssistantMessage(base);
		expect(out?.messageId).toBe("msg_xyz");
	});

	it("defaults messageId to empty string when id is absent", () => {
		const noId = {
			type: "assistant",
			timestamp: "2026-06-01T12:00:00.000Z",
			sessionId: "s1",
			message: {
				model: "claude-opus-4-8",
				usage: { input_tokens: 10, output_tokens: 20 },
			},
		};
		const out = parseAssistantMessage(noId);
		expect(out?.messageId).toBe("");
	});

	it("derives projectName from the top-level cwd", () => {
		const out = parseAssistantMessage({
			type: "assistant",
			timestamp: "2026-06-01T12:00:00.000Z",
			sessionId: "s1",
			cwd: "/home/u/projects/widget",
			message: {
				id: "msg_1",
				model: "claude-opus-4-8",
				usage: { input_tokens: 1, output_tokens: 2 },
			},
		});
		expect(out?.projectName).toBe("widget");
	});

	it("leaves projectName empty when cwd is absent", () => {
		const out = parseAssistantMessage({
			type: "assistant",
			timestamp: "2026-06-01T12:00:00.000Z",
			sessionId: "s1",
			message: {
				id: "msg_1",
				model: "claude-opus-4-8",
				usage: { input_tokens: 1, output_tokens: 2 },
			},
		});
		expect(out?.projectName).toBe("");
	});
});

describe("projectNameFromCwd", () => {
	it("returns the basename of a Windows path", () => {
		expect(projectNameFromCwd("C:\\Users\\dev\\projects\\claude-usage")).toBe(
			"claude-usage",
		);
	});

	it("returns the basename of a POSIX path", () => {
		expect(projectNameFromCwd("/home/u/projects/my-app")).toBe("my-app");
	});

	it("ignores trailing separators", () => {
		expect(projectNameFromCwd("/home/u/projects/my-app/")).toBe("my-app");
	});

	it("returns empty string for undefined or empty cwd", () => {
		expect(projectNameFromCwd(undefined)).toBe("");
		expect(projectNameFromCwd("")).toBe("");
	});
});

describe("reconcileSeenUsage", () => {
	it("counts a new message id in full and remembers it", () => {
		const seen = new Map<string, TokenUsage>();
		const r = rec("msg_a", { outputTokens: 100 });
		expect(reconcileSeenUsage(r, seen)).toBe(r);
		expect(seen.get("msg_a")).toBe(r);
	});

	it("drops a repeat with equal usage", () => {
		const seen = new Map<string, TokenUsage>();
		reconcileSeenUsage(rec("msg_a", { outputTokens: 100 }), seen);
		expect(
			reconcileSeenUsage(rec("msg_a", { outputTokens: 100 }), seen),
		).toBeNull();
	});

	it("drops a repeat with smaller usage", () => {
		const seen = new Map<string, TokenUsage>();
		reconcileSeenUsage(rec("msg_a", { outputTokens: 100 }), seen);
		expect(
			reconcileSeenUsage(rec("msg_a", { outputTokens: 50 }), seen),
		).toBeNull();
	});

	it("tops up with the positive delta when a later read carries larger usage", () => {
		const seen = new Map<string, TokenUsage>();
		reconcileSeenUsage(
			rec("msg_a", { inputTokens: 10, outputTokens: 100 }),
			seen,
		);
		const delta = reconcileSeenUsage(
			rec("msg_a", { inputTokens: 15, outputTokens: 250 }),
			seen,
		);
		expect(delta).not.toBeNull();
		expect(delta?.inputTokens).toBe(5);
		expect(delta?.outputTokens).toBe(150);
		// the delta is flagged so aggregation won't re-count it as a new message
		expect(delta?.isTopUp).toBe(true);
		// stored usage advances to the larger record for subsequent comparisons
		expect(seen.get("msg_a")?.outputTokens).toBe(250);
	});

	it("always counts records with no message id", () => {
		const seen = new Map<string, TokenUsage>();
		const r1 = rec(undefined);
		const r2 = rec("");
		expect(reconcileSeenUsage(r1, seen)).toBe(r1);
		expect(reconcileSeenUsage(r2, seen)).toBe(r2);
		expect(seen.size).toBe(0);
	});
});

describe("addToAggregation — messageCount and top-up deltas", () => {
	it("counts a normal record as one message", () => {
		const agg = createEmptyAggregatedUsage();
		addToAggregation(agg, rec("msg_a", { inputTokens: 10, outputTokens: 20 }));
		expect(agg.messageCount).toBe(1);
		expect(agg.inputTokens).toBe(10);
		expect(agg.outputTokens).toBe(20);
	});

	it("adds a top-up delta's tokens without counting it as a new message", () => {
		const agg = createEmptyAggregatedUsage();
		addToAggregation(agg, rec("msg_a", { inputTokens: 10, outputTokens: 20 }));
		// straddle top-up for the SAME message: extra tokens, not a new message
		addToAggregation(
			agg,
			rec("msg_a", { inputTokens: 5, outputTokens: 30, isTopUp: true }),
		);
		expect(agg.messageCount).toBe(1); // still one message
		expect(agg.inputTokens).toBe(15); // tokens topped up
		expect(agg.outputTokens).toBe(50);
	});
});

describe("pruneSeenUsage", () => {
	const ttl = 6 * 60 * 60 * 1000; // 6h idle
	const now = new Date("2026-06-01T12:00:00.000Z").getTime();

	function guard(ids: Array<[string, number]>) {
		const counted = new Map<string, TokenUsage>();
		const lastSeen = new Map<string, number>();
		for (const [id, seenAt] of ids) {
			counted.set(id, rec(id));
			lastSeen.set(id, seenAt);
		}
		return { counted, lastSeen };
	}

	it("drops ids idle past the ttl and keeps recently-seen ones", () => {
		const { counted, lastSeen } = guard([
			["idle", now - 7 * 60 * 60 * 1000],
			["recent", now - 1 * 60 * 60 * 1000],
		]);
		const pruned = pruneSeenUsage(counted, lastSeen, now, ttl);
		expect(pruned).toBe(1);
		expect(counted.has("idle")).toBe(false);
		expect(lastSeen.has("idle")).toBe(false);
		expect(counted.has("recent")).toBe(true);
	});

	it("keeps an old-message id that is still being re-logged (last-seen is recent)", () => {
		// Message created long ago but re-logged moments ago: last-seen is fresh,
		// so it must NOT be pruned — else the next re-log would be miscounted as a
		// brand-new message. Guards the prune-by-recency invariant.
		const counted = new Map<string, TokenUsage>();
		const lastSeen = new Map<string, number>();
		counted.set(
			"old-but-active",
			rec("old-but-active", {
				timestamp: new Date(now - 24 * 60 * 60 * 1000), // created 24h ago
			}),
		);
		lastSeen.set("old-but-active", now - 60_000); // re-logged 1 min ago
		expect(pruneSeenUsage(counted, lastSeen, now, ttl)).toBe(0);
		expect(counted.has("old-but-active")).toBe(true);
	});

	it("returns 0 and keeps everything when all ids are recently seen", () => {
		const { counted, lastSeen } = guard([
			["a", now - 60_000],
			["b", now],
		]);
		expect(pruneSeenUsage(counted, lastSeen, now, ttl)).toBe(0);
		expect(counted.size).toBe(2);
	});

	it("does not prune an id exactly at the ttl boundary (strict >)", () => {
		const { counted, lastSeen } = guard([["edge", now - ttl]]);
		expect(pruneSeenUsage(counted, lastSeen, now, ttl)).toBe(0);
		expect(counted.has("edge")).toBe(true);
	});
});

describe("reconcileBatch", () => {
	it("dedupes a batch, counts each new id once, and stamps last-seen", () => {
		const counted = new Map<string, TokenUsage>();
		const lastSeen = new Map<string, number>();
		const fresh = reconcileBatch(
			[rec("msg_a"), rec("msg_a", { outputTokens: 999 }), rec("msg_b")],
			counted,
			lastSeen,
			1000,
		);
		// msg_a collapses to its largest; msg_b counts -> 2 fresh records
		expect(fresh).toHaveLength(2);
		expect(lastSeen.get("msg_a")).toBe(1000);
		expect(lastSeen.get("msg_b")).toBe(1000);
	});

	it("stamps last-seen for a dropped equal re-log (keeps an active id prune-safe)", () => {
		// THE invariant behind the Codex fix: an id still being re-logged must
		// refresh last-seen even when reconcile drops the re-log as equal. If the
		// stamp moved inside the `counted !== null` branch, this test fails.
		const counted = new Map<string, TokenUsage>();
		const lastSeen = new Map<string, number>();
		reconcileBatch(
			[rec("msg_a", { outputTokens: 100 })],
			counted,
			lastSeen,
			1000,
		);
		expect(lastSeen.get("msg_a")).toBe(1000);
		const fresh = reconcileBatch(
			[rec("msg_a", { outputTokens: 100 })], // equal re-log -> dropped
			counted,
			lastSeen,
			5000,
		);
		expect(fresh).toHaveLength(0); // nothing new to aggregate
		expect(lastSeen.get("msg_a")).toBe(5000); // but last-seen advanced
	});

	it("keeps countedById and lastSeenById key sets in sync", () => {
		const counted = new Map<string, TokenUsage>();
		const lastSeen = new Map<string, number>();
		reconcileBatch(
			[rec("msg_a"), rec("msg_b"), rec("msg_a", { outputTokens: 999 })],
			counted,
			lastSeen,
			1000,
		);
		expect([...counted.keys()].sort()).toEqual([...lastSeen.keys()].sort());
	});

	it("never tracks id-less records in either guard map", () => {
		const counted = new Map<string, TokenUsage>();
		const lastSeen = new Map<string, number>();
		const fresh = reconcileBatch(
			[rec(undefined), rec("")],
			counted,
			lastSeen,
			1000,
		);
		expect(fresh).toHaveLength(2); // id-less records are always counted
		expect(counted.size).toBe(0);
		expect(lastSeen.size).toBe(0);
	});
});
