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

import {
	hourlyBucketKey,
	modelHourlyBucketKey,
	weeklyBucketKey,
} from "../aggregation/timeBuckets.js";
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
	// The shared helper, not a restatement of it. Mirroring the format string
	// here passed only because the two agree outside the turn of the year --
	// during the days where they diverge this fixture would key its buckets
	// somewhere calculateRateLimits never looks, and the test would fail for a
	// reason that has nothing to do with rate limits.
	return weeklyBucketKey(new Date());
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

		const result = calculateRateLimits(buckets, "max5", null, {
			scopedModel: "Fable",
		});
		expect(result.weeklyScoped).not.toBeNull();
		expect(result.weeklyScoped?.name).toBe("Weekly Fable");
		expect(result.weeklyScoped?.currentTokens).toBe(90_000);
	});

	it("ignores buckets from other weeks", () => {
		const buckets = bucketsWithModelWeekly(
			{ "claude-fable-5": 90_000 },
			"1999-W01",
		);
		const result = calculateRateLimits(buckets, "max5", null, {
			scopedModel: "Fable",
		});
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
			{ scopedModel: "Fable" },
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
		const data = buildStatusBarData(buckets, stats, "max5", 0, null, null, {
			scopedModel: "Fable",
		});
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
			{ scopedModel: "Fable" },
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

/**
 * The account's weekly cycle is anchored to a fixed instant Anthropic assigns,
 * not to a calendar week. Two captured payloads a week apart both reset at
 * 08:00 UTC on a Friday, and the scoped limit shared that instant rather than
 * carrying one of its own. A Monday-to-Sunday week is the wrong phase by up to
 * six days, so it counts usage from the wrong span and reports the wrong reset.
 */
describe("calculateRateLimits: the account's real weekly cycle", () => {
	// Mid-morning on Friday the 24th, an hour after that week's 08:00Z reset.
	const NOW = new Date("2026-07-24T12:00:00.000Z");
	const ANCHOR = "2026-07-24T08:00:00.383291+00:00";

	/** Wednesday: inside the ISO week, BEFORE the cycle that is running now. */
	const BEFORE_CYCLE = new Date("2026-07-22T12:00:00.000Z");
	/** Friday morning: inside both. */
	const INSIDE_CYCLE = new Date("2026-07-24T09:00:00.000Z");

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(NOW);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	/**
	 * Keys are built with the shared helpers rather than restated, so the
	 * fixture lands where the reader looks in any timezone.
	 */
	function bucketsWithHours(
		hours: { at: Date; model: string; tokens: number }[],
		isoWeekTotals: { weekly: number | null; models: Record<string, number> },
	): TimeBuckets {
		const hourly = new Map<string, AggregatedUsage>();
		const modelHourly = new Map<string, AggregatedUsage>();
		for (const { at, model, tokens } of hours) {
			hourly.set(hourlyBucketKey(at), emptyAgg(tokens));
			modelHourly.set(modelHourlyBucketKey(at, model), emptyAgg(tokens));
		}

		const weekKey = weeklyBucketKey(NOW);
		const modelWeekly = new Map<string, AggregatedUsage>();
		for (const [model, tokens] of Object.entries(isoWeekTotals.models)) {
			modelWeekly.set(`${weekKey}:${model}`, emptyAgg(tokens));
		}

		// `null` means no weekly bucket at all, which is what an account with no
		// history looks like. A bucket holding zero is a different state, and
		// passing one where the other is meant sends `canMeasureCycle` down the
		// fallback path while the test claims to be measuring the cycle.
		const weekly = new Map<string, AggregatedUsage>();
		if (isoWeekTotals.weekly !== null) {
			weekly.set(weekKey, emptyAgg(isoWeekTotals.weekly));
		}

		return {
			session: new Map(),
			daily: new Map(),
			weekly,
			monthly: new Map(),
			modelWeekly,
			hourly,
			modelHourly,
			project: new Map(),
		};
	}

	const FIXTURE = () =>
		bucketsWithHours(
			[
				{ at: BEFORE_CYCLE, model: "claude-fable-5", tokens: 50_000 },
				{ at: INSIDE_CYCLE, model: "claude-fable-5", tokens: 30_000 },
			],
			{ weekly: 80_000, models: { "claude-fable-5": 80_000 } },
		);

	it("reports the account's reset instant, not the next Monday", () => {
		const result = calculateRateLimits(FIXTURE(), "max5", null, {
			weeklyAnchor: ANCHOR,
		});
		expect(result.weekly.resetTime?.toISOString()).toBe(
			"2026-07-31T08:00:00.383Z",
		);
	});

	it("counts only usage inside the running cycle", () => {
		// Wednesday's 50k is in the same ISO week but belongs to the cycle that
		// already reset. Counting it is how a fresh cycle reads as two thirds
		// spent on its first morning.
		const result = calculateRateLimits(FIXTURE(), "max5", null, {
			weeklyAnchor: ANCHOR,
		});
		expect(result.weekly.currentTokens).toBe(30_000);
	});

	it("scopes the model limit to the same cycle", () => {
		const result = calculateRateLimits(FIXTURE(), "max5", null, {
			weeklyAnchor: ANCHOR,
			scopedModel: "Fable",
		});
		expect(result.weeklyScoped?.currentTokens).toBe(30_000);
		expect(result.weeklyScoped?.resetTime?.toISOString()).toBe(
			"2026-07-31T08:00:00.383Z",
		);
	});

	it("falls back to the calendar week when no anchor has been learned", () => {
		// Never having reached the API is the one case where a guess beats
		// nothing, and the guess is the old behaviour unchanged.
		const result = calculateRateLimits(FIXTURE(), "max5", null, {});
		expect(result.weekly.currentTokens).toBe(80_000);
		// Local midnight on Monday, which is a different UTC day in most zones --
		// part of why this fallback disagrees with the server's fixed instant.
		expect(result.weekly.resetTime?.getDay()).toBe(1);
		expect(result.weekly.resetTime?.getHours()).toBe(0);
	});

	it("uses the calendar week rather than reporting zero on stale state", () => {
		// modelHourly is newer than the persisted buckets it may be read from, so
		// on the first activation after an upgrade it deserializes empty while
		// modelWeekly is full. Summing the empty level would report 0% against a
		// limit that is actually 60% spent -- silence exactly where a warning is
		// owed. Falling back is wrong by a few days of phase instead.
		const buckets = FIXTURE();
		buckets.hourly = new Map();
		buckets.modelHourly = new Map();

		const result = calculateRateLimits(buckets, "max5", null, {
			weeklyAnchor: ANCHOR,
			scopedModel: "Fable",
		});
		expect(result.weekly.currentTokens).toBe(80_000);
		expect(result.weeklyScoped?.currentTokens).toBe(80_000);
	});

	it("reports zero when the buckets are genuinely empty", () => {
		// The other half of that guard: empty-because-nothing-happened must not
		// be dragged onto the fallback path, or a real zero becomes unreachable.
		const buckets = bucketsWithHours([], { weekly: null, models: {} });
		const result = calculateRateLimits(buckets, "max5", null, {
			weeklyAnchor: ANCHOR,
			scopedModel: "Fable",
		});
		expect(result.weekly.currentTokens).toBe(0);
		expect(result.weeklyScoped?.currentTokens).toBe(0);
	});

	it("measures the cycle when the calendar bucket is absent entirely", () => {
		// Zero is the one answer both branches agree on, so the test above cannot
		// tell which one ran. This one can: the calendar bucket does not exist,
		// so only the measured path can produce a non-zero total, and a fallback
		// would report 0 against real usage.
		const buckets = bucketsWithHours(
			[{ at: INSIDE_CYCLE, model: "claude-fable-5", tokens: 42_000 }],
			{ weekly: null, models: {} },
		);
		const result = calculateRateLimits(buckets, "max5", null, {
			weeklyAnchor: ANCHOR,
			scopedModel: "Fable",
		});
		expect(result.weekly.currentTokens).toBe(42_000);
		expect(result.weeklyScoped?.currentTokens).toBe(42_000);
	});
});
