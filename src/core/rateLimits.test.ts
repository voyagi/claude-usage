/**
 * Tests for the model-scoped weekly rate limit.
 *
 * Anthropic changes which model the scoped weekly limit covers (Sonnet -> Opus
 * -> Fable as of 2026-07). These tests pin the behaviour that matters: the model
 * comes from the API, never from a hardcoded name, and we show nothing rather
 * than a confidently wrong bar when we do not know it.
 */

// rateLimits -> usageCache -> vscode. Only getStaleness is used here, so an
// empty module stub is enough to let the import chain resolve under Jest.
jest.mock("vscode", () => ({}), { virtual: true });

import { format, startOfWeek } from "date-fns";
import type { AggregatedUsage, ApiUsageData, TimeBuckets } from "../types.js";
import {
	buildStatusBarData,
	calculateRateLimits,
	modelMatchesScopeLabel,
} from "./rateLimits.js";

function emptyAgg(outputTokens: number): AggregatedUsage {
	return {
		inputTokens: 0,
		outputTokens,
		cacheCreationTokens: 0,
		cacheReadTokens: 0,
		totalCost: 0,
		messageCount: 1,
		firstMessage: null,
		lastMessage: null,
	};
}

/** Build buckets whose modelWeekly entries land in the CURRENT ISO week */
function bucketsWithModelWeekly(
	models: Record<string, number>,
	weekKey: string,
): TimeBuckets {
	const modelWeekly = new Map<string, AggregatedUsage>();
	for (const [model, tokens] of Object.entries(models)) {
		modelWeekly.set(`${weekKey}:${model}`, emptyAgg(tokens));
	}
	return {
		session: new Map(),
		daily: new Map(),
		weekly: new Map(),
		monthly: new Map(),
		modelWeekly,
		hourly: new Map(),
		project: new Map(),
	};
}

/** The week key calculateRateLimits will compute for "now" */
function currentWeekKey(): string {
	// Mirrors calculateRateLimits: startOfWeek(Monday) formatted "yyyy-'W'II"
	return format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-'W'II");
}

describe("modelMatchesScopeLabel", () => {
	it("matches an API display name against a model id", () => {
		expect(modelMatchesScopeLabel("claude-fable-5", "Fable")).toBe(true);
		expect(modelMatchesScopeLabel("claude-sonnet-5", "Sonnet")).toBe(true);
		expect(modelMatchesScopeLabel("claude-opus-4-8", "Opus")).toBe(true);
	});

	it("does not match a different model", () => {
		expect(modelMatchesScopeLabel("claude-opus-4-8", "Fable")).toBe(false);
		expect(modelMatchesScopeLabel("claude-fable-5", "Sonnet")).toBe(false);
	});

	it("treats an empty or whitespace label as no match", () => {
		expect(modelMatchesScopeLabel("claude-fable-5", "")).toBe(false);
		expect(modelMatchesScopeLabel("claude-fable-5", "   ")).toBe(false);
	});
});

describe("calculateRateLimits: weekly scoped limit", () => {
	it("returns null when the scoped model is unknown", () => {
		const buckets = bucketsWithModelWeekly(
			{ "claude-fable-5": 100_000 },
			currentWeekKey(),
		);
		const result = calculateRateLimits(buckets, "max5");
		expect(result.weeklyScoped).toBeNull();
	});

	it("counts only the scoped model's output tokens", () => {
		const weekKey = currentWeekKey();
		const buckets = bucketsWithModelWeekly(
			{
				"claude-fable-5": 90_000,
				"claude-opus-4-8": 500_000,
				"claude-sonnet-5": 300_000,
			},
			weekKey,
		);

		const result = calculateRateLimits(buckets, "max5", null, "Fable");
		expect(result.weeklyScoped).not.toBeNull();
		expect(result.weeklyScoped?.name).toBe("Weekly Fable");
		expect(result.weeklyScoped?.currentTokens).toBe(90_000);
	});

	it("ignores buckets from other weeks", () => {
		const buckets = bucketsWithModelWeekly(
			{ "claude-fable-5": 90_000 },
			"1999-W01",
		);
		const result = calculateRateLimits(buckets, "max5", null, "Fable");
		expect(result.weeklyScoped?.currentTokens).toBe(0);
	});

	it("does not let an unknown scoped limit inflate worstPercentage", () => {
		const buckets = bucketsWithModelWeekly({}, currentWeekKey());
		const result = calculateRateLimits(buckets, "max5");
		expect(result.worstPercentage).toBe(0);
	});

	it("prefers a refined limit over the plan default", () => {
		const weekKey = currentWeekKey();
		const buckets = bucketsWithModelWeekly(
			{ "claude-fable-5": 50_000 },
			weekKey,
		);
		const result = calculateRateLimits(
			buckets,
			"max5",
			{ weeklyScopedLimit: 100_000, lastUpdated: new Date().toISOString() },
			"Fable",
		);
		expect(result.weeklyScoped?.estimatedLimit).toBe(100_000);
		expect(result.weeklyScoped?.percentage).toBe(50);
	});
});

describe("buildStatusBarData: scoped model resolution", () => {
	const stats = { filesProcessed: 1, linesSkipped: 0 };

	function apiWith(label: string | null): ApiUsageData {
		return {
			fiveHour: null,
			sevenDay: null,
			scopedWeekly: label ? [{ label, utilization: 0.6, resetsAt: null }] : [],
			rateLimitTier: null,
			extraUsage: null,
			spend: null,
			fetchedAt: new Date(),
		};
	}

	it("takes the scoped model from the API when available", () => {
		const buckets = bucketsWithModelWeekly(
			{ "claude-fable-5": 10_000 },
			currentWeekKey(),
		);
		const data = buildStatusBarData(
			buckets,
			stats,
			"max5",
			0,
			null,
			apiWith("Fable"),
		);
		expect(data.rateLimits.weeklyScoped?.name).toBe("Weekly Fable");
	});

	it("falls back to the last known model when the API is unreachable", () => {
		const buckets = bucketsWithModelWeekly(
			{ "claude-fable-5": 10_000 },
			currentWeekKey(),
		);
		const data = buildStatusBarData(
			buckets,
			stats,
			"max5",
			0,
			null,
			null,
			"Fable",
		);
		expect(data.rateLimits.weeklyScoped?.name).toBe("Weekly Fable");
		expect(data.rateLimits.weeklyScoped?.currentTokens).toBe(10_000);
	});

	it("prefers the live API model over the persisted one", () => {
		const buckets = bucketsWithModelWeekly(
			{ "claude-fable-5": 10_000, "claude-sonnet-5": 20_000 },
			currentWeekKey(),
		);
		const data = buildStatusBarData(
			buckets,
			stats,
			"max5",
			0,
			null,
			apiWith("Sonnet"),
			"Fable",
		);
		expect(data.rateLimits.weeklyScoped?.name).toBe("Weekly Sonnet");
		expect(data.rateLimits.weeklyScoped?.currentTokens).toBe(20_000);
	});

	it("reports no scoped limit when neither source knows one", () => {
		const buckets = bucketsWithModelWeekly({}, currentWeekKey());
		const data = buildStatusBarData(
			buckets,
			stats,
			"max5",
			0,
			null,
			apiWith(null),
		);
		expect(data.rateLimits.weeklyScoped).toBeNull();
	});
});
