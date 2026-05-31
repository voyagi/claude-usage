/**
 * BREAKIT: Adversarial tests for core pure modules
 * Targets: formatting, schemas, tokenCounter, tierDetection, burnRate,
 *          rateLimitDetector, pricingEngine, timeBuckets, rateLimits
 */

import {
	formatTokens,
	formatTokensExact,
	formatCooldown,
	formatCooldownCompact,
	formatResetTime24h,
	formatCost,
	formatPercentage,
	formatBurnRate,
	formatBarGraph,
	formatPaceForecast,
	formatTimeUntilLimit,
} from "./ui/formatting";
import { parseAssistantMessage } from "./parser/schemas";
import {
	extractTokenUsage,
	getBillableTokenCount,
	getTotalTokens,
	createEmptyAggregatedUsage,
	addToAggregation,
} from "./parser/tokenCounter";
import {
	parseCredentialsFile,
	mapTierStringToPlanType,
	detectTierFromCredentials,
} from "./core/tierDetection";
import {
	createBurnRateTracker,
	calculateBurnRateEMA,
	predictTimeUntilLimit,
} from "./core/burnRate";
import {
	parseRateLimitEvent,
	refineLimitEstimate,
} from "./parser/rateLimitDetector";
import {
	aggregateUsage,
	mergeTimeBuckets,
	serializeTimeBuckets,
	deserializeTimeBuckets,
	getTimeBucketSummary,
} from "./aggregation/timeBuckets";
import type { TokenUsage, AggregatedUsage, TimeBuckets } from "./types";

afterEach(() => {
	jest.restoreAllMocks();
});

// ============================================================
// FORMATTING MODULE
// ============================================================

describe("BREAKIT: formatting", () => {
	describe("Boundary Assault", () => {
		it("formatTokens handles zero", () => {
			expect(formatTokens(0)).toBe("0");
		});

		it("formatTokens handles negative numbers", () => {
			const result = formatTokens(-1);
			expect(result).toBeDefined();
			// Should not produce "NaN" or crash
			expect(result).not.toContain("NaN");
		});

		it("formatTokens handles MAX_SAFE_INTEGER", () => {
			const result = formatTokens(Number.MAX_SAFE_INTEGER);
			expect(result).toContain("M");
		});

		it("formatTokens handles fractional tokens", () => {
			const result = formatTokens(0.5);
			expect(result).toBeDefined();
		});

		it("formatTokens boundary at exactly 1000", () => {
			expect(formatTokens(1000)).toBe("1.0K");
		});

		it("formatTokens boundary at exactly 10000", () => {
			expect(formatTokens(10000)).toBe("10K");
		});

		it("formatTokens boundary at exactly 1000000", () => {
			expect(formatTokens(1000000)).toBe("1.0M");
		});

		it("formatTokens at 999 (just below 1K threshold)", () => {
			expect(formatTokens(999)).toBe("999");
		});

		it("formatTokens at 9999 (just below 10K threshold)", () => {
			expect(formatTokens(9999)).toBe("10.0K");
		});

		it("formatCost handles zero", () => {
			expect(formatCost(0)).toBe("$0.00");
		});

		it("formatCost handles negative cost", () => {
			const result = formatCost(-5);
			expect(result).toBeDefined();
			// Negative costs shouldn't produce "$0.00" silently
		});

		it("formatCost boundary at exactly 0.01", () => {
			expect(formatCost(0.01)).toBe("$0.01");
		});

		it("formatCost boundary at exactly 100", () => {
			expect(formatCost(100)).toBe("$100");
		});

		it("formatCost handles very small positive (0.001)", () => {
			expect(formatCost(0.001)).toBe("$0.00");
		});

		it("formatCost handles Infinity", () => {
			const result = formatCost(Infinity);
			expect(result).toBeDefined();
			expect(result).not.toContain("NaN");
		});

		it("formatBarGraph handles 0%", () => {
			const result = formatBarGraph(0);
			expect(result).toContain("0%");
		});

		it("formatBarGraph handles 100%", () => {
			const result = formatBarGraph(100);
			expect(result).toContain("100%");
		});

		it("formatBarGraph handles >100%", () => {
			const result = formatBarGraph(150);
			expect(result).toContain("100%"); // Should be clamped
		});

		it("formatBarGraph handles negative %", () => {
			const result = formatBarGraph(-10);
			expect(result).toContain("0%"); // Should be clamped
		});

		it("formatCooldown handles null", () => {
			expect(formatCooldown(null)).toBe("");
		});

		it("formatCooldown handles past date", () => {
			const past = new Date(Date.now() - 60000);
			expect(formatCooldown(past)).toBe("Ready");
		});

		it("formatCooldownCompact handles null", () => {
			expect(formatCooldownCompact(null)).toBe("");
		});

		it("formatResetTime24h handles null", () => {
			expect(formatResetTime24h(null)).toBe("");
		});

		it("formatBurnRate handles zero", () => {
			expect(formatBurnRate(0)).toBe("");
		});

		it("formatBurnRate handles sub-1 rate", () => {
			const result = formatBurnRate(0.4);
			expect(result).toBe("0/min");
		});

		it("formatPercentage handles NaN", () => {
			const result = formatPercentage(NaN);
			expect(result).not.toBe("NaN%");
		});

		it("formatTimeUntilLimit handles null", () => {
			expect(formatTimeUntilLimit(null)).toBe("");
		});

		it("formatTimeUntilLimit handles zero", () => {
			expect(formatTimeUntilLimit(0)).toBe("LIMIT HIT");
		});

		it("formatTimeUntilLimit handles fractional minutes <1", () => {
			expect(formatTimeUntilLimit(0.5)).toBe("<1m at current pace");
		});

		it("formatPaceForecast handles null minutes", () => {
			expect(formatPaceForecast(null, "Session")).toBe("");
		});

		it("formatPaceForecast handles zero minutes", () => {
			expect(formatPaceForecast(0, "Session")).toBe("Session: LIMIT HIT");
		});
	});

	describe("Type Confusion", () => {
		it("formatTokens with NaN", () => {
			const result = formatTokens(NaN);
			expect(result).not.toContain("undefined");
		});

		it("formatTokens with Infinity", () => {
			const result = formatTokens(Infinity);
			expect(result).toBeDefined();
		});

		it("formatTokens with -Infinity", () => {
			const result = formatTokens(-Infinity);
			expect(result).toBeDefined();
		});

		it("formatCost with NaN", () => {
			const result = formatCost(NaN);
			expect(result).toBeDefined();
		});

		it("formatBarGraph with NaN percentage", () => {
			const result = formatBarGraph(NaN);
			expect(result).toBeDefined();
			expect(result).not.toContain("NaN");
		});

		it("formatBarGraph with width=0", () => {
			const result = formatBarGraph(50, 0);
			expect(result).toBeDefined();
		});

		it("formatBarGraph with negative width", () => {
			const result = formatBarGraph(50, -5);
			expect(result).toBeDefined();
		});

		it("formatTimeUntilLimit with NaN minutes", () => {
			const result = formatTimeUntilLimit(NaN);
			expect(result).toBeDefined();
		});

		it("formatTimeUntilLimit with Infinity", () => {
			const result = formatTimeUntilLimit(Infinity);
			expect(result).toBeDefined();
			expect(result).not.toContain("NaN");
		});

		it("formatTimeUntilLimit with negative minutes", () => {
			const result = formatTimeUntilLimit(-10);
			// Negative minutes — should not return a positive forecast
			expect(result).not.toContain("at current pace");
		});
	});

	describe("Mutation Detectors", () => {
		it("formatTokens: 999 vs 1000 — boundary between raw and K", () => {
			const at999 = formatTokens(999);
			const at1000 = formatTokens(1000);
			expect(at999).not.toContain("K");
			expect(at1000).toContain("K");
		});

		it("formatTokens: 9999 vs 10000 — boundary between 1-decimal K and round K", () => {
			const at9999 = formatTokens(9999);
			const at10000 = formatTokens(10000);
			// 9999 should be "10.0K" (1-decimal), 10000 should be "10K" (no decimal)
			expect(at9999).toContain(".");
			expect(at10000).not.toContain(".");
		});

		it("formatCost: 0.009 vs 0.01 — below-penny boundary", () => {
			expect(formatCost(0.009)).toBe("$0.00");
			expect(formatCost(0.01)).toBe("$0.01");
		});

		it("formatCost: 99.99 vs 100 — decimal switch boundary", () => {
			const at99 = formatCost(99.99);
			expect(at99).toContain(".");
			const at100 = formatCost(100);
			expect(at100).not.toContain(".");
		});

		it("formatBurnRate: 0 produces empty, 1 produces value", () => {
			expect(formatBurnRate(0)).toBe("");
			expect(formatBurnRate(1)).not.toBe("");
		});

		it("formatTimeUntilLimit: 0 vs 0.5 vs 1 — boundary transitions", () => {
			expect(formatTimeUntilLimit(0)).toBe("LIMIT HIT");
			expect(formatTimeUntilLimit(0.5)).toBe("<1m at current pace");
			expect(formatTimeUntilLimit(1)).toBe("1m at current pace");
		});

		it("formatTimeUntilLimit: 59 vs 60 — minute/hour boundary", () => {
			expect(formatTimeUntilLimit(59)).toBe("59m at current pace");
			const at60 = formatTimeUntilLimit(60);
			expect(at60).toContain("h");
			expect(at60).toContain("0m");
		});
	});

	describe("Property Violations", () => {
		it("formatTokens is monotonic — larger input never produces shorter display", () => {
			const values = [
				0, 100, 999, 1000, 5000, 9999, 10000, 50000, 100000, 999999, 1000000,
				5000000,
			];
			for (let i = 1; i < values.length; i++) {
				const prev = formatTokens(values[i - 1]);
				const curr = formatTokens(values[i]);
				// Parse numeric value from formatted string
				const parseFormatted = (s: string) => {
					const num = parseFloat(s.replace(/[KM]/g, ""));
					if (s.includes("M")) return num * 1_000_000;
					if (s.includes("K")) return num * 1_000;
					return num;
				};
				expect(parseFormatted(curr)).toBeGreaterThanOrEqual(
					parseFormatted(prev),
				);
			}
		});

		it("formatCost is monotonic — larger cost never produces smaller display", () => {
			const costs = [0, 0.001, 0.01, 0.5, 1.0, 50, 99.99, 100, 500];
			for (let i = 1; i < costs.length; i++) {
				const prev = parseFloat(formatCost(costs[i - 1]).replace("$", ""));
				const curr = parseFloat(formatCost(costs[i]).replace("$", ""));
				expect(curr).toBeGreaterThanOrEqual(prev);
			}
		});

		it("formatBarGraph percentage in output matches clamped input", () => {
			const cases = [0, 25, 50, 75, 100];
			for (const pct of cases) {
				const result = formatBarGraph(pct);
				expect(result).toContain(`${pct}%`);
			}
		});
	});
});

