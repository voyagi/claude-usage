/**
 * Tests for usage attribution and behaviour signals.
 */

import type { TokenUsage, UsageAttributionTags } from "../types.js";
import {
	computeAttribution,
	computeAttributionWindow,
	hasAttributionContent,
	MAX_ATTRIBUTION_ROWS,
} from "./attribution.js";

const NOW = new Date("2026-07-21T18:00:00.000Z");

function minutesAgo(minutes: number): Date {
	return new Date(NOW.getTime() - minutes * 60_000);
}

function record(overrides: Partial<TokenUsage> = {}): TokenUsage {
	return {
		timestamp: minutesAgo(10),
		model: "claude-opus-4-8",
		sessionId: "session-1",
		messageId: `msg-${Math.round(Math.random() * 1e9)}`,
		inputTokens: 100,
		outputTokens: 500,
		cacheCreationTokens: 0,
		cacheReadTokens: 0,
		cacheCreation5m: 0,
		cacheCreation1h: 0,
		cost: 1,
		...overrides,
	};
}

function withTags(
	tags: UsageAttributionTags,
	overrides: Partial<TokenUsage> = {},
): TokenUsage {
	return record({ attribution: tags, ...overrides });
}

/** Percentage for a named contributor, or undefined when absent */
function share(
	entries: { name: string; percentage: number }[],
	name: string,
): number | undefined {
	return entries.find((e) => e.name === name)?.percentage;
}

function behaviorShare(
	behaviors: { key: string; percentage: number }[],
	key: string,
): number {
	return behaviors.find((b) => b.key === key)?.percentage ?? 0;
}

const dayStart = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);

describe("computeAttributionWindow: named contributors", () => {
	it("attributes cost to skills by name", () => {
		const result = computeAttributionWindow(
			[
				withTags({ skill: "suggest-run" }, { cost: 6 }),
				withTags({ skill: "update-check" }, { cost: 2 }),
				record({ cost: 2 }),
			],
			dayStart,
			NOW,
		);

		expect(result.totalCost).toBe(10);
		expect(share(result.skills, "suggest-run")).toBe(60);
		expect(share(result.skills, "update-check")).toBe(20);
	});

	it("attributes subagents, plugins and MCP servers independently", () => {
		const result = computeAttributionWindow(
			[
				withTags(
					{
						skill: "suggest-run",
						agent: "post-task-reviewer",
						plugin: "impeccable",
						mcpServer: "figma",
					},
					{ cost: 4 },
				),
				record({ cost: 6 }),
			],
			dayStart,
			NOW,
		);

		// One record can carry every tag at once: the groups overlap by design
		expect(share(result.skills, "suggest-run")).toBe(40);
		expect(share(result.agents, "post-task-reviewer")).toBe(40);
		expect(share(result.plugins, "impeccable")).toBe(40);
		expect(share(result.mcpServers, "figma")).toBe(40);
	});

	it("sums repeated contributors rather than listing them twice", () => {
		const result = computeAttributionWindow(
			[
				withTags({ skill: "pr" }, { cost: 1 }),
				withTags({ skill: "pr" }, { cost: 3 }),
			],
			dayStart,
			NOW,
		);

		expect(result.skills).toHaveLength(1);
		expect(result.skills[0]).toMatchObject({ name: "pr", cost: 4 });
	});

	it("ranks by cost and caps the number of rows", () => {
		const records: TokenUsage[] = [];
		for (let i = 0; i < MAX_ATTRIBUTION_ROWS + 5; i++) {
			records.push(withTags({ skill: `skill-${i}` }, { cost: i + 1 }));
		}

		const result = computeAttributionWindow(records, dayStart, NOW);
		expect(result.skills).toHaveLength(MAX_ATTRIBUTION_ROWS);
		// Highest cost first
		expect(result.skills[0].name).toBe(`skill-${MAX_ATTRIBUTION_ROWS + 4}`);
	});

	it("ignores records outside the window", () => {
		const result = computeAttributionWindow(
			[
				withTags({ skill: "recent" }, { cost: 5 }),
				withTags(
					{ skill: "ancient" },
					{ cost: 100, timestamp: minutesAgo(60 * 48) },
				),
			],
			dayStart,
			NOW,
		);

		expect(result.totalCost).toBe(5);
		expect(share(result.skills, "ancient")).toBeUndefined();
	});

	it("skips records with an unparseable timestamp", () => {
		const result = computeAttributionWindow(
			[
				withTags({ skill: "good" }, { cost: 5 }),
				withTags(
					{ skill: "corrupt" },
					{ cost: 1000, timestamp: new Date("not-a-date") },
				),
			],
			dayStart,
			NOW,
		);

		// A NaN timestamp compares false against both bounds; make sure that
		// exclusion is deliberate and cannot poison the totals.
		expect(result.totalCost).toBe(5);
		expect(result.recordCount).toBe(1);
		expect(share(result.skills, "corrupt")).toBeUndefined();
	});

	it("includes records exactly on the window boundaries", () => {
		const result = computeAttributionWindow(
			[
				withTags({ skill: "at-start" }, { cost: 1, timestamp: dayStart }),
				withTags({ skill: "at-end" }, { cost: 1, timestamp: NOW }),
			],
			dayStart,
			NOW,
		);

		expect(result.recordCount).toBe(2);
		expect(result.totalCost).toBe(2);
	});

	it("keeps every share within 0-100", () => {
		const result = computeAttributionWindow(
			[
				withTags(
					{ skill: "s", agent: "a", plugin: "p", mcpServer: "m" },
					{ cost: 3, cacheCreationTokens: 200_000, cacheReadTokens: 200_000 },
				),
				record({ cost: 1 }),
			],
			dayStart,
			NOW,
		);

		const allShares = [
			...result.behaviors.map((b) => b.percentage),
			...result.skills.map((s) => s.percentage),
			...result.agents.map((a) => a.percentage),
			...result.plugins.map((p) => p.percentage),
			...result.mcpServers.map((m) => m.percentage),
		];
		expect(allShares.length).toBeGreaterThan(0);
		for (const value of allShares) {
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThanOrEqual(100);
		}
	});

	it("does not divide by zero when every record in the window is free", () => {
		const result = computeAttributionWindow(
			[withTags({ skill: "free" }, { cost: 0 })],
			dayStart,
			NOW,
		);

		expect(result.recordCount).toBe(1);
		expect(result.totalCost).toBe(0);
		expect(result.skills[0].percentage).toBe(0);
		expect(result.behaviors).toEqual([]);
	});

	it("returns zeroed output for an empty window without dividing by zero", () => {
		const result = computeAttributionWindow([], dayStart, NOW);
		expect(result.totalCost).toBe(0);
		expect(result.recordCount).toBe(0);
		expect(result.behaviors).toEqual([]);
		expect(result.skills).toEqual([]);
	});
});

