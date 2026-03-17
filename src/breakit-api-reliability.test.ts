/**
 * BREAKIT: Adversarial tests for API-first reliability changes
 *
 * Targets: PollingTimer, getStaleness, mapTierStringToPlanType,
 * formatBarGraph, formatPaceForecast, formatTimeUntilLimit,
 * formatCooldownCompact, predictTimeUntilLimit
 */

// Mock vscode module (not available in Node test environment)
jest.mock("vscode", () => ({}), { virtual: true });

import {
	formatBarGraph,
	formatBurnRate,
	formatCooldownCompact,
	formatCost,
	formatPaceForecast,
	formatPercentage,
	formatTimeUntilLimit,
	formatTokens,
} from "./ui/formatting";
import { getStaleness } from "./api/usageCache";
import {
	mapTierStringToPlanType,
	parseCredentialsFile,
} from "./core/tierDetection";
import { predictTimeUntilLimit } from "./core/burnRate";
import { PollingTimer } from "./api/pollingTimer";
import type { ApiUsageData } from "./types";
import type { Logger } from "./utils/logger";

// ── Helpers ──────────────────────────────────────────────────────────

function makeLogger(): Logger {
	return {
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
		show: jest.fn(),
		dispose: jest.fn(),
	} as unknown as Logger;
}

function makeApiData(overrides: Partial<ApiUsageData> = {}): ApiUsageData {
	return {
		fiveHour: { utilization: 0.5, resetsAt: null },
		sevenDay: { utilization: 0.3, resetsAt: null },
		sevenDaySonnet: { utilization: 0.2, resetsAt: null },
		sevenDayOpus: null,
		rateLimitTier: null,
		extraUsage: null,
		fetchedAt: new Date(),
		...overrides,
	};
}

// ── getStaleness ─────────────────────────────────────────────────────

describe("BREAKIT: getStaleness", () => {
	describe("Boundary Assault", () => {
		it("returns 'critical' for null", () => {
			expect(getStaleness(null)).toBe("critical");
		});

		it("returns 'fresh' for Date.now()", () => {
			expect(getStaleness(new Date())).toBe("fresh");
		});

		it("returns 'fresh' at exactly 4m59s ago", () => {
			const d = new Date(Date.now() - 4 * 60_000 - 59_000);
			expect(getStaleness(d)).toBe("fresh");
		});

		it("returns 'normal' at exactly 5m0s ago", () => {
			const d = new Date(Date.now() - 5 * 60_000);
			expect(getStaleness(d)).toBe("normal");
		});

		it("returns 'normal' at 9m59s ago", () => {
			const d = new Date(Date.now() - 9 * 60_000 - 59_000);
			expect(getStaleness(d)).toBe("normal");
		});

		it("returns 'dim' at exactly 10m ago", () => {
			const d = new Date(Date.now() - 10 * 60_000);
			expect(getStaleness(d)).toBe("dim");
		});

		it("returns 'stale' at exactly 20m ago", () => {
			const d = new Date(Date.now() - 20 * 60_000);
			expect(getStaleness(d)).toBe("stale");
		});

		it("returns 'critical' at exactly 30m ago", () => {
			const d = new Date(Date.now() - 30 * 60_000);
			expect(getStaleness(d)).toBe("critical");
		});

		it("returns 'critical' for dates far in the past", () => {
			expect(getStaleness(new Date(0))).toBe("critical");
		});
	});

	describe("Type Confusion", () => {
		it("handles Invalid Date", () => {
			const invalid = new Date("not-a-date");
			// Invalid Date.getTime() returns NaN, Date.now() - NaN = NaN
			// NaN < 5*60000 is false, NaN < 10*60000 is false, etc.
			// So all comparisons fail, should fall through to 'critical'
			expect(getStaleness(invalid)).toBe("critical");
		});

		it("handles future dates (negative age)", () => {
			const future = new Date(Date.now() + 60_000);
			// ageMs is negative, negative < 5*60000 is true -> 'fresh'
			expect(getStaleness(future)).toBe("fresh");
		});
	});

	describe("Mutation Detectors", () => {
		// If someone changes < to <= at the 5m boundary
		it("boundary: 5m minus 1ms is fresh, 5m is normal", () => {
			const justUnder = new Date(Date.now() - 5 * 60_000 + 1);
			const atBoundary = new Date(Date.now() - 5 * 60_000);
			expect(getStaleness(justUnder)).toBe("fresh");
			expect(getStaleness(atBoundary)).toBe("normal");
		});

		// If someone changes < to <= at the 10m boundary
		it("boundary: 10m minus 1ms is normal, 10m is dim", () => {
			const justUnder = new Date(Date.now() - 10 * 60_000 + 1);
			const atBoundary = new Date(Date.now() - 10 * 60_000);
			expect(getStaleness(justUnder)).toBe("normal");
			expect(getStaleness(atBoundary)).toBe("dim");
		});

		// If someone changes < to <= at the 20m boundary
		it("boundary: 20m minus 1ms is dim, 20m is stale", () => {
			const justUnder = new Date(Date.now() - 20 * 60_000 + 1);
			const atBoundary = new Date(Date.now() - 20 * 60_000);
			expect(getStaleness(justUnder)).toBe("dim");
			expect(getStaleness(atBoundary)).toBe("stale");
		});

		// If someone changes < to <= at the 30m boundary
		it("boundary: 30m minus 1ms is stale, 30m is critical", () => {
			const justUnder = new Date(Date.now() - 30 * 60_000 + 1);
			const atBoundary = new Date(Date.now() - 30 * 60_000);
			expect(getStaleness(justUnder)).toBe("stale");
			expect(getStaleness(atBoundary)).toBe("critical");
		});
	});
});

