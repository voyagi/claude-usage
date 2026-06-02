/**
 * Token extraction and aggregation utilities
 * Converts parsed JSONL messages into TokenUsage records and provides aggregation helpers
 */

import type { AggregatedUsage, TokenUsage } from "../types.js";

/**
 * Extract TokenUsage from a validated assistant message
 * @param parsed Validated assistant message from Zod schema
 * @param sessionId Session identifier from JSONL
 * @returns TokenUsage object with all token counts and metadata
 */
export function extractTokenUsage(
	parsed: {
		timestamp: string;
		message: {
			model: string;
			usage: {
				input_tokens: number;
				output_tokens: number;
				cache_creation_input_tokens?: number;
				cache_read_input_tokens?: number;
				cache_creation?: {
					ephemeral_5m_input_tokens?: number;
					ephemeral_1h_input_tokens?: number;
				};
			};
		};
	},
	sessionId: string,
): TokenUsage {
	const usage = parsed.message.usage;
	const cacheCreation = usage.cache_creation;

	return {
		timestamp: new Date(parsed.timestamp),
		model: parsed.message.model,
		sessionId,
		inputTokens: usage.input_tokens,
		outputTokens: usage.output_tokens,
		cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
		cacheReadTokens: usage.cache_read_input_tokens ?? 0,
		cacheCreation5m: cacheCreation?.ephemeral_5m_input_tokens ?? 0,
		cacheCreation1h: cacheCreation?.ephemeral_1h_input_tokens ?? 0,
		cost: 0, // Will be calculated by pricing module
	};
}

/**
 * Calculate billable token count for rate limiting purposes
 *
 * For Claude 4.x models, rate limits are cache-aware:
 * - input_tokens count toward limits (uncached input)
 * - cache_creation_input_tokens count toward limits (writing to cache)
 * - cache_read_input_tokens do NOT count toward limits (reading from cache is free for rate limiting)
 * - output_tokens have separate rate limits
 *
 * @param usage TokenUsage record
 * @returns Number of tokens that count toward input token rate limits
 */
export function getBillableTokenCount(usage: TokenUsage): number {
	return usage.inputTokens + usage.cacheCreationTokens;
}

/**
 * Calculate total token activity across all types
 * This is the "total activity" metric, not the billable count
 *
 * @param usage TokenUsage record
 * @returns Total tokens processed (input + output + cache creation + cache reads)
 */
export function getTotalTokens(usage: TokenUsage): number {
	return (
		usage.inputTokens +
		usage.outputTokens +
		usage.cacheCreationTokens +
		usage.cacheReadTokens
	);
}

/**
 * Create a zero-initialized AggregatedUsage object
 * @returns Empty aggregated usage record
 */
export function createEmptyAggregatedUsage(): AggregatedUsage {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheCreationTokens: 0,
		cacheReadTokens: 0,
		totalCost: 0,
		messageCount: 0,
		firstMessage: null,
		lastMessage: null,
	};
}

/**
 * Add source TokenUsage to target AggregatedUsage (mutates target)
 * Used for building up aggregations over time buckets
 *
 * @param target AggregatedUsage to add to (mutated)
 * @param source TokenUsage to add from
 */
export function addToAggregation(
	target: AggregatedUsage,
	source: TokenUsage,
): void {
	// Sum all token counts
	target.inputTokens += source.inputTokens;
	target.outputTokens += source.outputTokens;
	target.cacheCreationTokens += source.cacheCreationTokens;
	target.cacheReadTokens += source.cacheReadTokens;
	target.totalCost += source.cost;
	target.messageCount += 1;

	// Update timestamp range
	if (target.firstMessage === null || source.timestamp < target.firstMessage) {
		target.firstMessage = source.timestamp;
	}
	if (target.lastMessage === null || source.timestamp > target.lastMessage) {
		target.lastMessage = source.timestamp;
	}
}

/**
 * Collapse re-logged duplicate records to one per message id.
 *
 * Claude Code writes the same assistant message (identical id and usage) across
 * many JSONL lines, so naively summing every line multiplies a single response's
 * tokens. This keeps the LAST record for each non-empty messageId (the last write
 * carries the final usage) and passes through records with no id unchanged — they
 * cannot be deduped and must each be counted.
 *
 * @param records Parsed token usage records
 * @returns Deduplicated records (order not preserved; aggregation is order-independent)
 */
export function dedupeByMessageId(records: TokenUsage[]): TokenUsage[] {
	const byId = new Map<string, TokenUsage>();
	const noId: TokenUsage[] = [];

	for (const record of records) {
		if (record.messageId) {
			byId.set(record.messageId, record); // keep last write per id
		} else {
			noId.push(record);
		}
	}

	return [...byId.values(), ...noId];
}

/**
 * Derive a friendly project name from a JSONL `cwd` path: its final path
 * segment (basename), handling both POSIX and Windows separators.
 *
 * @param cwd Working directory recorded in the transcript, if any
 * @returns Basename of cwd, or "" when cwd is missing/empty
 */
export function projectNameFromCwd(cwd: string | undefined): string {
	if (!cwd) {
		return "";
	}
	const parts = cwd.split(/[/\\]+/).filter(Boolean);
	return parts.length > 0 ? parts[parts.length - 1] : "";
}

/**
 * Reconcile a record against the usage already counted for its message id this run.
 *
 * Claude Code re-logs the same assistant message across many lines, and the
 * incremental reader can re-read bytes or split a burst across two reads. The
 * batch deduper keeps the LAST/largest usage per id; this preserves that
 * invariant ACROSS reads: a new id is counted in full, a smaller/equal repeat
 * is dropped, and a later read carrying strictly larger usage contributes only
 * the positive token delta — so live totals match a full reparse instead of
 * undercounting when the final write lands in a later read.
 *
 * Mutates `countedById` to remember the largest usage seen per id.
 *
 * @returns the record to aggregate (full record, or a token delta), or null to skip.
 *   NOTE: a delta top-up still increments messageCount by 1 when aggregated. That
 *   straddle-with-growing-usage case is rare (Claude Code re-logs identical final
 *   usage in practice); token/cost accuracy is the priority here.
 */
export function reconcileSeenUsage(
	record: TokenUsage,
	countedById: Map<string, TokenUsage>,
): TokenUsage | null {
	const id = record.messageId;
	if (!id) {
		return record; // no id -> cannot dedupe, always count
	}

	const prev = countedById.get(id);
	if (!prev) {
		countedById.set(id, record);
		return record; // first time this id is counted
	}

	// Already counted: only top up if this write carries strictly more usage.
	if (getTotalTokens(record) <= getTotalTokens(prev)) {
		return null;
	}

	countedById.set(id, record);
	return {
		...record,
		inputTokens: Math.max(0, record.inputTokens - prev.inputTokens),
		outputTokens: Math.max(0, record.outputTokens - prev.outputTokens),
		cacheCreationTokens: Math.max(
			0,
			record.cacheCreationTokens - prev.cacheCreationTokens,
		),
		cacheReadTokens: Math.max(0, record.cacheReadTokens - prev.cacheReadTokens),
		cacheCreation5m: Math.max(0, record.cacheCreation5m - prev.cacheCreation5m),
		cacheCreation1h: Math.max(0, record.cacheCreation1h - prev.cacheCreation1h),
		cost: 0, // recalculated by the caller, priced on the delta tokens
	};
}
