/**
 * Fetches real-time rate limit data from Anthropic's API
 * Uses the same endpoint and auth as Claude Code's "Account & Usage" panel
 */

import * as fs from "node:fs/promises";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";
import type { ApiRateLimitWindow, ApiUsageData } from "../types.js";
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

/**
 * Refresh the OAuth token using the refresh token.
 * Writes updated credentials back to disk so Claude Code and other
 * windows pick up the new token.
 */
async function refreshOAuthToken(
	credPath: string,
	creds: OAuthCredentials,
	logger: Logger,
): Promise<string | null> {
	const refreshToken = creds.claudeAiOauth?.refreshToken;
	if (!refreshToken) {
		logger.info("No refresh token available, cannot refresh");
		return null;
	}

	logger.info("OAuth token expired, attempting refresh...");

	return new Promise((resolve) => {
		const postData = JSON.stringify({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
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
				res.on("end", async () => {
					if (res.statusCode !== 200) {
						logger.warn(
							`Token refresh failed (${res.statusCode}): ${data.slice(0, 200)}`,
						);
						resolve(null);
						return;
					}
					try {
						const json = JSON.parse(data);
						const newAccessToken = json.access_token;
						const expiresIn = json.expires_in ?? 3600;
						const newRefreshToken = json.refresh_token ?? refreshToken;

						if (!newAccessToken) {
							logger.warn("Token refresh response missing access_token");
							resolve(null);
							return;
						}

						// Update credentials in memory and on disk
						creds.claudeAiOauth = {
							...creds.claudeAiOauth!,
							accessToken: newAccessToken,
							refreshToken: newRefreshToken,
							expiresAt: Date.now() + expiresIn * 1000,
						};

						await fs.writeFile(credPath, JSON.stringify(creds), "utf8");
						logger.info(`OAuth token refreshed, expires in ${expiresIn}s`);
						resolve(newAccessToken);
					} catch (parseError) {
						logger.warn(
							`Failed to parse token refresh response: ${parseError}`,
						);
						resolve(null);
					}
				});
			},
		);

		req.on("error", (error) => {
			logger.warn(`Token refresh request failed: ${error.message}`);
			resolve(null);
		});

		req.on("timeout", () => {
			req.destroy();
			logger.warn("Token refresh request timed out");
			resolve(null);
		});

		req.write(postData);
		req.end();
	});
}

/**
 * Read OAuth access token from ~/.claude/.credentials.json
 * If the token is expired, attempts to refresh it automatically.
 */
async function getAccessToken(logger: Logger): Promise<string | null> {
	const credPath = path.join(os.homedir(), ".claude", ".credentials.json");
	try {
		const raw = await fs.readFile(credPath, "utf8");
		const creds: OAuthCredentials = JSON.parse(raw);
		const oauth = creds.claudeAiOauth;
		if (!oauth?.accessToken) {
			logger.info("No OAuth access token found in credentials");
			return null;
		}

		// Check if token is expired (with 5-minute buffer)
		if (oauth.expiresAt && Date.now() > oauth.expiresAt - 5 * 60_000) {
			const refreshed = await refreshOAuthToken(credPath, creds, logger);
			if (refreshed) return refreshed;
			// Fall through to try the expired token anyway --
			// sometimes the API accepts slightly expired tokens
			logger.info("Refresh failed, trying existing token");
		}

		return oauth.accessToken;
	} catch (error) {
		logger.warn(
			`Could not read credentials: ${error instanceof Error ? error.message : error}`,
		);
		return null;
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
 * Returns null if auth is unavailable or request fails
 */
export async function fetchApiUsage(
	logger: Logger,
): Promise<ApiUsageData | null> {
	const token = await getAccessToken(logger);
	if (!token) {
		return null;
	}

	return new Promise((resolve) => {
		const req = https.request(
			"https://api.anthropic.com/api/oauth/usage",
			{
				method: "GET",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
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
								"Usage API: auth token expired (401). Will retry when Claude Code refreshes it.",
							);
						} else {
							logger.warn(
								`Usage API returned ${res.statusCode}: ${data.slice(0, 200)}`,
							);
						}
						resolve(null);
						return;
					}
					try {
						const json = JSON.parse(data);
						const extraRaw = json.extra_usage;
						resolve({
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
						});
					} catch (parseError) {
						logger.warn(`Failed to parse usage API response: ${parseError}`);
						resolve(null);
					}
				});
			},
		);

		req.on("error", (error) => {
			logger.warn(`Usage API request failed: ${error.message}`);
			resolve(null);
		});

		req.on("timeout", () => {
			req.destroy();
			logger.warn("Usage API request timed out");
			resolve(null);
		});

		req.end();
	});
}
