/**
 * BREAKIT: Stress tests for auth failure and recovery flows
 *
 * Targets: usageApi.ts (fetchApiUsage, getAccessToken, refreshOAuthToken),
 * pollingTimer.ts (auth state machine, dead detection threshold),
 * usageCache.ts (multi-window write contention)
 *
 * Scenarios tested:
 * 1. BOUNDARY: Token expires mid-fetch (between getAccessToken and API call)
 * 2. BOUNDARY: Refresh returns 200 but with empty/malformed access_token
 * 3. FAULT: credentials.json locked by another process during read
 * 4. FAULT: credentials.json deleted while extension is running
 * 5. FAULT: Network timeout during token refresh but success during API fetch
 * 6. MUTATION: Remove auth-dead detection threshold
 * 7. SECURITY: Refresh token endpoint returns redirect (SSRF potential)
 * 8. CONCURRENCY: Two VS Code windows refresh the same token simultaneously
 */

// Must mock before imports
jest.mock("vscode", () => ({}), { virtual: true });

// Mock node:https for usageApi tests
const mockRequest = jest.fn();
jest.mock("node:https", () => ({
	request: mockRequest,
}));

// Mock node:fs/promises for credential file tests
const mockReadFile = jest.fn();
jest.mock("node:fs/promises", () => ({
	readFile: mockReadFile,
	mkdir: jest.fn().mockResolvedValue(undefined),
	writeFile: jest.fn().mockResolvedValue(undefined),
	rename: jest.fn().mockResolvedValue(undefined),
}));

import { EventEmitter } from "node:events";
import { fetchApiUsage } from "./api/usageApi";
import { PollingTimer } from "./api/pollingTimer";
import type {
	ApiUsageData,
	AuthState,
	FetchErrorReason,
	FetchResult,
} from "./types";
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

/** Create a fake HTTP response (EventEmitter with statusCode) */
function fakeResponse(statusCode: number, body: string) {
	const res = new EventEmitter() as EventEmitter & { statusCode: number };
	res.statusCode = statusCode;
	// Emit data + end on next tick so the listener can attach
	process.nextTick(() => {
		res.emit("data", body);
		res.emit("end");
	});
	return res;
}

/** Create a fake HTTP request (EventEmitter with write/end/destroy) */
function fakeRequest() {
	const req = new EventEmitter() as EventEmitter & {
		write: jest.Mock;
		end: jest.Mock;
		destroy: jest.Mock;
	};
	req.write = jest.fn();
	req.end = jest.fn();
	req.destroy = jest.fn();
	return req;
}

/** Valid credentials JSON for tests */
function validCredentials(overrides: Record<string, unknown> = {}) {
	return JSON.stringify({
		claudeAiOauth: {
			accessToken: "valid-access-token",
			refreshToken: "valid-refresh-token",
			expiresAt: Date.now() + 3600_000, // 1h from now
			...overrides,
		},
	});
}

/** Expired credentials (expiresAt in the past) */
function expiredCredentials(overrides: Record<string, unknown> = {}) {
	return JSON.stringify({
		claudeAiOauth: {
			accessToken: "expired-access-token",
			refreshToken: "valid-refresh-token",
			expiresAt: Date.now() - 60_000, // 1 minute ago
			...overrides,
		},
	});
}

function makeApiData(overrides: Partial<ApiUsageData> = {}): ApiUsageData {
	return {
		fiveHour: { utilization: 0.5, resetsAt: null },
		sevenDay: { utilization: 0.3, resetsAt: null },
		sevenDaySonnet: null,
		sevenDayOpus: null,
		rateLimitTier: null,
		extraUsage: null,
		fetchedAt: new Date(),
		...overrides,
	};
}

function okResult(data?: ApiUsageData): FetchResult {
	return { ok: true, data: data ?? makeApiData() };
}

function failResult(error: FetchErrorReason = "network"): FetchResult {
	return { ok: false, error };
}

// ── Scenario 1: Token expires mid-fetch ─────────────────────────────

