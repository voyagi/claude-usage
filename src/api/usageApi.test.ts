/**
 * Unit tests for usageApi.ts auth failure paths
 *
 * Covers gaps identified by coverage analysis:
 * - refreshOAuthToken: no refresh token, successful refresh, parse error
 * - getAccessToken: no accessToken, terminal refresh -> auth_dead
 * - fetchApiUsage: 429, 5xx, other status codes, parse error, network error, timeout
 */

// Must mock before imports
jest.mock("vscode", () => ({}), { virtual: true });

const mockRequest = jest.fn();
jest.mock("node:https", () => ({
	request: mockRequest,
}));

const mockReadFile = jest.fn();
jest.mock("node:fs/promises", () => ({
	readFile: mockReadFile,
	mkdir: jest.fn().mockResolvedValue(undefined),
	writeFile: jest.fn().mockResolvedValue(undefined),
	rename: jest.fn().mockResolvedValue(undefined),
}));

import { EventEmitter } from "node:events";
import { fetchApiUsage } from "./usageApi";
import type { Logger } from "../utils/logger";

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

function fakeResponse(statusCode: number, body: string) {
	const res = new EventEmitter() as EventEmitter & { statusCode: number };
	res.statusCode = statusCode;
	process.nextTick(() => {
		res.emit("data", body);
		res.emit("end");
	});
	return res;
}

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

function validCredentials(overrides: Record<string, unknown> = {}) {
	return JSON.stringify({
		claudeAiOauth: {
			accessToken: "valid-access-token",
			refreshToken: "valid-refresh-token",
			expiresAt: Date.now() + 3600_000,
			...overrides,
		},
	});
}

function expiredCredentials(overrides: Record<string, unknown> = {}) {
	return JSON.stringify({
		claudeAiOauth: {
			accessToken: "expired-access-token",
			refreshToken: "valid-refresh-token",
			expiresAt: Date.now() - 60_000,
			...overrides,
		},
	});
}

// ── refreshOAuthToken: no refresh token ─────────────────────────────

describe("usageApi: refreshOAuthToken - no refresh token", () => {
	beforeEach(() => jest.clearAllMocks());

	it("returns no_credentials when credentials have no refreshToken", async () => {
		const logger = makeLogger();
		// Expired token but NO refresh token -> can't refresh -> terminal
		mockReadFile.mockResolvedValue(
			expiredCredentials({ refreshToken: undefined }),
		);

		// No HTTP calls should be made for refresh
		const requestedUrls: string[] = [];
		mockRequest.mockImplementation(
			(url: string, _opts: unknown, cb: (res: unknown) => void) => {
				requestedUrls.push(url);
				const req = fakeRequest();
				// API call with expired token -> 401
				const res = fakeResponse(401, '{"error":"unauthorized"}');
				cb(res);
				return req;
			},
		);

		const result = await fetchApiUsage(logger);
		// No refresh token -> terminal -> auth_dead
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("auth_dead");
		}
		// Should NOT have tried the refresh endpoint
		expect(requestedUrls.every((u) => !u.includes("oauth/token"))).toBe(true);
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining("No refresh token"),
		);
	});
});

// ── refreshOAuthToken: successful refresh ───────────────────────────

describe("usageApi: refreshOAuthToken - successful refresh", () => {
	beforeEach(() => jest.clearAllMocks());

	it("uses refreshed token for API call after successful refresh", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(expiredCredentials());

		const capturedHeaders: Record<string, string>[] = [];
		mockRequest.mockImplementation(
			(
				url: string,
				opts: { headers?: Record<string, string> },
				cb: (res: unknown) => void,
			) => {
				const req = fakeRequest();
				if (url.includes("oauth/token")) {
					// Refresh succeeds
					const res = fakeResponse(
						200,
						JSON.stringify({
							access_token: "new-refreshed-token",
							expires_in: 3600,
						}),
					);
					cb(res);
				} else {
					// Capture auth header on API call
					capturedHeaders.push(opts.headers ?? {});
					const res = fakeResponse(
						200,
						JSON.stringify({
							five_hour: { utilization: 60, resets_at: null },
							seven_day: { utilization: 40, resets_at: null },
						}),
					);
					cb(res);
				}
				return req;
			},
		);

		const result = await fetchApiUsage(logger);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.fiveHour?.utilization).toBe(0.6);
		}
		// API call should use the NEW token, not the expired one
		expect(capturedHeaders.length).toBe(1);
		expect(capturedHeaders[0].Authorization).toBe("Bearer new-refreshed-token");
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining("OAuth token refreshed"),
		);
	});
});

