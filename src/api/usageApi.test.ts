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
import type { Logger } from "../utils/logger";
import { fetchApiUsage, parseUsagePayload } from "./usageApi";

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

	it("parses the legacy per-model keys when limits[] is absent", async () => {
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
			// seven_day_sonnet was null, so only Opus survives as a scoped limit
			expect(result.data.scopedWeekly).toHaveLength(1);
			expect(result.data.scopedWeekly[0].label).toBe("Opus");
			expect(result.data.scopedWeekly[0].utilization).toBe(0.1);
			expect(result.data.rateLimitTier).toBe("tier4");
			expect(result.data.extraUsage?.creditsUsed).toBe(42.5);
			expect(result.data.extraUsage?.creditsTotal).toBe(100);
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

// ── parseUsagePayload: the 2026-07 API shape ───────────────────────

describe("usageApi: parseUsagePayload - limits[] shape", () => {
	/** Trimmed copy of a real 2026-07-21 response from /api/oauth/usage */
	const CURRENT_SHAPE = {
		five_hour: {
			utilization: 17,
			resets_at: "2026-07-21T19:20:00.383267+00:00",
			limit_dollars: null,
			used_dollars: null,
			remaining_dollars: null,
		},
		seven_day: {
			utilization: 56,
			resets_at: "2026-07-24T08:00:00.383291+00:00",
		},
		seven_day_opus: null,
		seven_day_sonnet: null,
		tangelo: null,
		extra_usage: {
			is_enabled: false,
			monthly_limit: null,
			used_credits: null,
			utilization: null,
			currency: null,
			disabled_reason: null,
		},
		limits: [
			{
				kind: "session",
				group: "session",
				percent: 17,
				severity: "normal",
				resets_at: "2026-07-21T19:20:00.383267+00:00",
				scope: null,
				is_active: false,
			},
			{
				kind: "weekly_all",
				group: "weekly",
				percent: 56,
				severity: "normal",
				resets_at: "2026-07-24T08:00:00.383291+00:00",
				scope: null,
				is_active: false,
			},
			{
				kind: "weekly_scoped",
				group: "weekly",
				percent: 60,
				severity: "normal",
				resets_at: "2026-07-24T08:00:00.383503+00:00",
				scope: { model: { id: null, display_name: "Fable" }, surface: null },
				is_active: true,
			},
		],
		spend: {
			used: { amount_minor: 0, currency: "USD", exponent: 2 },
			limit: null,
			percent: 0,
			severity: "normal",
			enabled: false,
		},
	};

	it("reads session and weekly from limits[]", () => {
		const data = parseUsagePayload(CURRENT_SHAPE);
		expect(data.fiveHour?.utilization).toBe(0.17);
		expect(data.fiveHour?.severity).toBe("normal");
		expect(data.sevenDay?.utilization).toBe(0.56);
	});

	it("surfaces the scoped weekly limit with the model name the API supplies", () => {
		const data = parseUsagePayload(CURRENT_SHAPE);
		expect(data.scopedWeekly).toHaveLength(1);
		expect(data.scopedWeekly[0]).toMatchObject({
			label: "Fable",
			utilization: 0.6,
			isActive: true,
		});
	});

	it("does not fall back to the legacy null per-model keys", () => {
		const data = parseUsagePayload(CURRENT_SHAPE);
		// Regression guard: seven_day_sonnet/opus are null in the current API.
		// Reading them instead of limits[] is what silently emptied the third bar.
		expect(data.scopedWeekly.some((w) => w.label === "Sonnet")).toBe(false);
	});

	it("parses spend into major currency units", () => {
		const data = parseUsagePayload({
			...CURRENT_SHAPE,
			spend: {
				used: { amount_minor: 1234, currency: "USD", exponent: 2 },
				limit: { amount_minor: 5000, currency: "USD", exponent: 2 },
				percent: 24,
				severity: "normal",
				enabled: true,
			},
		});
		expect(data.spend).toEqual({
			used: 12.34,
			limit: 50,
			percent: 24,
			currency: "USD",
			severity: "normal",
			enabled: true,
		});
	});

	it("returns null extraUsage when credits are disabled and empty", () => {
		expect(parseUsagePayload(CURRENT_SHAPE).extraUsage).toBeNull();
	});

	it("derives extraUsage utilization from real credit amounts", () => {
		const data = parseUsagePayload({
			...CURRENT_SHAPE,
			extra_usage: {
				is_enabled: true,
				monthly_limit: 200,
				used_credits: 50,
				utilization: 25,
				currency: "USD",
				disabled_reason: null,
			},
		});
		expect(data.extraUsage).toEqual({
			isEnabled: true,
			creditsUsed: 50,
			creditsTotal: 200,
			utilization: 0.25,
			currency: "USD",
			disabledReason: null,
		});
	});

	it("survives a payload with no limits[] and no legacy keys", () => {
		const data = parseUsagePayload({});
		expect(data.fiveHour).toBeNull();
		expect(data.sevenDay).toBeNull();
		expect(data.scopedWeekly).toEqual([]);
		expect(data.spend).toBeNull();
		expect(data.extraUsage).toBeNull();
	});

	it("ignores scoped limits that carry no usable label", () => {
		const data = parseUsagePayload({
			limits: [
				{
					kind: "weekly_scoped",
					group: "weekly",
					percent: 40,
					resets_at: null,
					scope: { model: { id: null, display_name: null }, surface: null },
				},
			],
		});
		expect(data.scopedWeekly).toEqual([]);
	});

	it("labels a surface-scoped limit by its surface", () => {
		const data = parseUsagePayload({
			limits: [
				{
					kind: "weekly_scoped",
					group: "weekly",
					percent: 40,
					resets_at: null,
					scope: { model: null, surface: "Cowork" },
				},
			],
		});
		expect(data.scopedWeekly[0].label).toBe("Cowork");
	});
});

describe("parseUsagePayload: an unreadable resets_at", () => {
	/** A payload whose session limit carries a reset in the given form. */
	function payloadWithReset(resets_at: unknown) {
		return {
			limits: [{ kind: "session", group: "session", percent: 17, resets_at }],
		};
	}

	it("drops a reset it cannot read, rather than passing it on", () => {
		const data = parseUsagePayload(payloadWithReset("not-a-date"));
		expect(data.fiveHour?.utilization).toBe(0.17);
		expect(data.fiveHour?.resetsAt).toBeNull();
	});

	it("says so, because a blank countdown is otherwise a normal state", () => {
		// Display code renders a null reset as "no countdown", which this change
		// set made the ordinary case. So a timestamp format change would empty
		// every countdown on every surface and look exactly like working
		// correctly. This warning is the only thing that would distinguish them.
		const logger = makeLogger();
		parseUsagePayload(payloadWithReset("not-a-date"), logger);

		expect(logger.warn).toHaveBeenCalledTimes(1);
		// Naming the offending value is the point: a format change is only
		// actionable if the log says what arrived.
		expect((logger.warn as jest.Mock).mock.calls[0][0]).toContain("not-a-date");
	});

	it("stays quiet about a reset the API legitimately omitted", () => {
		// The scoped weekly limit reports null at zero usage on every poll. If
		// that warned, the signal would be noise from the first minute.
		const logger = makeLogger();
		const data = parseUsagePayload(payloadWithReset(null), logger);

		expect(data.fiveHour?.resetsAt).toBeNull();
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it("keeps a reset it can read, untouched", () => {
		const logger = makeLogger();
		const data = parseUsagePayload(
			payloadWithReset("2026-07-31T08:00:00.585182+00:00"),
			logger,
		);

		// Stored verbatim, not normalized: this string is also the weekly anchor,
		// and re-serializing it would quietly change what gets persisted.
		expect(data.fiveHour?.resetsAt).toBe("2026-07-31T08:00:00.585182+00:00");
		expect(logger.warn).not.toHaveBeenCalled();
	});
});