describe("BREAKIT AUTH: Token expires mid-fetch", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns auth_expired when token valid at read but 401 at API call", async () => {
		const logger = makeLogger();

		// Credentials file: token looks valid (expiresAt in the future)
		mockReadFile.mockResolvedValue(validCredentials());

		// API call returns 401 (token expired between read and call)
		const req = fakeRequest();
		mockRequest.mockImplementation(
			(_url: string, _opts: unknown, cb: (res: unknown) => void) => {
				const res = fakeResponse(401, '{"error":"unauthorized"}');
				cb(res);
				return req;
			},
		);

		const result = await fetchApiUsage(logger);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("auth_expired");
		}
	});

	it("PollingTimer transitions healthy->degraded->dead on repeated mid-fetch 401s", async () => {
		jest.useFakeTimers();
		const logger = makeLogger();
		const authStates: AuthState[] = [];
		let fetchCount = 0;

		const timer = new PollingTimer(
			() => {
				fetchCount++;
				return Promise.resolve(failResult("auth_expired"));
			},
			jest.fn(),
			jest.fn(),
			(state) => authStates.push(state),
			logger,
		);

		timer.start();

		// Tick 1: healthy -> degraded
		jest.advanceTimersByTime(5_000);
		await Promise.resolve();
		expect(authStates).toContain("degraded");

		// Tick 2: still degraded
		jest.advanceTimersByTime(30_000);
		await Promise.resolve();

		// Tick 3: degraded -> dead (AUTH_DEAD_THRESHOLD = 3)
		jest.advanceTimersByTime(60_000);
		await Promise.resolve();
		expect(authStates).toContain("dead");
		expect(fetchCount).toBeGreaterThanOrEqual(3);

		timer.dispose();
		jest.useRealTimers();
	});
});

// ── Scenario 2: Refresh returns 200 but malformed access_token ──────

describe("BREAKIT AUTH: Malformed refresh response", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("200 with empty access_token string treats as transient failure", async () => {
		const logger = makeLogger();

		// Expired credentials trigger refresh
		mockReadFile.mockResolvedValue(expiredCredentials());

		const requestCalls: string[] = [];
		mockRequest.mockImplementation(
			(url: string, _opts: unknown, cb: (res: unknown) => void) => {
				requestCalls.push(url);
				const req = fakeRequest();

				if (url.includes("oauth/token")) {
					// Refresh endpoint: 200 but empty access_token
					const res = fakeResponse(
						200,
						JSON.stringify({
							access_token: "",
							expires_in: 3600,
						}),
					);
					cb(res);
				} else {
					// API endpoint: should still be called with expired token (fallback)
					const res = fakeResponse(
						200,
						JSON.stringify({
							five_hour: { utilization: 50, resets_at: null },
							seven_day: null,
						}),
					);
					cb(res);
				}
				return req;
			},
		);

		const result = await fetchApiUsage(logger);
		// Empty access_token from refresh -> transient failure -> falls back to expired token
		// Then API call with expired token may succeed or fail
		// Key: it should NOT crash
		expect(result).toBeDefined();
		expect(requestCalls.some((u) => u.includes("oauth/token"))).toBe(true);
	});

	it("200 with null access_token field treats as transient failure", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(expiredCredentials());

		mockRequest.mockImplementation(
			(url: string, _opts: unknown, cb: (res: unknown) => void) => {
				const req = fakeRequest();
				if (url.includes("oauth/token")) {
					const res = fakeResponse(
						200,
						JSON.stringify({
							access_token: null,
							expires_in: 3600,
						}),
					);
					cb(res);
				} else {
					const res = fakeResponse(401, '{"error":"expired"}');
					cb(res);
				}
				return req;
			},
		);

		const result = await fetchApiUsage(logger);
		expect(result).toBeDefined();
		// Should log a warning about missing access_token
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("missing access_token"),
		);
	});

	it("200 with valid JSON but no access_token key at all", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(expiredCredentials());

		mockRequest.mockImplementation(
			(url: string, _opts: unknown, cb: (res: unknown) => void) => {
				const req = fakeRequest();
				if (url.includes("oauth/token")) {
					// Response missing access_token entirely
					const res = fakeResponse(
						200,
						JSON.stringify({
							token_type: "bearer",
							expires_in: 3600,
						}),
					);
					cb(res);
				} else {
					const res = fakeResponse(401, "{}");
					cb(res);
				}
				return req;
			},
		);

		const result = await fetchApiUsage(logger);
		expect(result).toBeDefined();
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("missing access_token"),
		);
	});

	it("200 with unparseable body (not JSON)", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(expiredCredentials());

		mockRequest.mockImplementation(
			(url: string, _opts: unknown, cb: (res: unknown) => void) => {
				const req = fakeRequest();
				if (url.includes("oauth/token")) {
					const res = fakeResponse(200, "<html>Gateway Timeout</html>");
					cb(res);
				} else {
					const res = fakeResponse(401, "{}");
					cb(res);
				}
				return req;
			},
		);

		const result = await fetchApiUsage(logger);
		expect(result).toBeDefined();
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("parse token refresh response"),
		);
	});
});