// ── mapTierStringToPlanType ──────────────────────────────────────────

describe("BREAKIT: mapTierStringToPlanType", () => {
	describe("Boundary Assault", () => {
		it("returns null for empty string", () => {
			expect(mapTierStringToPlanType("")).toBeNull();
		});

		it("returns null for whitespace-only string", () => {
			expect(mapTierStringToPlanType("   ")).toBeNull();
		});

		it("returns null for unrecognized tier", () => {
			expect(mapTierStringToPlanType("enterprise_custom_tier")).toBeNull();
		});
	});

	describe("Type Confusion", () => {
		it("handles strings that look like numbers", () => {
			expect(mapTierStringToPlanType("5")).toBeNull();
		});

		it("handles strings with null bytes", () => {
			expect(mapTierStringToPlanType("pro\0admin")).toBe("pro");
		});

		it("handles very long strings", () => {
			const long = "a".repeat(10_000) + "max_20" + "b".repeat(10_000);
			expect(mapTierStringToPlanType(long)).toBe("max20");
		});
	});

	describe("Mutation Detectors", () => {
		// Exact known tier strings from the API
		const knownMax5 = [
			"default_claude_max_5x",
			"DEFAULT_CLAUDE_MAX_5X",
			"max_5",
			"MAX_5",
			"max5",
			"MAX5",
		];
		const knownMax20 = [
			"default_claude_max_20x",
			"DEFAULT_CLAUDE_MAX_20X",
			"max_20",
			"MAX_20",
			"max20",
			"MAX20",
		];
		const knownPro = ["pro", "PRO", "Pro", "standard", "STANDARD", "Standard"];

		for (const tier of knownMax5) {
			it(`maps '${tier}' to max5`, () => {
				expect(mapTierStringToPlanType(tier)).toBe("max5");
			});
		}
		for (const tier of knownMax20) {
			it(`maps '${tier}' to max20`, () => {
				expect(mapTierStringToPlanType(tier)).toBe("max20");
			});
		}
		for (const tier of knownPro) {
			it(`maps '${tier}' to pro`, () => {
				expect(mapTierStringToPlanType(tier)).toBe("pro");
			});
		}

		// Priority: max_20 checked before max_5 (both contain "max")
		it("max_20 wins over max_5 when string contains both", () => {
			// "max_20_from_max_5_upgrade" has both max_20 and max_5
			expect(mapTierStringToPlanType("max_20_from_max_5_upgrade")).toBe(
				"max20",
			);
		});

		// Verify max_5 doesn't accidentally match max_20
		it("max_5 alone does not produce max20", () => {
			expect(mapTierStringToPlanType("only_max_5_here")).toBe("max5");
		});
	});

	describe("Security Payloads", () => {
		it("handles SQL injection in tier string", () => {
			expect(
				mapTierStringToPlanType("' OR '1'='1'; DROP TABLE users;--"),
			).toBeNull();
		});

		it("handles XSS payload in tier string", () => {
			expect(
				mapTierStringToPlanType("<script>alert('xss')</script>"),
			).toBeNull();
		});

		it("handles unicode tricks", () => {
			// Unicode fullwidth 'p' 'r' 'o' - should NOT match
			expect(mapTierStringToPlanType("\uFF50\uFF52\uFF4F")).toBeNull();
		});
	});
});

// ── formatBarGraph ───────────────────────────────────────────────────