// ============================================================
// SCHEMAS MODULE
// ============================================================

describe("BREAKIT: schemas", () => {
	describe("Boundary Assault", () => {
		it("parseAssistantMessage with null", () => {
			expect(parseAssistantMessage(null)).toBeNull();
		});

		it("parseAssistantMessage with undefined", () => {
			expect(parseAssistantMessage(undefined)).toBeNull();
		});

		it("parseAssistantMessage with empty object", () => {
			expect(parseAssistantMessage({})).toBeNull();
		});

		it("parseAssistantMessage with empty string", () => {
			expect(parseAssistantMessage("")).toBeNull();
		});

		it("parseAssistantMessage with number", () => {
			expect(parseAssistantMessage(42)).toBeNull();
		});

		it("parseAssistantMessage with boolean", () => {
			expect(parseAssistantMessage(true)).toBeNull();
		});

		it("parseAssistantMessage with array", () => {
			expect(parseAssistantMessage([])).toBeNull();
		});

		it("parseAssistantMessage with type=assistant but missing fields", () => {
			expect(parseAssistantMessage({ type: "assistant" })).toBeNull();
		});

		it("parseAssistantMessage with valid structure but zero tokens", () => {
			const msg = {
				type: "assistant",
				timestamp: "2026-01-01T00:00:00Z",
				sessionId: "test-session",
				message: {
					model: "claude-sonnet-4-5",
					usage: {
						input_tokens: 0,
						output_tokens: 0,
					},
				},
			};
			const result = parseAssistantMessage(msg);
			expect(result).not.toBeNull();
			expect(result!.inputTokens).toBe(0);
			expect(result!.outputTokens).toBe(0);
		});

		it("parseAssistantMessage with MAX_SAFE_INTEGER tokens", () => {
			const msg = {
				type: "assistant",
				timestamp: "2026-01-01T00:00:00Z",
				sessionId: "test-session",
				message: {
					model: "claude-sonnet-4-5",
					usage: {
						input_tokens: Number.MAX_SAFE_INTEGER,
						output_tokens: Number.MAX_SAFE_INTEGER,
					},
				},
			};
			const result = parseAssistantMessage(msg);
			expect(result).not.toBeNull();
			expect(result!.inputTokens).toBe(Number.MAX_SAFE_INTEGER);
		});

		it("parseAssistantMessage with negative tokens is rejected", () => {
			const msg = {
				type: "assistant",
				timestamp: "2026-01-01T00:00:00Z",
				sessionId: "test-session",
				message: {
					model: "claude-sonnet-4-5",
					usage: {
						input_tokens: -1,
						output_tokens: 100,
					},
				},
			};
			const result = parseAssistantMessage(msg);
			expect(result).toBeNull();
		});

		it("parseAssistantMessage with fractional tokens is rejected", () => {
			const msg = {
				type: "assistant",
				timestamp: "2026-01-01T00:00:00Z",
				sessionId: "test-session",
				message: {
					model: "claude-sonnet-4-5",
					usage: {
						input_tokens: 1.5,
						output_tokens: 100,
					},
				},
			};
			const result = parseAssistantMessage(msg);
			expect(result).toBeNull();
		});
	});

	describe("Type Confusion", () => {
		it("parseAssistantMessage with string tokens", () => {
			const msg = {
				type: "assistant",
				timestamp: "2026-01-01T00:00:00Z",
				sessionId: "test-session",
				message: {
					model: "claude-sonnet-4-5",
					usage: {
						input_tokens: "1000",
						output_tokens: "500",
					},
				},
			};
			const result = parseAssistantMessage(msg);
			// Zod should reject string tokens
			expect(result).toBeNull();
		});

		it("parseAssistantMessage with NaN tokens", () => {
			const msg = {
				type: "assistant",
				timestamp: "2026-01-01T00:00:00Z",
				sessionId: "test-session",
				message: {
					model: "claude-sonnet-4-5",
					usage: {
						input_tokens: NaN,
						output_tokens: 100,
					},
				},
			};
			const result = parseAssistantMessage(msg);
			expect(result).toBeNull();
		});

		it("parseAssistantMessage with Infinity tokens", () => {
			const msg = {
				type: "assistant",
				timestamp: "2026-01-01T00:00:00Z",
				sessionId: "test-session",
				message: {
					model: "claude-sonnet-4-5",
					usage: {
						input_tokens: Infinity,
						output_tokens: 100,
					},
				},
			};
			const result = parseAssistantMessage(msg);
			expect(result).toBeNull();
		});

		it("parseAssistantMessage with non-ISO timestamp", () => {
			const msg = {
				type: "assistant",
				timestamp: "not-a-date",
				sessionId: "test-session",
				message: {
					model: "claude-sonnet-4-5",
					usage: { input_tokens: 100, output_tokens: 50 },
				},
			};
			const result = parseAssistantMessage(msg);
			expect(result).toBeNull();
		});

		it("parseAssistantMessage with null timestamp", () => {
			const msg = {
				type: "assistant",
				timestamp: null,
				sessionId: "test-session",
				message: {
					model: "claude-sonnet-4-5",
					usage: { input_tokens: 100, output_tokens: 50 },
				},
			};
			const result = parseAssistantMessage(msg);
			expect(result).toBeNull();
		});
	});

	describe("Security Payloads", () => {
		it("parseAssistantMessage with XSS in model name", () => {
			const msg = {
				type: "assistant",
				timestamp: "2026-01-01T00:00:00Z",
				sessionId: "<script>alert(1)</script>",
				message: {
					model: "<img onerror=alert(1) src=x>",
					usage: { input_tokens: 100, output_tokens: 50 },
				},
			};
			const result = parseAssistantMessage(msg);
			// Should parse (data is stored locally, not rendered as HTML)
			// but verify it doesn't crash
			if (result) {
				expect(result.model).toBe("<img onerror=alert(1) src=x>");
			}
		});

		it("parseAssistantMessage with SQL injection in sessionId", () => {
			const msg = {
				type: "assistant",
				timestamp: "2026-01-01T00:00:00Z",
				sessionId: "'; DROP TABLE sessions; --",
				message: {
					model: "claude-sonnet-4-5",
					usage: { input_tokens: 100, output_tokens: 50 },
				},
			};
			const result = parseAssistantMessage(msg);
			if (result) {
				expect(result.sessionId).toBe("'; DROP TABLE sessions; --");
			}
		});

		it("parseAssistantMessage with null bytes in strings", () => {
			const msg = {
				type: "assistant",
				timestamp: "2026-01-01T00:00:00Z",
				sessionId: "session\x00id",
				message: {
					model: "claude\x00model",
					usage: { input_tokens: 100, output_tokens: 50 },
				},
			};
			const result = parseAssistantMessage(msg);
			// Should not crash
			expect(result === null || typeof result === "object").toBe(true);
		});
	});

	describe("Error Path Torture", () => {
		it("parseAssistantMessage with deeply nested but wrong structure", () => {
			const msg = {
				type: "assistant",
				timestamp: "2026-01-01T00:00:00Z",
				sessionId: "test",
				message: {
					model: "test",
					usage: {
						input_tokens: 100,
						output_tokens: 50,
						cache_creation: {
							ephemeral_5m_input_tokens: "not-a-number",
						},
					},
				},
			};
			const result = parseAssistantMessage(msg);
			expect(result).toBeNull();
		});

		it("parseAssistantMessage with extra unknown fields (passthrough)", () => {
			const msg = {
				type: "assistant",
				timestamp: "2026-01-01T00:00:00Z",
				sessionId: "test",
				extraField: "should-be-ignored",
				message: {
					model: "claude-sonnet-4-5",
					anotherExtra: true,
					usage: {
						input_tokens: 100,
						output_tokens: 50,
						unknown_field: 999,
					},
				},
			};
			const result = parseAssistantMessage(msg);
			expect(result).not.toBeNull();
			expect(result!.inputTokens).toBe(100);
		});
	});
});