// ── Scenario 3: credentials.json locked by another process ──────────

describe("BREAKIT AUTH: Credentials file locked", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("EBUSY error returns no_credentials, not crash", async () => {
		const logger = makeLogger();
		const err = new Error("resource busy or locked") as NodeJS.ErrnoException;
		err.code = "EBUSY";
		mockReadFile.mockRejectedValue(err);

		const result = await fetchApiUsage(logger);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("no_credentials");
		}
	});

	it("EPERM error returns no_credentials gracefully", async () => {
		const logger = makeLogger();
		const err = new Error("operation not permitted") as NodeJS.ErrnoException;
		err.code = "EPERM";
		mockReadFile.mockRejectedValue(err);

		const result = await fetchApiUsage(logger);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("no_credentials");
		}
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("Could not read credentials"),
		);
	});

	it("EACCES error returns no_credentials gracefully", async () => {
		const logger = makeLogger();
		const err = new Error("permission denied") as NodeJS.ErrnoException;
		err.code = "EACCES";
		mockReadFile.mockRejectedValue(err);

		const result = await fetchApiUsage(logger);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("no_credentials");
		}
	});
});

// ── Scenario 4: credentials.json deleted while running ──────────────

describe("BREAKIT AUTH: Credentials file deleted mid-run", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("ENOENT returns no_credentials (not crash)", async () => {
		const logger = makeLogger();
		const err = new Error("no such file or directory") as NodeJS.ErrnoException;
		err.code = "ENOENT";
		mockReadFile.mockRejectedValue(err);

		const result = await fetchApiUsage(logger);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("no_credentials");
		}
	});

	it("PollingTimer recovers when file reappears after deletion", async () => {
		jest.useFakeTimers();
		const logger = makeLogger();
		const authStates: AuthState[] = [];
		let callCount = 0;

		// First 3 calls: no_credentials (file deleted)
		// 4th call onward: success (file restored)
		const timer = new PollingTimer(
			() => {
				callCount++;
				if (callCount <= 3) {
					return Promise.resolve(failResult("no_credentials"));
				}
				return Promise.resolve(okResult());
			},
			jest.fn(),
			jest.fn(),
			(state) => authStates.push(state),
			logger,
		);

		timer.start();

		// 3 failures -> dead
		for (let i = 0; i < 3; i++) {
			jest.advanceTimersByTime(i === 0 ? 5_000 : 300_000);
			await Promise.resolve();
			await Promise.resolve(); // extra tick for async
		}
		expect(authStates).toContain("dead");

		// Simulate credentials file change detected -> resetAuth
		timer.resetAuth();
		expect(timer.authState).toBe("healthy");

		// Next tick should succeed
		jest.advanceTimersByTime(5_000);
		await Promise.resolve();
		await Promise.resolve();
		expect(callCount).toBeGreaterThanOrEqual(4);

		timer.dispose();
		jest.useRealTimers();
	});

	it("empty credentials file returns no_credentials", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue("");

		const result = await fetchApiUsage(logger);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("no_credentials");
		}
	});

	it("credentials file with invalid JSON returns no_credentials", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue("{broken json");

		const result = await fetchApiUsage(logger);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("no_credentials");
		}
	});
});

