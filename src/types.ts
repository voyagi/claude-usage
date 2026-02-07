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
}

/**
 * Claude plan types
 */
export type PlanType = 'pro' | 'max5' | 'max20';

/**
 * Plan configuration with pricing
 */
export interface PlanConfig {
  type: PlanType;
  displayName: string;
  monthlyPrice: number;
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