// ============================================================
// TOKEN COUNTER MODULE
// ============================================================

describe("BREAKIT: tokenCounter", () => {
	const makeUsage = (overrides: Partial<TokenUsage> = {}): TokenUsage => ({
		timestamp: new Date("2026-01-15T10:00:00Z"),
		model: "claude-sonnet-4-5",
		sessionId: "test-session",
		inputTokens: 1000,
		outputTokens: 500,
		cacheCreationTokens: 200,
		cacheReadTokens: 300,
		cacheCreation5m: 100,
		cacheCreation1h: 100,
		cost: 0.05,
		...overrides,
	});

	describe("Boundary Assault", () => {
		it("getBillableTokenCount with all zeros", () => {
			const usage = makeUsage({ inputTokens: 0, cacheCreationTokens: 0 });
			expect(getBillableTokenCount(usage)).toBe(0);
		});

		it("getBillableTokenCount with MAX_SAFE_INTEGER", () => {
			const usage = makeUsage({
				inputTokens: Number.MAX_SAFE_INTEGER,
				cacheCreationTokens: 1,
			});
			// This will overflow — check it doesn't produce negative
			const result = getBillableTokenCount(usage);
			expect(result).toBeGreaterThan(0);
		});

		it("getTotalTokens with all zeros", () => {
			const usage = makeUsage({
				inputTokens: 0,
				outputTokens: 0,
				cacheCreationTokens: 0,
				cacheReadTokens: 0,
			});
			expect(getTotalTokens(usage)).toBe(0);
		});

		it("createEmptyAggregatedUsage returns all zeros", () => {
			const agg = createEmptyAggregatedUsage();
			expect(agg.inputTokens).toBe(0);
			expect(agg.outputTokens).toBe(0);
			expect(agg.messageCount).toBe(0);
			expect(agg.firstMessage).toBeNull();
			expect(agg.lastMessage).toBeNull();
		});
	});

	describe("Mutation Detectors", () => {
		it("getBillableTokenCount includes inputTokens but NOT cacheReadTokens", () => {
			const usage = makeUsage({
				inputTokens: 100,
				cacheCreationTokens: 50,
				cacheReadTokens: 9999,
			});
			expect(getBillableTokenCount(usage)).toBe(150);
		});

		it("getTotalTokens includes all four token types", () => {
			const usage = makeUsage({
				inputTokens: 10,
				outputTokens: 20,
				cacheCreationTokens: 30,
				cacheReadTokens: 40,
			});
			expect(getTotalTokens(usage)).toBe(100);
		});

		it("addToAggregation increments messageCount by exactly 1", () => {
			const agg = createEmptyAggregatedUsage();
			const usage = makeUsage();
			addToAggregation(agg, usage);
			expect(agg.messageCount).toBe(1);
			addToAggregation(agg, usage);
			expect(agg.messageCount).toBe(2);
		});
	});

	describe("State Corruption", () => {
		it("addToAggregation updates firstMessage/lastMessage correctly with out-of-order timestamps", () => {
			const agg = createEmptyAggregatedUsage();
			const later = makeUsage({ timestamp: new Date("2026-01-15T12:00:00Z") });
			const earlier = makeUsage({
				timestamp: new Date("2026-01-15T08:00:00Z"),
			});

			addToAggregation(agg, later);
			addToAggregation(agg, earlier);

			expect(agg.firstMessage!.getTime()).toBe(
				new Date("2026-01-15T08:00:00Z").getTime(),
			);
			expect(agg.lastMessage!.getTime()).toBe(
				new Date("2026-01-15T12:00:00Z").getTime(),
			);
		});

		it("addToAggregation accumulates costs additively", () => {
			const agg = createEmptyAggregatedUsage();
			addToAggregation(agg, makeUsage({ cost: 0.1 }));
			addToAggregation(agg, makeUsage({ cost: 0.2 }));
			addToAggregation(agg, makeUsage({ cost: 0.3 }));
			expect(agg.totalCost).toBeCloseTo(0.6, 10);
		});
	});

	describe("Property Violations", () => {
		it("extractTokenUsage produces consistent results with parseAssistantMessage", () => {
			const raw = {
				timestamp: "2026-01-15T10:00:00Z",
				message: {
					model: "claude-sonnet-4-5",
					usage: {
						input_tokens: 500,
						output_tokens: 250,
						cache_creation_input_tokens: 100,
						cache_read_input_tokens: 50,
					},
				},
			};
			const extracted = extractTokenUsage(raw, "session-1");
			expect(extracted.inputTokens).toBe(500);
			expect(extracted.outputTokens).toBe(250);
			expect(extracted.cacheCreationTokens).toBe(100);
			expect(extracted.cacheReadTokens).toBe(50);
			expect(extracted.sessionId).toBe("session-1");
		});
	});
});

