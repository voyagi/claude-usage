// pricingEngine imports "vscode" (for loadPricingFromConfig); these tests only
// exercise the pure pricing functions, so a virtual empty mock is enough to load
// the module under Node (vscode is editor-provided at runtime, not an npm package).
jest.mock("vscode", () => ({}), { virtual: true });

import type { TokenUsage } from "../types";
import {
	calculateCost,
	getDefaultPricing,
	resolveModelPricing,
} from "./pricingEngine";

const pricing = getDefaultPricing();

function usage(model: string, over: Partial<TokenUsage> = {}): TokenUsage {
	return {
		timestamp: new Date("2026-06-01T12:00:00.000Z"),
		model,
		sessionId: "s1",
		inputTokens: 0,
		outputTokens: 0,
		cacheCreationTokens: 0,
		cacheReadTokens: 0,
		cacheCreation5m: 0,
		cacheCreation1h: 0,
		cost: 0,
		...over,
	};
}

describe("resolveModelPricing", () => {
	it("resolves an exact model match", () => {
		const p = resolveModelPricing("claude-opus-4-8", pricing);
		expect(p?.inputPerMillion).toBe(5.0);
		expect(p?.outputPerMillion).toBe(25.0);
	});

	it("prices claude-opus-4-8 as Opus, not the Sonnet fallback (regression)", () => {
		// Before the fix, any model missing from the table fell back to
		// claude-sonnet-4-5 (3/15), undercounting Opus (5/25) by ~40%.
		const p = resolveModelPricing("claude-opus-4-8", pricing);
		expect(p?.inputPerMillion).toBe(5.0);
		expect(p?.inputPerMillion).not.toBe(3.0);
	});

	it("resolves a dated / suffixed model id via prefix match", () => {
		const p = resolveModelPricing("claude-opus-4-8-20260514", pricing);
		expect(p?.inputPerMillion).toBe(5.0);
	});

	it("falls back to the newest model in the family for an unknown version", () => {
		// An unreleased opus version should price as the newest known opus, not Sonnet.
		const p = resolveModelPricing("claude-opus-4-9", pricing);
		expect(p?.inputPerMillion).toBe(5.0);
		expect(p?.outputPerMillion).toBe(25.0);
	});

	it("resolves the sonnet and haiku families", () => {
		expect(
			resolveModelPricing("claude-sonnet-4-6", pricing)?.inputPerMillion,
		).toBe(3.0);
		expect(
			resolveModelPricing("claude-haiku-4-5", pricing)?.inputPerMillion,
		).toBe(1.0);
	});

	it("returns null for non-billable / synthetic models", () => {
		expect(resolveModelPricing("<synthetic>", pricing)).toBeNull();
		expect(resolveModelPricing("text-embedding-3", pricing)).toBeNull();
	});
});

describe("calculateCost", () => {
	it("prices opus-4-8 input/output at $5/$25 per million", () => {
		const cost = calculateCost(
			usage("claude-opus-4-8", {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			}),
			pricing,
		);
		// 1M input * $5/M + 1M output * $25/M
		expect(cost).toBeCloseTo(30, 6);
	});

	it("returns 0 for a non-billable model instead of mis-pricing it", () => {
		const cost = calculateCost(
			usage("<synthetic>", {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			}),
			pricing,
		);
		expect(cost).toBe(0);
	});

	it("applies the standard cache multipliers (5m 1.25x, 1h 2x, read 0.1x)", () => {
		const cost = calculateCost(
			usage("claude-opus-4-8", {
				cacheCreation5m: 1_000_000,
				cacheCreation1h: 1_000_000,
				cacheReadTokens: 1_000_000,
			}),
			pricing,
		);
		// 5m: 1M * 5 * 1.25 = 6.25 ; 1h: 1M * 5 * 2 = 10 ; read: 1M * 5 * 0.1 = 0.5
		expect(cost).toBeCloseTo(6.25 + 10 + 0.5, 6);
	});
});
