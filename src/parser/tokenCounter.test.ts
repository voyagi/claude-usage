import type { TokenUsage } from "../types";
import { parseAssistantMessage } from "./schemas";
import { dedupeByMessageId, projectNameFromCwd } from "./tokenCounter";

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

	it("keeps the LAST record for a repeated id (final write carries final usage)", () => {
		const records = [
			rec("msg_a", { outputTokens: 1 }),
			rec("msg_a", { outputTokens: 999 }),
		];
		const out = dedupeByMessageId(records);
		expect(out).toHaveLength(1);
		expect(out[0].outputTokens).toBe(999);
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
		expect(projectNameFromCwd("C:\\Users\\Eagi\\projects\\claude-usage")).toBe(
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