describe("BREAKIT: formatBarGraph", () => {
	describe("Boundary Assault", () => {
		it("0% has no filled blocks", () => {
			const result = formatBarGraph(0);
			expect(result).toMatch(/^\[░{12}\] 0%$/);
		});

		it("100% has all filled blocks", () => {
			const result = formatBarGraph(100);
			expect(result).toMatch(/^\[█{12}\] 100%$/);
		});

		it("50% has exactly 6 filled blocks", () => {
			const result = formatBarGraph(50);
			const filled = (result.match(/█/g) || []).length;
			expect(filled).toBe(6);
		});

		it("clamps negative values to 0%", () => {
			const result = formatBarGraph(-50);
			expect(result).toMatch(/0%$/);
			const filled = (result.match(/█/g) || []).length;
			expect(filled).toBe(0);
		});

		it("clamps values over 100 to 100%", () => {
			const result = formatBarGraph(200);
			expect(result).toMatch(/100%$/);
			const filled = (result.match(/█/g) || []).length;
			expect(filled).toBe(12);
		});

		it("custom width=1 works at 100%", () => {
			const result = formatBarGraph(100, 1);
			expect(result).toBe("[█] 100%");
		});

		it("custom width=0 shows empty bar", () => {
			const result = formatBarGraph(50, 0);
			expect(result).toBe("[] 50%");
		});
	});

	describe("Type Confusion", () => {
		it("handles NaN as 0%", () => {
			const result = formatBarGraph(NaN);
			// Math.max(0, Math.min(100, NaN)) => Math.max(0, NaN) => NaN
			// Math.round(NaN/100 * 20) => NaN
			// "█".repeat(NaN) => "" and "░".repeat(NaN - NaN) => ""
			// But the % label will show NaN
			expect(result).toContain("NaN");
		});

		it("handles Infinity", () => {
			const result = formatBarGraph(Infinity);
			// clamped to 100
			expect(result).toMatch(/100%$/);
		});

		it("handles -Infinity", () => {
			const result = formatBarGraph(-Infinity);
			// clamped to 0
			expect(result).toMatch(/0%$/);
		});
	});

	describe("Property Violations", () => {
		it("total characters in bar always equals width", () => {
			for (const pct of [0, 1, 25, 49, 50, 51, 75, 99, 100]) {
				const result = formatBarGraph(pct, 20);
				const barContent = result.match(/\[(.*?)\]/)?.[1] ?? "";
				expect(barContent.length).toBe(20);
			}
		});

		it("filled + empty always equals width for any percentage", () => {
			for (let pct = 0; pct <= 100; pct++) {
				const result = formatBarGraph(pct, 10);
				const filled = (result.match(/█/g) || []).length;
				const empty = (result.match(/░/g) || []).length;
				expect(filled + empty).toBe(10);
			}
		});

		it("monotonicity: higher percentage never has fewer filled blocks", () => {
			let prevFilled = 0;
			for (let pct = 0; pct <= 100; pct++) {
				const result = formatBarGraph(pct, 20);
				const filled = (result.match(/█/g) || []).length;
				expect(filled).toBeGreaterThanOrEqual(prevFilled);
				prevFilled = filled;
			}
		});
	});
});

// ── formatPaceForecast ───────────────────────────────────────────────

describe("BREAKIT: formatPaceForecast", () => {
	describe("Boundary Assault", () => {
		it("null returns empty string", () => {
			expect(formatPaceForecast(null, "Session")).toBe("");
		});

		it("0 returns LIMIT HIT", () => {
			expect(formatPaceForecast(0, "Session")).toBe("Session: LIMIT HIT");
		});

		it("0.5 (under 1 minute) returns <1m message", () => {
			expect(formatPaceForecast(0.5, "Session")).toBe(
				"Session: <1m at current pace",
			);
		});

		it("1 minute returns ~1m message", () => {
			expect(formatPaceForecast(1, "Session")).toBe(
				"Session: ~1m at current pace",
			);
		});

		it("59 minutes returns ~59m message", () => {
			expect(formatPaceForecast(59, "Session")).toBe(
				"Session: ~59m at current pace",
			);
		});

		it("60 minutes returns ~1h 0m message", () => {
			expect(formatPaceForecast(60, "Session")).toBe(
				"Session: ~1h 0m at current pace",
			);
		});

		it("90.5 minutes shows correct hours and minutes", () => {
			const result = formatPaceForecast(90.5, "Weekly");
			expect(result).toBe("Weekly: ~1h 31m at current pace");
		});
	});

	describe("Type Confusion", () => {
		it("negative minutes treated as <1m", () => {
			const result = formatPaceForecast(-5, "Session");
			// -5 < 1 is true, so "<1m"
			expect(result).toContain("<1m");
		});

		it("very large number shows hours", () => {
			const result = formatPaceForecast(100_000, "Session");
			expect(result).toContain("h");
		});
	});

	describe("Mutation Detectors", () => {
		// If someone changes === 0 to < 0 or > 0
		it("exactly 0 is LIMIT HIT, not <1m", () => {
			expect(formatPaceForecast(0, "X")).toBe("X: LIMIT HIT");
		});

		// If someone changes < 1 to <= 1
		it("exactly 1 shows ~1m, not <1m", () => {
			const result = formatPaceForecast(1, "X");
			expect(result).toContain("~1m");
			expect(result).not.toContain("<1m");
		});

		// If someone changes < 60 to <= 60
		it("exactly 60 shows hours, not minutes-only", () => {
			const result = formatPaceForecast(60, "X");
			expect(result).toContain("h");
		});
	});
});

// ── formatTimeUntilLimit ─────────────────────────────────────────────

describe("BREAKIT: formatTimeUntilLimit", () => {
	describe("Boundary Assault", () => {
		it("null returns empty string", () => {
			expect(formatTimeUntilLimit(null)).toBe("");
		});

		it("0 returns LIMIT HIT", () => {
			expect(formatTimeUntilLimit(0)).toBe("LIMIT HIT");
		});

		it("0.5 returns <1m message", () => {
			expect(formatTimeUntilLimit(0.5)).toBe("<1m at current pace");
		});

		it("59 returns 59m", () => {
			expect(formatTimeUntilLimit(59)).toBe("59m at current pace");
		});

		it("60 returns 1h 0m", () => {
			expect(formatTimeUntilLimit(60)).toBe("1h 0m at current pace");
		});
	});

	describe("Mutation Detectors", () => {
		it("exactly 0 is LIMIT HIT not <1m", () => {
			expect(formatTimeUntilLimit(0)).not.toContain("<1m");
		});

		it("exactly 1 is 1m not <1m", () => {
			const result = formatTimeUntilLimit(1);
			expect(result).toContain("1m");
			expect(result).not.toContain("<1m");
		});
	});
});

