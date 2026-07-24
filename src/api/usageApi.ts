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
import type {
	ApiRateLimitWindow,
	ApiScopedWindow,
	ApiUsageData,
	ExtraUsageInfo,
	FetchErrorReason,
	FetchResult,
	SpendInfo,
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

/** Raw window from the legacy top-level keys (five_hour, seven_day, ...) */
interface RawWindow {
	utilization?: number | null;
	resets_at?: string | null;
}

/** Raw entry from the `limits[]` array (added 2026-07) */
interface RawLimit {
	kind?: string | null;
	group?: string | null;
	percent?: number | null;
	severity?: string | null;
	resets_at?: string | null;
	is_active?: boolean | null;
	scope?: {
		model?: { id?: string | null; display_name?: string | null } | null;
		surface?: string | null;
	} | null;
}

/** Raw money object: { amount_minor, currency, exponent } */
interface RawMoney {
	amount_minor?: number | null;
	currency?: string | null;
	exponent?: number | null;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/**
 * Normalize `resets_at`, dropping an unparseable value to null and saying so.
 *
 * `resets_at` is typed `string | null`, which asserts the server's JSON rather
 * than checking it. Display code treats a null as "no countdown to show", and
 * that is now a NORMAL state rather than an error one, so an unparseable value
 * arriving silently would blank every countdown on every bar and card with no
 * signal at all -- indistinguishable from working correctly. This is the layer
 * where a server format change is actually diagnosable, so the complaint
 * belongs here; the guard in `resetInstant` stays as the backstop.
 */
function parseResetsAt(
	raw: string | null | undefined,
	logger?: Logger,
): string | null {
	if (raw == null) return null;
	if (Number.isNaN(new Date(raw).getTime())) {
		logger?.warn(
			`Usage API sent a resets_at this build cannot read (${JSON.stringify(raw)}). Treating it as absent, so countdowns will be blank. Please report this -- the timestamp format has changed.`,
		);
		return null;
	}
	return raw;
}

/**
 * Parse a legacy top-level window (five_hour, seven_day, seven_day_sonnet, ...)
 */
function parseWindow(
	raw: RawWindow | null,
	logger?: Logger,
): ApiRateLimitWindow | null {
	if (!raw || !isFiniteNumber(raw.utilization)) {
		return null;
	}
	// API returns percentages as integers (0-100), always normalize to 0-1 fraction
	return {
		utilization: raw.utilization / 100,
		resetsAt: parseResetsAt(raw.resets_at, logger),
	};
}

/**
 * Parse one entry of the `limits[]` array into a window.
 * Returns null when the entry carries no usable percentage.
 */
function parseLimit(
	raw: RawLimit | null,
	logger?: Logger,
): ApiRateLimitWindow | null {
	if (!raw || !isFiniteNumber(raw.percent)) {
		return null;
	}
	return {
		utilization: raw.percent / 100,
		resetsAt: parseResetsAt(raw.resets_at, logger),
		severity: raw.severity ?? "normal",
		isActive: raw.is_active === true,
	};
}

/**
 * Display label for a scoped limit. The API names the scoped model itself
 * (e.g. "Fable"), so we never hardcode a model name.
 */
function scopeLabel(raw: RawLimit): string | null {
	const model = raw.scope?.model?.display_name;
	if (typeof model === "string" && model.trim()) return model.trim();
	const surface = raw.scope?.surface;
	if (typeof surface === "string" && surface.trim()) return surface.trim();
	return null;
}

/** Convert a raw money object to major currency units */
function parseMoney(
	raw: RawMoney | null,
): { amount: number; currency: string } | null {
	if (!raw || !isFiniteNumber(raw.amount_minor)) return null;
	const exponent = isFiniteNumber(raw.exponent) ? raw.exponent : 2;
	return {
		amount: raw.amount_minor / 10 ** exponent,
		currency: typeof raw.currency === "string" ? raw.currency : "USD",
	};
}

/**
 * Parse the `extra_usage` object.
 *
 * Shape changed 2026-07: credits are null unless the feature is enabled, and
 * the object gained is_enabled/utilization/currency. Both snake_case and the
 * older camelCase spellings are accepted.
 */
function parseExtraUsage(
	raw: Record<string, unknown> | null,
): ExtraUsageInfo | null {
	if (!raw || typeof raw !== "object") return null;

	const used = isFiniteNumber(raw.used_credits)
		? raw.used_credits
		: isFiniteNumber(raw.usedCredits)
			? raw.usedCredits
			: null;
	const total = isFiniteNumber(raw.monthly_limit)
		? raw.monthly_limit
		: isFiniteNumber(raw.monthlyLimit)
			? raw.monthlyLimit
			: null;
	const isEnabled = raw.is_enabled === true;
	const rawUtil = isFiniteNumber(raw.utilization) ? raw.utilization : null;

	// Nothing usable at all -- don't fabricate an empty credits card
	if (!isEnabled && used === null && total === null && rawUtil === null) {
		return null;
	}

	// Prefer a utilization derived from real amounts; the API's own utilization
	// is a 0-100 percentage like every other window in this payload.
	const utilization =
		used !== null && total !== null && total > 0
			? Math.min(1, used / total)
			: rawUtil !== null
				? Math.min(1, Math.max(0, rawUtil / 100))
				: null;

	return {
		isEnabled,
		creditsUsed: used,
		creditsTotal: total,
		utilization,
		currency: typeof raw.currency === "string" ? raw.currency : null,
		disabledReason:
			typeof raw.disabled_reason === "string" ? raw.disabled_reason : null,
	};
}

/** Parse the `spend` object (added 2026-07) */
function parseSpend(raw: Record<string, unknown> | null): SpendInfo | null {
	if (!raw || typeof raw !== "object") return null;
	const used = parseMoney(raw.used as RawMoney | null);
	const limit = parseMoney(raw.limit as RawMoney | null);
	if (!used && !limit && !isFiniteNumber(raw.percent)) return null;
	return {
		used: used?.amount ?? 0,
		limit: limit?.amount ?? null,
		percent: isFiniteNumber(raw.percent) ? raw.percent : 0,
		currency: used?.currency ?? limit?.currency ?? "USD",
		severity: typeof raw.severity === "string" ? raw.severity : "normal",
		enabled: raw.enabled === true,
	};
}

/**
 * Build ApiUsageData from a parsed usage payload.
 *
 * Prefers the `limits[]` array (current shape, carries severity + is_active and
 * names the scoped model), falling back to the legacy top-level keys so accounts
 * or server versions still returning the old shape keep working.
 *
 * Exported for testing.
 */
export function parseUsagePayload(
	json: unknown,
	logger?: Logger,
): ApiUsageData {
	const root = (json ?? {}) as Record<string, unknown>;
	const limits: RawLimit[] = Array.isArray(root.limits)
		? (root.limits as RawLimit[]).filter(
				(l): l is RawLimit => !!l && typeof l === "object",
			)
		: [];

	const sessionLimit = limits.find(
		(l) => l.kind === "session" || (!l.kind && l.group === "session"),
	);
	const weeklyAllLimit = limits.find(
		(l) =>
			l.kind === "weekly_all" || (!l.kind && l.group === "weekly" && !l.scope),
	);

	const fiveHour =
		parseLimit(sessionLimit ?? null, logger) ??
		parseWindow(root.five_hour as RawWindow | null, logger);
	const sevenDay =
		parseLimit(weeklyAllLimit ?? null, logger) ??
		parseWindow(root.seven_day as RawWindow | null, logger);

	// Scoped weekly limits: the API decides which model is scoped and labels it.
	const scopedWeekly: ApiScopedWindow[] = [];
	for (const limit of limits) {
		if (limit.kind !== "weekly_scoped") continue;
		const window = parseLimit(limit, logger);
		const label = scopeLabel(limit);
		if (!window || !label) continue;
		scopedWeekly.push({ ...window, label });
	}

	// Legacy fallback: fixed per-model keys, used only when limits[] gave us none
	if (scopedWeekly.length === 0) {
		for (const [key, label] of [
			["seven_day_sonnet", "Sonnet"],
			["seven_day_opus", "Opus"],
		] as const) {
			const window = parseWindow(root[key] as RawWindow | null, logger);
			if (window) scopedWeekly.push({ ...window, label });
		}
	}

	return {
		fiveHour,
		sevenDay,
		scopedWeekly,
		rateLimitTier:
			typeof root.rate_limit_tier === "string" ? root.rate_limit_tier : null,
		extraUsage: parseExtraUsage(
			root.extra_usage as Record<string, unknown> | null,
		),
		spend: parseSpend(root.spend as Record<string, unknown> | null),
		fetchedAt: new Date(),
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
						resolve({ ok: true, data: parseUsagePayload(json, logger) });
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