// ============================================================
// TIER DETECTION MODULE
// ============================================================

describe("BREAKIT: tierDetection", () => {
	describe("Boundary Assault", () => {
		it("parseCredentialsFile with empty string", () => {
			expect(parseCredentialsFile("")).toBeNull();
		});

		it("parseCredentialsFile with empty JSON object", () => {
			const result = parseCredentialsFile("{}");
			expect(result).toEqual({});
		});

		it("parseCredentialsFile with null JSON", () => {
			const result = parseCredentialsFile("null");
			// JSON.parse("null") returns null, then accessing .rateLimitTier throws
			// catch returns null — acceptable graceful degradation
			expect(result).toBeNull();
		});

		it("parseCredentialsFile with invalid JSON", () => {
			expect(parseCredentialsFile("{not json}")).toBeNull();
		});

		it("parseCredentialsFile with truncated JSON", () => {
			expect(parseCredentialsFile('{"rateLimitTier": "')).toBeNull();
		});

		it("mapTierStringToPlanType with empty string", () => {
			expect(mapTierStringToPlanType("")).toBeNull();
		});

		it("detectTierFromCredentials with null credentials", () => {
			expect(detectTierFromCredentials(null, "pro")).toBe("pro");
		});

		it("detectTierFromCredentials with empty credentials", () => {
			expect(detectTierFromCredentials({}, "max5")).toBe("max5");
		});
	});

	describe("Type Confusion", () => {
		it("parseCredentialsFile with number JSON", () => {
			const result = parseCredentialsFile("42");
			// JSON.parse(42) succeeds, but result has no rateLimitTier
			expect(result).toEqual({});
		});

		it("parseCredentialsFile with array JSON", () => {
			const result = parseCredentialsFile("[1,2,3]");
			expect(result).toEqual({});
		});

		it("parseCredentialsFile with boolean JSON", () => {
			const result = parseCredentialsFile("true");
			expect(result).toEqual({});
		});
	});

	describe("Mutation Detectors", () => {
		it("mapTierStringToPlanType: max_20 => max20, max_5 => max5, pro => pro", () => {
			expect(mapTierStringToPlanType("max_20")).toBe("max20");
			expect(mapTierStringToPlanType("max_5")).toBe("max5");
			expect(mapTierStringToPlanType("pro")).toBe("pro");
		});

		it("mapTierStringToPlanType: case insensitive", () => {
			expect(mapTierStringToPlanType("MAX_20")).toBe("max20");
			expect(mapTierStringToPlanType("PRO")).toBe("pro");
			expect(mapTierStringToPlanType("Max5")).toBe("max5");
		});

		it("mapTierStringToPlanType: standard => pro", () => {
			expect(mapTierStringToPlanType("standard")).toBe("pro");
		});

		it("detectTierFromCredentials prefers rateLimitTier over subscriptionType", () => {
			const creds = { rateLimitTier: "max_20", subscriptionType: "pro" };
			expect(detectTierFromCredentials(creds, "pro")).toBe("max20");
		});

		it("detectTierFromCredentials falls to subscriptionType when rateLimitTier unrecognized", () => {
			const creds = {
				rateLimitTier: "unknown_tier",
				subscriptionType: "max_5",
			};
			expect(detectTierFromCredentials(creds, "pro")).toBe("max5");
		});
	});

	describe("Security Payloads", () => {
		it("parseCredentialsFile with prototype pollution attempt", () => {
			const result = parseCredentialsFile('{"__proto__": {"polluted": true}}');
			// Should parse without polluting Object prototype
			expect(result).toBeDefined();
			expect(({} as any).polluted).toBeUndefined();
		});

		it("parseCredentialsFile with very long tier string", () => {
			const longTier = "a".repeat(100000);
			const result = parseCredentialsFile(
				JSON.stringify({ rateLimitTier: longTier }),
			);
			expect(result).toBeDefined();
			expect(result!.rateLimitTier).toBe(longTier);
		});
	});
});

// ============================================================
// BURN RATE MODULE
// ============================================================

describe("BREAKIT: burnRate", () => {
	describe("Boundary Assault", () => {
		it("createBurnRateTracker defaults", () => {
			const tracker = createBurnRateTracker();
			expect(tracker.ema).toBe(0);
			expect(tracker.alpha).toBe(0.2);
		});

		it("createBurnRateTracker with alpha=0", () => {
			const tracker = createBurnRateTracker(0);
			expect(tracker.alpha).toBe(0);
		});

		it("createBurnRateTracker with alpha=1", () => {
			const tracker = createBurnRateTracker(1);
			expect(tracker.alpha).toBe(1);
		});

		it("predictTimeUntilLimit with zero burn rate", () => {
			expect(predictTimeUntilLimit(100, 1000, 0)).toBeNull();
		});

		it("predictTimeUntilLimit with zero limit", () => {
			expect(predictTimeUntilLimit(100, 0, 10)).toBeNull();
		});

		it("predictTimeUntilLimit with negative limit", () => {
			expect(predictTimeUntilLimit(100, -1, 10)).toBeNull();
		});

		it("predictTimeUntilLimit when already at limit", () => {
			expect(predictTimeUntilLimit(1000, 1000, 10)).toBe(0);
		});

		it("predictTimeUntilLimit when over limit", () => {
			expect(predictTimeUntilLimit(1500, 1000, 10)).toBe(0);
		});

		it("predictTimeUntilLimit caps at 999999", () => {
			// Very low burn rate, very high remaining
			const result = predictTimeUntilLimit(0, 10_000_000_000, 1);
			expect(result).toBe(999999);
		});
	});

	describe("Type Confusion", () => {
		it("predictTimeUntilLimit with NaN currentTokens", () => {
			const result = predictTimeUntilLimit(NaN, 1000, 10);
			// NaN >= limitTokens is false, so it proceeds to calculation
			// tokensRemaining = 1000 - NaN = NaN, minutesRemaining = NaN
			// This is a potential NaN propagation bug
			expect(result === null || Number.isFinite(result as number)).toBe(true);
		});

		it("predictTimeUntilLimit with NaN burnRate", () => {
			const result = predictTimeUntilLimit(100, 1000, NaN);
			// NaN === 0 is false, so it doesn't return null
			// NaN <= 0 is false, passes second check
			// tokensRemaining / NaN = NaN
			expect(result === null || Number.isFinite(result as number)).toBe(true);
		});

		it("predictTimeUntilLimit with negative burn rate", () => {
			const result = predictTimeUntilLimit(100, 1000, -10);
			// Negative burn rate should be handled — negative minutes makes no sense
			if (result !== null) {
				expect(result).toBeGreaterThanOrEqual(0);
			}
		});

		it("predictTimeUntilLimit with Infinity burn rate", () => {
			const result = predictTimeUntilLimit(100, 1000, Infinity);
			if (result !== null) {
				expect(Number.isFinite(result)).toBe(true);
			}
		});
	});

	describe("Mutation Detectors", () => {
		it("predictTimeUntilLimit: currentTokens exactly equal to limit returns 0", () => {
			expect(predictTimeUntilLimit(1000, 1000, 10)).toBe(0);
		});

		it("predictTimeUntilLimit: currentTokens one less than limit returns positive", () => {
			const result = predictTimeUntilLimit(999, 1000, 10);
			expect(result).not.toBeNull();
			expect(result!).toBeGreaterThan(0);
		});

		it("calculateBurnRateEMA with empty buckets returns rate 0", () => {
			const emptyBuckets: TimeBuckets = {
				session: new Map(),
				daily: new Map(),
				weekly: new Map(),
				monthly: new Map(),
				modelWeekly: new Map(),
				hourly: new Map(),
			};
			const tracker = createBurnRateTracker();
			const { rate } = calculateBurnRateEMA(emptyBuckets, tracker, 300);
			expect(rate).toBe(0);
		});
	});
});