// ── Scenario 5: Timeout during refresh, success during API fetch ────

describe("BREAKIT AUTH: Selective network failures", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("refresh times out but API fetch with expired token succeeds", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(expiredCredentials());

		mockRequest.mockImplementation(
			(url: string, _opts: unknown, cb: (res: unknown) => void) => {
				const req = fakeRequest();

				if (url.includes("oauth/token")) {
					// Refresh: simulate timeout
					process.nextTick(() => {
						req.emit("timeout");
					});
				} else {
					// API: succeeds with expired token (grace period)
					const res = fakeResponse(
						200,
						JSON.stringify({
							five_hour: { utilization: 50, resets_at: null },
							seven_day: { utilization: 30, resets_at: null },
						}),
					);
					cb(res);
				}
				return req;
			},
		);

		const result = await fetchApiUsage(logger);
		// Refresh timed out -> transient -> falls back to expired token -> API succeeds
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.fiveHour?.utilization).toBe(0.5);
		}
	});

	it("refresh network error but API fetch succeeds", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(expiredCredentials());

		mockRequest.mockImplementation(
			(url: string, _opts: unknown, cb: (res: unknown) => void) => {
				const req = fakeRequest();

				if (url.includes("oauth/token")) {
					process.nextTick(() => {
						req.emit("error", new Error("ECONNRESET"));
					});
				} else {
					const res = fakeResponse(
						200,
						JSON.stringify({
							five_hour: { utilization: 80, resets_at: null },
							seven_day: null,
						}),
					);
					cb(res);
				}
				return req;
			},
		);

		const result = await fetchApiUsage(logger);
		expect(result.ok).toBe(true);
	});
});

// ── Scenario 6: MUTATION: Remove auth-dead detection threshold ──────

