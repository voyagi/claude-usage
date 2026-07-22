/**
 * StatusBarManager - Manages three status bar items for Claude usage monitoring
 * Each rate limit (Session, Weekly, and the model-scoped weekly limit) gets its
 * own color-coded item. The scoped item is hidden until we know which model it
 * covers -- Anthropic changes that model (Sonnet -> Opus -> Fable as of 2026-07).
 */

import * as vscode from "vscode";
import { predictTimeUntilLimit } from "../core/burnRate.js";
import type { AuthState, StatusBarData } from "../types.js";
import {
	formatBarGraph,
	formatBurnRate,
	formatCooldown,
	formatCooldownCompact,
	formatCost,
	formatPaceForecast,
	formatPercentage,
	formatResetTime24h,
	formatTokensExact,
} from "./formatting.js";

// Distinct text colors for each rate limit (readable on dark status bar)
const SESSION_COLOR = "#4EC9B0"; // teal
const WEEKLY_COLOR = "#DCDCAA"; // yellow
/**
 * Whether to show dollar figures, matching the dashboard rule: on a
 * subscription a per-token cost is an API-equivalent estimate, not a bill, so
 * it only appears when the account actually has usage credits enabled.
 */
function shouldShowCost(api: StatusBarData["apiUsage"]): boolean {
	const mode = vscode.workspace
		.getConfiguration("claude-usage")
		.get<"auto" | "always" | "never">("showCostEstimates", "auto");
	if (mode === "always") return true;
	if (mode === "never") return false;
	return api?.spend?.enabled === true || api?.extraUsage?.isEnabled === true;
}

const SCOPED_COLOR = "#C586C0"; // purple
const STALE_COLOR = "#808080"; // gray for dim/stale data
const CRITICAL_COLOR = "#555555"; // very dim for critical staleness

export class StatusBarManager {
	private sessionItem: vscode.StatusBarItem;
	private weeklyItem: vscode.StatusBarItem;
	private scopedItem: vscode.StatusBarItem;
	private errorTimer: NodeJS.Timeout | undefined;
	private _visible = true;
	private lastSignature = "";
	private _authState: AuthState = "healthy";
	private _rateLimited = false;
	/**
	 * Whether we know which model the weekly scoped limit covers. Until we do,
	 * the scoped item stays hidden rather than showing a nameless ":0%".
	 */
	private _hasScopedLimit = false;

	constructor(context: vscode.ExtensionContext) {
		// Use high, adjacent priorities so all 3 stay grouped together
		this.sessionItem = vscode.window.createStatusBarItem(
			"claude-usage.session",
			vscode.StatusBarAlignment.Right,
			-10000,
		);
		this.sessionItem.command = "claude-usage.openDashboard";
		this.sessionItem.color = SESSION_COLOR;
		context.subscriptions.push(this.sessionItem);

		this.weeklyItem = vscode.window.createStatusBarItem(
			"claude-usage.weekly",
			vscode.StatusBarAlignment.Right,
			-10001,
		);
		this.weeklyItem.command = "claude-usage.openDashboard";
		this.weeklyItem.color = WEEKLY_COLOR;
		context.subscriptions.push(this.weeklyItem);

		this.scopedItem = vscode.window.createStatusBarItem(
			"claude-usage.scopedWeekly",
			vscode.StatusBarAlignment.Right,
			-10002,
		);
		this.scopedItem.command = "claude-usage.openDashboard";
		this.scopedItem.color = SCOPED_COLOR;
		context.subscriptions.push(this.scopedItem);

		// Show initial loading state on session item only
		this.sessionItem.text = "$(loading~spin) Claude: Loading...";
		this.sessionItem.show();
		this.weeklyItem.hide();
		this.scopedItem.hide();
	}

