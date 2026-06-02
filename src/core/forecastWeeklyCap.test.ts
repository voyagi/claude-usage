import { forecastWeeklyCap } from "./burnRate";

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