// ── getAccessToken: no accessToken in credentials ───────────────────

describe("usageApi: getAccessToken - no accessToken", () => {
	beforeEach(() => jest.clearAllMocks());

	it("returns no_credentials when oauth block has no accessToken", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(
			JSON.stringify({
				claudeAiOauth: {
					refreshToken: "has-refresh",
					// no accessToken
				},
			}),
		);

		const result = await fetchApiUsage(logger);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("no_credentials");
		}
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining("No OAuth access token"),
		);
	});

	it("returns no_credentials when claudeAiOauth is missing entirely", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(JSON.stringify({ someOtherKey: true }));

		const result = await fetchApiUsage(logger);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("no_credentials");
		}
	});
});

// ── getAccessToken: terminal refresh -> auth_dead ───────────────────

describe("usageApi: getAccessToken - terminal refresh failure", () => {
	beforeEach(() => jest.clearAllMocks());

	it("returns auth_dead when refresh token returns 400 (terminal)", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(expiredCredentials());

		mockRequest.mockImplementation(
			(url: string, _opts: unknown, cb: (res: unknown) => void) => {
				const req = fakeRequest();
				if (url.includes("oauth/token")) {
					// 400 = terminal failure (refresh token is dead)
					const res = fakeResponse(
						400,
						'{"error":"invalid_grant","error_description":"Refresh token expired"}',
					);
					cb(res);
				}
				return req;
			},
		);

		const result = await fetchApiUsage(logger);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("auth_dead");
		}
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("Refresh token is dead"),
		);
	});

	it("returns auth_dead when refresh token returns 401 (terminal)", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(expiredCredentials());

		mockRequest.mockImplementation(
			(url: string, _opts: unknown, cb: (res: unknown) => void) => {
				const req = fakeRequest();
				if (url.includes("oauth/token")) {
					const res = fakeResponse(401, '{"error":"invalid_token"}');
					cb(res);
				}
				return req;
			},
		);

		const result = await fetchApiUsage(logger);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("auth_dead");
		}
	});
});

// ── fetchApiUsage: HTTP error status codes ──────────────────────────

describe("usageApi: fetchApiUsage - HTTP error responses", () => {
	beforeEach(() => jest.clearAllMocks());

	it("returns rate_limited on 429", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(validCredentials());

		mockRequest.mockImplementation(
			(_url: string, _opts: unknown, cb: (res: unknown) => void) => {
				const req = fakeRequest();
				const res = fakeResponse(429, '{"error":"rate_limited"}');
				cb(res);
				return req;
			},
		);

		const result = await fetchApiUsage(logger);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("rate_limited");
		}
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("rate limited (429)"),
		);
	});

	it("returns server_error on 500", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(validCredentials());

		mockRequest.mockImplementation(
			(_url: string, _opts: unknown, cb: (res: unknown) => void) => {
				const req = fakeRequest();
				const res = fakeResponse(500, "Internal Server Error");
				cb(res);
				return req;
			},
		);

		const result = await fetchApiUsage(logger);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("server_error");
		}
	});

	it("returns server_error on 502", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(validCredentials());

		mockRequest.mockImplementation(
			(_url: string, _opts: unknown, cb: (res: unknown) => void) => {
				const req = fakeRequest();
				const res = fakeResponse(502, "Bad Gateway");
				cb(res);
				return req;
			},
		);

		const result = await fetchApiUsage(logger);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("server_error");
		}
	});

	it("returns server_error on 503", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(validCredentials());

		mockRequest.mockImplementation(
			(_url: string, _opts: unknown, cb: (res: unknown) => void) => {
				const req = fakeRequest();
				const res = fakeResponse(503, "Service Unavailable");
				cb(res);
				return req;
			},
		);

		const result = await fetchApiUsage(logger);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("server_error");
		}
	});

	it("returns server_error on unexpected status code (403)", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(validCredentials());

		mockRequest.mockImplementation(
			(_url: string, _opts: unknown, cb: (res: unknown) => void) => {
				const req = fakeRequest();
				const res = fakeResponse(403, '{"error":"forbidden"}');
				cb(res);
				return req;
			},
		);

		const result = await fetchApiUsage(logger);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("server_error");
		}
	});
});

