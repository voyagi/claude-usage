/**
 * Message type definitions for extension-webview communication.
 * These types define the contract between the VS Code extension and the React dashboard.
 */

/**
 * Single data point for trend charts (time series visualization)
 */
export interface TrendDataPoint {
	period: string; // e.g., "2026-02-07" for daily, "2026-W06" for weekly
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
	totalCost: number;
	messageCount: number;
}

/**
 * Single message detail for per-command drill-down view
 */
export interface MessageDetail {
	timestamp: string; // ISO 8601
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
	cost: number;
}

/**
 * Rate limit information (serialization-safe version of RateLimitInfo)
 */
export interface RateLimitData {
	name: string;
	currentTokens: number;
	estimatedLimit: number;
	percentage: number;
	resetTime: string | null; // ISO 8601 string for serialization
	isHit: boolean;
	/**
	 * True when the percentage came from local JSONL rather than the API.
	 *
	 * Every row needs this, not just the scoped one: with the API unreachable
	 * the session and weekly percentages are estimates too, and an unqualified
	 * number is the kind of confident-and-wrong the rest of this codebase goes
	 * out of its way to avoid.
	 */
	isEstimated: boolean;
}

/**
 * A model-scoped weekly limit. `label` is the API's display name for the scoped
 * model (e.g. "Fable").
 */
export interface ScopedRateLimitData extends RateLimitData {
	label: string;
}

/** Behaviour signal keys, mirroring src/aggregation/attribution.ts */
export type BehaviorKey =
	| "cacheMiss"
	| "longContext"
	| "subagentHeavy"
	| "highParallel"
	| "longRunning";

/** One named contributor (skill, subagent, plugin, MCP server) */
export interface AttributionEntry {
	name: string;
	cost: number;
	percentage: number;
}

/** One behaviour signal */
export interface BehaviorEntry {
	key: BehaviorKey;
	percentage: number;
}

/** Attribution for one time window (serialization-safe) */
export interface AttributionWindow {
	totalCost: number;
	recordCount: number;
	behaviors: BehaviorEntry[];
	skills: AttributionEntry[];
	agents: AttributionEntry[];
	plugins: AttributionEntry[];
	mcpServers: AttributionEntry[];
}

/** Day and week attribution views for the "what's contributing" section */
export interface UsageAttribution {
	day: AttributionWindow;
	week: AttributionWindow;
}

/** Age of the API figures, mirroring src/types.ts StalenessLevel */
export type StalenessLevel =
	| "fresh"
	| "normal"
	| "dim"
	| "stale"
	| "critical"
	| "unavailable";

/** Usage-credit spend, in major currency units (serialization-safe) */
export interface SpendSummary {
	used: number;
	limit: number | null;
	percentage: number;
	currency: string;
}

/**
 * Per-project usage totals (serialization-safe).
 */
export interface ProjectUsage {
	project: string; // friendly project name (basename of cwd), or "unknown"
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
	totalCost: number;
	messageCount: number;
}

/**
 * Predictive weekly-cap forecast (serialization-safe; plain numbers/bool).
 */
export interface WeeklyCapForecast {
	avgDailyTokens: number;
	daysUntilCap: number;
	daysUntilReset: number;
	willExceedBeforeReset: boolean;
}

/**
 * Complete dashboard data payload sent from extension to webview.
 * Contains all information needed by Overview, Trends, Session, and Projects tabs.
 */
export interface DashboardData {
	// Token breakdown (current window/day/period)
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;

	// Cost data
	todayCost: number;
	monthCost: number;
	totalCost: number;

	// Rate limits with detailed info
	session5h: RateLimitData;
	weekly: RateLimitData;
	/**
	 * Model-scoped weekly limits (e.g. "Weekly Fable"). Empty when the API is
	 * unreachable and no scoped model has been seen -- which model Anthropic
	 * scopes changes over time, so it is never assumed.
	 */
	scopedWeekly: ScopedRateLimitData[];

	// Predictive weekly-cap forecast (null when not computable)
	weeklyForecast: WeeklyCapForecast | null;

	/**
	 * What usage is attributable to (skills, subagents, plugins, MCP servers)
	 * plus independent behaviour signals, for the last 24h and 7d. Null until a
	 * full parse has produced records.
	 */
	attribution: UsageAttribution | null;

	/**
	 * Usage credits that cover you past the plan limits. Null unless the account
	 * has extra usage enabled.
	 */
	spend: SpendSummary | null;

	/**
	 * How old the API figures are. A row sourced from a stale cache is exact but
	 * out of date, which `isEstimated` does not capture -- it only distinguishes
	 * API from local. The status bar already dims for this; the dashboard says it.
	 */
	apiStaleness: StalenessLevel;

	// Session timing
	windowStart: string | null; // ISO 8601 string
	windowExpiry: string | null; // ISO 8601 string
	timeRemainingMinutes: number | null;

	// Burn rate
	tokensPerMinute: number;
	minutesUntilLimit: number | null;

	// Time series data for charts
	trendData: TrendDataPoint[];

	// Per-project usage breakdown (sorted by cost, desc)
	projects: ProjectUsage[];

	// Session comparison
	currentSessionTokens: number;
	averageSessionTokens: number;
	sessionCount: number;

	// Metadata
	lastUpdated: string; // ISO 8601 string
	filesProcessed: number;
	linesSkipped: number;
	planType: string; // e.g., "max_5x", "max_20x", "pro"

	// Trust & transparency
	dataSourcePath: string; // Watched directory path for transparency footer
	isFirstRun: boolean; // True if user has never seen the dashboard before
	hasCustomPricing: boolean; // True if user has overridden any pricing values

	// Parse health: assistant usage records that failed the schema in the last
	// full parse. > 0 means Claude Code's transcript format may have drifted, so
	// totals could be undercounted.
	unparsedUsageRecords: number;
}

/**
 * Messages sent FROM webview TO extension
 */
export type WebviewMessage =
	| { type: "requestData" }
	| { type: "changePeriod"; period: "daily" | "weekly" | "monthly" }
	| { type: "dismissWelcome" }
	| {
			type: "requestMessageDetail";
			period: string;
			periodType: "daily" | "weekly" | "monthly";
	  };

/**
 * Messages sent FROM extension TO webview
 */
export type ExtensionMessage =
	| { type: "usageData"; payload: DashboardData }
	| { type: "periodData"; payload: { period: string; data: TrendDataPoint[] } }
	| {
			type: "messageDetailData";
			payload: { period: string; messages: MessageDetail[] };
	  };
