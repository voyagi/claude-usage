import { parseRateLimitEvent, refineLimitEstimate } from "./rateLimitDetector";

describe("Rate Limit Detector", () => {
	describe("parseRateLimitEvent", () => {
		it("should parse weekly limit error", () => {
			const line = JSON.stringify({
				type: "error",
				timestamp: "2026-05-12T10:00:00Z",
				error: {
					type: "rate_limit_error",
					message: "You have exceeded your weekly token limit for this model.",
				},
			});

			const result = parseRateLimitEvent(line);

			expect(result).not.toBeNull();
			expect(result!.limitType).toBe("weekly");
			expect(result!.timestamp).toEqual(new Date("2026-05-12T10:00:00Z"));
			expect(result!.errorMessage).toContain("weekly");
		});

		it("should parse daily limit as weekly type", () => {
			const line = JSON.stringify({
				type: "error",
				timestamp: "2026-05-12T11:00:00Z",
				error: {
					type: "rate_limit_error",
					message: "Daily usage limit reached. Please try again tomorrow.",
				},
			});

			const result = parseRateLimitEvent(line);

			expect(result).not.toBeNull();
			expect(result!.limitType).toBe("weekly");
		});

		it("should parse session/rpm limit error", () => {
			const line = JSON.stringify({
				type: "error",
				timestamp: "2026-05-12T12:00:00Z",
				error: {
					type: "rate_limit_error",
					message: "Rate limit exceeded: too many requests per-minute.",
				},
			});

			const result = parseRateLimitEvent(line);

			expect(result).not.toBeNull();
			expect(result!.limitType).toBe("session");
		});

		it("should parse rpm variant as session type", () => {
			const line = JSON.stringify({
				type: "error",
				timestamp: "2026-05-12T12:30:00Z",
				error: {
					type: "rate_limit_error",
					message: "You have exceeded the rpm limit for your plan.",
				},
			});

			const result = parseRateLimitEvent(line);

			expect(result).not.toBeNull();
			expect(result!.limitType).toBe("session");
		});

		it("should return null for non-error type", () => {
			const line = JSON.stringify({
				type: "assistant",
				timestamp: "2026-05-12T10:00:00Z",
				message: {
					model: "claude-sonnet-4-20250514",
					usage: { input_tokens: 100, output_tokens: 50 },
				},
			});

			expect(parseRateLimitEvent(line)).toBeNull();
		});

		it("should return null for non-rate-limit error", () => {
			const line = JSON.stringify({
				type: "error",
				timestamp: "2026-05-12T10:00:00Z",
				error: {
					type: "overloaded_error",
					message: "Server is temporarily overloaded.",
				},
			});

			expect(parseRateLimitEvent(line)).toBeNull();
		});

		it("should return null for invalid JSON", () => {
			expect(parseRateLimitEvent("{not valid json")).toBeNull();
		});

		it("should return null for empty string", () => {
			expect(parseRateLimitEvent("")).toBeNull();
		});
	});

	describe("refineLimitEstimate", () => {
		it("should adjust downward with 5% margin", () => {
			// observedUsage=1000, floor(1000 * 0.95) = 950
			// min(2000, 950) = 950
			const result = refineLimitEstimate(2000, 1000);
			expect(result).toBe(950);
		});

		it("should never adjust upward", () => {
			// observedUsage=5000, floor(5000 * 0.95) = 4750
			// min(2000, 4750) = 2000 (current estimate wins)
			const result = refineLimitEstimate(2000, 5000);
			expect(result).toBe(2000);
		});

		it("should return unchanged for observedUsage <= 0", () => {
			expect(refineLimitEstimate(2000, 0)).toBe(2000);
			expect(refineLimitEstimate(2000, -100)).toBe(2000);
		});

		it("should adjust when observed is above current estimate", () => {
			// observedUsage=3000, floor(3000 * 0.95) = 2850
			// min(2000, 2850) = 2000 (current estimate is already lower)
			const result = refineLimitEstimate(2000, 3000);
			expect(result).toBe(2000);
		});

		it("should adjust when observed is just below current estimate", () => {
			// observedUsage=1900, floor(1900 * 0.95) = 1805
			// min(2000, 1805) = 1805
			const result = refineLimitEstimate(2000, 1900);
			expect(result).toBe(1805);
		});

		it("should floor the result (no fractional tokens)", () => {
			// observedUsage=101, floor(101 * 0.95) = floor(95.95) = 95
			const result = refineLimitEstimate(500, 101);
			expect(result).toBe(95);
			expect(Number.isInteger(result)).toBe(true);
		});
	});
});
