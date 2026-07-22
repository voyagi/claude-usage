import {
	forecastWeeklyCap,
	forecastWeeklyCapFromUtilization,
} from "./burnRate";

describe("forecastWeeklyCapFromUtilization", () => {
	it("projects from the pace across the elapsed part of the window", () => {
		// 50% used with 3.5 days left => 3.5 days elapsed => 14.29%/day
		// remaining 50% / 14.29 => 3.5 days
		const f = forecastWeeklyCapFromUtilization(0.5, 3.5);
		expect(f?.daysUntilCap).toBeCloseTo(3.5, 6);
		expect(f?.isFromApi).toBe(true);
		expect(f?.avgDailyTokens).toBeNull();
	});

	it("flags an overrun when the pace outruns the reset", () => {
		// 80% used with 3.5 days left => 22.86%/day; remaining 20% => 0.875 days
		const f = forecastWeeklyCapFromUtilization(0.8, 3.5);
		expect(f?.willExceedBeforeReset).toBe(true);
	});

	it("reports on-track when the reset arrives first", () => {
		// 20% used with 3.5 days left => 5.71%/day; remaining 80% => 14 days
		const f = forecastWeeklyCapFromUtilization(0.2, 3.5);
		expect(f?.willExceedBeforeReset).toBe(false);
	});

	it("does not warn on the real reading that produced a false alarm", () => {
		// Regression: the dashboard showed "reach the weekly cap in ~1h" beside a
		// 65% bar, because the forecast used local output tokens (3.36M over an
		// ISO week) against the max5 plan default (900k) -- 373% of a cap that
		// is not this account's. From the API's own numbers, 65% with 1.95 days
		// left is 12.9%/day, so the remaining 35% lasts 2.7 days: no overrun.
		const f = forecastWeeklyCapFromUtilization(0.65, 1.954);
		expect(f?.daysUntilCap).toBeCloseTo(2.72, 1);
		expect(f?.willExceedBeforeReset).toBe(false);
	});

	it("returns null before any of the window has elapsed", () => {
		// A just-reset window has no elapsed time to average a pace over
		expect(forecastWeeklyCapFromUtilization(0.5, 7)).toBeNull();
		expect(forecastWeeklyCapFromUtilization(0.5, 8)).toBeNull();
	});

	it("stays silent early in the window instead of alarming on a tiny sample", () => {
		// Regression: the firing rule reduces to used% > 100 * elapsed / 7, which
		// is scale-free, so a short elapsed time makes a trivial amount of usage
		// project an overrun. Half an hour in, 1% used extrapolates to 48%/day.
		// Arithmetically true, practically meaningless -- one large request right
		// after a reset must not raise an alarm.
		expect(forecastWeeklyCapFromUtilization(0.01, 7 - 0.02)).toBeNull(); // 30 min in
		expect(forecastWeeklyCapFromUtilization(0.03, 7 - 0.083)).toBeNull(); // 2 h in
		expect(forecastWeeklyCapFromUtilization(0.05, 7 - 0.25)).toBeNull(); // 6 h in
	});

	it("starts forecasting once a full day of the window has elapsed", () => {
		// The boundary itself must produce a forecast, or the guard silently
		// swallows the whole first-day case too
		const atBoundary = forecastWeeklyCapFromUtilization(0.2, 6);
		expect(atBoundary).not.toBeNull();
		// 20% in 1 day => 20%/day => remaining 80% lasts 4 days, and the reset is
		// 6 days out, so the cap arrives first: this SHOULD warn
		expect(atBoundary?.daysUntilCap).toBeCloseTo(4, 6);
		expect(atBoundary?.willExceedBeforeReset).toBe(true);
	});

	it("still forecasts early in the window once usage is already heavy", () => {
		// The elapsed guard exists so a trivial amount cannot be extrapolated
		// into an alarm. Half the weekly limit burned in the first day is not
		// trivial, and staying silent there would trade a false alarm for a
		// missed one -- the more dangerous of the two.
		const halfDayIn = forecastWeeklyCapFromUtilization(0.6, 7 - 0.5);
		expect(halfDayIn).not.toBeNull();
		expect(halfDayIn?.willExceedBeforeReset).toBe(true);

		// And the trivial-usage case at the same elapsed time stays silent
		expect(forecastWeeklyCapFromUtilization(0.05, 7 - 0.5)).toBeNull();
	});

	it("returns null at or past the reset instant", () => {
		expect(forecastWeeklyCapFromUtilization(0.5, 0)).toBeNull();
		expect(forecastWeeklyCapFromUtilization(0.5, -1)).toBeNull();
	});

	it("returns null at zero utilization", () => {
		expect(forecastWeeklyCapFromUtilization(0, 3)).toBeNull();
	});

	it("returns null on NaN input rather than rendering NaN days", () => {
		expect(forecastWeeklyCapFromUtilization(Number.NaN, 3)).toBeNull();
		expect(forecastWeeklyCapFromUtilization(0.5, Number.NaN)).toBeNull();
	});

	it("reports no time left once the limit is reached", () => {
		const f = forecastWeeklyCapFromUtilization(1, 2);
		expect(f?.daysUntilCap).toBe(0);
		expect(f?.willExceedBeforeReset).toBe(true);
	});

	it("clamps utilization above 1 instead of projecting negative days", () => {
		const f = forecastWeeklyCapFromUtilization(1.2, 2);
		expect(f?.daysUntilCap).toBe(0);
	});
});

describe("forecastWeeklyCap", () => {
	it("projects days-until-cap from the remaining budget and daily pace", () => {
		// remaining = 700k - 100k = 600k; pace 100k/day => 6 days
		const f = forecastWeeklyCap(100_000, 700_000, 100_000, 5);
		expect(f).not.toBeNull();
		expect(f?.daysUntilCap).toBeCloseTo(6, 6);
		expect(f?.daysUntilReset).toBe(5);
	});

	it("flags willExceedBeforeReset when the cap arrives before the reset", () => {
		// remaining 200k at 100k/day => 2 days, resets in 5 => will exceed
		const f = forecastWeeklyCap(500_000, 700_000, 100_000, 5);
		expect(f?.willExceedBeforeReset).toBe(true);
	});

	it("reports on-track when the reset arrives before the cap", () => {
		// remaining 600k at 100k/day => 6 days, resets in 5 => safe
		const f = forecastWeeklyCap(100_000, 700_000, 100_000, 5);
		expect(f?.willExceedBeforeReset).toBe(false);
	});

	it("clamps remaining to zero when already over the cap (daysUntilCap = 0)", () => {
		const f = forecastWeeklyCap(800_000, 700_000, 100_000, 3);
		expect(f?.daysUntilCap).toBe(0);
		expect(f?.willExceedBeforeReset).toBe(true);
	});

	it("returns null without a known cap or a positive pace", () => {
		expect(forecastWeeklyCap(100, 0, 100, 5)).toBeNull();
		expect(forecastWeeklyCap(100, 700_000, 0, 5)).toBeNull();
	});

	it("returns null for NaN inputs", () => {
		expect(forecastWeeklyCap(Number.NaN, 700_000, 100, 5)).toBeNull();
		expect(forecastWeeklyCap(100, 700_000, 100, Number.NaN)).toBeNull();
	});

	it("caps an essentially-idle pace at 999 days instead of Infinity", () => {
		const f = forecastWeeklyCap(0, 700_000, 1, 5);
		expect(f?.daysUntilCap).toBe(999);
		expect(Number.isFinite(f?.daysUntilCap ?? 0)).toBe(true);
	});
});