// ============================================================
// RATE LIMIT DETECTOR MODULE
// ============================================================

describe("BREAKIT: rateLimitDetector", () => {
	describe("Boundary Assault", () => {
		it("parseRateLimitEvent with empty string", () => {
			expect(parseRateLimitEvent("")).toBeNull();
		});

		it("parseRateLimitEvent with non-JSON", () => {
			expect(parseRateLimitEvent("not json")).toBeNull();
		});

		it("parseRateLimitEvent with valid JSON but wrong type", () => {
			expect(parseRateLimitEvent('{"type": "user"}')).toBeNull();
		});

		it("parseRateLimitEvent with error type but not rate_limit_error", () => {
			const line = JSON.stringify({
				type: "error",
				timestamp: "2026-01-01T00:00:00Z",
				error: { type: "server_error", message: "internal error" },
			});
			expect(parseRateLimitEvent(line)).toBeNull();
		});

		it("refineLimitEstimate with zero observedUsage", () => {
			expect(refineLimitEstimate(1000, 0)).toBe(1000);
		});

		it("refineLimitEstimate with negative observedUsage", () => {
			expect(refineLimitEstimate(1000, -100)).toBe(1000);
		});

		it("refineLimitEstimate only adjusts downward", () => {
			// observed 500 * 0.95 = 475, which is below current 1000
			expect(refineLimitEstimate(1000, 500)).toBe(475);
			// observed 2000 * 0.95 = 1900, which is above current 1000
			expect(refineLimitEstimate(1000, 2000)).toBe(1000);
		});
	});

	describe("Mutation Detectors", () => {
		it("parseRateLimitEvent classifies 'daily' as weekly", () => {
			const line = JSON.stringify({
				type: "error",
				timestamp: "2026-01-01T00:00:00Z",
				error: { type: "rate_limit_error", message: "Daily limit exceeded" },
			});
			const result = parseRateLimitEvent(line);
			expect(result).not.toBeNull();
			expect(result!.limitType).toBe("weekly");
		});

		it("parseRateLimitEvent classifies 'weekly' as weekly", () => {
			const line = JSON.stringify({
				type: "error",
				timestamp: "2026-01-01T00:00:00Z",
				error: { type: "rate_limit_error", message: "Weekly limit hit" },
			});
			const result = parseRateLimitEvent(line);
			expect(result!.limitType).toBe("weekly");
		});

		it("parseRateLimitEvent classifies 'per-minute' as session", () => {
			const line = JSON.stringify({
				type: "error",
				timestamp: "2026-01-01T00:00:00Z",
				error: {
					type: "rate_limit_error",
					message: "per-minute rate exceeded",
				},
			});
			const result = parseRateLimitEvent(line);
			expect(result!.limitType).toBe("session");
		});

		it("parseRateLimitEvent classifies 'rpm' as session", () => {
			const line = JSON.stringify({
				type: "error",
				timestamp: "2026-01-01T00:00:00Z",
				error: { type: "rate_limit_error", message: "RPM limit reached" },
			});
			const result = parseRateLimitEvent(line);
			expect(result!.limitType).toBe("session");
		});

		it("parseRateLimitEvent unknown message => unknown type", () => {
			const line = JSON.stringify({
				type: "error",
				timestamp: "2026-01-01T00:00:00Z",
				error: { type: "rate_limit_error", message: "Something else entirely" },
			});
			const result = parseRateLimitEvent(line);
			expect(result!.limitType).toBe("unknown");
		});

		it("refineLimitEstimate applies 5% safety margin (floor)", () => {
			// 1000 * 0.95 = 950
			expect(refineLimitEstimate(2000, 1000)).toBe(950);
		});

		it("refineLimitEstimate with exact same as current", () => {
			// 1000 * 0.95 = 950, which is below 1000 → returns 950
			expect(refineLimitEstimate(1000, 1000)).toBe(950);
		});
	});

	describe("Security Payloads", () => {
		it("parseRateLimitEvent with JSON injection in message", () => {
			const line = JSON.stringify({
				type: "error",
				timestamp: "2026-01-01T00:00:00Z",
				error: {
					type: "rate_limit_error",
					message: '{"injected": true, "weekly": "fake"}',
				},
			});
			const result = parseRateLimitEvent(line);
			expect(result).not.toBeNull();
			// The word "weekly" appears in the message, so it will classify as weekly
			expect(result!.limitType).toBe("weekly");
		});
	});
});

// ============================================================
// TIME BUCKETS MODULE
// ============================================================

