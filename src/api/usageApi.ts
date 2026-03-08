/**
 * Fetches real-time rate limit data from Anthropic's API
 * Uses the same endpoint and auth as Claude Code's "Account & Usage" panel
 */

import * as fs from "node:fs/promises";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";
import type { Logger } from "../utils/logger.js";

export interface ApiRateLimitWindow {
	utilization: number; // 0.0-1.0
	resetsAt: string | null; // ISO timestamp
}

export interface ApiUsageData {
	fiveHour: ApiRateLimitWindow | null;
	sevenDay: ApiRateLimitWindow | null;
	sevenDaySonnet: ApiRateLimitWindow | null;
	fetchedAt: Date;
}

interface OAuthCredentials {
	claudeAiOauth?: {
		accessToken: string;
		refreshToken?: string;
		expiresAt?: string;
	};
}

/**
 * Read OAuth access token from ~/.claude/.credentials.json
 */
async function getAccessToken(logger: Logger): Promise<string | null> {
	const credPath = path.join(os.homedir(), ".claude", ".credentials.json");
	try {
		const raw = await fs.readFile(credPath, "utf8");
		const creds: OAuthCredentials = JSON.parse(raw);
		const token = creds.claudeAiOauth?.accessToken;
		if (!token) {
			logger.info("No OAuth access token found in credentials");
			return null;
		}
		return token;
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
						logger.warn(`Usage API returned ${res.statusCode}`);
						resolve(null);
						return;
					}
					try {
						const json = JSON.parse(data);
						resolve({
							fiveHour: parseWindow(json.five_hour),
							sevenDay: parseWindow(json.seven_day),
							sevenDaySonnet: parseWindow(json.seven_day_sonnet),
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