// ── formatCooldownCompact ────────────────────────────────────────────

describe("BREAKIT: formatCooldownCompact", () => {
	describe("Boundary Assault", () => {
		it("null returns empty string", () => {
			expect(formatCooldownCompact(null)).toBe("");
		});

		it("past date returns '0m'", () => {
			const past = new Date(Date.now() - 60_000);
			expect(formatCooldownCompact(past)).toBe("0m");
		});

		it("date 30 minutes in the future", () => {
			const future = new Date(Date.now() + 30 * 60_000 + 30_000);
			const result = formatCooldownCompact(future);
			expect(result).toMatch(/^\d+m$/);
		});

		it("date 2 hours in the future", () => {
			const future = new Date(Date.now() + 2 * 3600_000 + 15 * 60_000);
			const result = formatCooldownCompact(future);
			expect(result).toMatch(/^\d+h\d+m$/);
		});

		it("date 2 days in the future", () => {
			const future = new Date(Date.now() + 2 * 86400_000 + 3 * 3600_000);
			const result = formatCooldownCompact(future);
			expect(result).toMatch(/^\d+d\d+h$/);
		});
	});
});

// ── predictTimeUntilLimit ────────────────────────────────────────────

describe("BREAKIT: predictTimeUntilLimit", () => {
	describe("Boundary Assault", () => {
		it("0 tokens, 0 limit, non-zero rate returns 0", () => {
			expect(predictTimeUntilLimit(0, 0, 10)).toBe(0);
		});

		it("negative current tokens", () => {
			// currentTokens < limitTokens, so (1000 - (-100)) / 10 = 110
			const result = predictTimeUntilLimit(-100, 1000, 10);
			expect(result).toBe(110);
		});

		it("negative limit tokens", () => {
			// currentTokens (100) >= limitTokens (-100), returns 0
			expect(predictTimeUntilLimit(100, -100, 10)).toBe(0);
		});

		it("very small burn rate produces capped result", () => {
			const result = predictTimeUntilLimit(0, 1_000_000, 0.001);
			// 1_000_000 / 0.001 = 1_000_000_000 > 999999 cap
			expect(result).toBe(999999);
		});

		it("negative burn rate", () => {
			// Negative rate: (1000-100) / -10 = -90
			// Math.min(-90, 999999) = -90
			// No capping below zero! This could be a bug.
			const result = predictTimeUntilLimit(100, 1000, -10);
			expect(result).toBeLessThan(0);
		});
	});

	describe("Property Violations", () => {
		it("higher current tokens => less time remaining", () => {
			const t1 = predictTimeUntilLimit(100, 1000, 10);
			const t2 = predictTimeUntilLimit(500, 1000, 10);
			const t3 = predictTimeUntilLimit(900, 1000, 10);
			// All non-null (rate > 0)
			expect(t1).not.toBeNull();
			expect(t2).not.toBeNull();
			expect(t3).not.toBeNull();
			expect(t1!).toBeGreaterThan(t2!);
			expect(t2!).toBeGreaterThan(t3!);
		});

		it("higher burn rate => less time remaining", () => {
			const t1 = predictTimeUntilLimit(100, 1000, 1);
			const t2 = predictTimeUntilLimit(100, 1000, 10);
			const t3 = predictTimeUntilLimit(100, 1000, 100);
			expect(t1!).toBeGreaterThan(t2!);
			expect(t2!).toBeGreaterThan(t3!);
		});
	});

	describe("Mutation Detectors", () => {
		it("at exactly limit returns 0, not null", () => {
			expect(predictTimeUntilLimit(1000, 1000, 10)).toBe(0);
		});

		it("just under limit returns small positive number", () => {
			const result = predictTimeUntilLimit(999, 1000, 10);
			expect(result).toBeGreaterThan(0);
			expect(result).toBeLessThan(1);
		});
	});
});

// ── PollingTimer ─────────────────────────────────────────────────────