describe("BREAKIT: timeBuckets", () => {
	const makeRecord = (overrides: Partial<TokenUsage> = {}): TokenUsage => ({
		timestamp: new Date("2026-01-15T10:00:00Z"),
		model: "claude-sonnet-4-5",
		sessionId: "session-1",
		inputTokens: 1000,
		outputTokens: 500,
		cacheCreationTokens: 200,
		cacheReadTokens: 300,
		cacheCreation5m: 100,
		cacheCreation1h: 100,
		cost: 0.05,
		...overrides,
	});

	describe("Boundary Assault", () => {
		it("aggregateUsage with empty array", () => {
			const buckets = aggregateUsage([]);
			expect(buckets.session.size).toBe(0);
			expect(buckets.daily.size).toBe(0);
			expect(buckets.weekly.size).toBe(0);
			expect(buckets.monthly.size).toBe(0);
		});

		it("aggregateUsage with single record", () => {
			const buckets = aggregateUsage([makeRecord()]);
			expect(buckets.session.size).toBe(1);
			expect(buckets.daily.size).toBe(1);
		});

		it("getTimeBucketSummary with empty buckets", () => {
			const buckets = aggregateUsage([]);
			const summary = getTimeBucketSummary(buckets);
			expect(summary.totalSessions).toBe(0);
			expect(summary.totalDays).toBe(0);
			expect(summary.totalCost).toBe(0);
			expect(summary.totalMessages).toBe(0);
		});
	});

	describe("Property Violations", () => {
		it("serialize/deserialize roundtrip preserves data", () => {
			const records = [
				makeRecord({
					timestamp: new Date("2026-01-15T10:00:00Z"),
					sessionId: "s1",
				}),
				makeRecord({
					timestamp: new Date("2026-01-16T11:00:00Z"),
					sessionId: "s2",
				}),
			];
			const original = aggregateUsage(records);
			const serialized = serializeTimeBuckets(original);
			const deserialized = deserializeTimeBuckets(serialized);

			expect(deserialized.session.size).toBe(original.session.size);
			expect(deserialized.daily.size).toBe(original.daily.size);

			// Verify numeric values match
			for (const [key, origAgg] of original.daily.entries()) {
				const deserAgg = deserialized.daily.get(key)!;
				expect(deserAgg.inputTokens).toBe(origAgg.inputTokens);
				expect(deserAgg.outputTokens).toBe(origAgg.outputTokens);
				expect(deserAgg.messageCount).toBe(origAgg.messageCount);
			}
		});

		it("mergeTimeBuckets is commutative for numeric values", () => {
			const r1 = [makeRecord({ sessionId: "s1", inputTokens: 100 })];
			const r2 = [makeRecord({ sessionId: "s2", inputTokens: 200 })];
			const a = aggregateUsage(r1);
			const b = aggregateUsage(r2);

			const ab = mergeTimeBuckets(a, b);
			const ba = mergeTimeBuckets(b, a);

			// Same number of sessions
			expect(ab.session.size).toBe(ba.session.size);

			// Same daily totals
			for (const [key, aggAB] of ab.daily.entries()) {
				const aggBA = ba.daily.get(key)!;
				expect(aggAB.inputTokens).toBe(aggBA.inputTokens);
				expect(aggAB.outputTokens).toBe(aggBA.outputTokens);
			}
		});

		it("mergeTimeBuckets with empty second bucket is identity", () => {
			const records = [makeRecord()];
			const a = aggregateUsage(records);
			const empty = aggregateUsage([]);

			const merged = mergeTimeBuckets(a, empty);
			expect(merged.session.size).toBe(a.session.size);

			for (const [key, origAgg] of a.daily.entries()) {
				const mergedAgg = merged.daily.get(key)!;
				expect(mergedAgg.inputTokens).toBe(origAgg.inputTokens);
			}
		});
	});

	describe("State Corruption", () => {
		it("mergeTimeBuckets does not mutate inputs", () => {
			const r1 = [makeRecord({ sessionId: "s1", inputTokens: 100 })];
			const r2 = [makeRecord({ sessionId: "s1", inputTokens: 200 })];
			const a = aggregateUsage(r1);
			const b = aggregateUsage(r2);

			const origAInput = a.daily.values().next().value!.inputTokens;
			mergeTimeBuckets(a, b);
			const afterMergeAInput = a.daily.values().next().value!.inputTokens;

			expect(afterMergeAInput).toBe(origAInput);
		});

		it("deserializeTimeBuckets handles missing optional fields", () => {
			const serialized = {
				session: [],
				daily: [],
				weekly: [],
				monthly: [],
				// modelWeekly and hourly intentionally omitted
			};
			const result = deserializeTimeBuckets(serialized as any);
			expect(result.modelWeekly.size).toBe(0);
			expect(result.hourly.size).toBe(0);
		});

		it("deserializeTimeBuckets reconstructs Date objects from strings", () => {
			const serialized = {
				session: [],
				daily: [
					[
						"2026-01-15",
						{
							inputTokens: 100,
							outputTokens: 50,
							cacheCreationTokens: 0,
							cacheReadTokens: 0,
							totalCost: 0.01,
							messageCount: 1,
							firstMessage: "2026-01-15T10:00:00.000Z",
							lastMessage: "2026-01-15T12:00:00.000Z",
						},
					],
				] as [string, any][],
				weekly: [],
				monthly: [],
			};
			const result = deserializeTimeBuckets(serialized as any);
			const dailyAgg = result.daily.get("2026-01-15")!;
			expect(dailyAgg.firstMessage).toBeInstanceOf(Date);
			expect(dailyAgg.lastMessage).toBeInstanceOf(Date);
		});
	});

	describe("Resource Pressure", () => {
		it("aggregateUsage with 1000 records across 100 sessions", () => {
			const records: TokenUsage[] = [];
			for (let i = 0; i < 1000; i++) {
				records.push(
					makeRecord({
						sessionId: `session-${i % 100}`,
						timestamp: new Date(Date.UTC(2026, 0, 1 + (i % 30), i % 24)),
						inputTokens: i * 10,
					}),
				);
			}
			const buckets = aggregateUsage(records);
			expect(buckets.session.size).toBe(100);
			expect(buckets.daily.size).toBeGreaterThan(1);
		}, 5000);
	});
});

// ============================================================
// PRICING ENGINE MODULE (calculateCost only — no vscode dep)
// ============================================================