describe("computeAttributionWindow: behaviour signals", () => {
	it("flags requests that wrote a huge fresh cache", () => {
		const result = computeAttributionWindow(
			[
				record({ cost: 7, cacheCreationTokens: 120_000 }),
				record({ cost: 3, cacheCreationTokens: 1_000 }),
			],
			dayStart,
			NOW,
		);

		expect(behaviorShare(result.behaviors, "cacheMiss")).toBe(70);
	});

	it("flags long context by total context carried, not output size", () => {
		const result = computeAttributionWindow(
			[
				record({ cost: 5, inputTokens: 10, cacheReadTokens: 160_000 }),
				record({ cost: 5, inputTokens: 10, cacheReadTokens: 1_000 }),
			],
			dayStart,
			NOW,
		);

		expect(behaviorShare(result.behaviors, "longContext")).toBe(50);
	});

	it("flags sessions that lean on subagents, counting requests not cost", () => {
		const result = computeAttributionWindow(
			[
				// session-a: 3 subagent requests, individually cheap
				withTags({ agent: "workflow-subagent" }, { cost: 1, sessionId: "a" }),
				withTags({ agent: "workflow-subagent" }, { cost: 1, sessionId: "a" }),
				withTags({ agent: "post-task-reviewer" }, { cost: 1, sessionId: "a" }),
				// ...against an expensive main thread. A cost-share rule would miss it.
				record({ cost: 7, sessionId: "a" }),
				// session-b: no subagents
				record({ cost: 10, sessionId: "b" }),
			],
			dayStart,
			NOW,
		);

		// All of session-a's cost (10 of 20 total) counts as subagent-heavy
		expect(behaviorShare(result.behaviors, "subagentHeavy")).toBe(50);
	});

	it("does not flag a session with only a couple of subagent requests", () => {
		const result = computeAttributionWindow(
			[
				withTags({ agent: "post-task-reviewer" }, { cost: 1, sessionId: "a" }),
				withTags({ agent: "post-task-reviewer" }, { cost: 1, sessionId: "a" }),
				record({ cost: 8, sessionId: "a" }),
			],
			dayStart,
			NOW,
		);

		expect(behaviorShare(result.behaviors, "subagentHeavy")).toBe(0);
	});

	it("flags sessions running 8+ hours", () => {
		const result = computeAttributionWindow(
			[
				record({ cost: 3, sessionId: "long", timestamp: minutesAgo(9 * 60) }),
				record({ cost: 3, sessionId: "long", timestamp: minutesAgo(30) }),
				record({ cost: 4, sessionId: "short", timestamp: minutesAgo(20) }),
			],
			dayStart,
			NOW,
		);

		expect(behaviorShare(result.behaviors, "longRunning")).toBe(60);
	});

	it("flags usage spent while several sessions ran at once", () => {
		const at = minutesAgo(30);
		const result = computeAttributionWindow(
			[
				record({ cost: 1, sessionId: "s1", timestamp: at }),
				record({ cost: 1, sessionId: "s2", timestamp: at }),
				record({ cost: 1, sessionId: "s3", timestamp: at }),
				record({ cost: 1, sessionId: "s4", timestamp: at }),
				// A lone session an hour later is not parallel
				record({ cost: 6, sessionId: "s5", timestamp: minutesAgo(90) }),
			],
			dayStart,
			NOW,
		);

		expect(behaviorShare(result.behaviors, "highParallel")).toBe(40);
	});

	it("does not flag parallelism below the threshold", () => {
		const at = minutesAgo(30);
		const result = computeAttributionWindow(
			[
				record({ cost: 1, sessionId: "s1", timestamp: at }),
				record({ cost: 1, sessionId: "s2", timestamp: at }),
				record({ cost: 1, sessionId: "s3", timestamp: at }),
			],
			dayStart,
			NOW,
		);

		expect(behaviorShare(result.behaviors, "highParallel")).toBe(0);
	});

	it("lets one request match several behaviours (shares need not sum to 100)", () => {
		const result = computeAttributionWindow(
			[
				record({
					cost: 10,
					cacheCreationTokens: 200_000,
					cacheReadTokens: 200_000,
				}),
			],
			dayStart,
			NOW,
		);

		expect(behaviorShare(result.behaviors, "cacheMiss")).toBe(100);
		expect(behaviorShare(result.behaviors, "longContext")).toBe(100);
	});
});