// ── fetchApiUsage: response parse error ─────────────────────────────

describe("usageApi: fetchApiUsage - malformed response body", () => {
	beforeEach(() => jest.clearAllMocks());

	it("returns server_error when API returns invalid JSON", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(validCredentials());

		mockRequest.mockImplementation(
			(_url: string, _opts: unknown, cb: (res: unknown) => void) => {
				const req = fakeRequest();
				const res = fakeResponse(200, "<html>not json</html>");
				cb(res);
				return req;
			},
		);

		const result = await fetchApiUsage(logger);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("server_error");
		}
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("Failed to parse usage API response"),
		);
	});
});

// ── fetchApiUsage: network error and timeout ────────────────────────

describe("usageApi: fetchApiUsage - network failures", () => {
	beforeEach(() => jest.clearAllMocks());

	it("returns network error on connection failure", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(validCredentials());

		mockRequest.mockImplementation(() => {
			const req = fakeRequest();
			process.nextTick(() => {
				req.emit("error", new Error("ECONNREFUSED"));
			});
			return req;
		});

		const result = await fetchApiUsage(logger);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("network");
		}
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("Usage API request failed"),
		);
	});

	it("returns network error on timeout", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(validCredentials());

		mockRequest.mockImplementation(() => {
			const req = fakeRequest();
			process.nextTick(() => {
				req.emit("timeout");
			});
			return req;
		});

		const result = await fetchApiUsage(logger);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("network");
		}
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("Usage API request timed out"),
		);
	});
});

// ── fetchApiUsage: successful response with extra fields ────────────

describe("usageApi: fetchApiUsage - successful parsing", () => {
	beforeEach(() => jest.clearAllMocks());

	it("parses extraUsage when present", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(validCredentials());

		mockRequest.mockImplementation(
			(_url: string, _opts: unknown, cb: (res: unknown) => void) => {
				const req = fakeRequest();
				const res = fakeResponse(
					200,
					JSON.stringify({
						five_hour: { utilization: 50, resets_at: "2026-03-23T20:00:00Z" },
						seven_day: { utilization: 30, resets_at: null },
						seven_day_sonnet: null,
						seven_day_opus: { utilization: 10, resets_at: null },
						rate_limit_tier: "tier4",
						extra_usage: {
							usedCredits: 42.5,
							monthlyLimit: 100,
						},
					}),
				);
				cb(res);
				return req;
			},
		);

		const result = await fetchApiUsage(logger);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.fiveHour?.utilization).toBe(0.5);
			expect(result.data.fiveHour?.resetsAt).toBe("2026-03-23T20:00:00Z");
			expect(result.data.sevenDay?.utilization).toBe(0.3);
			expect(result.data.sevenDaySonnet).toBeNull();
			expect(result.data.sevenDayOpus?.utilization).toBe(0.1);
			expect(result.data.rateLimitTier).toBe("tier4");
			expect(result.data.extraUsage).toEqual({
				creditsUsed: 42.5,
				creditsTotal: 100,
			});
			expect(result.data.fetchedAt).toBeInstanceOf(Date);
		}
	});

	it("returns null extraUsage when fields are missing", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(validCredentials());

		mockRequest.mockImplementation(
			(_url: string, _opts: unknown, cb: (res: unknown) => void) => {
				const req = fakeRequest();
				const res = fakeResponse(
					200,
					JSON.stringify({
						five_hour: { utilization: 0, resets_at: null },
						seven_day: null,
						extra_usage: { usedCredits: "not-a-number" },
					}),
				);
				cb(res);
				return req;
			},
		);

		const result = await fetchApiUsage(logger);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.extraUsage).toBeNull();
		}
	});
});
