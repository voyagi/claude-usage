/**
 * Tests for how usage credits are read off the API.
 *
 * Two API objects describe the same thing and an account may report either:
 * the current `spend`, and the older `extra_usage`. Reading only one hides
 * bought credits from anyone served the other shape, which is the whole point
 * of this code path.
 */

jest.mock("vscode", () => ({}), { virtual: true });

import type { ApiUsageData, StatusBarData } from "../types.js";
import type { SpendSummary } from "./app/types.js";
import { DashboardProvider } from "./DashboardProvider.js";

/** The private static under test, reached without widening the public API. */
const buildSpendSummary = (
	DashboardProvider as unknown as {
		_buildSpendSummary: (api: StatusBarData["apiUsage"]) => SpendSummary | null;
	}
)._buildSpendSummary;

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

describe("DashboardProvider credits summary", () => {
	it("is null with no API data at all", () => {
		expect(buildSpendSummary(null)).toBeNull();
	});

	it("is null when the account has no credits enabled", () => {
		// The shape this account actually returns: present but switched off
		expect(
			buildSpendSummary(
				api({
					spend: {
						used: 0,
						limit: null,
						percent: 0,
						currency: "USD",
						severity: "normal",
						enabled: false,
					},
				}),
			),
		).toBeNull();
	});

	it("reads the current spend object when enabled", () => {
		const result = buildSpendSummary(
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
		);

		// Percentage is derived from the real amounts, not the reported 24:
		// parseSpend defaults `percent` to 0 when the payload omits it, which
		// would render "$12.34 of $50" beside an empty bar.
		expect(result).toMatchObject({ used: 12.34, limit: 50, currency: "USD" });
		expect(result?.percentage).toBeCloseTo(24.68, 6);
	});

	it("derives the spend percentage rather than trusting a missing one", () => {
		const result = buildSpendSummary(
			api({
				spend: {
					used: 20,
					limit: 50,
					// parseSpend's default when the payload omits `percent`
					percent: 0,
					currency: "USD",
					severity: "normal",
					enabled: true,
				},
			}),
		);

		expect(result?.percentage).toBeCloseTo(40, 6);
	});

	it("clamps an over-limit spend balance to 100%", () => {
		const result = buildSpendSummary(
			api({
				spend: {
					used: 75,
					limit: 50,
					percent: 150,
					currency: "USD",
					severity: "normal",
					enabled: true,
				},
			}),
		);

		expect(result?.percentage).toBe(100);
	});

	it("falls back to extra_usage when spend is absent", () => {
		// Regression: reading only `spend` hid bought credits on accounts still
		// reporting the older shape.
		const result = buildSpendSummary(
			api({
				extraUsage: {
					isEnabled: true,
					creditsUsed: 25,
					creditsTotal: 200,
					utilization: 0.125,
					currency: "EUR",
					disabledReason: null,
				},
			}),
		);

		expect(result).toMatchObject({ used: 25, limit: 200, currency: "EUR" });
		// Derived from the real amounts, not the reported utilization
		expect(result?.percentage).toBeCloseTo(12.5, 6);
	});

	it("prefers spend over extra_usage when both are enabled", () => {
		const result = buildSpendSummary(
			api({
				spend: {
					used: 1,
					limit: 10,
					percent: 10,
					currency: "USD",
					severity: "normal",
					enabled: true,
				},
				extraUsage: {
					isEnabled: true,
					creditsUsed: 99,
					creditsTotal: 100,
					utilization: 0.99,
					currency: "EUR",
					disabledReason: null,
				},
			}),
		);

		expect(result?.used).toBe(1);
		expect(result?.currency).toBe("USD");
	});

	it("ignores extra_usage that is not enabled", () => {
		expect(
			buildSpendSummary(
				api({
					extraUsage: {
						isEnabled: false,
						creditsUsed: 25,
						creditsTotal: 200,
						utilization: 0.125,
						currency: "USD",
						disabledReason: "not_purchased",
					},
				}),
			),
		).toBeNull();
	});

	it("derives the used amount when the payload reports only a utilization", () => {
		// Some payloads carry a limit and a utilization but no used amount.
		// Treating that as 0 would derive 0/limit and discard the utilization,
		// showing "$0 of $200" with an empty bar on an account with real spend.
		const result = buildSpendSummary(
			api({
				extraUsage: {
					isEnabled: true,
					creditsUsed: null,
					creditsTotal: 200,
					utilization: 0.35,
					currency: "USD",
					disabledReason: null,
				},
			}),
		);

		expect(result?.used).toBeCloseTo(70, 6);
		expect(result?.percentage).toBeCloseTo(35, 6);
	});

	it("uses reported utilization when there is no credit total to divide by", () => {
		const result = buildSpendSummary(
			api({
				extraUsage: {
					isEnabled: true,
					creditsUsed: 5,
					creditsTotal: null,
					utilization: 0.4,
					currency: null,
					disabledReason: null,
				},
			}),
		);

		expect(result?.limit).toBeNull();
		expect(result?.percentage).toBeCloseTo(40, 6);
		// No currency reported: assume dollars rather than render "null 5.00"
		expect(result?.currency).toBe("USD");
	});

	it("reports no amount when there is neither a used figure nor a limit", () => {
		// One branch over from the derived-amount case: with no limit there is
		// nothing to derive from, and rendering 0 would claim an empty balance
		// on an account that has spent something.
		const result = buildSpendSummary(
			api({
				extraUsage: {
					isEnabled: true,
					creditsUsed: null,
					creditsTotal: null,
					utilization: 0.4,
					currency: "USD",
					disabledReason: null,
				},
			}),
		);

		expect(result?.used).toBeNull();
		expect(result?.percentage).toBeCloseTo(40, 6);
	});

	it("marks a derived amount as derived, and a reported one as not", () => {
		const derived = buildSpendSummary(
			api({
				extraUsage: {
					isEnabled: true,
					creditsUsed: null,
					creditsTotal: 200,
					utilization: 0.35,
					currency: "USD",
					disabledReason: null,
				},
			}),
		);
		expect(derived?.isDerived).toBe(true);

		const reported = buildSpendSummary(
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
		);
		expect(reported?.isDerived).toBe(false);
	});

	it("does not divide by zero on a zero credit total", () => {
		const result = buildSpendSummary(
			api({
				extraUsage: {
					isEnabled: true,
					creditsUsed: 0,
					creditsTotal: 0,
					utilization: 0,
					currency: "USD",
					disabledReason: null,
				},
			}),
		);

		expect(result?.percentage).toBe(0);
		expect(Number.isNaN(result?.percentage as number)).toBe(false);
	});

	it("clamps an over-limit balance to 100%", () => {
		const result = buildSpendSummary(
			api({
				extraUsage: {
					isEnabled: true,
					creditsUsed: 300,
					creditsTotal: 200,
					utilization: 1.5,
					currency: "USD",
					disabledReason: null,
				},
			}),
		);

		expect(result?.percentage).toBe(100);
	});
});
