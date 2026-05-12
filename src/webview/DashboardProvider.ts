/**
 * WebviewViewProvider for the sidebar dashboard panel.
 * Manages webview lifecycle, HTML generation, CSP, and message passing.
 */

import * as crypto from "node:crypto";
import { format, getISOWeek, getISOWeekYear, subHours } from "date-fns";
import * as vscode from "vscode";
import type {
	RateLimitInfo,
	StatusBarData,
	TimeBuckets,
	TokenUsage,
} from "../types.js";
import { getClaudeProjectsDir } from "../utils/paths.js";
import type {
	DashboardData,
	ExtensionMessage,
	MessageDetail,
	RateLimitData,
	TrendDataPoint,
	WebviewMessage,
} from "./app/types.js";

export class DashboardProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "claude-usage.dashboardView";

	private _view?: vscode.WebviewView;
	private _currentData?: DashboardData;
	private _buckets?: TimeBuckets;
	private _statusBarData?: StatusBarData;
	private _records: TokenUsage[] = [];
	private _planType: string = "pro";
	private _activePeriod: "daily" | "weekly" | "monthly" = "daily";
	private _isFirstRun: boolean = false;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _context: vscode.ExtensionContext,
	) {
		// Check first-run status
		const welcomeDismissed = _context.globalState.get<string>(
			"welcomeDismissedVersion",
		);
		this._isFirstRun = !welcomeDismissed;
	}

	/**
	 * Transform internal TimeBuckets + StatusBarData into webview-safe DashboardData.
	 * This is the core data transformation pipeline for the dashboard.
	 */
	public static buildDashboardData(
		buckets: TimeBuckets,
		statusBarData: StatusBarData,
		planType: string,
		activePeriod: "daily" | "weekly" | "monthly" = "daily",
		isFirstRun: boolean = false,
		hasCustomPricing: boolean = false,
	): DashboardData {
		const now = new Date();
		const today = format(now, "yyyy-MM-dd");

		// 1. Token breakdown - get cache tokens from today's daily bucket
		const todayBucket = buckets.daily.get(today);
		const cacheCreationTokens = todayBucket?.cacheCreationTokens ?? 0;
		const cacheReadTokens = todayBucket?.cacheReadTokens ?? 0;

		// 2. Cost data - direct from statusBarData
		const todayCost = statusBarData.todayCost;
		const monthCost = statusBarData.monthCost;
		const totalCost = statusBarData.totalCost;

		// 3. Rate limits - use API data when available, fall back to JSONL estimates
		const api = statusBarData.apiUsage;

		const convertRateLimit = (
			info: RateLimitInfo,
			apiWindow: { utilization: number; resetsAt: string | null } | null,
		): RateLimitData => ({
			name: info.name,
			currentTokens: info.currentTokens,
			estimatedLimit: info.estimatedLimit,
			percentage: apiWindow
				? Math.round(apiWindow.utilization * 100)
				: info.percentage,
			resetTime: apiWindow?.resetsAt ?? info.resetTime?.toISOString() ?? null,
			isHit: apiWindow ? apiWindow.utilization >= 1.0 : info.isHit,
		});

		const session5h = convertRateLimit(
			statusBarData.rateLimits.session5h,
			api?.fiveHour ?? null,
		);
		const weekly = convertRateLimit(
			statusBarData.rateLimits.weekly,
			api?.sevenDay ?? null,
		);
		const weeklySonnet = convertRateLimit(
			statusBarData.rateLimits.weeklySonnet,
			api?.sevenDaySonnet ?? null,
		);

		// 4. Session timing - use API reset time when available
		let windowStart: string | null = null;
		let windowExpiry: string | null = null;
		let timeRemainingMinutes: number | null = null;

		const sessionResetSource = api?.fiveHour?.resetsAt
			? new Date(api.fiveHour.resetsAt)
			: statusBarData.rateLimits.session5h.resetTime;

		if (sessionResetSource) {
			const resetTime = sessionResetSource;
			windowExpiry = resetTime.toISOString();
			windowStart = new Date(
				resetTime.getTime() - 5 * 60 * 60 * 1000,
			).toISOString();
			timeRemainingMinutes = Math.max(
				0,
				Math.round((resetTime.getTime() - now.getTime()) / 60000),
			);
		}

		// 5. Burn rate
		const tokensPerMinute = statusBarData.burnRate;
		let minutesUntilLimit: number | null = null;
		if (tokensPerMinute > 0 && session5h.estimatedLimit > 0) {
			const remainingTokens =
				session5h.estimatedLimit - session5h.currentTokens;
			if (remainingTokens > 0) {
				minutesUntilLimit = Math.round(remainingTokens / tokensPerMinute);
			}
		}

		// 6. Trend data - convert appropriate bucket Map to TrendDataPoint[]
		const bucketMap = buckets[activePeriod];
		const trendData: TrendDataPoint[] = Array.from(bucketMap.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([period, agg]) => ({
				period,
				inputTokens: agg.inputTokens,
				outputTokens: agg.outputTokens,
				cacheCreationTokens: agg.cacheCreationTokens,
				cacheReadTokens: agg.cacheReadTokens,
				totalCost: agg.totalCost,
				messageCount: agg.messageCount,
			}));

		// 7. Session comparison - CRITICAL for Session tab
		// Current session: Sum output tokens from all sessions active in last 5 hours
		const fiveHoursAgo = subHours(now, 5);
		let currentSessionTokens = 0;
		for (const [_sessionId, agg] of buckets.session.entries()) {
			if (agg.lastMessage && agg.lastMessage >= fiveHoursAgo) {
				currentSessionTokens += agg.outputTokens;
			}
		}

		// Average session: Mean of ALL sessions' output tokens (historical)
		let totalOutputAcrossAllSessions = 0;
		for (const agg of buckets.session.values()) {
			totalOutputAcrossAllSessions += agg.outputTokens;
		}
		const sessionCount = buckets.session.size;
		const averageSessionTokens =
			sessionCount > 0
				? Math.round(totalOutputAcrossAllSessions / sessionCount)
				: 0;

		// 8. Metadata
		const lastUpdated = statusBarData.lastUpdated.toISOString();
		const filesProcessed = statusBarData.filesProcessed;
		const linesSkipped = statusBarData.linesSkipped;

		return {
			inputTokens: statusBarData.totalInputTokens,
			outputTokens: statusBarData.totalOutputTokens,
			cacheCreationTokens,
			cacheReadTokens,
			todayCost,
			monthCost,
			totalCost,
			session5h,
			weekly,
			weeklySonnet,
			windowStart,
			windowExpiry,
			timeRemainingMinutes,
			tokensPerMinute,
			minutesUntilLimit,
			trendData,
			currentSessionTokens,
			averageSessionTokens,
			sessionCount,
			lastUpdated,
			filesProcessed,
			linesSkipped,
			planType,
			dataSourcePath: getClaudeProjectsDir(),
			isFirstRun,
			hasCustomPricing,
		};
	}

	/**
	 * Called when the view first becomes visible.
	 * Sets up webview options, HTML content, and message handlers.
	 */
	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void | Thenable<void> {
		this._view = webviewView;

		// Configure webview
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
		};

		// Set HTML content
		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// Handle messages from webview
		webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
			switch (message.type) {
				case "requestData":
					// Send current data immediately if available
					if (this._currentData) {
						this._postMessage({
							type: "usageData",
							payload: this._currentData,
						});
					}
					break;

				case "changePeriod":
					// Update period and rebuild data with new trend aggregation
					this._activePeriod = message.period;
					if (this._buckets && this._statusBarData) {
						const data = DashboardProvider.buildDashboardData(
							this._buckets,
							this._statusBarData,
							this._planType,
							this._activePeriod,
							this._isFirstRun,
							this._hasCustomPricing(),
						);
						this.updateData(data);
					}
					break;

				case "dismissWelcome":
					this._isFirstRun = false;
					this._context.globalState.update("welcomeDismissedVersion", "0.1.0");
					// Rebuild and send data without welcome flag
					if (this._buckets && this._statusBarData) {
						const data = DashboardProvider.buildDashboardData(
							this._buckets,
							this._statusBarData,
							this._planType,
							this._activePeriod,
							false,
							this._hasCustomPricing(),
						);
						this.updateData(data);
					}
					break;

				case "requestMessageDetail":
					this._handleMessageDetailRequest(message.period, message.periodType);
					break;
			}
		});

		// Handle visibility changes - refresh data when becoming visible
		webviewView.onDidChangeVisibility(() => {
			if (webviewView.visible && this._currentData) {
				this._postMessage({ type: "usageData", payload: this._currentData });
			}
		});

		// Handle disposal
		webviewView.onDidDispose(() => {
			this._view = undefined;
		});
	}

	/**
	 * Public method for extension.ts to push buckets + statusBarData.
	 * Transforms data via buildDashboardData and caches for visibility refresh.
	 */
	public updateBuckets(
		buckets: TimeBuckets,
		statusBarData: StatusBarData,
		planType: string,
	): void {
		this._buckets = buckets;
		this._statusBarData = statusBarData;
		this._planType = planType;

		const data = DashboardProvider.buildDashboardData(
			buckets,
			statusBarData,
			planType,
			this._activePeriod,
			this._isFirstRun,
			this._hasCustomPricing(),
		);
		this.updateData(data);
	}

	/**
	 * Public method for extension.ts to push data updates to the webview.
	 * Data is cached so it can be sent when webview becomes visible.
	 */
	public updateData(data: DashboardData): void {
		this._currentData = data;

		// Post to webview if visible
		if (this._view?.visible) {
			this._postMessage({ type: "usageData", payload: data });
		}
	}

	/**
	 * Replace stored records for on-demand message detail drill-down.
	 */
	public setRecords(records: TokenUsage[]): void {
		this._records = records;
	}

	/**
	 * Filter stored records by period and send to webview.
	 */
	private _handleMessageDetailRequest(
		period: string,
		periodType: "daily" | "weekly" | "monthly",
	): void {
		const filtered = this._records.filter((r) => {
			switch (periodType) {
				case "daily":
					return format(r.timestamp, "yyyy-MM-dd") === period;
				case "weekly": {
					const wy = getISOWeekYear(r.timestamp);
					const wn = getISOWeek(r.timestamp);
					const key = `${wy}-W${String(wn).padStart(2, "0")}`;
					return key === period;
				}
				case "monthly":
					return format(r.timestamp, "yyyy-MM") === period;
				default:
					return false;
			}
		});

		const messages: MessageDetail[] = filtered
			.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
			.map((r) => ({
				timestamp: r.timestamp.toISOString(),
				model: r.model,
				inputTokens: r.inputTokens,
				outputTokens: r.outputTokens,
				cacheCreationTokens: r.cacheCreationTokens,
				cacheReadTokens: r.cacheReadTokens,
				cost: r.cost,
			}));

		this._postMessage({
			type: "messageDetailData",
			payload: { period, messages },
		});
	}

	/**
	 * Check if user has custom pricing overrides
	 */
	private _hasCustomPricing(): boolean {
		const pricing = vscode.workspace
			.getConfiguration("claude-usage")
			.get<object>("pricing", {});
		return Object.keys(pricing).length > 0;
	}

	/**
	 * Post a message to the webview (if it exists and is visible).
	 */
	private _postMessage(message: ExtensionMessage): void {
		if (this._view) {
			this._view.webview.postMessage(message);
		}
	}

	/**
	 * Generate the HTML content for the webview.
	 * Includes CSP, nonce-protected script loading, and root div for React.
	 */
	private _getHtmlForWebview(webview: vscode.Webview): string {
		// Generate nonce for CSP
		const nonce = this._getNonce();

		// Get URIs for bundled assets
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._extensionUri, "dist", "webview.js"),
		);

		// CSP configuration
		const csp = [
			`default-src 'none'`,
			`style-src ${webview.cspSource} 'unsafe-inline'`, // Allow inline styles for React
			`script-src 'nonce-${nonce}'`, // Only allow scripts with nonce
			`font-src ${webview.cspSource}`, // Allow fonts from extension
			`img-src ${webview.cspSource} data:`, // Allow images from extension and data URIs
		].join("; ");

		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Claude Usage Dashboard</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}

	/**
	 * Generate a cryptographically secure nonce for CSP.
	 */
	private _getNonce(): string {
		return crypto.randomBytes(16).toString("base64");
	}
}