describe("computeAttribution: day and week windows", () => {
	it("separates the last 24h from the last 7 days", () => {
		const result = computeAttribution(
			[
				withTags({ skill: "today" }, { cost: 5, timestamp: minutesAgo(60) }),
				withTags(
					{ skill: "earlier-this-week" },
					{ cost: 5, timestamp: minutesAgo(60 * 72) },
				),
			],
			NOW,
		);

		expect(result.day.totalCost).toBe(5);
		expect(share(result.day.skills, "today")).toBe(100);
		expect(result.week.totalCost).toBe(10);
		expect(share(result.week.skills, "earlier-this-week")).toBe(50);
	});

	it("excludes records older than the week window", () => {
		const result = computeAttribution(
			[
				withTags(
					{ skill: "old" },
					{ cost: 5, timestamp: minutesAgo(60 * 24 * 9) },
				),
			],
			NOW,
		);

		expect(result.week.totalCost).toBe(0);
	});
});

describe("hasAttributionContent", () => {
	it("is false for an empty window", () => {
		expect(
			hasAttributionContent(computeAttributionWindow([], dayStart, NOW)),
		).toBe(false);
	});

	it("is true when a named contributor exists", () => {
		const window = computeAttributionWindow(
			[withTags({ skill: "pr" }, { cost: 1 })],
			dayStart,
			NOW,
		);
		expect(hasAttributionContent(window)).toBe(true);
	});

	it("is false when the only behaviour is under the display floor", () => {
		const records: TokenUsage[] = [
			record({ cost: 1, cacheCreationTokens: 200_000 }),
		];
		// 99 more records with no notable behaviour dilute it below 10%
		for (let i = 0; i < 99; i++) records.push(record({ cost: 1 }));

		const window = computeAttributionWindow(records, dayStart, NOW);
		expect(behaviorShare(window.behaviors, "cacheMiss")).toBeCloseTo(1, 5);
		expect(hasAttributionContent(window)).toBe(false);
	});
});
