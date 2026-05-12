/**
 * Unit tests for rateLimits.ts
 *
 * Tests calculateRateLimits, calculateUrgencyScore, and calculateBurnRate.
 */

jest.mock("vscode", () => ({}), { virtual: true });

import { format, startOfWeek } from "date-fns";
import type {
	AggregatedUsage,
	RateLimitInfo,
	RefinedLimits,
	TimeBuckets,
} from "../types";
import {
	calculateBurnRate,
	calculateRateLimits,
	calculateUrgencyScore,
} from "./rateLimits";

// ── Helpers ────────────────────────────────────────────────────────────

function emptyAgg(overrides: Partial<AggregatedUsage> = {}): AggregatedUsage {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheCreationTokens: 0,
		cacheReadTokens: 0,
		totalCost: 0,
		messageCount: 0,
		firstMessage: null,
		lastMessage: null,
		...overrides,
	};
}

function emptyBuckets(): TimeBuckets {
	return {
		session: new Map(),
		daily: new Map(),
		weekly: new Map(),
		monthly: new Map(),
		modelWeekly: new Map(),
		hourly: new Map(),
	};
}

/** Format an hourly bucket key matching the source: "YYYY-MM-DDTHH" */
function hourKey(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	const h = String(date.getHours()).padStart(2, "0");
	return `${y}-${m}-${d}T${h}`;
}

