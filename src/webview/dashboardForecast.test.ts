/**
 * Tests that buildDashboardData feeds the weekly forecast the right window.
 *
 * The pure forecast functions are tested elsewhere; what is untested there, and
 * is where both real bugs lived, is the wiring: which utilization and which
 * reset time the dashboard hands them.
 */

jest.mock(
	"vscode",
	() => ({
		workspace: {
			getConfiguration: () => ({
				get: (_key: string, fallback: unknown) => fallback,
			}),
		},
		Uri: { joinPath: () => ({ path: "" }) },
	}),
	{ virtual: true },
);

import type {
	AggregatedUsage,
	ApiUsageData,
	RateLimitInfo,
	StatusBarData,
	TimeBuckets,
} from "../types.js";
import { DashboardProvider } from "./DashboardProvider.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function emptyBuckets(): TimeBuckets {
	return {
		session: new Map<string, AggregatedUsage>(),
		daily: new Map(),
		weekly: new Map(),
		monthly: new Map(),
		modelWeekly: new Map(),
		hourly: new Map(),
		project: new Map(),
	};
}

function limit(
	name: string,
	overrides: Partial<RateLimitInfo> = {},
): RateLimitInfo {
	return {
		name,
		currentTokens: 0,
		estimatedLimit: 900_000,
		percentage: 0,
		resetTime: null,
		isHit: false,
		...overrides,
	};
}

function api(overrides: Partial<ApiUsageData> = {}): ApiUsageData {
	return {
		fiveHour: null,
		sevenDay: null,
		scopedWeekly: [],
		rateLimitTier: null,
		extraUsage: null,
		spend: null,
		fetchedAt: new Date(),
		...overrides,
	};
}

function statusBarData(
	apiUsage: ApiUsageData | null,
	weeklyOverrides: Partial<RateLimitInfo> = {},
): StatusBarData {
	return {
		totalInputTokens: 0,
		totalOutputTokens: 0,
		totalCost: 0,
		todayCost: 0,
		monthCost: 0,
		burnRate: 0,
		rateLimits: {
			session5h: limit("Session (5hr)"),
			weekly: limit("Weekly", weeklyOverrides),
			weeklyScoped: null,
			worstPercentage: 0,
		},
		apiUsage,
		staleness: apiUsage ? "fresh" : "unavailable",
		lastUpdated: new Date(),
		filesProcessed: 0,
		linesSkipped: 0,
	};
}

function build(data: StatusBarData) {
	return DashboardProvider.buildDashboardData(emptyBuckets(), data, "max5");
}

describe("buildDashboardData: weekly forecast wiring", () => {
	it("projects from the API's utilization and the API's own reset time", () => {
		// The reading that produced the false alarm: 65% with ~2 days left.
		// 65% over 5.05 elapsed days is 12.9%/day, so 35% lasts 2.7 days and the
		// reset arrives first. No warning.
		const resetsAt = new Date(Date.now() + 1.954 * DAY_MS).toISOString();
		const result = build(
			statusBarData(
				api({ sevenDay: { utilization: 0.65, resetsAt } }),
				// Local numbers deliberately absurd: 373% of the plan default.
				// If the forecast reads these, it fires red.
				{ currentTokens: 3_361_708, estimatedLimit: 900_000 },
			),
		);

		expect(result.weeklyForecast).not.toBeNull();
		expect(result.weeklyForecast?.isFromApi).toBe(true);
		expect(result.weeklyForecast?.willExceedBeforeReset).toBe(false);
		expect(result.weeklyForecast?.daysUntilCap).toBeCloseTo(2.72, 1);
	});

	it("ignores local token estimates entirely when the API is present", () => {
		// Same API reading, local numbers swapped for harmless ones: the forecast
		// must not move, or it is still reading them.
		const resetsAt = new Date(Date.now() + 1.954 * DAY_MS).toISOString();
		const withAbsurdLocal = build(
			statusBarData(api({ sevenDay: { utilization: 0.65, resetsAt } }), {
				currentTokens: 3_361_708,
				estimatedLimit: 900_000,
			}),
		);
		const withTinyLocal = build(
			statusBarData(api({ sevenDay: { utilization: 0.65, resetsAt } }), {
				currentTokens: 10,
				estimatedLimit: 900_000,
			}),
		);

		expect(withTinyLocal.weeklyForecast?.daysUntilCap).toBeCloseTo(
			withAbsurdLocal.weeklyForecast?.daysUntilCap as number,
			6,
		);
	});

	it("does not use the API path when the API gave no reset time", () => {
		// Regression: api.sevenDay is truthy whenever a percentage parsed, but
		// resets_at is separately nullable. Taking the reset from the local ISO
		// week instead would divide an API utilization by a Monday boundary --
		// red every Monday morning, blind every Sunday night.
		const result = build(
			statusBarData(api({ sevenDay: { utilization: 0.65, resetsAt: null } }), {
				currentTokens: 100,
				estimatedLimit: 900_000,
				resetTime: new Date(Date.now() + 0.4 * DAY_MS),
			}),
		);

		// Either no forecast, or the local one -- but never an API projection
		// built on a local calendar boundary.
		expect(result.weeklyForecast?.isFromApi ?? false).toBe(false);
	});

	it("falls back to the local estimate when there is no API data at all", () => {
		const result = build(
			statusBarData(null, {
				currentTokens: 100_000,
				estimatedLimit: 900_000,
				resetTime: new Date(Date.now() + 3 * DAY_MS),
			}),
		);

		// No daily buckets means no pace, so no forecast rather than a fake one
		expect(result.weeklyForecast?.isFromApi ?? false).toBe(false);
	});

	it("stays silent in the first day of the API window", () => {
		// 2 hours in, 3% used: enough to project an overrun arithmetically,
		// nowhere near enough to mean anything.
		const resetsAt = new Date(Date.now() + (7 - 0.083) * DAY_MS).toISOString();
		const result = build(
			statusBarData(api({ sevenDay: { utilization: 0.03, resetsAt } })),
		);

		expect(result.weeklyForecast).toBeNull();
	});
});

describe("buildDashboardData: cost visibility", () => {
	it("hides cost on a subscription with no credits", () => {
		const result = build(statusBarData(api()));
		expect(result.showCost).toBe(false);
		expect(result.spend).toBeNull();
	});

	it("shows cost once the account has credits enabled", () => {
		const result = build(
			statusBarData(
				api({
					spend: {
						used: 12.34,
						limit: 50,
						percent: 24,
						currency: "USD",
						severity: "normal",
						enabled: true,
					},
				}),
			),
		);

		expect(result.showCost).toBe(true);
		expect(result.spend?.used).toBe(12.34);
	});

	it("hides cost when the API is unreachable, rather than guessing", () => {
		// No API means no way to know whether credits are in play; a subscriber
		// is the common case, so do not assert a dollar figure at them.
		const result = build(statusBarData(null));
		expect(result.showCost).toBe(false);
	});
});