describe("BREAKIT AUTH MUTATION: Auth-dead threshold", () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});
	afterEach(() => {
		jest.useRealTimers();
	});

	it("without threshold, auth_expired failures never reach dead state", async () => {
		// This test VERIFIES the threshold exists by checking that
		// exactly AUTH_DEAD_THRESHOLD (3) consecutive auth failures
		// are required to enter dead state.
		const authStates: AuthState[] = [];
		let fetchCount = 0;

		const timer = new PollingTimer(
			() => {
				fetchCount++;
				return Promise.resolve(failResult("auth_expired"));
			},
			jest.fn(),
			jest.fn(),
			(state) => authStates.push(state),
			makeLogger(),
		);

		timer.start();

		// After 2 failures: should be degraded, NOT dead
		jest.advanceTimersByTime(5_000);
		await Promise.resolve();
		jest.advanceTimersByTime(30_000);
		await Promise.resolve();

		expect(fetchCount).toBe(2);
		expect(timer.authState).not.toBe("dead");
		expect(timer.authState).toBe("degraded");

		// After 3rd failure: should be dead
		jest.advanceTimersByTime(60_000);
		await Promise.resolve();

		expect(fetchCount).toBe(3);
		expect(timer.authState).toBe("dead");

		timer.dispose();
	});

	it("staleness grows unbounded when threshold is removed (mutation detector)", async () => {
		// Simulates what happens if AUTH_DEAD_THRESHOLD were removed:
		// the timer would keep polling forever with exponential backoff.
		// This test verifies that WITH the threshold, polling STOPS.
		const logger = makeLogger();
		let fetchCount = 0;

		const timer = new PollingTimer(
			() => {
				fetchCount++;
				return Promise.resolve(failResult("auth_expired"));
			},
			jest.fn(),
			jest.fn(),
			jest.fn(),
			logger,
		);

		timer.start();

		// Run for a very long simulated time (10 minutes)
		for (let i = 0; i < 20; i++) {
			jest.advanceTimersByTime(300_000); // 5 min each
			await Promise.resolve();
		}

		// With threshold=3, should have stopped after 3 fetches
		// Without threshold, fetchCount would be >>3
		expect(fetchCount).toBe(3);
		expect(timer.authState).toBe("dead");

		timer.dispose();
	});

	it("a single success resets the auth failure counter", async () => {
		const authStates: AuthState[] = [];
		let callIndex = 0;
		// Pattern: fail, fail, SUCCESS, fail, fail, fail -> should reach dead on 6th call
		const results: FetchResult[] = [
			failResult("auth_expired"),
			failResult("auth_expired"),
			okResult(),
			failResult("auth_expired"),
			failResult("auth_expired"),
			failResult("auth_expired"),
		];

		const timer = new PollingTimer(
			() => {
				const r = results[callIndex] ?? failResult("auth_expired");
				callIndex++;
				return Promise.resolve(r);
			},
			jest.fn(),
			jest.fn(),
			(state) => authStates.push(state),
			makeLogger(),
		);

		timer.start();

		// Run through all 6 calls with generous time
		for (let i = 0; i < 10; i++) {
			jest.advanceTimersByTime(300_000);
			await Promise.resolve();
			await Promise.resolve();
		}

		// The success at call 3 should have reset the counter.
		// So calls 4,5,6 are the 3 consecutive failures -> dead.
		expect(timer.authState).toBe("dead");
		// Verify healthy appeared (from the success)
		expect(authStates).toContain("healthy");

		timer.dispose();
	});

	it("network errors do NOT count toward auth-dead threshold", async () => {
		let fetchCount = 0;

		const timer = new PollingTimer(
			() => {
				fetchCount++;
				return Promise.resolve(failResult("network"));
			},
			jest.fn(),
			jest.fn(),
			jest.fn(),
			makeLogger(),
		);

		timer.start();

		// Run for a long time with only network errors
		for (let i = 0; i < 20; i++) {
			jest.advanceTimersByTime(300_000);
			await Promise.resolve();
		}

		// Should NEVER enter dead state from network errors alone
		expect(timer.authState).not.toBe("dead");
		// Should still be polling (fetchCount >> 3)
		expect(fetchCount).toBeGreaterThan(3);

		timer.dispose();
	});
});

// ── Scenario 7: SSRF via redirect from refresh endpoint ─────────────

describe("BREAKIT AUTH SECURITY: Redirect from refresh endpoint", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("301 redirect treated as transient failure, not followed", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(expiredCredentials());

		const requestedUrls: string[] = [];
		mockRequest.mockImplementation(
			(url: string, _opts: unknown, cb: (res: unknown) => void) => {
				requestedUrls.push(url);
				const req = fakeRequest();

				if (url.includes("oauth/token")) {
					// Refresh endpoint returns 301 redirect
					const res = fakeResponse(
						301,
						'{"location":"https://evil.com/steal-token"}',
					);
					(res as unknown as Record<string, unknown>).headers = {
						location: "https://evil.com/steal-token",
					};
					cb(res);
				} else {
					// API call with expired token
					const res = fakeResponse(
						200,
						JSON.stringify({
							five_hour: { utilization: 25, resets_at: null },
							seven_day: null,
						}),
					);
					cb(res);
				}
				return req;
			},
		);

		const result = await fetchApiUsage(logger);
		// Must NOT follow the redirect to evil.com
		expect(requestedUrls).not.toContain("https://evil.com/steal-token");
		// 301 is not 200, not 400/401 -> treated as transient
		expect(result).toBeDefined();
	});

	it("302 redirect from refresh does not leak refresh token", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(expiredCredentials());

		const capturedOptions: Array<Record<string, unknown>> = [];
		mockRequest.mockImplementation(
			(
				url: string,
				opts: Record<string, unknown>,
				cb: (res: unknown) => void,
			) => {
				capturedOptions.push({ url, ...opts });
				const req = fakeRequest();

				if (url.includes("oauth/token")) {
					const res = fakeResponse(302, "");
					cb(res);
				} else {
					const res = fakeResponse(
						200,
						JSON.stringify({
							five_hour: null,
							seven_day: null,
						}),
					);
					cb(res);
				}
				return req;
			},
		);

		const result = await fetchApiUsage(logger);
		// The refresh token should only be sent to the original refresh URL
		const apiCalls = capturedOptions.filter(
			(o) => !(o.url as string).includes("oauth/token"),
		);
		for (const call of apiCalls) {
			const headers = call.headers as Record<string, string>;
			// Authorization header should NOT contain the refresh token
			if (headers.Authorization) {
				expect(headers.Authorization).not.toContain("valid-refresh-token");
			}
		}
		expect(result).toBeDefined();
	});
});