describe("BREAKIT: pricingEngine (calculateCost)", () => {
	// We can't import loadPricingFromConfig (vscode dep), but calculateCost is testable
	const { calculateCost, getDefaultPricing } = jest.requireActual(
		"./pricing/pricingEngine",
	) as any;

	jest.mock(
		"vscode",
		() => ({
			workspace: {
				getConfiguration: () => ({
					get: () => undefined,
				}),
			},
			window: {
				createOutputChannel: () => ({
					appendLine: () => {},
					show: () => {},
					dispose: () => {},
				}),
			},
		}),
		{ virtual: true },
	);

	const pricing = (() => {
		try {
			return getDefaultPricing();
		} catch {
			return {
				"claude-sonnet-4-5": {
					inputPerMillion: 3.0,
					outputPerMillion: 15.0,
					cache5mWriteMultiplier: 1.25,
					cache1hWriteMultiplier: 2.0,
					cacheReadMultiplier: 0.1,
				},
			};
		}
	})();

	const makeUsage = (overrides: Partial<TokenUsage> = {}): TokenUsage => ({
		timestamp: new Date("2026-01-15T10:00:00Z"),
		model: "claude-sonnet-4-5",
		sessionId: "test",
		inputTokens: 1000,
		outputTokens: 500,
		cacheCreationTokens: 0,
		cacheReadTokens: 0,
		cacheCreation5m: 0,
		cacheCreation1h: 0,
		cost: 0,
		...overrides,
	});

	describe("Boundary Assault", () => {
		it("calculateCost with all zero tokens", () => {
			const usage = makeUsage({
				inputTokens: 0,
				outputTokens: 0,
				cacheCreationTokens: 0,
				cacheReadTokens: 0,
			});
			expect(calculateCost(usage, pricing)).toBe(0);
		});

		it("calculateCost with unknown model falls back", () => {
			const usage = makeUsage({ model: "unknown-model-xyz" });
			const cost = calculateCost(usage, pricing);
			expect(typeof cost).toBe("number");
			expect(cost).toBeGreaterThanOrEqual(0);
		});

		it("calculateCost with MAX_SAFE_INTEGER input tokens", () => {
			const usage = makeUsage({ inputTokens: Number.MAX_SAFE_INTEGER });
			const cost = calculateCost(usage, pricing);
			expect(Number.isFinite(cost)).toBe(true);
			expect(cost).toBeGreaterThan(0);
		});
	});

	describe("Mutation Detectors", () => {
		it("calculateCost: cache5m uses cache5mWriteMultiplier not cache1hWriteMultiplier", () => {
			const usage5m = makeUsage({
				inputTokens: 0,
				outputTokens: 0,
				cacheCreation5m: 1_000_000,
				cacheCreation1h: 0,
			});
			const usage1h = makeUsage({
				inputTokens: 0,
				outputTokens: 0,
				cacheCreation5m: 0,
				cacheCreation1h: 1_000_000,
			});
			const cost5m = calculateCost(usage5m, pricing);
			const cost1h = calculateCost(usage1h, pricing);
			// 1h multiplier (2.0) is higher than 5m multiplier (1.25)
			expect(cost1h).toBeGreaterThan(cost5m);
		});

		it("calculateCost: cacheReadTokens cost uses cacheReadMultiplier", () => {
			const usageWithCache = makeUsage({
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 1_000_000,
			});
			const cost = calculateCost(usageWithCache, pricing);
			// 1M * 3.0 (sonnet input) * 0.1 (read multiplier) = $0.30
			expect(cost).toBeCloseTo(0.3, 1);
		});

		it("calculateCost: output cost uses outputPerMillion not inputPerMillion", () => {
			const inputOnly = makeUsage({
				inputTokens: 1_000_000,
				outputTokens: 0,
			});
			const outputOnly = makeUsage({
				inputTokens: 0,
				outputTokens: 1_000_000,
			});
			const inputCost = calculateCost(inputOnly, pricing);
			const outputCost = calculateCost(outputOnly, pricing);
			// Output is 5x more expensive than input for sonnet ($15 vs $3)
			expect(outputCost).toBeGreaterThan(inputCost);
			expect(outputCost / inputCost).toBeCloseTo(5.0, 0);
		});
	});

	describe("Property Violations", () => {
		it("calculateCost is additive: cost(a+b tokens) ~= cost(a) + cost(b)", () => {
			const usageA = makeUsage({ inputTokens: 500, outputTokens: 200 });
			const usageB = makeUsage({ inputTokens: 300, outputTokens: 100 });
			const usageCombined = makeUsage({ inputTokens: 800, outputTokens: 300 });

			const costA = calculateCost(usageA, pricing);
			const costB = calculateCost(usageB, pricing);
			const costCombined = calculateCost(usageCombined, pricing);

			expect(costA + costB).toBeCloseTo(costCombined, 10);
		});
	});
});

// ============================================================
// ESCALATION: Harder variants targeting surviving functions
// ============================================================

describe("ESCALATION: formatting", () => {
	it("formatTokens with Number.EPSILON", () => {
		const result = formatTokens(Number.EPSILON);
		expect(result).toBeDefined();
		expect(result).not.toContain("NaN");
	});

	it("formatTokens with Number.MIN_VALUE", () => {
		const result = formatTokens(Number.MIN_VALUE);
		expect(result).toBeDefined();
	});

	it("formatCost with IEEE 754 precision trap: 0.1 + 0.2", () => {
		const cost = 0.1 + 0.2; // 0.30000000000000004
		const result = formatCost(cost);
		expect(result).toBe("$0.30");
	});

	it("formatBarGraph with fractional percentage produces valid bar", () => {
		const result = formatBarGraph(33.333);
		expect(result).toContain("%");
		expect(result).not.toContain("NaN");
	});

	it("formatCooldown with date exactly now", () => {
		const now = new Date();
		const result = formatCooldown(now);
		expect(result).toBe("Ready");
	});

	it("formatCooldownCompact with date exactly now", () => {
		const now = new Date();
		const result = formatCooldownCompact(now);
		expect(result).toBe("0m");
	});

	it("formatCooldownCompact with date 24h from now", () => {
		const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
		const result = formatCooldownCompact(future);
		expect(result).toContain("d");
	});

	it("formatTimeUntilLimit with very large minutes (999999)", () => {
		const result = formatTimeUntilLimit(999999);
		expect(result).toContain("h");
		expect(result).not.toContain("NaN");
	});

	it("formatBurnRate with exactly 1000 tokens/min", () => {
		const result = formatBurnRate(1000);
		expect(result).toBe("1.0K/min");
	});

	it("formatBurnRate with 999 tokens/min (just below K threshold)", () => {
		const result = formatBurnRate(999);
		expect(result).toBe("999/min");
	});

	it("formatTokensExact with MAX_SAFE_INTEGER", () => {
		const result = formatTokensExact(Number.MAX_SAFE_INTEGER);
		expect(result).toBeDefined();
		expect(result.length).toBeGreaterThan(0);
	});

	it("formatTokensExact with 0", () => {
		expect(formatTokensExact(0)).toBe("0");
	});
});

describe("ESCALATION: burnRate combined boundaries", () => {
	it("predictTimeUntilLimit with currentTokens=0, huge limit, tiny burn rate", () => {
		const result = predictTimeUntilLimit(0, 999_999_999, 0.001);
		expect(result).toBe(999999); // should cap
	});

	it("predictTimeUntilLimit with limit exactly 1 token away", () => {
		const result = predictTimeUntilLimit(999, 1000, 100);
		expect(result).not.toBeNull();
		expect(result!).toBeCloseTo(0.01, 2);
	});

	it("calculateBurnRateEMA with alpha=0 ignores new data entirely", () => {
		const buckets: TimeBuckets = {
			session: new Map([
				[
					"s1",
					{
						inputTokens: 0,
						outputTokens: 10000,
						cacheCreationTokens: 0,
						cacheReadTokens: 0,
						totalCost: 0,
						messageCount: 5,
						firstMessage: new Date(Date.now() - 60000),
						lastMessage: new Date(),
					},
				],
			]),
			daily: new Map(),
			weekly: new Map(),
			monthly: new Map(),
			modelWeekly: new Map(),
			hourly: new Map(),
		};
		const tracker = createBurnRateTracker(0); // alpha=0 means only old EMA matters
		const { rate } = calculateBurnRateEMA(buckets, tracker, 300);
		// With alpha=0, newEma = 0 * currentRate + 1 * oldEma(0) = 0
		expect(rate).toBe(0);
	});

	it("calculateBurnRateEMA with alpha=1 completely replaces old EMA", () => {
		const now = Date.now();
		const buckets: TimeBuckets = {
			session: new Map([
				[
					"s1",
					{
						inputTokens: 0,
						outputTokens: 6000,
						cacheCreationTokens: 0,
						cacheReadTokens: 0,
						totalCost: 0,
						messageCount: 5,
						firstMessage: new Date(now - 120000),
						lastMessage: new Date(now),
					},
				],
			]),
			daily: new Map(),
			weekly: new Map(),
			monthly: new Map(),
			modelWeekly: new Map(),
			hourly: new Map(),
		};
		const tracker = createBurnRateTracker(1);
		tracker.ema = 9999; // old EMA
		const { rate, tracker: newTracker } = calculateBurnRateEMA(
			buckets,
			tracker,
			300,
		);
		// With alpha=1, newEma = 1 * currentRate + 0 * oldEma
		// Old EMA of 9999 should be completely ignored
		expect(newTracker.ema).not.toBe(9999);
		expect(rate).toBeGreaterThan(0);
	});
});

