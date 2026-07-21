/**
 * Domain types for Claude Usage Monitor
 */

/**
 * Token usage from a single assistant message
 */
export interface TokenUsage {
	timestamp: Date;
	model: string;
	sessionId: string;
	/**
	 * Anthropic message id (e.g. "msg_..."). Claude Code re-logs the same
	 * assistant message across many JSONL lines as it streams (the output-token
	 * count grows across the copies), so this is used to dedupe and count each
	 * response once, keeping the largest/final usage. Empty when absent.
	 */
	messageId?: string;
	/**
	 * Friendly project name derived from the JSONL `cwd` (its basename), used for
	 * the per-project usage breakdown. Empty/undefined when `cwd` is absent.
	 */
	projectName?: string;
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
	cacheCreation5m: number;
	cacheCreation1h: number;
	cost: number;
	/**
	 * Set only on the delta record returned by reconcileSeenUsage when a
	 * straddled message's later read tops up its tokens. The delta carries ONLY
	 * the extra tokens/cost for an already-counted message, so aggregation adds
	 * its tokens/cost but must NOT count it as a new message. Absent on every
	 * normal record.
	 */
	isTopUp?: boolean;
	/**
	 * What this request is attributable to, as recorded by Claude Code itself on
	 * the transcript line (`attributionSkill`, `attributionAgent`, ...). Absent
	 * on plain conversation turns, which is most of them -- kept as an optional
	 * object so those records stay small.
	 */
	attribution?: UsageAttributionTags;
}

/**
 * Attribution tags Claude Code stamps on a transcript record. Every field is
 * optional and independent: a skill can invoke a subagent that calls an MCP
 * tool, and the record then carries all three.
 */
export interface UsageAttributionTags {
	/** Skill or slash command, e.g. "suggest-run" */
	skill?: string;
	/** Subagent type, e.g. "post-task-reviewer", "workflow-subagent" */
	agent?: string;
	/** Plugin that owns the skill/agent, e.g. "impeccable" */
	plugin?: string;
	/** MCP server name, e.g. "figma" */
	mcpServer?: string;
	/** MCP tool name, e.g. "get_screenshot" */
	mcpTool?: string;
}

/**
 * Aggregated usage totals for a time bucket
 */
export interface AggregatedUsage {
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
	totalCost: number;
	messageCount: number;
	firstMessage: Date | null;
	lastMessage: Date | null;
}

/**
 * Time bucket containers for different aggregation levels
 */
export interface TimeBuckets {
	session: Map<string, AggregatedUsage>;
	daily: Map<string, AggregatedUsage>;
	weekly: Map<string, AggregatedUsage>;
	monthly: Map<string, AggregatedUsage>;
	/** Per-model weekly aggregation. Key format: "YYYY-WII:model-name" */
	modelWeekly: Map<string, AggregatedUsage>;
	/** Hourly buckets for sliding window calculations. Key format: "YYYY-MM-DDTHH" */
	hourly: Map<string, AggregatedUsage>;
	/**
	 * Per-project aggregation. Key = friendly project name (basename of cwd).
	 * Optional so existing empty-bucket constructions and persisted data without
	 * it remain valid; aggregateUsage always populates it.
	 */
	project?: Map<string, AggregatedUsage>;
}

/**
 * Claude plan types
 */
export type PlanType = "pro" | "max5" | "max20";

/**
 * Plan configuration with pricing and rate limits
 */
export interface PlanConfig {
	type: PlanType;
	displayName: string;
	monthlyPrice: number;
	// Token limits (estimates based on community reports)
	sessionTokenLimit?: number; // 5hr rolling window limit (output tokens)
	weeklyTokenLimit?: number; // Weekly limit (output tokens)
	weeklyScopedLimit?: number; // Weekly model-scoped limit (output tokens)
}

/**
 * Per-model pricing configuration
 */
export interface ModelPricing {
	inputPerMillion: number;
	outputPerMillion: number;
	cache5mWriteMultiplier: number;
	cache1hWriteMultiplier: number;
	cacheReadMultiplier: number;
}

/**
 * Persisted state structure
 */
export interface PersistedState {
	version: number;
	lastParseTimestamp: string | null;
	totalFilesProcessed: number;
	totalLinesSkipped: number;
	timeBuckets: SerializedTimeBuckets;
}

/**
 * Serialized time buckets (Maps converted to arrays)
 */
export interface SerializedTimeBuckets {
	session: [string, AggregatedUsage][];
	daily: [string, AggregatedUsage][];
	weekly: [string, AggregatedUsage][];
	monthly: [string, AggregatedUsage][];
	modelWeekly?: [string, AggregatedUsage][]; // Optional for backward compat with existing persisted data
	hourly?: [string, AggregatedUsage][]; // Optional for backward compat
	project?: [string, AggregatedUsage][]; // Optional for backward compat
}

/**
 * Result from parsing a single JSONL file
 */
export interface FileParseResult {
	filePath: string;
	records: TokenUsage[];
	linesSkipped: number;
	/** Assistant lines that carried a usage block but failed the schema (format-drift signal). */
	schemaFailures: number;
	errors: string[];
}

