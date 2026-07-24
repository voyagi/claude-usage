/**
 * WebviewViewProvider for the sidebar dashboard panel.
 * Manages webview lifecycle, HTML generation, CSP, and message passing.
 */

import * as crypto from "node:crypto";
import { format, subDays, subHours } from "date-fns";
import * as vscode from "vscode";
import type { UsageAttribution } from "../aggregation/attribution.js";
import { computeAttribution } from "../aggregation/attribution.js";
import { dailyBucketKey, weeklyBucketKey } from "../aggregation/timeBuckets.js";
import { shouldShowCost } from "../config/costVisibility.js";
import type { WeeklyCapForecast } from "../core/burnRate.js";
import {
	forecastWeeklyCap,
	forecastWeeklyCapFromUtilization,
} from "../core/burnRate.js";
import { resetInstant } from "../core/resetInstant.js";
import type {
	AggregatedUsage,
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
	ProjectUsage,
	RateLimitData,
	ScopedRateLimitData,
	SpendSummary,
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
	/** Cached usage attribution, recomputed only when records change. */
	private _attribution: UsageAttribution | null = null;
	/** messageId -> record, so watcher updates can find what they amend. */
	private readonly _recordsByMessageId = new Map<string, TokenUsage>();
	private _planType: string = "pro";
	private _activePeriod: "daily" | "weekly" | "monthly" = "daily";
	private _isFirstRun: boolean = false;
	/** Assistant usage records that failed the schema in the last full parse (format-drift signal). */
	private _schemaFailures = 0;

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
	 * Usage credits the account actually has, or null when it has none.
	 *
	 * The API describes these two ways and an account may report either: the
	 * current `spend` object, and the older `extra_usage` one. Reading only
	 * `spend` would hide bought credits from anyone still served the old shape.
	 */
	private static _buildSpendSummary(
		api: StatusBarData["apiUsage"],
	): SpendSummary | null {
		/** Share of the credit limit used, preferring real amounts over a
		 * reported percentage: `parseSpend` defaults `percent` to 0 when the
		 * payload omits it, which would render "$20 of $50" as an empty bar. */
		const share = (
			used: number,
			limit: number | null,
			reportedPercent: number,
		): number => {
			if (limit !== null && limit > 0) {
				return Math.min(100, Math.max(0, (used / limit) * 100));
			}
			return Math.min(100, Math.max(0, reportedPercent));
		};

		const spend = api?.spend;
		if (spend?.enabled === true) {
			return {
				used: spend.used,
				limit: spend.limit,
				percentage: share(spend.used, spend.limit, spend.percent),
				currency: spend.currency,
				isDerived: false,
			};
		}

		const extra = api?.extraUsage;
		if (extra?.isEnabled === true) {
			const limit = extra.creditsTotal;
			// utilization is already normalised to 0-1 by the API parser
			const reportedPercent = (extra.utilization ?? 0) * 100;

			// Some payloads report a utilization but no used amount. Reading that
			// as 0 would both render "$0.00" on an account with real spend and,
			// where a limit exists, make share() derive 0/limit and discard the
			// utilization the parser preserved. Derive the amount where the limit
			// allows it; where it does not, say nothing rather than say zero.
			if (extra.creditsUsed === null) {
				// Neither an amount nor a utilization: the API told us credits
				// exist and nothing else. Reporting 0% would be a claim about the
				// account rather than a report of what it said.
				if (extra.utilization === null) {
					return {
						used: null,
						limit,
						percentage: null,
						currency: extra.currency ?? "USD",
						isDerived: false,
					};
				}

				const derived = limit !== null ? limit * extra.utilization : null;
				return {
					used: derived,
					limit,
					percentage: share(derived ?? 0, limit, reportedPercent),
					currency: extra.currency ?? "USD",
					isDerived: derived !== null,
				};
			}

			return {
				used: extra.creditsUsed,
				limit,
				percentage: share(extra.creditsUsed, limit, reportedPercent),
				currency: extra.currency ?? "USD",
				isDerived: false,
			};
		}

		return null;
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
	): Omit<DashboardData, "unparsedUsageRecords" | "attribution"> {
		const now = new Date();
		const today = dailyBucketKey(now);

		// 1. Token breakdown - get cache tokens from today's daily bucket
		const todayBucket = buckets.daily.get(today);
		const cacheCreationTokens = todayBucket?.cacheCreationTokens ?? 0;
		const cacheReadTokens = todayBucket?.cacheReadTokens ?? 0;

		// 2. Cost data - direct from statusBarData
		const todayCost = statusBarData.todayCost;
		const monthCost = statusBarData.monthCost;
		const totalCost = statusBarData.totalCost;

		// Token equivalents, shown instead of cost on a subscription. All four
		// token kinds, so this matches the Token Breakdown card below rather
		// than quietly counting only output.
		const sumTokens = (bucket: AggregatedUsage | undefined): number =>
			bucket
				? bucket.inputTokens +
					bucket.outputTokens +
					bucket.cacheCreationTokens +
					bucket.cacheReadTokens
				: 0;
		const todayTokens = sumTokens(todayBucket);
		const monthTokens = sumTokens(buckets.monthly.get(format(now, "yyyy-MM")));

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
			// Reaching past an API window that reported no reset would emit a
			// guessed instant under `isEstimated: false`, i.e. a guess wearing the
			// label of an authoritative reading. See resetInstant for why null is
			// carried through rather than filled.
			resetTime:
				resetInstant(apiWindow, { local: info.resetTime })?.toISOString() ??
				null,
			isHit: apiWindow ? apiWindow.utilization >= 1.0 : info.isHit,
			// Without an API window this percentage is local tokens over a plan
			// default, which is a guess and must be labelled as one.
			isEstimated: !apiWindow,
		});

		const session5h = convertRateLimit(
			statusBarData.rateLimits.session5h,
			api?.fiveHour ?? null,
		);
		const weekly = convertRateLimit(
			statusBarData.rateLimits.weekly,
			api?.sevenDay ?? null,
		);
		// Model-scoped weekly limits. The API is authoritative (it names the model
		// and gives the true percentage); the local estimate is only a fallback for
		// the one scoped model we have previously learned about.
		const scopedWeekly: ScopedRateLimitData[] = [];
		if (api?.scopedWeekly?.length) {
			for (const window of api.scopedWeekly) {
				const local =
					statusBarData.rateLimits.weeklyScoped?.name ===
					`Weekly ${window.label}`
						? statusBarData.rateLimits.weeklyScoped
						: null;
				scopedWeekly.push({
					name: `Weekly ${window.label}`,
					label: window.label,
					currentTokens: local?.currentTokens ?? 0,
					estimatedLimit: local?.estimatedLimit ?? 0,
					percentage: Math.round(window.utilization * 100),
					resetTime: window.resetsAt,
					isHit: window.utilization >= 1.0,
					isEstimated: false,
				});
			}
		} else if (statusBarData.rateLimits.weeklyScoped) {
			const local = statusBarData.rateLimits.weeklyScoped;
			scopedWeekly.push({
				name: local.name,
				label: local.name.replace(/^Weekly\s+/, "").trim(),
				currentTokens: local.currentTokens,
				estimatedLimit: local.estimatedLimit,
				percentage: local.percentage,
				resetTime: local.resetTime?.toISOString() ?? null,
				isHit: local.isHit,
				isEstimated: true,
			});
		}

		// Usage credits, shown only when the account actually has them enabled.
		// Two API objects describe the same thing: `spend` (current) and
		// `extra_usage` (older, still populated on some accounts). Prefer spend,
		// fall back to extra_usage, so a user who bought credits sees them
		// whichever shape their account reports.
		const spend = DashboardProvider._buildSpendSummary(api);

		// Shared with the status bar tooltip so the two cannot disagree about
		// whether this account deals in money.
		const showCost = shouldShowCost(api);

		// 4. Session timing - use API reset time when available
		let windowStart: string | null = null;
		let windowExpiry: string | null = null;
		let timeRemainingMinutes: number | null = null;

		// The same shared rule. This card derives three further fields from the
		// instant, so filling it from the local estimate would rebuild the whole
		// "Current Window" panel -- start, expiry and minutes remaining -- around
		// a guessed time, beside a session bar correctly showing none.
		const sessionResetSource = resetInstant(api?.fiveHour ?? null, {
			local: statusBarData.rateLimits.session5h.resetTime,
		});

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

		// 9. Per-project breakdown, sorted by cost (desc)
		const projects: ProjectUsage[] = Array.from(
			(buckets.project ?? new Map<string, AggregatedUsage>()).entries(),
		)
			.map(([project, agg]) => ({
				project,
				inputTokens: agg.inputTokens,
				outputTokens: agg.outputTokens,
				cacheCreationTokens: agg.cacheCreationTokens,
				cacheReadTokens: agg.cacheReadTokens,
				totalCost: agg.totalCost,
				messageCount: agg.messageCount,
			}))
			.sort((a, b) => b.totalCost - a.totalCost);

		// 10. Weekly-cap forecast.
		//
		// Prefer the API's own utilization. The local alternative counts output
		// tokens over an ISO calendar week and compares them against a
		// community-estimated plan cap, and the two do not describe the same
		// thing: on a real account the local view read 373% of cap while the API
		// read 65%, producing a red "you will hit the cap within the hour"
		// warning next to a two-thirds-full bar. Only fall back to local when
		// there is no API reading at all, and mark it as the guess it is.
		const daysUntil = (iso: string | null | undefined): number | null => {
			if (!iso) return null;
			const ms = new Date(iso).getTime();
			if (Number.isNaN(ms)) return null;
			return Math.max(0, (ms - now.getTime()) / (24 * 60 * 60 * 1000));
		};

		let weeklyForecast: WeeklyCapForecast | null = null;
		// The API projection needs the API's OWN reset time, not `weekly.resetTime`:
		// that falls back to the local ISO calendar week when resets_at is null,
		// which would divide an API utilization by a Monday-morning boundary and
		// fire red every Monday while going blind every Sunday night.
		const apiWeeklyResetDays = daysUntil(api?.sevenDay?.resetsAt);
		if (api?.sevenDay && apiWeeklyResetDays !== null) {
			weeklyForecast = forecastWeeklyCapFromUtilization(
				api.sevenDay.utilization,
				apiWeeklyResetDays,
			);
		} else if (!api?.sevenDay) {
			// Only when there is NO API reading at all. Falling back here merely
			// because `resets_at` was null would put the local 373%-of-plan-cap
			// artefact back on screen -- in red, captioned "no live limit data",
			// directly under a bar showing the API's exact percentage.
			const daysUntilWeeklyReset = daysUntil(weekly.resetTime) ?? 0;
			// Trailing 7-day average, not the short-window burn rate: that would
			// be a misleading 24/7 extrapolation.
			let last7DaysOutput = 0;
			for (let i = 0; i < 7; i++) {
				const day = dailyBucketKey(subDays(now, i));
				last7DaysOutput += buckets.daily.get(day)?.outputTokens ?? 0;
			}
			weeklyForecast = forecastWeeklyCap(
				weekly.currentTokens,
				weekly.estimatedLimit,
				last7DaysOutput / 7,
				daysUntilWeeklyReset,
			);
		}

		return {
			inputTokens: statusBarData.totalInputTokens,
			outputTokens: statusBarData.totalOutputTokens,
			cacheCreationTokens,
			cacheReadTokens,
			todayCost,
			monthCost,
			totalCost,
			todayTokens,
			monthTokens,
			session5h,
			weekly,
			scopedWeekly,
			spend,
			showCost,
			apiStaleness: statusBarData.staleness,
			windowStart,
			windowExpiry,
			timeRemainingMinutes,
			tokensPerMinute,
			minutesUntilLimit,
			trendData,
			projects,
			weeklyForecast,
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
			// unparsedUsageRecords is intentionally omitted here — updateData() is
			// the sole stamping point, enforced by this method's Omit<> return type.
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
	public updateData(
		data: Omit<DashboardData, "unparsedUsageRecords" | "attribution">,
	): void {
		// Stamp the latest parse-health signal on every push (all rebuild paths
		// funnel through here), so the format-drift warning persists across
		// incremental updates and period changes. Typing the input as Omit<>
		// makes it a compile error to cache or post data that skipped this stamp.
		const stamped: DashboardData = {
			...data,
			unparsedUsageRecords: this._schemaFailures,
			attribution: this._attribution,
		};
		this._currentData = stamped;

		// Post to webview if visible
		if (this._view?.visible) {
			this._postMessage({ type: "usageData", payload: stamped });
		}
	}

	/**
	 * Record parse health from the latest full parse (called by extension.ts). A
	 * non-zero count means Claude Code logged assistant usage this build couldn't
	 * read — a transcript-format-drift signal surfaced to the user.
	 *
	 * Only ever pass a real count from a completed full parse. Never call this
	 * with 0 from a cached-data load path — that would reset a genuine drift
	 * count before the user has seen the warning.
	 */
	public setParseHealth(schemaFailures: number): void {
		this._schemaFailures = schemaFailures;
		if (this._currentData) {
			this.updateData(this._currentData);
		}
	}

	/**
	 * Replace stored records for on-demand message detail drill-down.
	 *
	 * Attribution is recomputed here rather than per render: it is a full scan
	 * of every record, and the records only change on a reparse.
	 */
	public setRecords(records: TokenUsage[]): void {
		this._records = records;
		this._recordsByMessageId.clear();
		for (const record of records) {
			if (record.messageId)
				this._recordsByMessageId.set(record.messageId, record);
		}
		this._attribution = computeAttribution(records);
	}

	/**
	 * Add records counted by the file watcher since the last full parse.
	 *
	 * Without this the attribution card would freeze at whatever the last full
	 * parse saw: the watcher only pushed buckets, so live usage moved the totals
	 * and the rate-limit bars while "what's contributing" quietly went stale
	 * until the next restart or manual refresh.
	 *
	 * Two things this must not get wrong:
	 *
	 * - A top-up delta carries ONLY the extra tokens for a message counted on an
	 *   earlier read. Appending it would inflate the record count and, for a
	 *   subagent message, the subagent-request tally behind the subagent-heavy
	 *   signal. Dropping it instead would under-report that message's cost, so
	 *   the delta is folded into the record already held.
	 * - The same message can arrive again after a reset clears the watcher's
	 *   dedupe guard, so a repeat of an id we already hold replaces it rather
	 *   than appending a duplicate.
	 */
	public appendRecords(records: TokenUsage[]): void {
		if (records.length === 0) return;

		let changed = false;
		for (const record of records) {
			const existing = record.messageId
				? this._recordsByMessageId.get(record.messageId)
				: undefined;

			if (record.isTopUp) {
				// Fold the delta into the message it tops up. With no record to
				// top up (reset, or a full parse that never saw it) there is
				// nothing to correct, and the delta alone would misrepresent it.
				if (existing) {
					existing.inputTokens += record.inputTokens;
					existing.outputTokens += record.outputTokens;
					existing.cacheCreationTokens += record.cacheCreationTokens;
					existing.cacheReadTokens += record.cacheReadTokens;
					// The ephemeral split is part of the delta too; leaving it out
					// makes cacheCreationTokens exceed 5m + 1h on folded records.
					existing.cacheCreation5m += record.cacheCreation5m;
					existing.cacheCreation1h += record.cacheCreation1h;
					existing.cost += record.cost;
					changed = true;
				}
				continue;
			}

			if (existing) {
				// Re-read of a message we already hold. Overwrite the held object
				// in place rather than swapping it into the array: locating it
				// would be a linear scan of every record, once per re-read record,
				// and a re-read replays a whole file at once.
				//
				// Still reachable, though a reset no longer causes it: the watcher's
				// dedupe guard ages ids out after 6h idle while this index keeps
				// them, and a full parse's setRecords lands before the watcher is
				// seeded, so a file change in that window arrives as a full record
				// for an id already held. Do not delete this branch on the grounds
				// that resets now clear the records.
				//
				// Assign wholesale rather than field by field. A hand-written list
				// is what let the ephemeral cache split go missing from the fold
				// above, and it would silently skip any field added to TokenUsage
				// later. Safe here: this branch is unreachable for a top-up, and
				// the ids are equal by construction.
				Object.assign(existing, record);
			} else {
				this._records.push(record);
				if (record.messageId)
					this._recordsByMessageId.set(record.messageId, record);
			}
			changed = true;
		}

		if (changed) {
			this._attribution = computeAttribution(this._records);
		}
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
					// `period` is a daily bucket key round-tripped through the
					// webview, so it has to be compared using the same derivation.
					return dailyBucketKey(r.timestamp) === period;
				case "weekly":
					// Same derivation as the writer. Hand-rolling it here is what
					// let this disagree with the bucket keys around the turn of the
					// year -- 14 days across 2022-2027, none at all in some years --
					// returning an empty drill-down for those weeks.
					return weeklyBucketKey(r.timestamp) === period;
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

		// Get URIs for bundled assets.
		//
		// The stylesheet has to be linked explicitly. esbuild's "css" loader
		// emits dist/webview.css as a SIBLING of the JS bundle rather than
		// injecting it, so importing app.css from index.tsx is not enough: with
		// no <link> the file is built, packaged, and never loaded, and every
		// className in the React tree resolves to nothing.
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._extensionUri, "dist", "webview.js"),
		);
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._extensionUri, "dist", "webview.css"),
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
  <link rel="stylesheet" href="${styleUri}">
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