	/**
	 * Update all three status bar items with new data
	 */
	update(data: StatusBarData): void {
		if (this.errorTimer) {
			clearTimeout(this.errorTimer);
			this.errorTimer = undefined;
		}

		const api = data.apiUsage;
		const sessionPct = api?.fiveHour
			? Math.round(api.fiveHour.utilization * 100)
			: data.rateLimits.session5h.percentage;
		const weeklyPct = api?.sevenDay
			? Math.round(api.sevenDay.utilization * 100)
			: data.rateLimits.weekly.percentage;
		// The model-scoped weekly limit: prefer the API (it names the model), fall
		// back to the local estimate, and render nothing when neither knows.
		const scopedApi = api?.scopedWeekly?.[0] ?? null;
		const scopedLocal = data.rateLimits.weeklyScoped;
		// `||`, not `??`: an empty-string label is as unknown as a missing one,
		// and letting "" through would render the nameless ":0%" this guards.
		const scopedLabel =
			scopedApi?.label ||
			scopedLocal?.name.replace(/^Weekly\s+/, "").trim() ||
			null;
		const scopedPct = scopedApi
			? Math.round(scopedApi.utilization * 100)
			: (scopedLocal?.percentage ?? 0);

		const sessionReset = api?.fiveHour?.resetsAt
			? new Date(api.fiveHour.resetsAt)
			: data.rateLimits.session5h.resetTime;
		const weeklyReset = api?.sevenDay?.resetsAt
			? new Date(api.sevenDay.resetsAt)
			: data.rateLimits.weekly.resetTime;
		const scopedReset = scopedApi?.resetsAt
			? new Date(scopedApi.resetsAt)
			: (scopedLocal?.resetTime ?? null);

		// Build text for each item
		const sCd = formatCooldownCompact(sessionReset);
		const wCd = formatCooldownCompact(weeklyReset);
		const soCd = formatCooldownCompact(scopedReset);

		// Two-letter prefix from the model name, e.g. "Fable" -> "Fa:"
		const scopedPrefix = scopedLabel ? scopedLabel.slice(0, 2) : "";

		// Skip redundant re-renders via signature hash
		const staleness = data.staleness;
		const signature = `${sessionPct}|${weeklyPct}|${scopedLabel ?? "-"}:${scopedPct}|${staleness}|${sCd}|${wCd}|${soCd}|${data.todayCost.toFixed(2)}|${Math.round(data.burnRate)}`;
		if (signature === this.lastSignature) return;
		this.lastSignature = signature;

		if (this._authState === "dead") {
			this.sessionItem.text = "$(key) Auth expired";
			this.weeklyItem.text = `W:${formatPercentage(weeklyPct)} ?`;
			this.scopedItem.text = `${scopedPrefix}:${formatPercentage(scopedPct)} ?`;
		} else {
			const staleMarker =
				!this._rateLimited &&
				(staleness === "stale" || staleness === "critical")
					? " ?"
					: "";
			this.sessionItem.text = `S:${formatPercentage(sessionPct)}${sCd ? ` ${sCd}` : ""}${staleMarker}`;
			this.weeklyItem.text = `W:${formatPercentage(weeklyPct)}${wCd ? ` ${wCd}` : ""}`;
			this.scopedItem.text = `${scopedPrefix}:${formatPercentage(scopedPct)}${soCd ? ` ${soCd}` : ""}`;
		}

		// Apply staleness dimming
		// When rate-limited (429), suppress dimming: the data is still valid
		// because rate limits are 5h/7d windows that change slowly.
		const effectiveStaleness = this._rateLimited ? "normal" : staleness;
		if (this._authState === "dead" || effectiveStaleness === "critical") {
			this.sessionItem.color = CRITICAL_COLOR;
			this.weeklyItem.color = CRITICAL_COLOR;
			this.scopedItem.color = CRITICAL_COLOR;
		} else if (
			effectiveStaleness === "stale" ||
			effectiveStaleness === "unavailable"
		) {
			this.sessionItem.color = STALE_COLOR;
			this.weeklyItem.color = STALE_COLOR;
			this.scopedItem.color = STALE_COLOR;
		} else {
			this.sessionItem.color = SESSION_COLOR;
			this.weeklyItem.color = WEEKLY_COLOR;
			this.scopedItem.color = SCOPED_COLOR;
		}

		// Build shared tooltip (same on all items)
		const tooltip = this.buildTooltip(
			data,
			api,
			sessionPct,
			weeklyPct,
			scopedLabel,
			scopedPct,
			sessionReset,
			weeklyReset,
			scopedReset,
		);
		this.sessionItem.tooltip = tooltip;
		this.weeklyItem.tooltip = tooltip;
		this.scopedItem.tooltip = tooltip;

		this.sessionItem.show();
		this.weeklyItem.show();
		// No scoped limit known (API unreachable and never seen before): showing a
		// bare ":0%" would be worse than showing nothing.
		this._hasScopedLimit = Boolean(scopedLabel);
		if (this._hasScopedLimit) {
			this.scopedItem.show();
		} else {
			this.scopedItem.hide();
		}
	}