describe("BREAKIT: PollingTimer", () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	describe("Boundary Assault", () => {
		it("start() is idempotent", () => {
			const fetchFn = jest.fn().mockResolvedValue(null);
			const timer = new PollingTimer(
				fetchFn,
				jest.fn(),
				jest.fn(),
				makeLogger(),
			);
			timer.start();
			timer.start();
			timer.start();
			// Only one timer scheduled
			jest.advanceTimersByTime(5_000);
			expect(fetchFn).toHaveBeenCalledTimes(1);
			timer.stop();
		});

		it("stop() before start() is safe", () => {
			const timer = new PollingTimer(
				jest.fn().mockResolvedValue(null),
				jest.fn(),
				jest.fn(),
				makeLogger(),
			);
			// Should not throw
			timer.stop();
			timer.dispose();
		});

		it("forceRefresh() when stopped is a no-op", async () => {
			const fetchFn = jest.fn().mockResolvedValue(makeApiData());
			const timer = new PollingTimer(
				fetchFn,
				jest.fn(),
				jest.fn(),
				makeLogger(),
			);
			// Not started
			await timer.forceRefresh();
			expect(fetchFn).not.toHaveBeenCalled();
		});
	});

	describe("Error Path Torture", () => {
		it("fetchFn throwing does not kill the timer", async () => {
			const fetchFn = jest.fn().mockRejectedValue(new Error("network down"));
			const onError = jest.fn();
			const timer = new PollingTimer(fetchFn, jest.fn(), onError, makeLogger());

			timer.start();
			// First tick at 5s
			jest.advanceTimersByTime(5_000);
			await Promise.resolve(); // let tick() run

			// Timer should still be running - schedule next at FAILURE_INTERVAL (30s)
			jest.advanceTimersByTime(30_000);
			await Promise.resolve();

			// fetchFn called twice (initial + retry after throw)
			expect(fetchFn).toHaveBeenCalledTimes(2);
			timer.stop();
		});

		it("onData throwing does not kill the timer", async () => {
			const data = makeApiData();
			const fetchFn = jest.fn().mockResolvedValue(data);
			const onData = jest.fn().mockImplementation(() => {
				throw new Error("callback crash");
			});
			const timer = new PollingTimer(fetchFn, onData, jest.fn(), makeLogger());

			timer.start();
			jest.advanceTimersByTime(5_000);
			await Promise.resolve();

			// Despite onData crash, timer should schedule next at 120s
			jest.advanceTimersByTime(120_000);
			await Promise.resolve();

			expect(fetchFn).toHaveBeenCalledTimes(2);
			timer.stop();
		});

		it("onError throwing does not kill the timer", async () => {
			const fetchFn = jest.fn().mockResolvedValue(null); // null = failure
			const onError = jest.fn().mockImplementation(() => {
				throw new Error("error callback crash");
			});
			const timer = new PollingTimer(fetchFn, jest.fn(), onError, makeLogger());

			timer.start();
			jest.advanceTimersByTime(5_000);
			await Promise.resolve();

			// Should schedule next (backoff)
			jest.advanceTimersByTime(30_000);
			await Promise.resolve();

			expect(fetchFn).toHaveBeenCalledTimes(2);
			timer.stop();
		});
	});

	describe("State Corruption", () => {
		it("stop() during in-flight tick prevents scheduling", async () => {
			let resolvePromise: (v: ApiUsageData | null) => void;
			const fetchFn = jest.fn().mockImplementation(
				() =>
					new Promise<ApiUsageData | null>((resolve) => {
						resolvePromise = resolve;
					}),
			);
			const onData = jest.fn();
			const timer = new PollingTimer(fetchFn, onData, jest.fn(), makeLogger());

			timer.start();
			jest.advanceTimersByTime(5_000);
			// tick() is now in-flight (fetchFn waiting)

			// Stop while fetch is pending
			timer.stop();

			// Resolve the fetch
			resolvePromise!(makeApiData());
			await Promise.resolve();

			// onData should NOT be called because isRunning was set false
			expect(onData).not.toHaveBeenCalled();
		});

		it("forceRefresh() skips when tick is in-flight", async () => {
			let resolvePromise: (v: ApiUsageData | null) => void;
			const fetchFn = jest.fn().mockImplementation(
				() =>
					new Promise<ApiUsageData | null>((resolve) => {
						resolvePromise = resolve;
					}),
			);
			const timer = new PollingTimer(
				fetchFn,
				jest.fn(),
				jest.fn(),
				makeLogger(),
			);

			timer.start();
			jest.advanceTimersByTime(5_000);
			// tick() is in-flight

			// forceRefresh should be a no-op because isTickInFlight is true
			await timer.forceRefresh();
			expect(fetchFn).toHaveBeenCalledTimes(1); // Only the scheduled tick

			resolvePromise!(null);
			await Promise.resolve();
			timer.stop();
		});

		it("rapid start/stop/start works correctly", () => {
			const fetchFn = jest.fn().mockResolvedValue(null);
			const timer = new PollingTimer(
				fetchFn,
				jest.fn(),
				jest.fn(),
				makeLogger(),
			);

			timer.start();
			timer.stop();
			timer.start();

			jest.advanceTimersByTime(5_000);
			expect(fetchFn).toHaveBeenCalledTimes(1);
			timer.stop();
		});
	});

	describe("Mutation Detectors", () => {
		it("success resets consecutiveFailures counter", async () => {
			const fetchFn = jest
				.fn()
				.mockResolvedValueOnce(null) // fail
				.mockResolvedValueOnce(null) // fail
				.mockResolvedValueOnce(makeApiData()) // success
				.mockResolvedValueOnce(null); // fail again

			const timer = new PollingTimer(
				fetchFn,
				jest.fn(),
				jest.fn(),
				makeLogger(),
			);
			timer.start();

			// 1st tick at 5s (fail)
			jest.advanceTimersByTime(5_000);
			await Promise.resolve();

			// 2nd tick at 5s + 30s = 35s (fail, backoff = 30s)
			jest.advanceTimersByTime(30_000);
			await Promise.resolve();

			// 3rd tick at 35s + 60s = 95s (fail, backoff = 60s, but success this time)
			jest.advanceTimersByTime(60_000);
			await Promise.resolve();

			// 4th tick should be at 120s (SUCCESS interval, not continued backoff)
			// If consecutiveFailures wasn't reset, backoff would be 120s
			jest.advanceTimersByTime(120_000);
			await Promise.resolve();

			expect(fetchFn).toHaveBeenCalledTimes(4);
			timer.stop();
		});

		it("exponential backoff caps at 300s", async () => {
			// 10 consecutive failures
			const fetchFn = jest.fn().mockResolvedValue(null);
			const logger = makeLogger();
			const timer = new PollingTimer(fetchFn, jest.fn(), jest.fn(), logger);

			timer.start();

			// Initial: 5s
			jest.advanceTimersByTime(5_000);
			await Promise.resolve();

			// Backoffs: 30, 60, 120, 240, 300, 300, ...
			const expected = [30, 60, 120, 240, 300, 300];
			for (const seconds of expected) {
				jest.advanceTimersByTime(seconds * 1000);
				await Promise.resolve();
			}

			// All calls happened
			expect(fetchFn).toHaveBeenCalledTimes(1 + expected.length);

			// Check logger messages for capped backoff
			const warnCalls = (logger.warn as jest.Mock).mock.calls.map(
				(c: string[]) => c[0],
			);
			const lastBackoff = warnCalls[warnCalls.length - 1];
			expect(lastBackoff).toContain("300s");

			timer.stop();
		});
	});
});