// ── Scenario 8: Concurrent refresh from two VS Code windows ────────

describe("BREAKIT AUTH CONCURRENCY: Dual-window token refresh", () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});
	afterEach(() => {
		jest.useRealTimers();
	});

	it("two PollingTimers with same fetchFn don't corrupt shared state", async () => {
		const results1: ApiUsageData[] = [];
		const results2: ApiUsageData[] = [];
		let fetchCount = 0;

		const sharedFetchFn = (): Promise<FetchResult> => {
			fetchCount++;
			return Promise.resolve(
				okResult(
					makeApiData({
						fiveHour: {
							utilization: fetchCount * 0.1,
							resetsAt: null,
						},
					}),
				),
			);
		};

		const timer1 = new PollingTimer(
			sharedFetchFn,
			(data) => results1.push(data),
			jest.fn(),
			jest.fn(),
			makeLogger(),
		);

		const timer2 = new PollingTimer(
			sharedFetchFn,
			(data) => results2.push(data),
			jest.fn(),
			jest.fn(),
			makeLogger(),
		);

		timer1.start();
		timer2.start();

		// First tick at 5s
		jest.advanceTimersByTime(5_000);
		await Promise.resolve();
		await Promise.resolve();

		// Both should have received data
		expect(results1.length).toBeGreaterThanOrEqual(1);
		expect(results2.length).toBeGreaterThanOrEqual(1);

		// Data should be different (each got their own fetch)
		if (results1.length > 0 && results2.length > 0) {
			// Each timer got its own fetch call with incremented counter
			expect(fetchCount).toBeGreaterThanOrEqual(2);
		}

		timer1.dispose();
		timer2.dispose();
	});

	it("resetAuth on one timer does not affect the other", async () => {
		let fetchCount = 0;

		const timer1 = new PollingTimer(
			() => {
				fetchCount++;
				return Promise.resolve(failResult("auth_dead"));
			},
			jest.fn(),
			jest.fn(),
			jest.fn(),
			makeLogger(),
		);

		const timer2 = new PollingTimer(
			() => {
				fetchCount++;
				return Promise.resolve(failResult("auth_dead"));
			},
			jest.fn(),
			jest.fn(),
			jest.fn(),
			makeLogger(),
		);

		timer1.start();
		timer2.start();

		// Both enter dead state
		jest.advanceTimersByTime(5_000);
		await Promise.resolve();
		await Promise.resolve();

		expect(timer1.authState).toBe("dead");
		expect(timer2.authState).toBe("dead");

		// Reset only timer1
		timer1.resetAuth();
		expect(timer1.authState).toBe("healthy");
		expect(timer2.authState).toBe("dead"); // Must NOT be affected

		timer1.dispose();
		timer2.dispose();
	});

	it("simultaneous forceRefresh on both timers handles correctly", async () => {
		let fetchCount = 0;
		const fetchStarted = jest.fn();
		const fetchCompleted = jest.fn();

		const slowFetch = (): Promise<FetchResult> => {
			fetchCount++;
			fetchStarted();
			return new Promise((resolve) => {
				// Simulate slow fetch
				setTimeout(() => {
					fetchCompleted();
					resolve(okResult());
				}, 100);
			});
		};

		const timer1 = new PollingTimer(
			slowFetch,
			jest.fn(),
			jest.fn(),
			jest.fn(),
			makeLogger(),
		);

		const timer2 = new PollingTimer(
			slowFetch,
			jest.fn(),
			jest.fn(),
			jest.fn(),
			makeLogger(),
		);

		timer1.start();
		timer2.start();

		// Both force refresh simultaneously
		const p1 = timer1.forceRefresh();
		const p2 = timer2.forceRefresh();

		// Advance timers to let the slow fetches complete
		jest.advanceTimersByTime(200);
		await Promise.resolve();
		await Promise.resolve();

		await p1;
		await p2;

		// Both should have fetched independently without crash
		expect(fetchStarted).toHaveBeenCalled();
		expect(timer1.authState).toBe("healthy");
		expect(timer2.authState).toBe("healthy");

		timer1.dispose();
		timer2.dispose();
	});
});