	private buildTooltip(
		data: StatusBarData,
		api: StatusBarData["apiUsage"],
		sessionPct: number,
		weeklyPct: number,
		scopedLabel: string | null,
		scopedPct: number,
		sessionReset: Date | null,
		weeklyReset: Date | null,
		scopedReset: Date | null,
	): vscode.MarkdownString {
		const tooltip = new vscode.MarkdownString();
		tooltip.isTrusted = true;
		tooltip.supportHtml = false;

		tooltip.appendMarkdown("**Claude Usage Monitor**\n\n");
		// Same rule as the dashboard: a per-token cost is an API-equivalent
		// estimate, not a subscriber's bill, so it only appears when the account
		// actually spends money.
		// The token totals further down carry the same information without
		// implying a bill, so there is nothing to substitute here.
		if (shouldShowCost(api)) {
			tooltip.appendMarkdown(
				`**Today:** ${formatCost(data.todayCost)} | **Month:** ${formatCost(data.monthCost)}\n\n`,
			);
		}

		if (api) {
			tooltip.appendMarkdown("**Rate Limits**\n\n");
		} else {
			tooltip.appendMarkdown(
				"**Rate Limits** _(estimated -- API unavailable)_\n\n",
			);
		}

		const limitEntries: {
			name: string;
			resetTime: Date | null;
			pct: number;
		}[] = [
			{ name: "Session (5hr)", resetTime: sessionReset, pct: sessionPct },
			{ name: "Weekly (7 day)", resetTime: weeklyReset, pct: weeklyPct },
		];
		if (scopedLabel) {
			limitEntries.push({
				name: `Weekly ${scopedLabel}`,
				resetTime: scopedReset,
				pct: scopedPct,
			});
		}

		for (const entry of limitEntries) {
			const bar = formatBarGraph(entry.pct);
			let line = `\`${bar}\` ${entry.name}`;
			const cd = formatCooldown(entry.resetTime);
			const exactTime = formatResetTime24h(entry.resetTime);
			if (cd && exactTime) {
				line += ` -- resets in ${cd} (${exactTime})`;
			} else if (cd) {
				line += ` -- resets in ${cd}`;
			}
			tooltip.appendMarkdown(`${line}\n\n`);
		}

		if (data.burnRate > 0) {
			tooltip.appendMarkdown(
				`**Burn Rate:** ${formatBurnRate(data.burnRate)}\n\n`,
			);

			// Pace forecast: use API utilization when available (accurate),
			// fall back to JSONL token estimates (inaccurate)
			const forecasts = [
				{
					name: "Session",
					pct: api?.fiveHour?.utilization,
					current: data.rateLimits.session5h.currentTokens,
					limit: data.rateLimits.session5h.estimatedLimit,
				},
				{
					name: "Weekly",
					pct: api?.sevenDay?.utilization,
					current: data.rateLimits.weekly.currentTokens,
					limit: data.rateLimits.weekly.estimatedLimit,
				},
			];
			for (const f of forecasts) {
				let current = f.current;
				let limit = f.limit;
				// When API utilization is available, synthesize current/limit
				// from it so the forecast matches the API percentage
				if (f.pct != null && limit > 0) {
					current = f.pct * limit;
				} else if (f.pct != null) {
					// No JSONL limit but have API pct: use a synthetic limit
					limit = 1_000_000;
					current = f.pct * limit;
				}
				const minutes = predictTimeUntilLimit(current, limit, data.burnRate);
				const forecast = formatPaceForecast(minutes, f.name);
				if (forecast) {
					tooltip.appendMarkdown(`${forecast}\n\n`);
				}
			}
		}

		tooltip.appendMarkdown(
			`**Tokens:** ${formatTokensExact(data.totalInputTokens)} in / ${formatTokensExact(data.totalOutputTokens)} out\n\n`,
		);
		// Auth/staleness warning with actionable hints
		if (this._authState === "dead") {
			tooltip.appendMarkdown(
				"\u26D4 _Auth expired. Re-authenticate in Claude Code to restore live data._\n\n",
			);
		} else if (
			!this._rateLimited &&
			(data.staleness === "stale" || data.staleness === "critical")
		) {
			const ageMs = api?.fetchedAt
				? Date.now() - new Date(api.fetchedAt).getTime()
				: 0;
			const ageMin = Math.round(ageMs / 60_000);
			tooltip.appendMarkdown(
				`\u26A0\uFE0F _API data is ${ageMin}m old. Click to refresh._\n\n`,
			);
		} else if (data.staleness === "unavailable") {
			tooltip.appendMarkdown(
				"\u2139\uFE0F _API not connected. Rate limits are estimated from local data._\n\n",
			);
		} else if (!api) {
			tooltip.appendMarkdown(
				"\u2139\uFE0F _Rate limits estimated (API unavailable)_\n\n",
			);
		}

		tooltip.appendMarkdown(
			`Files: ${data.filesProcessed} | Updated: ${data.lastUpdated.toLocaleTimeString()}`,
		);

		return tooltip;
	}

