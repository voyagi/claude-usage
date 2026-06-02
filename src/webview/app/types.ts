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

	// Rate limits (all three limits with detailed info)
	session5h: RateLimitData;
	weekly: RateLimitData;
	weeklySonnet: RateLimitData;

	// Predictive weekly-cap forecast (null when not computable)
	weeklyForecast: WeeklyCapForecast | null;

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
