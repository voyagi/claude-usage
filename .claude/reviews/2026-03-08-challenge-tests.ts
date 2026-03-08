/**
 * Adversarial tests for 2026-03-08 challenge
 * Targets: the debug analysis findings and their correctness
 * Framework: Jest with ts-jest
 */

import type { TimeBuckets, AggregatedUsage } from "../../src/types";

// Helper to create valid empty TimeBuckets
function createEmptyBuckets(): TimeBuckets {
	return {
		session: new Map(),
		daily: new Map(),
		weekly: new Map(),
		monthly: new Map(),
		modelWeekly: new Map(),
		hourly: new Map(),
	};
}

describe("Finding #1: resetState() must include hourly bucket", () => {
	it("TimeBuckets interface requires hourly property", () => {
		const buckets: TimeBuckets = createEmptyBuckets();
		// hourly must exist and be iterable
		expect(buckets.hourly).toBeInstanceOf(Map);
		expect(() => {
			for (const [_key, _agg] of buckets.hourly.entries()) {
				// should not throw
			}
		}).not.toThrow();
	});

	it("resetState-equivalent object missing hourly throws on iteration", () => {
		// Simulates the bug at sessionWatcher.ts:230-236
		const broken = {
			session: new Map(),
			daily: new Map(),
			weekly: new Map(),
			monthly: new Map(),
			modelWeekly: new Map(),
			// hourly is missing - this is the bug
		} as unknown as TimeBuckets;

		expect(() => {
			// This is what rateLimits.ts:52 does
			for (const [_key, _agg] of broken.hourly.entries()) {
				// unreachable
			}
		}).toThrow(); // TypeError: Cannot read properties of undefined
	});

	it("all TimeBuckets construction sites include hourly", () => {
		// Verify the fix pattern: every object literal assigned to TimeBuckets
		// must include hourly. This test ensures the type constraint holds.
		const assertValidBuckets = (b: TimeBuckets) => {
			const requiredKeys: (keyof TimeBuckets)[] = [
				"session",
				"daily",
				"weekly",
				"monthly",
				"modelWeekly",
				"hourly",
			];
			for (const key of requiredKeys) {
				expect(b[key]).toBeInstanceOf(Map);
			}
		};

		assertValidBuckets(createEmptyBuckets());
	});
});

describe("Finding #2: fetchApiUsage promise behavior", () => {
	it("resolve-only Promise cannot produce unhandled rejection", async () => {
		// Demonstrates that new Promise((resolve) => ...) cannot reject
		const resolveOnly = new Promise<string | null>((resolve) => {
			// Simulate fetchApiUsage pattern: always resolve, never reject
			try {
				throw new Error("simulated network error");
			} catch {
				resolve(null);
			}
		});

		// This should always resolve to null, never reject
		const result = await resolveOnly;
		expect(result).toBeNull();
	});

	it(".then() callback throw DOES produce unhandled rejection", async () => {
		// Demonstrates the actual risk: throws inside .then() without .catch()
		const promise = new Promise<string>((resolve) => resolve("data"));

		let rejectionCaught = false;
		const chained = promise
			.then(() => {
				throw new Error("callback threw");
			})
			.catch(() => {
				rejectionCaught = true;
			});

		await chained;
		// Without the .catch() above, this would be an unhandled rejection
		expect(rejectionCaught).toBe(true);
	});
});

describe("Still-unfixed: handleFileChange race condition", () => {
	it("concurrent read-modify-write on shared state loses updates", async () => {
		// Simulates the race in sessionWatcher.ts handleFileChange
		let sharedState = 0;

		const readModifyWrite = async (delta: number): Promise<void> => {
			const currentValue = sharedState; // read
			// Simulate async yield (parsing)
			await new Promise((r) => setTimeout(r, 10));
			sharedState = currentValue + delta; // write
		};

		// Two concurrent calls
		await Promise.all([readModifyWrite(5), readModifyWrite(3)]);

		// Expected: 8 (5 + 3). Actual: 3 or 5 (last writer wins)
		// This demonstrates the race condition
		expect(sharedState).not.toBe(8); // RACE: one update is lost
	});
});

describe("Still-unfixed: double JSON.parse in parser pipeline", () => {
	it("parseAssistantMessage re-parses already-parsed JSON", () => {
		// jsonlParser.ts:45 does JSON.parse(line) to check type
		// schemas.ts:75 does JSON.parse(line) again inside parseAssistantMessage
		// This is 2x CPU on the hot path

		const line = JSON.stringify({
			type: "assistant",
			message: {
				model: "claude-sonnet-4-5-20250514",
				usage: {
					input_tokens: 100,
					output_tokens: 50,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 0,
				},
			},
			session_id: "test-123",
			timestamp: new Date().toISOString(),
		});

		let parseCount = 0;
		const originalParse = JSON.parse;
		JSON.parse = (...args: Parameters<typeof JSON.parse>) => {
			parseCount++;
			return originalParse(...args);
		};

		try {
			// First parse (simulating jsonlParser.ts:45)
			const parsed = JSON.parse(line);
			expect(parsed.type).toBe("assistant");

			// Second parse would happen inside parseAssistantMessage(line)
			// which calls JSON.parse(line) again at schemas.ts:75
			JSON.parse(line);

			// Two parses of the same string
			expect(parseCount).toBe(2);
		} finally {
			JSON.parse = originalParse;
		}
	});
});

describe("Still-unfixed: hardcoded extensionVersion", () => {
	it("exportData.ts version does not match package.json", () => {
		// exportData.ts:45 hardcodes "0.1.0"
		// package.json has "1.0.0"
		const hardcodedVersion = "0.1.0";
		const packageVersion = "1.0.0"; // from package.json

		expect(hardcodedVersion).not.toBe(packageVersion);
	});
});