	/**
	 * Update the auth state for display purposes.
	 * Called by the extension when PollingTimer's auth state changes.
	 */
	setAuthState(state: AuthState): void {
		this._authState = state;
		// Invalidate signature to force re-render on next update()
		this.lastSignature = "";
	}

	/**
	 * Mark whether the API is rate-limited (429).
	 * When rate-limited, staleness dimming is suppressed because the data
	 * is still valid (rate limits are 5h/7d windows that change slowly).
	 */
	setRateLimited(limited: boolean): void {
		this._rateLimited = limited;
		this.lastSignature = "";
	}

	showRefreshing(): void {
		this.sessionItem.text = "$(sync~spin) Refreshing...";
		this.sessionItem.backgroundColor = undefined;
		this.weeklyItem.hide();
		this.scopedItem.hide();
	}

	showError(message: string): void {
		this.sessionItem.text = "$(warning) Claude: Error";
		this.sessionItem.tooltip = message;
		this.weeklyItem.hide();
		this.scopedItem.hide();

		this.errorTimer = setTimeout(() => {
			this.showNoData();
		}, 5000);
	}

	showNoData(): void {
		this.sessionItem.text = "$(cloud) Claude: No data";
		this.sessionItem.tooltip =
			"No Claude usage data found. Start using Claude Code to see usage stats.";
		this.sessionItem.backgroundColor = undefined;
		this.sessionItem.show();
		this.weeklyItem.hide();
		this.scopedItem.hide();
	}

	toggle(): void {
		this._visible = !this._visible;
		if (this._visible) {
			this.sessionItem.show();
			this.weeklyItem.show();
			// Only restore the scoped item if we actually know which model it
			// covers; showing it unconditionally would resurrect a blank ":0%".
			if (this._hasScopedLimit) {
				this.scopedItem.show();
			}
		} else {
			this.sessionItem.hide();
			this.weeklyItem.hide();
			this.scopedItem.hide();
		}
	}

	dispose(): void {
		if (this.errorTimer) {
			clearTimeout(this.errorTimer);
		}
		this.sessionItem.dispose();
		this.weeklyItem.dispose();
		this.scopedItem.dispose();
	}
}