/** Compute the ISO week key the same way the source does */
function weekKey(date: Date): string {
	const ws = startOfWeek(date, { weekStartsOn: 1 });
	return format(ws, "yyyy-'W'II");
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("calculateRateLimits", () => {
	beforeEach(() => {
		jest.useFakeTimers();
		// Wednesday 2026-05-06 14:00 UTC (a known midweek time)
		jest.setSystemTime(new Date("2026-05-06T14:00:00Z"));
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it("returns all zeros with empty buckets", () => {
		const result = calculateRateLimits(emptyBuckets(), "pro");

		expect(result.session5h.currentTokens).toBe(0);
		expect(result.session5h.percentage).toBe(0);
		expect(result.session5h.isHit).toBe(false);
		expect(result.weekly.currentTokens).toBe(0);
		expect(result.weekly.percentage).toBe(0);
		expect(result.weeklySonnet.currentTokens).toBe(0);
		expect(result.weeklySonnet.percentage).toBe(0);
		expect(result.worstPercentage).toBe(0);
	});

	it("sums hourly output tokens within the 5hr window", () => {
		const now = new Date();
		const buckets = emptyBuckets();

		// Add hourly buckets: 2h ago and 4h ago (both within 5hr window)
		const twoHoursAgo = new Date(now.getTime() - 2 * 3600_000);
		const fourHoursAgo = new Date(now.getTime() - 4 * 3600_000);
		buckets.hourly.set(
			hourKey(twoHoursAgo),
			emptyAgg({ outputTokens: 10_000 }),
		);
		buckets.hourly.set(
			hourKey(fourHoursAgo),
			emptyAgg({ outputTokens: 5_000 }),
		);

		const result = calculateRateLimits(buckets, "pro");
		// pro sessionTokenLimit = 44000
		expect(result.session5h.currentTokens).toBe(15_000);
		expect(result.session5h.percentage).toBe(
			Math.min(100, Math.round((15_000 / 44_000) * 100)),
		);
		expect(result.session5h.isHit).toBe(false);
	});

	it("excludes hourly tokens outside the 5hr window", () => {
		const now = new Date();
		const buckets = emptyBuckets();

		// 6 hours ago: outside the window
		const sixHoursAgo = new Date(now.getTime() - 6 * 3600_000);
		buckets.hourly.set(
			hourKey(sixHoursAgo),
			emptyAgg({ outputTokens: 20_000 }),
		);

		const result = calculateRateLimits(buckets, "pro");
		expect(result.session5h.currentTokens).toBe(0);
	});

	it("reads weekly tokens from the correct week key", () => {
		const now = new Date();
		const wk = weekKey(now);
		const buckets = emptyBuckets();
		buckets.weekly.set(wk, emptyAgg({ outputTokens: 250_000 }));

		const result = calculateRateLimits(buckets, "pro");
		// pro weeklyTokenLimit = 500000
		expect(result.weekly.currentTokens).toBe(250_000);
		expect(result.weekly.percentage).toBe(50);
		expect(result.weekly.isHit).toBe(false);
	});

	it("sums sonnet model tokens from modelWeekly matching the week key", () => {
		const now = new Date();
		const wk = weekKey(now);
		const buckets = emptyBuckets();

		buckets.modelWeekly.set(
			`${wk}:claude-sonnet-4`,
			emptyAgg({ outputTokens: 100_000 }),
		);
		buckets.modelWeekly.set(
			`${wk}:claude-sonnet-4-20250514`,
			emptyAgg({ outputTokens: 50_000 }),
		);
		// Non-sonnet should be excluded
		buckets.modelWeekly.set(
			`${wk}:claude-opus-4`,
			emptyAgg({ outputTokens: 200_000 }),
		);

		const result = calculateRateLimits(buckets, "pro");
		// pro weeklySonnetLimit = 500000
		expect(result.weeklySonnet.currentTokens).toBe(150_000);
		expect(result.weeklySonnet.percentage).toBe(30);
	});

	it("caps percentage at 100", () => {
		const now = new Date();
		const buckets = emptyBuckets();

		// Exceed the session limit
		const oneHourAgo = new Date(now.getTime() - 1 * 3600_000);
		buckets.hourly.set(hourKey(oneHourAgo), emptyAgg({ outputTokens: 60_000 }));

		const result = calculateRateLimits(buckets, "pro");
		// 60000 / 44000 = 136% but capped at 100
		expect(result.session5h.percentage).toBe(100);
	});

	it("sets isHit true when at or above the limit", () => {
		const now = new Date();
		const buckets = emptyBuckets();

		const oneHourAgo = new Date(now.getTime() - 1 * 3600_000);
		buckets.hourly.set(hourKey(oneHourAgo), emptyAgg({ outputTokens: 44_000 }));

		const result = calculateRateLimits(buckets, "pro");
		expect(result.session5h.isHit).toBe(true);
	});

	it("worstPercentage is the max of all three", () => {
		const now = new Date();
		const wk = weekKey(now);
		const buckets = emptyBuckets();

		// Session: 50%
		const twoHoursAgo = new Date(now.getTime() - 2 * 3600_000);
		buckets.hourly.set(
			hourKey(twoHoursAgo),
			emptyAgg({ outputTokens: 22_000 }),
		);

		// Weekly: 80%
		buckets.weekly.set(wk, emptyAgg({ outputTokens: 400_000 }));

		// Sonnet: 60%
		buckets.modelWeekly.set(
			`${wk}:claude-sonnet-4`,
			emptyAgg({ outputTokens: 300_000 }),
		);

		const result = calculateRateLimits(buckets, "pro");
		expect(result.worstPercentage).toBe(80);
	});

	it("uses refinedLimits to override plan defaults", () => {
		const now = new Date();
		const buckets = emptyBuckets();

		const oneHourAgo = new Date(now.getTime() - 1 * 3600_000);
		buckets.hourly.set(hourKey(oneHourAgo), emptyAgg({ outputTokens: 22_000 }));

		const refined: RefinedLimits = {
			sessionTokenLimit: 22_000, // exact match -> 100%
			lastUpdated: new Date().toISOString(),
		};

		const result = calculateRateLimits(buckets, "pro", refined);
		expect(result.session5h.percentage).toBe(100);
		expect(result.session5h.isHit).toBe(true);
		expect(result.session5h.estimatedLimit).toBe(22_000);
	});

	it("uses max5 plan config values", () => {
		const now = new Date();
		const wk = weekKey(now);
		const buckets = emptyBuckets();
		buckets.weekly.set(wk, emptyAgg({ outputTokens: 450_000 }));

		const result = calculateRateLimits(buckets, "max5");
		// max5 weeklyTokenLimit = 900000
		expect(result.weekly.percentage).toBe(50);
		expect(result.weekly.estimatedLimit).toBe(900_000);
	});
});

describe("calculateUrgencyScore", () => {
	it("returns 0 when percentage is 0", () => {
		const limit: RateLimitInfo = {
			name: "test",
			currentTokens: 0,
			estimatedLimit: 44_000,
			percentage: 0,
			resetTime: new Date(Date.now() + 3600_000),
			isHit: false,
		};
		expect(calculateUrgencyScore(limit, new Date())).toBe(0);
	});

	it("returns 0 when resetTime is null", () => {
		const limit: RateLimitInfo = {
			name: "test",
			currentTokens: 22_000,
			estimatedLimit: 44_000,
			percentage: 50,
			resetTime: null,
			isHit: false,
		};
		expect(calculateUrgencyScore(limit, new Date())).toBe(0);
	});

	it("returns 0 when reset is in the past", () => {
		const now = new Date("2026-05-06T14:00:00Z");
		const limit: RateLimitInfo = {
			name: "test",
			currentTokens: 22_000,
			estimatedLimit: 44_000,
			percentage: 50,
			resetTime: new Date("2026-05-06T12:00:00Z"), // 2h before now
			isHit: false,
		};
		expect(calculateUrgencyScore(limit, now)).toBe(0);
	});

	it("increases with higher percentage", () => {
		const now = new Date("2026-05-06T14:00:00Z");
		const resetTime = new Date("2026-05-06T18:00:00Z"); // 4h away

		const low: RateLimitInfo = {
			name: "test",
			currentTokens: 0,
			estimatedLimit: 44_000,
			percentage: 20,
			resetTime,
			isHit: false,
		};
		const high: RateLimitInfo = {
			name: "test",
			currentTokens: 0,
			estimatedLimit: 44_000,
			percentage: 80,
			resetTime,
			isHit: false,
		};

		expect(calculateUrgencyScore(high, now)).toBeGreaterThan(
			calculateUrgencyScore(low, now),
		);
	});

	it("increases as reset time approaches", () => {
		const now = new Date("2026-05-06T14:00:00Z");

		const farReset: RateLimitInfo = {
			name: "test",
			currentTokens: 0,
			estimatedLimit: 44_000,
			percentage: 50,
			resetTime: new Date("2026-05-06T22:00:00Z"), // 8h away
			isHit: false,
		};
		const nearReset: RateLimitInfo = {
			name: "test",
			currentTokens: 0,
			estimatedLimit: 44_000,
			percentage: 50,
			resetTime: new Date("2026-05-06T15:00:00Z"), // 1h away
			isHit: false,
		};

		expect(calculateUrgencyScore(nearReset, now)).toBeGreaterThan(
			calculateUrgencyScore(farReset, now),
		);
	});

	it("computes correct value for known inputs", () => {
		const now = new Date("2026-05-06T14:00:00Z");
		const limit: RateLimitInfo = {
			name: "test",
			currentTokens: 0,
			estimatedLimit: 44_000,
			percentage: 80,
			resetTime: new Date("2026-05-06T18:00:00Z"), // 4h away
			isHit: false,
		};
		// urgency = 80 * (1 / sqrt(max(1, 4))) = 80 * (1/2) = 40
		expect(calculateUrgencyScore(limit, now)).toBe(40);
	});
});

describe("calculateBurnRate", () => {
	beforeEach(() => {
		jest.useFakeTimers();
		jest.setSystemTime(new Date("2026-05-06T14:00:00Z"));
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it("returns 0 with empty buckets", () => {
		expect(calculateBurnRate(emptyBuckets())).toBe(0);
	});

	it("returns 0 when no sessions have recent activity", () => {
		const now = new Date();
		const buckets = emptyBuckets();

		// Session with activity 30 minutes ago (outside 10-min window)
		buckets.session.set(
			"old-session",
			emptyAgg({
				outputTokens: 5_000,
				firstMessage: new Date(now.getTime() - 30 * 60_000),
				lastMessage: new Date(now.getTime() - 30 * 60_000),
			}),
		);

		expect(calculateBurnRate(buckets)).toBe(0);
	});

	it("computes tokens per minute from recent session activity", () => {
		const now = new Date();
		const buckets = emptyBuckets();

		// Session with last activity 5 min ago, started 8 min ago
		buckets.session.set(
			"active-session",
			emptyAgg({
				outputTokens: 1_600,
				firstMessage: new Date(now.getTime() - 8 * 60_000),
				lastMessage: new Date(now.getTime() - 5 * 60_000),
			}),
		);

		const rate = calculateBurnRate(buckets);
		// 1600 tokens / 8 minutes = 200 tokens/min
		expect(rate).toBe(200);
	});

	it("returns 0 when firstMessage equals now (0 elapsed minutes)", () => {
		const now = new Date();
		const buckets = emptyBuckets();

		buckets.session.set(
			"instant-session",
			emptyAgg({
				outputTokens: 500,
				firstMessage: now,
				lastMessage: now,
			}),
		);

		// differenceInMinutes(now, now) = 0, so rate = 0 (division guard)
		expect(calculateBurnRate(buckets)).toBe(0);
	});
});