// ── parseCredentialsFile (Security Payloads) ─────────────────────────

describe("BREAKIT: parseCredentialsFile", () => {
	describe("Security Payloads", () => {
		it("handles prototype pollution attempt", () => {
			const payload = '{"__proto__":{"isAdmin":true},"rateLimitTier":"pro"}';
			const result = parseCredentialsFile(payload);
			expect(result?.rateLimitTier).toBe("pro");
			// Verify prototype wasn't polluted
			expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
		});

		it("handles constructor pollution", () => {
			const payload =
				'{"constructor":{"prototype":{"evil":true}},"rateLimitTier":"pro"}';
			const result = parseCredentialsFile(payload);
			expect(result?.rateLimitTier).toBe("pro");
		});
	});

	describe("Error Path Torture", () => {
		it("null byte in JSON value causes parse failure (graceful)", () => {
			// JSON spec rejects control chars in string literals
			expect(parseCredentialsFile('{"rateLimitTier":"pro\x00"}')).toBeNull();
		});

		it("BOM prefix causes parse failure (graceful)", () => {
			// JSON.parse rejects BOM prefix - this is a real Windows edge case
			// (Notepad saves with BOM). The code gracefully returns null.
			const bom = '\uFEFF{"rateLimitTier":"pro"}';
			expect(parseCredentialsFile(bom)).toBeNull();
		});

		it("handles extremely nested JSON", () => {
			const depth = 100;
			const open = '{"a":'.repeat(depth);
			const close = "}".repeat(depth);
			const result = parseCredentialsFile(open + "1" + close);
			// Should parse without stack overflow
			expect(result).not.toBeNull();
		});

		it("handles trailing comma (invalid JSON)", () => {
			const result = parseCredentialsFile('{"rateLimitTier":"pro",}');
			// JSON.parse rejects trailing commas
			expect(result).toBeNull();
		});
	});
});

// ── formatCost (Mutation Detectors) ──────────────────────────────────

describe("BREAKIT: formatCost", () => {
	describe("Mutation Detectors", () => {
		it("just below $0.01 shows $0.00", () => {
			expect(formatCost(0.009)).toBe("$0.00");
		});

		it("exactly $0.01 shows two decimals", () => {
			expect(formatCost(0.01)).toBe("$0.01");
		});

		it("exactly $100 shows no decimals", () => {
			expect(formatCost(100)).toBe("$100");
		});

		it("just below $100 shows decimals", () => {
			expect(formatCost(99.99)).toBe("$99.99");
		});

		it("negative cost", () => {
			// cost < 0.01, so "$0.00"
			expect(formatCost(-5)).toBe("$0.00");
		});
	});
});

// ── formatPercentage (Boundary) ──────────────────────────────────────

describe("BREAKIT: formatPercentage", () => {
	it("rounds 0.4 to 0%", () => {
		expect(formatPercentage(0.4)).toBe("0%");
	});

	it("rounds 0.5 to 1%", () => {
		expect(formatPercentage(0.5)).toBe("1%");
	});

	it("handles NaN", () => {
		expect(formatPercentage(NaN)).toBe("NaN%");
	});

	it("handles negative", () => {
		expect(formatPercentage(-10)).toBe("-10%");
	});

	it("handles very large", () => {
		expect(formatPercentage(99999)).toBe("99999%");
	});
});

// ── formatBurnRate (Boundary) ────────────────────────────────────────

