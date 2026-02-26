/**
 * StatusBarManager - Manages three status bar items for Claude usage monitoring
 * Each rate limit (Session, Weekly, Sonnet) gets its own color-coded item
 */

import * as vscode from "vscode";
import { predictTimeUntilLimit } from "../core/burnRate.js";
import type { StatusBarData } from "../types.js";
import {
	formatBurnRate,
	formatCooldown,
	formatCooldownCompact,
	formatCost,
	formatPercentage,
	formatResetTime24h,
	formatTimeUntilLimit,
	formatTokensExact,
} from "./formatting.js";

// Distinct text colors for each rate limit (readable on dark status bar)
const SESSION_COLOR = "#4EC9B0"; // teal
const WEEKLY_COLOR = "#DCDCAA"; // yellow
const SONNET_COLOR = "#C586C0"; // purple

export class StatusBarManager {
	private sessionItem: vscode.StatusBarItem;
	private weeklyItem: vscode.StatusBarItem;
	private sonnetItem: vscode.StatusBarItem;
	private errorTimer: NodeJS.Timeout | undefined;
	private _visible = true;

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

		this.sonnetItem = vscode.window.createStatusBarItem(
			"claude-usage.sonnet",
			vscode.StatusBarAlignment.Right,
			-10002,
		);
		this.sonnetItem.command = "claude-usage.openDashboard";
		this.sonnetItem.color = SONNET_COLOR;
		context.subscriptions.push(this.sonnetItem);

		// Show initial loading state on session item only
		this.sessionItem.text = "$(loading~spin) Claude: Loading...";
		this.sessionItem.show();
		this.weeklyItem.hide();
		this.sonnetItem.hide();
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
		const sonnetPct = api?.sevenDaySonnet
			? Math.round(api.sevenDaySonnet.utilization * 100)
			: data.rateLimits.weeklySonnet.percentage;

		const sessionReset = api?.fiveHour?.resetsAt
			? new Date(api.fiveHour.resetsAt)
			: data.rateLimits.session5h.resetTime;
		const weeklyReset = api?.sevenDay?.resetsAt
			? new Date(api.sevenDay.resetsAt)
			: data.rateLimits.weekly.resetTime;
		const sonnetReset = api?.sevenDaySonnet?.resetsAt
			? new Date(api.sevenDaySonnet.resetsAt)
			: data.rateLimits.weeklySonnet.resetTime;

		// Build text for each item
		const sCd = formatCooldownCompact(sessionReset);
		const wCd = formatCooldownCompact(weeklyReset);
		const soCd = formatCooldownCompact(sonnetReset);

		this.sessionItem.text = `S:${formatPercentage(sessionPct)}${sCd ? ` ${sCd}` : ""}`;
		this.weeklyItem.text = `W:${formatPercentage(weeklyPct)}${wCd ? ` ${wCd}` : ""}`;
		this.sonnetItem.text = `So:${formatPercentage(sonnetPct)}${soCd ? ` ${soCd}` : ""}`;

		// Build shared tooltip (same on all 3 items)
		const tooltip = this.buildTooltip(
			data,
			api,
			sessionPct,
			weeklyPct,
			sonnetPct,
			sessionReset,
			weeklyReset,
			sonnetReset,
		);
		this.sessionItem.tooltip = tooltip;
		this.weeklyItem.tooltip = tooltip;
		this.sonnetItem.tooltip = tooltip;

		this.sessionItem.show();
		this.weeklyItem.show();
		this.sonnetItem.show();
	}

	private buildTooltip(
		data: StatusBarData,
		api: StatusBarData["apiUsage"],
		sessionPct: number,
		weeklyPct: number,
		sonnetPct: number,
		sessionReset: Date | null,
		weeklyReset: Date | null,
		sonnetReset: Date | null,
	): vscode.MarkdownString {
		const tooltip = new vscode.MarkdownString();
		tooltip.isTrusted = true;
		tooltip.supportHtml = false;

		tooltip.appendMarkdown("**Claude Usage Monitor**\n\n");
		tooltip.appendMarkdown(
			`**Today:** ${formatCost(data.todayCost)} | **Month:** ${formatCost(data.monthCost)}\n\n`,
		);

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
			{ name: "Weekly Sonnet", resetTime: sonnetReset, pct: sonnetPct },
		];

		for (const entry of limitEntries) {
			let line = `- ${entry.name}: **${formatPercentage(entry.pct)}**`;
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
			const minutesUntilSession = predictTimeUntilLimit(
				data.rateLimits.session5h.currentTokens,
				data.rateLimits.session5h.estimatedLimit,
				data.burnRate,
			);
			if (minutesUntilSession !== null) {
				tooltip.appendMarkdown(
					`**Est. Time to Session Limit:** ${formatTimeUntilLimit(minutesUntilSession)}\n\n`,
				);
			}
		}

		tooltip.appendMarkdown(
			`**Tokens:** ${formatTokensExact(data.totalInputTokens)} in / ${formatTokensExact(data.totalOutputTokens)} out\n\n`,
		);
		tooltip.appendMarkdown(
			`Files: ${data.filesProcessed} | Updated: ${data.lastUpdated.toLocaleTimeString()}`,
		);

		return tooltip;
	}

	showRefreshing(): void {
		this.sessionItem.text = "$(sync~spin) Refreshing...";
		this.sessionItem.backgroundColor = undefined;
		this.weeklyItem.hide();
		this.sonnetItem.hide();
	}

	showError(message: string): void {
		this.sessionItem.text = "$(warning) Claude: Error";
		this.sessionItem.tooltip = message;
		this.weeklyItem.hide();
		this.sonnetItem.hide();

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
		this.sonnetItem.hide();
	}

	toggle(): void {
		this._visible = !this._visible;
		if (this._visible) {
			this.sessionItem.show();
			this.weeklyItem.show();
			this.sonnetItem.show();
		} else {
			this.sessionItem.hide();
			this.weeklyItem.hide();
			this.sonnetItem.hide();
		}
	}

	dispose(): void {
		if (this.errorTimer) {
			clearTimeout(this.errorTimer);
		}
		this.sessionItem.dispose();
		this.weeklyItem.dispose();
		this.sonnetItem.dispose();
	}
}
