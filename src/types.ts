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
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cacheCreation5m: number;
  cacheCreation1h: number;
  cost: number;
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
}

/**
 * Claude plan types
 */
export type PlanType = 'pro' | 'max5' | 'max20';

/**
 * Plan configuration with pricing and rate limits
 */
export interface PlanConfig {
  type: PlanType;
  displayName: string;
  monthlyPrice: number;
  // Token limits (estimates based on community reports)
  sessionTokenLimit?: number;  // 5hr rolling window limit (output tokens)
  weeklyTokenLimit?: number;    // Weekly limit (output tokens)
  weeklySonnetLimit?: number;   // Weekly model-specific limit (output tokens)
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
  modelWeekly?: [string, AggregatedUsage][];  // Optional for backward compat with existing persisted data
}

/**
 * Result from parsing a single JSONL file
 */
export interface FileParseResult {
  filePath: string;
  records: TokenUsage[];
  linesSkipped: number;
  errors: string[];
}

/**
 * Rate limit information for a single limit window
 */
export interface RateLimitInfo {
  name: string;                    // e.g. "Session (5hr)", "Weekly", "Weekly Sonnet"
  currentTokens: number;           // billable tokens consumed in this window
  estimatedLimit: number;          // estimated token cap for this limit
  percentage: number;              // 0-100, currentTokens/estimatedLimit * 100, capped at 100
  resetTime: Date | null;          // when this limit window resets
  isHit: boolean;                  // percentage >= 100
}

/**
 * Aggregate of all three rate limits
 */
export interface RateLimitStatus {
  session5h: RateLimitInfo;
  weekly: RateLimitInfo;
  weeklySonnet: RateLimitInfo;
  worstPercentage: number;         // max of all three percentages (drives color coding)
}

/** Persisted refined limit estimates from observed 429 events */
export interface RefinedLimits {
  sessionTokenLimit?: number;
  weeklyTokenLimit?: number;
  weeklySonnetLimit?: number;
  lastUpdated: string; // ISO timestamp
}

/** Real-time rate limit data from Anthropic API */
export interface ApiRateLimitWindow {
  utilization: number;  // 0.0-1.0
  resetsAt: string | null;  // ISO timestamp
}

/** API usage response (fetched from same endpoint as Claude Code's Account & Usage) */
export interface ApiUsageData {
  fiveHour: ApiRateLimitWindow | null;
  sevenDay: ApiRateLimitWindow | null;
  sevenDaySonnet: ApiRateLimitWindow | null;
  fetchedAt: Date;
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
  burnRate: number;                // tokens per minute, 0 if no recent activity
  rateLimits: RateLimitStatus;
  apiUsage: ApiUsageData | null;   // exact percentages from Anthropic API (when available)
  lastUpdated: Date;
  filesProcessed: number;
  linesSkipped: number;
}