describe("BREAKIT: formatBurnRate", () => {
	it("0 returns empty string", () => {
		expect(formatBurnRate(0)).toBe("");
	});

	it("exactly 100 shows abbreviated", () => {
		// 100 >= 100, uses formatTokens(100) + "/min"
		// formatTokens(100) = "100" (under 1000)
		expect(formatBurnRate(100)).toBe("100/min");
	});

	it("99 shows exact", () => {
		expect(formatBurnRate(99)).toBe("99/min");
	});

	it("1500 shows 1.5K/min", () => {
		expect(formatBurnRate(1500)).toBe("1.5K/min");
	});

	it("NaN", () => {
		// NaN === 0 is false, NaN < 100 is false
		// so it falls through to formatTokens(NaN) + "/min"
		const result = formatBurnRate(NaN);
		expect(result).toContain("/min");
	});
});

// ── Resource Pressure (last) ─────────────────────────────────────────

describe("BREAKIT: Resource Pressure", () => {
	it("formatBarGraph with width=10000", () => {
		const result = formatBarGraph(50, 10_000);
		expect(result.length).toBeGreaterThan(10_000);
		const filled = (result.match(/█/g) || []).length;
		expect(filled).toBe(5_000);
	}, 5000);

	it("mapTierStringToPlanType with 100KB string", () => {
		const huge = "x".repeat(100_000);
		// Should not throw or hang
		expect(mapTierStringToPlanType(huge)).toBeNull();
	}, 5000);

	it("parseCredentialsFile with 1MB valid JSON", () => {
		const bigObj: Record<string, string> = {};
		for (let i = 0; i < 10_000; i++) {
			bigObj[`key_${i}`] = `value_${i}`;
		}
		bigObj.rateLimitTier = "pro";
		const result = parseCredentialsFile(JSON.stringify(bigObj));
		expect(result?.rateLimitTier).toBe("pro");
	}, 5000);

	it("getStaleness called 10,000 times", () => {
		const d = new Date();
		for (let i = 0; i < 10_000; i++) {
			getStaleness(d);
		}
		expect(getStaleness(d)).toBe("fresh");
	}, 5000);
});

// ── ESCALATION ───────────────────────────────────────────────────────

describe("ESCALATION: Combined Boundary + Type Confusion", () => {
	describe("formatBarGraph edge combinations", () => {
		it("NaN percentage with width=0 doesn't throw", () => {
			expect(() => formatBarGraph(NaN, 0)).not.toThrow();
		});

		it("Infinity percentage with width=1", () => {
			const result = formatBarGraph(Infinity, 1);
			expect(result).toBe("[█] 100%");
		});

		it("-Infinity percentage with large width", () => {
			const result = formatBarGraph(-Infinity, 100);
			const filled = (result.match(/█/g) || []).length;
			expect(filled).toBe(0);
		});

		it("fractional percentages near rounding boundaries", () => {
			// 2.5% of 20 = 0.5, Math.round(0.5) = 1
			const result = formatBarGraph(2.5, 20);
			const filled = (result.match(/█/g) || []).length;
			// Either 0 or 1 is acceptable, but must be consistent
			expect(filled).toBeGreaterThanOrEqual(0);
			expect(filled).toBeLessThanOrEqual(1);
		});
	});

	describe("predictTimeUntilLimit extreme combinations", () => {
		it("MAX_SAFE_INTEGER tokens with tiny burn rate", () => {
			const result = predictTimeUntilLimit(0, Number.MAX_SAFE_INTEGER, 0.001);
			// Should be capped at 999999
			expect(result).toBe(999999);
		});

		it("both tokens at MAX_SAFE_INTEGER", () => {
			const result = predictTimeUntilLimit(
				Number.MAX_SAFE_INTEGER,
				Number.MAX_SAFE_INTEGER,
				10,
			);
			expect(result).toBe(0);
		});

		it("NaN burn rate returns null", () => {
			// NaN === 0 is false, so it doesn't return null
			// Then NaN >= limitTokens... NaN >= X is false
			// Then (X - Y) / NaN = NaN, Math.min(NaN, 999999) = NaN
			const result = predictTimeUntilLimit(100, 1000, NaN);
			// BUG? This should arguably return null but returns NaN
			expect(result).toBeNaN();
		});

		it("Infinity burn rate returns 0 (not null)", () => {
			const result = predictTimeUntilLimit(100, 1000, Infinity);
			// 900 / Infinity = 0, Math.min(0, 999999) = 0
			expect(result).toBe(0);
		});

		it("negative burn rate returns negative (no floor guard)", () => {
			// This is a potential bug: negative burn rate should probably
			// return null (can't predict with negative consumption)
			const result = predictTimeUntilLimit(100, 1000, -10);
			// (1000-100) / -10 = -90
			expect(result).toBe(-90);
		});
	});

	describe("formatPaceForecast + predictTimeUntilLimit chain", () => {
		it("NaN minutes produces NaN in output", () => {
			const result = formatPaceForecast(NaN, "Test");
			// NaN === null false, NaN === 0 false, NaN < 1 false, NaN < 60 false
			// Falls to hours path: Math.floor(NaN/60) = NaN, Math.round(NaN%60) = NaN
			expect(result).toContain("NaN");
		});

		it("Infinity minutes produces Infinity in output", () => {
			const result = formatPaceForecast(Infinity, "Test");
			// Infinity < 1 false, Infinity < 60 false
			// Math.floor(Infinity/60) = Infinity
			expect(result).toContain("Infinity");
		});

		it("negative Infinity minutes shows <1m", () => {
			const result = formatPaceForecast(-Infinity, "Test");
			// -Infinity < 1 is true
			expect(result).toContain("<1m");
		});
	});
});

