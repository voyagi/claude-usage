import {
	detectTierFromCredentials,
	parseCredentialsFile,
} from "./tierDetection";

describe("Tier Detection", () => {
	describe("parseCredentialsFile", () => {
		it("should parse valid JSON credentials", () => {
			const content = '{"rateLimitTier":"default_claude_max_5x"}';
			const result = parseCredentialsFile(content);
			expect(result).toEqual({ rateLimitTier: "default_claude_max_5x" });
		});

		it("should return null for invalid JSON", () => {
			const content = "invalid json";
			const result = parseCredentialsFile(content);
			expect(result).toBeNull();
		});

		it("should parse empty object", () => {
			const content = "{}";
			const result = parseCredentialsFile(content);
			expect(result).toEqual({});
		});

		it("should extract both rateLimitTier and subscriptionType", () => {
			const content =
				'{"rateLimitTier":"default_claude_max_5x","subscriptionType":"pro"}';
			const result = parseCredentialsFile(content);
			expect(result).toEqual({
				rateLimitTier: "default_claude_max_5x",
				subscriptionType: "pro",
			});
		});
	});

	describe("detectTierFromCredentials", () => {
		it("should return fallback for null credentials", () => {
			const result = detectTierFromCredentials(null, "max5");
			expect(result).toBe("max5");
		});

		it("should return fallback for empty credentials", () => {
			const result = detectTierFromCredentials({}, "max5");
			expect(result).toBe("max5");
		});

		it("should detect max5 from rateLimitTier", () => {
			const result = detectTierFromCredentials(
				{ rateLimitTier: "default_claude_max_5x" },
				"pro",
			);
			expect(result).toBe("max5");
		});

		it("should detect max20 from rateLimitTier", () => {
			const result = detectTierFromCredentials(
				{ rateLimitTier: "default_claude_max_20x" },
				"pro",
			);
			expect(result).toBe("max20");
		});

		it("should detect pro from subscriptionType", () => {
			const result = detectTierFromCredentials(
				{ subscriptionType: "pro" },
				"max5",
			);
			expect(result).toBe("pro");
		});

		it("should return fallback for unknown rateLimitTier", () => {
			const result = detectTierFromCredentials(
				{ rateLimitTier: "unknown_tier" },
				"max5",
			);
			expect(result).toBe("max5");
		});

		it("should handle case-insensitive matching for max_5", () => {
			const result = detectTierFromCredentials(
				{ rateLimitTier: "DEFAULT_CLAUDE_MAX_5X" },
				"pro",
			);
			expect(result).toBe("max5");
		});

		it("should handle case-insensitive matching for max_20", () => {
			const result = detectTierFromCredentials(
				{ rateLimitTier: "default_CLAUDE_max_20X" },
				"pro",
			);
			expect(result).toBe("max20");
		});
	});
});