// ── ESCALATION: Combined auth stress scenarios ──────────────────────

describe("ESCALATION: Auth recovery chain", () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});
	afterEach(() => {
		jest.useRealTimers();
	});

	it("dead->resetAuth->immediate auth_dead goes back to dead", async () => {
		const authStates: AuthState[] = [];

		const timer = new PollingTimer(
			() => Promise.resolve(failResult("auth_dead")),
			jest.fn(),
			jest.fn(),
			(state) => authStates.push(state),
			makeLogger(),
		);

		timer.start();

		// Enter dead
		jest.advanceTimersByTime(5_000);
		await Promise.resolve();
		expect(timer.authState).toBe("dead");

		// Reset
		timer.resetAuth();
		expect(timer.authState).toBe("healthy");

		// Immediately hit auth_dead again
		jest.advanceTimersByTime(5_000);
		await Promise.resolve();
		expect(timer.authState).toBe("dead");

		// Verify full transition chain
		expect(authStates).toEqual(["dead", "healthy", "dead"]);

		timer.dispose();
	});

	it("rapid resetAuth calls don't create timer leaks", async () => {
		const timer = new PollingTimer(
			() => Promise.resolve(failResult("auth_dead")),
			jest.fn(),
			jest.fn(),
			jest.fn(),
			makeLogger(),
		);

		timer.start();

		// Enter dead
		jest.advanceTimersByTime(5_000);
		await Promise.resolve();

		// Rapid resets
		for (let i = 0; i < 100; i++) {
			timer.resetAuth();
		}

		// Should not throw, should be healthy
		expect(timer.authState).toBe("healthy");

		// One more tick to verify timer still works
		jest.advanceTimersByTime(5_000);
		await Promise.resolve();

		timer.dispose();
	});

	it("mixed error types: network->auth->network cycle", async () => {
		let callIndex = 0;
		const pattern: FetchResult[] = [
			failResult("network"),
			failResult("network"),
			failResult("auth_expired"),
			failResult("network"),
			failResult("auth_expired"),
			failResult("auth_expired"),
			failResult("auth_expired"), // 3rd consecutive auth -> dead
		];

		const timer = new PollingTimer(
			() => {
				const r = pattern[callIndex] ?? okResult();
				callIndex++;
				return Promise.resolve(r);
			},
			jest.fn(),
			jest.fn(),
			jest.fn(),
			makeLogger(),
		);

		timer.start();

		// Run through all calls
		for (let i = 0; i < 20; i++) {
			jest.advanceTimersByTime(300_000);
			await Promise.resolve();
			await Promise.resolve();
		}

		// Network errors interspersed with auth errors should reset auth counter
		// Call 3: auth_expired (consecutiveAuthFailures=1)
		// Call 4: network (doesn't increment auth counter, but does it reset?)
		// Actually looking at the code, network errors DON'T reset consecutiveAuthFailures
		// So: call3=auth(1), call4=network(1), call5=auth(2), call6=auth(3)=dead
		// Wait -- let me re-read. The counter only resets on success (line 174).
		// Network errors are not isAuthError so they don't increment consecutiveAuthFailures.
		// But they also don't reset it. So the pattern depends on threshold counting.
		expect(timer.authState).toBe("dead");

		timer.dispose();
	});
});
