import type { AggregatedUsage, TokenUsage } from "../types";
import {
	addToAggregation,
	createEmptyAggregatedUsage,
	extractTokenUsage,
	getBillableTokenCount,
	getTotalTokens,
} from "./tokenCounter";

describe("Token Counter", () => {
	describe("extractTokenUsage", () => {
		it("should extract full cache data including ephemeral buckets", () => {
			const parsed = {
				timestamp: "2026-05-12T10:30:00Z",
				message: {
					model: "claude-sonnet-4-20250514",
					usage: {
						input_tokens: 1500,
						output_tokens: 800,
						cache_creation_input_tokens: 200,
						cache_read_input_tokens: 3000,
						cache_creation: {
							ephemeral_5m_input_tokens: 50,
							ephemeral_1h_input_tokens: 150,
						},
					},
				},
			};

			const result = extractTokenUsage(parsed, "session-abc");

			expect(result).toEqual({
				timestamp: new Date("2026-05-12T10:30:00Z"),
				model: "claude-sonnet-4-20250514",
				sessionId: "session-abc",
				inputTokens: 1500,
				outputTokens: 800,
				cacheCreationTokens: 200,
				cacheReadTokens: 3000,
				cacheCreation5m: 50,
				cacheCreation1h: 150,
				cost: 0,
			});
		});

		it("should default optional fields to 0 when absent", () => {
			const parsed = {
				timestamp: "2026-05-12T11:00:00Z",
				message: {
					model: "claude-opus-4-20250514",
					usage: {
						input_tokens: 500,
						output_tokens: 200,
					},
				},
			};

			const result = extractTokenUsage(parsed, "session-xyz");

			expect(result.inputTokens).toBe(500);
			expect(result.outputTokens).toBe(200);
			expect(result.cacheCreationTokens).toBe(0);
			expect(result.cacheReadTokens).toBe(0);
			expect(result.cacheCreation5m).toBe(0);
			expect(result.cacheCreation1h).toBe(0);
			expect(result.cost).toBe(0);
			expect(result.model).toBe("claude-opus-4-20250514");
			expect(result.sessionId).toBe("session-xyz");
			expect(result.timestamp).toEqual(new Date("2026-05-12T11:00:00Z"));
		});
	});

	describe("getBillableTokenCount", () => {
		it("should return inputTokens + cacheCreationTokens", () => {
			const usage: TokenUsage = {
				timestamp: new Date(),
				model: "claude-sonnet-4-20250514",
				sessionId: "s1",
				inputTokens: 1000,
				outputTokens: 500,
				cacheCreationTokens: 300,
				cacheReadTokens: 2000,
				cacheCreation5m: 0,
				cacheCreation1h: 0,
				cost: 0,
			};

			expect(getBillableTokenCount(usage)).toBe(1300);
		});
	});

	describe("getTotalTokens", () => {
		it("should sum all 4 token types", () => {
			const usage: TokenUsage = {
				timestamp: new Date(),
				model: "claude-sonnet-4-20250514",
				sessionId: "s1",
				inputTokens: 1000,
				outputTokens: 500,
				cacheCreationTokens: 300,
				cacheReadTokens: 2000,
				cacheCreation5m: 0,
				cacheCreation1h: 0,
				cost: 0,
			};

			// 1000 + 500 + 300 + 2000 = 3800
			expect(getTotalTokens(usage)).toBe(3800);
		});
	});

	describe("createEmptyAggregatedUsage", () => {
		it("should return zeros and nulls", () => {
			const empty = createEmptyAggregatedUsage();

			expect(empty).toEqual({
				inputTokens: 0,
				outputTokens: 0,
				cacheCreationTokens: 0,
				cacheReadTokens: 0,
				totalCost: 0,
				messageCount: 0,
				firstMessage: null,
				lastMessage: null,
			});
		});
	});

	describe("addToAggregation", () => {
		const makeUsage = (overrides: Partial<TokenUsage> = {}): TokenUsage => ({
			timestamp: new Date("2026-05-12T12:00:00Z"),
			model: "claude-sonnet-4-20250514",
			sessionId: "s1",
			inputTokens: 100,
			outputTokens: 50,
			cacheCreationTokens: 20,
			cacheReadTokens: 500,
			cacheCreation5m: 0,
			cacheCreation1h: 0,
			cost: 0.05,
			...overrides,
		});

		it("should add token values correctly", () => {
			const target = createEmptyAggregatedUsage();
			const source = makeUsage();

			addToAggregation(target, source);

			expect(target.inputTokens).toBe(100);
			expect(target.outputTokens).toBe(50);
			expect(target.cacheCreationTokens).toBe(20);
			expect(target.cacheReadTokens).toBe(500);
			expect(target.totalCost).toBeCloseTo(0.05);
			expect(target.messageCount).toBe(1);

			// Add a second source
			addToAggregation(target, makeUsage({ inputTokens: 200, cost: 0.1 }));

			expect(target.inputTokens).toBe(300);
			expect(target.outputTokens).toBe(100);
			expect(target.totalCost).toBeCloseTo(0.15);
			expect(target.messageCount).toBe(2);
		});

		it("should update firstMessage and lastMessage timestamps", () => {
			const target = createEmptyAggregatedUsage();

			const earlier = new Date("2026-05-12T08:00:00Z");
			const later = new Date("2026-05-12T16:00:00Z");

			addToAggregation(target, makeUsage({ timestamp: later }));
			expect(target.firstMessage).toEqual(later);
			expect(target.lastMessage).toEqual(later);

			// Adding an earlier message should update firstMessage but not lastMessage
			addToAggregation(target, makeUsage({ timestamp: earlier }));
			expect(target.firstMessage).toEqual(earlier);
			expect(target.lastMessage).toEqual(later);
		});

		it("should handle null timestamps in target", () => {
			const target: AggregatedUsage = {
				inputTokens: 50,
				outputTokens: 25,
				cacheCreationTokens: 10,
				cacheReadTokens: 200,
				totalCost: 0.02,
				messageCount: 1,
				firstMessage: null,
				lastMessage: null,
			};

			const ts = new Date("2026-05-12T14:00:00Z");
			addToAggregation(target, makeUsage({ timestamp: ts }));

			expect(target.firstMessage).toEqual(ts);
			expect(target.lastMessage).toEqual(ts);
			expect(target.messageCount).toBe(2);
		});
	});
});
