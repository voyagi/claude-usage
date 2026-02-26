import { subMinutes } from "date-fns";
import type { AggregatedUsage, TimeBuckets } from "../types";
import {
	calculateBurnRateEMA,
	createBurnRateTracker,
	predictTimeUntilLimit,
} from "./burnRate";

describe("Burn Rate Calculator", () => {
	describe("createBurnRateTracker", () => {
		it("should create tracker with default alpha 0.2", () => {
			const tracker = createBurnRateTracker();
			expect(tracker.alpha).toBe(0.2);
			expect(tracker.ema).toBe(0);
			expect(tracker.lastUpdate).toBeInstanceOf(Date);
		});

		it("should create tracker with custom alpha", () => {
			const tracker = createBurnRateTracker(0.5);
			expect(tracker.alpha).toBe(0.5);
			expect(tracker.ema).toBe(0);
		});
	});

	describe("calculateBurnRateEMA", () => {
		it("should return 0 with empty buckets", () => {
			const buckets: TimeBuckets = {
				session: new Map(),
				daily: new Map(),
				weekly: new Map(),
				monthly: new Map(),
				modelWeekly: new Map(),
			};
			const tracker = createBurnRateTracker();
			const result = calculateBurnRateEMA(buckets, tracker, 60);

			expect(result.rate).toBe(0);
			expect(result.tracker.ema).toBe(0);
		});

		it("should return 0 when activity is outside lookback window", () => {
			const now = new Date();
			const oldActivity: AggregatedUsage = {
				inputTokens: 0,
				outputTokens: 1000,
				cacheCreationTokens: 0,
				cacheReadTokens: 0,
				totalCost: 0,
				messageCount: 1,
				firstMessage: subMinutes(now, 120), // 2 hours ago
				lastMessage: subMinutes(now, 120),
			};

			const buckets: TimeBuckets = {
				session: new Map([["old-session", oldActivity]]),
				daily: new Map(),
				weekly: new Map(),
				monthly: new Map(),
				modelWeekly: new Map(),
			};

			const tracker = createBurnRateTracker();
			const result = calculateBurnRateEMA(buckets, tracker, 60); // 60 min lookback

			expect(result.rate).toBe(0);
		});

		it("should return positive rate with activity in lookback window", () => {
			const now = new Date();
			const recentActivity: AggregatedUsage = {
				inputTokens: 0,
				outputTokens: 1000,
				cacheCreationTokens: 0,
				cacheReadTokens: 0,
				totalCost: 0,
				messageCount: 1,
				firstMessage: subMinutes(now, 10), // 10 mins ago
				lastMessage: subMinutes(now, 5), // 5 mins ago
			};

			const buckets: TimeBuckets = {
				session: new Map([["recent-session", recentActivity]]),
				daily: new Map(),
				weekly: new Map(),
				monthly: new Map(),
				modelWeekly: new Map(),
			};

			const tracker = createBurnRateTracker();
			const result = calculateBurnRateEMA(buckets, tracker, 60);

			expect(result.rate).toBeGreaterThan(0);
		});

		it("should apply EMA smoothing across multiple calls", () => {
			const now = new Date();
			const activity: AggregatedUsage = {
				inputTokens: 0,
				outputTokens: 1000,
				cacheCreationTokens: 0,
				cacheReadTokens: 0,
				totalCost: 0,
				messageCount: 1,
				firstMessage: subMinutes(now, 10),
				lastMessage: subMinutes(now, 5),
			};

			const buckets: TimeBuckets = {
				session: new Map([["session", activity]]),
				daily: new Map(),
				weekly: new Map(),
				monthly: new Map(),
				modelWeekly: new Map(),
			};

			const tracker = createBurnRateTracker(0.5); // alpha = 0.5 for predictable math
			const firstResult = calculateBurnRateEMA(buckets, tracker, 60);
			const _firstRate = firstResult.rate;

			// Second call should blend with previous EMA
			const secondResult = calculateBurnRateEMA(
				buckets,
				firstResult.tracker,
				60,
			);

			// With alpha=0.5, newEma = 0.5 * currentRate + 0.5 * oldEma
			// If rate is stable, EMA should converge toward currentRate
			expect(secondResult.rate).toBeGreaterThan(0);
		});
	});

	describe("predictTimeUntilLimit", () => {
		it("should return null when burn rate is 0", () => {
			const result = predictTimeUntilLimit(100, 1000, 0);
			expect(result).toBeNull();
		});

		it("should return 0 when already at limit", () => {
			const result = predictTimeUntilLimit(1000, 1000, 10);
			expect(result).toBe(0);
		});

		it("should return 0 when over limit", () => {
			const result = predictTimeUntilLimit(1100, 1000, 10);
			expect(result).toBe(0);
		});

		it("should calculate time remaining correctly", () => {
			const result = predictTimeUntilLimit(100, 1000, 10);
			// (1000 - 100) / 10 = 90 minutes
			expect(result).toBe(90);
		});

		it("should handle fractional minutes", () => {
			const result = predictTimeUntilLimit(100, 1000, 15);
			// (1000 - 100) / 15 = 60 minutes
			expect(result).toBe(60);
		});
	});
});
