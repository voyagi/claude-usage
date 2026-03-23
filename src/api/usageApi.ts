/**
 * Fetches real-time rate limit data from Anthropic's API
 * Uses the same endpoint and auth as Claude Code's "Account & Usage" panel
 *
 * Returns typed FetchResult instead of null so callers can distinguish
 * terminal auth failures from transient network errors.
 */

import * as fs from "node:fs/promises";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import type {
	ApiRateLimitWindow,
	ApiUsageData,
	FetchErrorReason,
	FetchResult,
} from "../types.js";
import type { Logger } from "../utils/logger.js";

interface OAuthCredentials {
	claudeAiOauth?: {
		accessToken: string;
		refreshToken?: string;
		expiresAt?: number;
		scopes?: string[];
		subscriptionType?: string;
		rateLimitTier?: string;
	};
	[key: string]: unknown;
}

/** Result from a token refresh attempt */
type RefreshResult =
	| { ok: true; token: string }
	| { ok: false; terminal: boolean }; // terminal=true means refresh token is dead

/**
 * Refresh the OAuth token using the refresh token.
 * Returns typed result so caller can distinguish terminal from transient failures.
 * Does NOT write to the credentials file -- Claude Code owns that file.
 */
async function refreshOAuthToken(
	creds: OAuthCredentials,
	logger: Logger,
): Promise<RefreshResult> {
	const refreshToken = creds.claudeAiOauth?.refreshToken;
	if (!refreshToken) {
		logger.info("No refresh token available, cannot refresh");
		return { ok: false, terminal: true };
	}

	logger.info("OAuth token expired, attempting refresh...");

	const config = vscode.workspace.getConfiguration("claude-usage");
	const clientId = config.get<string>(
		"oauthClientId",
		"9d1c250a-e61b-44d9-88ed-5944d1962f5e",
	);

	return new Promise((resolve) => {
		const postData = JSON.stringify({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: clientId,
		});

		const req = https.request(
			"https://platform.claude.com/v1/oauth/token",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(postData),
				},
				timeout: 10000,
			},
			(res) => {
				let data = "";
				res.on("data", (chunk) => {
					data += chunk;
				});
				res.on("end", () => {
					if (res.statusCode !== 200) {
						// 400/401 from token endpoint = refresh token is dead (terminal)
						// 429/5xx = transient server issue
						const terminal = res.statusCode === 400 || res.statusCode === 401;
						logger.warn(
							`Token refresh failed (${res.statusCode}${terminal ? " - terminal" : ""}): ${data.slice(0, 200)}`,
						);
						resolve({ ok: false, terminal });
						return;
					}
					try {
						const json = JSON.parse(data);
						const newAccessToken = json.access_token;
						const expiresIn = json.expires_in ?? 3600;

						if (!newAccessToken) {
							logger.warn("Token refresh response missing access_token");
							resolve({ ok: false, terminal: false });
							return;
						}

						logger.info(`OAuth token refreshed, expires in ${expiresIn}s`);
						resolve({ ok: true, token: newAccessToken });
					} catch (parseError) {
						logger.warn(
							`Failed to parse token refresh response: ${parseError}`,
						);
						resolve({ ok: false, terminal: false });
					}
				});
			},
		);

		req.on("error", (error) => {
			logger.warn(`Token refresh request failed: ${error.message}`);
			resolve({ ok: false, terminal: false });
		});

		req.on("timeout", () => {
			req.destroy();
			logger.warn("Token refresh request timed out");
			resolve({ ok: false, terminal: false });
		});

		req.write(postData);
		req.end();
	});
}

/** Result from getAccessToken with error reason */
type TokenResult =
	| { ok: true; token: string }
	| { ok: false; reason: FetchErrorReason };

/**
 * Read OAuth access token from ~/.claude/.credentials.json
 * If the token is expired, attempts to refresh it automatically.
 * Returns typed result instead of null.
 */