describe("ESCALATION: timeBuckets deep stress", () => {
	const makeRecord = (overrides: Partial<TokenUsage> = {}): TokenUsage => ({
		timestamp: new Date("2026-01-15T10:00:00Z"),
		model: "claude-sonnet-4-5",
		sessionId: "session-1",
		inputTokens: 1000,
		outputTokens: 500,
		cacheCreationTokens: 200,
		cacheReadTokens: 300,
		cacheCreation5m: 100,
		cacheCreation1h: 100,
		cost: 0.05,
		...overrides,
	});

	it("serialize/deserialize roundtrip with null timestamps", () => {
		const buckets: TimeBuckets = {
			session: new Map(),
			daily: new Map([
				[
					"2026-01-15",
					{
						inputTokens: 0,
						outputTokens: 0,
						cacheCreationTokens: 0,
						cacheReadTokens: 0,
						totalCost: 0,
						messageCount: 0,
						firstMessage: null,
						lastMessage: null,
					},
				],
			]),
			weekly: new Map(),
			monthly: new Map(),
			modelWeekly: new Map(),
			hourly: new Map(),
		};
		const serialized = serializeTimeBuckets(buckets);
		const deserialized = deserializeTimeBuckets(serialized);
		const dailyAgg = deserialized.daily.get("2026-01-15")!;
		expect(dailyAgg.firstMessage).toBeNull();
		expect(dailyAgg.lastMessage).toBeNull();
	});

	it("mergeTimeBuckets with overlapping session keys sums correctly", () => {
		const r1 = [
			makeRecord({ sessionId: "shared", inputTokens: 100, outputTokens: 50 }),
		];
		const r2 = [
			makeRecord({ sessionId: "shared", inputTokens: 200, outputTokens: 75 }),
		];
		const a = aggregateUsage(r1);
		const b = aggregateUsage(r2);
		const merged = mergeTimeBuckets(a, b);
		const session = merged.session.get("shared")!;
		expect(session.inputTokens).toBe(300);
		expect(session.outputTokens).toBe(125);
		expect(session.messageCount).toBe(2);
	});

	it("aggregateUsage generates correct hourly keys", () => {
		const records = [
			makeRecord({ timestamp: new Date("2026-03-15T14:30:00Z") }),
			makeRecord({ timestamp: new Date("2026-03-15T14:59:00Z") }),
			makeRecord({ timestamp: new Date("2026-03-15T15:01:00Z") }),
		];
		const buckets = aggregateUsage(records);
		// First two should share an hourly bucket, third is different
		expect(buckets.hourly.size).toBe(2);
	});

	it("aggregateUsage generates correct modelWeekly keys", () => {
		const records = [
			makeRecord({ model: "claude-sonnet-4-5" }),
			makeRecord({ model: "claude-opus-4-6" }),
		];
		const buckets = aggregateUsage(records);
		expect(buckets.modelWeekly.size).toBe(2);
		// Both keys should contain the week prefix
		for (const key of buckets.modelWeekly.keys()) {
			expect(key).toContain(":");
		}
	});

	it("getTimeBucketSummary cost matches sum of daily costs", () => {
		const records = [
			makeRecord({
				timestamp: new Date("2026-01-15T10:00:00Z"),
				cost: 0.1,
			}),
			makeRecord({
				timestamp: new Date("2026-01-16T10:00:00Z"),
				cost: 0.2,
			}),
		];
		const buckets = aggregateUsage(records);
		const summary = getTimeBucketSummary(buckets);
		expect(summary.totalCost).toBeCloseTo(0.3, 10);
		expect(summary.totalDays).toBe(2);
		expect(summary.totalMessages).toBe(2);
	});
});

describe("ESCALATION: rateLimitDetector edge cases", () => {
	it("refineLimitEstimate with very large numbers", () => {
		const result = refineLimitEstimate(
			Number.MAX_SAFE_INTEGER,
			Number.MAX_SAFE_INTEGER,
		);
		expect(Number.isFinite(result)).toBe(true);
		expect(result).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
	});

	it("refineLimitEstimate repeated calls converge downward", () => {
		let estimate = 10000;
		const observations = [9000, 8500, 8200];
		for (const obs of observations) {
			estimate = refineLimitEstimate(estimate, obs);
		}
		// Should be lowest observation * 0.95
		expect(estimate).toBe(Math.floor(8200 * 0.95));
	});

	it("parseRateLimitEvent with message containing multiple keywords picks first match", () => {
		const line = JSON.stringify({
			type: "error",
			timestamp: "2026-01-01T00:00:00Z",
			error: {
				type: "rate_limit_error",
				message: "daily per-minute RPM session limit exceeded weekly",
			},
		});
		const result = parseRateLimitEvent(line);
		expect(result).not.toBeNull();
		// "daily" appears first in the message AND in the code checks
		// Code checks "daily || weekly" first, then "per-minute || rpm || session"
		expect(result!.limitType).toBe("weekly");
	});
});

describe("ESCALATION: pricingEngine edge cases", () => {
	const { calculateCost, getDefaultPricing } = jest.requireActual(
		"./pricing/pricingEngine",
	) as any;

	const pricing = (() => {
		try {
			return getDefaultPricing();
		} catch {
			return {
				"claude-sonnet-4-5": {
					inputPerMillion: 3.0,
					outputPerMillion: 15.0,
					cache5mWriteMultiplier: 1.25,
					cache1hWriteMultiplier: 2.0,
					cacheReadMultiplier: 0.1,
				},
			};
		}
	})();

	const makeUsage = (overrides: Partial<TokenUsage> = {}): TokenUsage => ({
		timestamp: new Date("2026-01-15T10:00:00Z"),
		model: "claude-sonnet-4-5",
		sessionId: "test",
		inputTokens: 1000,
		outputTokens: 500,
		cacheCreationTokens: 0,
		cacheReadTokens: 0,
		cacheCreation5m: 0,
		cacheCreation1h: 0,
		cost: 0,
		...overrides,
	});

	it("calculateCost with cacheCreationTokens fallback (no 5m/1h breakdown)", () => {
		const usage = makeUsage({
			inputTokens: 0,
			outputTokens: 0,
			cacheCreationTokens: 1_000_000,
			cacheCreation5m: 0,
			cacheCreation1h: 0,
		});
		const cost = calculateCost(usage, pricing);
		// Should use cacheCreationTokens with 5m multiplier as default
		// 1M * 3.0 * 1.25 = $3.75
		expect(cost).toBeCloseTo(3.75, 1);
	});

	it("calculateCost with both breakdown and legacy field uses breakdown only", () => {
		const usage = makeUsage({
			inputTokens: 0,
			outputTokens: 0,
			cacheCreationTokens: 5_000_000, // legacy total
			cacheCreation5m: 1_000_000, // breakdown present
			cacheCreation1h: 0,
		});
		const cost = calculateCost(usage, pricing);
		// When breakdown is present (5m or 1h > 0), legacy field is ignored
		// 1M * 3.0 * 1.25 = $3.75
		expect(cost).toBeCloseTo(3.75, 1);
	});

	it("calculateCost: each model has different pricing", () => {
		const usage = makeUsage({
			inputTokens: 1_000_000,
			outputTokens: 1_000_000,
		});
		const sonnetCost = calculateCost(
			{ ...usage, model: "claude-sonnet-4-5" },
			pricing,
		);
		const opusCost = calculateCost(
			{ ...usage, model: "claude-opus-4-6" },
			pricing,
		);
		expect(opusCost).toBeGreaterThan(sonnetCost);
	});
});