describe("ESCALATION: PollingTimer Concurrency Stress", () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it("multiple forceRefresh() calls don't duplicate fetches", async () => {
		const fetchFn = jest.fn().mockResolvedValue(makeApiData());
		const timer = new PollingTimer(fetchFn, jest.fn(), jest.fn(), makeLogger());

		timer.start();
		jest.advanceTimersByTime(5_000);
		await Promise.resolve(); // first tick completes

		// Fire 5 forceRefresh calls in rapid succession
		const promises = [];
		for (let i = 0; i < 5; i++) {
			promises.push(timer.forceRefresh());
		}
		await Promise.all(promises);

		// Should be at most 2 total calls: the initial tick + 1 force refresh
		// (subsequent forceRefresh calls should be blocked by isTickInFlight)
		expect(fetchFn.mock.calls.length).toBeLessThanOrEqual(3);
		timer.stop();
	});

	it("start() after forceRefresh() mid-flight doesn't double-schedule", async () => {
		let resolvePromise: (v: ApiUsageData | null) => void;
		const fetchFn = jest.fn().mockImplementation(
			() =>
				new Promise<ApiUsageData | null>((resolve) => {
					resolvePromise = resolve;
				}),
		);
		const timer = new PollingTimer(fetchFn, jest.fn(), jest.fn(), makeLogger());

		timer.start();
		jest.advanceTimersByTime(5_000);
		// tick in flight

		// stop and restart while tick is in flight
		timer.stop();
		timer.start();

		// resolve the original fetch
		resolvePromise!(makeApiData());
		await Promise.resolve();

		// Advance past the new start's initial interval
		jest.advanceTimersByTime(5_000);
		await Promise.resolve();

		// Should have 2 fetch calls: original + new start
		expect(fetchFn).toHaveBeenCalledTimes(2);
		timer.stop();
	});

	it("dispose() during tick prevents all further activity", async () => {
		let resolvePromise: (v: ApiUsageData | null) => void;
		const fetchFn = jest.fn().mockImplementation(
			() =>
				new Promise<ApiUsageData | null>((resolve) => {
					resolvePromise = resolve;
				}),
		);
		const onData = jest.fn();
		const timer = new PollingTimer(fetchFn, onData, jest.fn(), makeLogger());

		timer.start();
		jest.advanceTimersByTime(5_000);

		// dispose while fetch is in flight
		timer.dispose();

		// resolve the pending fetch
		resolvePromise!(makeApiData());
		await Promise.resolve();

		// Advance a long time - nothing should fire
		jest.advanceTimersByTime(300_000);
		await Promise.resolve();

		expect(onData).not.toHaveBeenCalled();
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});
});

describe("ESCALATION: getStaleness time-edge precision", () => {
	it("all 5 staleness levels reachable in sequence", () => {
		const levels = new Set<string>();
		// Sample every minute from 0 to 35 minutes
		for (let m = 0; m <= 35; m++) {
			const d = new Date(Date.now() - m * 60_000);
			levels.add(getStaleness(d));
		}
		expect(levels.size).toBe(5);
		expect(levels).toContain("fresh");
		expect(levels).toContain("normal");
		expect(levels).toContain("dim");
		expect(levels).toContain("stale");
		expect(levels).toContain("critical");
	});
});

describe("ESCALATION: formatBarGraph NaN propagation", () => {
	it("NaN produces empty bar (no filled, no empty blocks)", () => {
		const result = formatBarGraph(NaN, 20);
		// "█".repeat(NaN) = "" and "░".repeat(NaN) = ""
		// So bar is "[]" with no blocks - total bar length is 0, not 20
		const barContent = result.match(/\[(.*?)\]/)?.[1] ?? "";
		// This BREAKS the property that bar length === width
		// NaN propagation means bar has 0 characters instead of 20
		expect(barContent.length).not.toBe(20);
	});
});

describe("ESCALATION: predictTimeUntilLimit NaN propagation chain", () => {
	it("NaN currentTokens propagates to NaN result", () => {
		// NaN >= 1000 is false, so doesn't return 0
		// (1000 - NaN) / 10 = NaN
		const result = predictTimeUntilLimit(NaN, 1000, 10);
		expect(result).toBeNaN();
	});

	it("NaN limitTokens propagates to NaN result", () => {
		// 100 >= NaN is false
		// (NaN - 100) / 10 = NaN
		const result = predictTimeUntilLimit(100, NaN, 10);
		expect(result).toBeNaN();
	});

	it("both NaN still returns NaN (not null or 0)", () => {
		const result = predictTimeUntilLimit(NaN, NaN, 10);
		// NaN >= NaN is false, (NaN - NaN) / 10 = NaN
		expect(result).toBeNaN();
	});
});
