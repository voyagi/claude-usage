/**
 * Unit tests for pricingEngine
 *
 * Covers:
 * - getDefaultPricing returns a deep copy (mutations don't bleed)
 * - calculateCost for each model tier (opus, sonnet, haiku)
 * - Cache creation with 5m/1h breakdown vs. undifferentiated fallback
 * - Cache read cost
 * - Unknown-model fallback to sonnet pricing
 * - Zero-token edge case
 */

jest.mock("vscode", () => ({ workspace: { getConfiguration: jest.fn() } }), {
	virtual: true,
});

jest.mock("../utils/logger", () => ({
	Logger: {
		create: jest.fn(() => ({
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
		})),
	},
}));

import type { TokenUsage } from "../types";
import { calculateCost, getDefaultPricing } from "./pricingEngine";

/** Helper: build a TokenUsage record with sensible defaults */
function makeUsage(overrides: Partial<TokenUsage> = {}): TokenUsage {
	return {
		timestamp: new Date("2026-03-15T10:00:00Z"),
		model: "claude-sonnet-4-5",
		sessionId: "test-session",
		inputTokens: 0,
		outputTokens: 0,
		cacheCreationTokens: 0,
		cacheReadTokens: 0,
		cacheCreation5m: 0,
		cacheCreation1h: 0,
		cost: 0,
		...overrides,
	};
}

describe("pricingEngine", () => {
	describe("getDefaultPricing", () => {
		it("returns a deep copy — mutating the result does not affect subsequent calls", () => {
			const first = getDefaultPricing();
			first["claude-opus-4-6"].inputPerMillion = 999;
			delete (first as Record<string, unknown>)["claude-haiku-3-5"];

			const second = getDefaultPricing();
			expect(second["claude-opus-4-6"].inputPerMillion).toBe(5.0);
			expect(second["claude-haiku-3-5"]).toBeDefined();
		});

		it("includes all three default models", () => {
			const pricing = getDefaultPricing();
			expect(Object.keys(pricing).sort()).toEqual([
				"claude-haiku-3-5",
				"claude-opus-4-6",
				"claude-sonnet-4-5",
			]);
		});
	});

	describe("calculateCost", () => {
		const pricing = getDefaultPricing();

		it("calculates basic input+output cost for opus", () => {
			const usage = makeUsage({
				model: "claude-opus-4-6",
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			});

			const cost = calculateCost(usage, pricing);
			// input: 1M * 5.0/M = 5.00
			// output: 1M * 25.0/M = 25.00
			expect(cost).toBeCloseTo(30.0, 6);
		});

		it("calculates basic input+output cost for sonnet", () => {
			const usage = makeUsage({
				model: "claude-sonnet-4-5",
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			});

			const cost = calculateCost(usage, pricing);
			// input: 1M * 3.0/M = 3.00
			// output: 1M * 15.0/M = 15.00
			expect(cost).toBeCloseTo(18.0, 6);
		});

		it("calculates cost with 5m and 1h cache creation breakdown", () => {
			const usage = makeUsage({
				model: "claude-opus-4-6",
				inputTokens: 500_000,
				outputTokens: 200_000,
				cacheCreation5m: 100_000,
				cacheCreation1h: 50_000,
			});

			const cost = calculateCost(usage, pricing);
			// input:  0.5M * 5.0 = 2.50
			// output: 0.2M * 25.0 = 5.00
			// cache5m: 0.1M * 5.0 * 1.25 = 0.625
			// cache1h: 0.05M * 5.0 * 2.0 = 0.50
			// total = 2.50 + 5.00 + 0.625 + 0.50 = 8.625
			expect(cost).toBeCloseTo(8.625, 6);
		});

		it("uses 5m multiplier when only cacheCreationTokens is set (no breakdown)", () => {
			const usage = makeUsage({
				model: "claude-sonnet-4-5",
				inputTokens: 0,
				outputTokens: 0,
				cacheCreationTokens: 1_000_000,
				cacheCreation5m: 0,
				cacheCreation1h: 0,
			});

			const cost = calculateCost(usage, pricing);
			// cache: 1M * 3.0 * 1.25 = 3.75
			expect(cost).toBeCloseTo(3.75, 6);
		});

		it("calculates cache read cost", () => {
			const usage = makeUsage({
				model: "claude-opus-4-6",
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 1_000_000,
			});

			const cost = calculateCost(usage, pricing);
			// cacheRead: 1M * 5.0 * 0.1 = 0.50
			expect(cost).toBeCloseTo(0.5, 6);
		});

		it("falls back to sonnet pricing for an unknown model", () => {
			const usage = makeUsage({
				model: "claude-mystery-99",
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			});

			const cost = calculateCost(usage, pricing);
			// Same as sonnet: 3.0 + 15.0 = 18.0
			expect(cost).toBeCloseTo(18.0, 6);
		});

		it("returns 0 when all token counts are zero", () => {
			const usage = makeUsage({
				model: "claude-opus-4-6",
				inputTokens: 0,
				outputTokens: 0,
				cacheCreationTokens: 0,
				cacheReadTokens: 0,
				cacheCreation5m: 0,
				cacheCreation1h: 0,
			});

			expect(calculateCost(usage, pricing)).toBe(0);
		});
	});
});