/**
 * Rate limit information for a single limit window
 */
export interface RateLimitInfo {
	name: string; // e.g. "Session (5hr)", "Weekly", "Weekly Fable"
	currentTokens: number; // billable tokens consumed in this window
	estimatedLimit: number; // estimated token cap for this limit
	percentage: number; // 0-100, currentTokens/estimatedLimit * 100, capped at 100
	resetTime: Date | null; // when this limit window resets
	isHit: boolean; // percentage >= 100
}

/**
 * Aggregate of the rate limits we track.
 *
 * `weeklyScoped` is the model-scoped weekly limit (the API's `weekly_scoped`
 * kind). Which model it covers is chosen by Anthropic and changes over time --
 * it was Sonnet/Opus, it is Fable as of 2026-07 -- so it is null until we learn
 * the scoped model name from the API. We never guess it from local data alone.
 */
export interface RateLimitStatus {
	session5h: RateLimitInfo;
	weekly: RateLimitInfo;
	weeklyScoped: RateLimitInfo | null;
	worstPercentage: number; // max of all known percentages (drives color coding)
}

/** Persisted refined limit estimates from observed 429 events */
export interface RefinedLimits {
	sessionTokenLimit?: number;
	weeklyTokenLimit?: number;
	weeklyScopedLimit?: number;
	lastUpdated: string; // ISO timestamp
}

/** Severity the API attaches to a limit window */
export type LimitSeverity = "normal" | "warning" | "critical" | (string & {});

/** Real-time rate limit data from Anthropic API */
export interface ApiRateLimitWindow {
	utilization: number; // 0.0-1.0
	resetsAt: string | null; // ISO timestamp
	severity?: LimitSeverity;
	/** True when the API flags this as the limit currently constraining usage */
	isActive?: boolean;
}

/**
 * A model- or surface-scoped limit window (API `limits[]` entry of kind
 * "weekly_scoped"). `label` is the API's own display name for the scope, e.g.
 * "Fable" -- rendered as "Weekly Fable".
 */
export interface ApiScopedWindow extends ApiRateLimitWindow {
	label: string;
}

/** Extra-usage (credit) state. Shape changed 2026-07: credits may be null. */
export interface ExtraUsageInfo {
	isEnabled: boolean;
	creditsUsed: number | null;
	creditsTotal: number | null;
	utilization: number | null; // 0.0-1.0
	currency: string | null;
	disabledReason: string | null;
}

/** Spend state from the API's `spend` object (major currency units) */
export interface SpendInfo {
	used: number;
	limit: number | null;
	percent: number; // 0-100
	currency: string;
	severity: LimitSeverity;
	enabled: boolean;
}

/** API usage response (fetched from same endpoint as Claude Code's Account & Usage) */
export interface ApiUsageData {
	fiveHour: ApiRateLimitWindow | null;
	sevenDay: ApiRateLimitWindow | null;
	/**
	 * Model/surface-scoped weekly limits, newest API shape (`limits[]` entries of
	 * kind "weekly_scoped"). Replaces the fixed sevenDaySonnet/sevenDayOpus pair:
	 * those top-level keys still exist but return null, and the scoped model is
	 * now named dynamically by the server.
	 */
	scopedWeekly: ApiScopedWindow[];
	rateLimitTier: string | null;
	extraUsage: ExtraUsageInfo | null;
	spend: SpendInfo | null;
	fetchedAt: Date;
}

/** Why an API fetch failed */
export type FetchErrorReason =
	| "auth_dead" // refresh token expired/revoked, only user re-auth can fix
	| "auth_expired" // access token expired, API returned 401
	| "network" // network error or timeout
	| "rate_limited" // API returned 429
	| "server_error" // API returned 5xx
	| "no_credentials"; // no OAuth credentials found

/** Typed result from fetchApiUsage -- replaces null returns */
export type FetchResult =
	| { ok: true; data: ApiUsageData }
	| { ok: false; error: FetchErrorReason };

/** Auth health state for the polling timer */
export type AuthState = "healthy" | "degraded" | "dead";

/** Staleness level of API data */
export type StalenessLevel =
	| "fresh"
	| "normal"
	| "dim"
	| "stale"
	| "critical"
	| "unavailable";

/** Shared cache file format for multi-window consistency */
export interface UsageCacheData {
	apiUsage: ApiUsageData;
	rateLimitTier: string | null;
	writtenAt: string; // ISO timestamp
	writtenBy: string; // process.pid of the writer
}

/**
 * Everything the status bar needs to render
 */
export interface StatusBarData {
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCost: number;
	todayCost: number;
	monthCost: number;
	burnRate: number; // tokens per minute, 0 if no recent activity
	rateLimits: RateLimitStatus;
	apiUsage: ApiUsageData | null; // exact percentages from Anthropic API (when available)
	staleness: StalenessLevel;
	lastUpdated: Date;
	filesProcessed: number;
	linesSkipped: number;
}