async function getAccessToken(logger: Logger): Promise<TokenResult> {
	const credPath = path.join(os.homedir(), ".claude", ".credentials.json");
	try {
		const raw = await fs.readFile(credPath, "utf8");
		const creds: OAuthCredentials = JSON.parse(raw);
		const oauth = creds.claudeAiOauth;
		if (!oauth?.accessToken) {
			logger.info("No OAuth access token found in credentials");
			return { ok: false, reason: "no_credentials" };
		}

		// Check if token is expired (with 5-minute buffer)
		if (oauth.expiresAt && Date.now() > oauth.expiresAt - 5 * 60_000) {
			const refreshResult = await refreshOAuthToken(creds, logger);
			if (refreshResult.ok) {
				return { ok: true, token: refreshResult.token };
			}
			// Terminal refresh failure = don't try the expired token
			if (refreshResult.terminal) {
				logger.warn(
					"Refresh token is dead. User must re-authenticate in Claude Code.",
				);
				return { ok: false, reason: "auth_dead" };
			}
			// Transient refresh failure = try expired token (might still work)
			logger.info("Transient refresh failure, trying existing token");
		}

		return { ok: true, token: oauth.accessToken };
	} catch (error) {
		logger.warn(
			`Could not read credentials: ${error instanceof Error ? error.message : error}`,
		);
		return { ok: false, reason: "no_credentials" };
	}
}

/**
 * Parse the API response into our typed structure
 */
function parseWindow(
	raw: { utilization?: number | null; resets_at?: string | null } | null,
): ApiRateLimitWindow | null {
	if (!raw || raw.utilization === null || raw.utilization === undefined) {
		return null;
	}
	// API returns percentages as integers (0-100), always normalize to 0-1 fraction
	const utilization = raw.utilization / 100;
	return {
		utilization,
		resetsAt: raw.resets_at ?? null,
	};
}

/**
 * Fetch rate limit usage from Anthropic API
 * Returns typed FetchResult so callers can distinguish failure modes.
 */
export async function fetchApiUsage(logger: Logger): Promise<FetchResult> {
	const tokenResult = await getAccessToken(logger);
	if (!tokenResult.ok) {
		return { ok: false, error: tokenResult.reason };
	}

	return new Promise((resolve) => {
		const req = https.request(
			"https://api.anthropic.com/api/oauth/usage",
			{
				method: "GET",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${tokenResult.token}`,
					"anthropic-beta": "oauth-2025-04-20",
				},
				timeout: 5000,
			},
			(res) => {
				let data = "";
				res.on("data", (chunk) => {
					data += chunk;
				});
				res.on("end", () => {
					if (res.statusCode !== 200) {
						if (res.statusCode === 401) {
							logger.warn(
								"Usage API: auth token rejected (401). Token may be expired.",
							);
							resolve({ ok: false, error: "auth_expired" });
						} else if (res.statusCode === 429) {
							logger.warn("Usage API: rate limited (429).");
							resolve({ ok: false, error: "rate_limited" });
						} else if (res.statusCode && res.statusCode >= 500) {
							logger.warn(
								`Usage API server error (${res.statusCode}): ${data.slice(0, 200)}`,
							);
							resolve({ ok: false, error: "server_error" });
						} else {
							logger.warn(
								`Usage API returned ${res.statusCode}: ${data.slice(0, 200)}`,
							);
							resolve({ ok: false, error: "server_error" });
						}
						return;
					}
					try {
						const json = JSON.parse(data);
						const extraRaw = json.extra_usage;
						resolve({
							ok: true,
							data: {
								fiveHour: parseWindow(json.five_hour),
								sevenDay: parseWindow(json.seven_day),
								sevenDaySonnet: parseWindow(json.seven_day_sonnet),
								sevenDayOpus: parseWindow(json.seven_day_opus),
								rateLimitTier: json.rate_limit_tier ?? null,
								extraUsage:
									extraRaw &&
									typeof extraRaw.usedCredits === "number" &&
									typeof extraRaw.monthlyLimit === "number"
										? {
												creditsUsed: extraRaw.usedCredits,
												creditsTotal: extraRaw.monthlyLimit,
											}
										: null,
								fetchedAt: new Date(),
							},
						});
					} catch (parseError) {
						logger.warn(`Failed to parse usage API response: ${parseError}`);
						resolve({ ok: false, error: "server_error" });
					}
				});
			},
		);

		req.on("error", (error) => {
			logger.warn(`Usage API request failed: ${error.message}`);
			resolve({ ok: false, error: "network" });
		});

		req.on("timeout", () => {
			req.destroy();
			logger.warn("Usage API request timed out");
			resolve({ ok: false, error: "network" });
		});

		req.end();
	});
}
