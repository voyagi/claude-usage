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
 * Why duplicates exist: Claude Code re-logs the same assistant message (same
 * `message.id`) across many JSONL lines as the response streams and the session
 * progresses — a single response can appear dozens of times (measured up to 39x,
 * ~2x total token inflation across real transcripts). The usage is NOT identical
 * across those copies: the output-token count grows as the response streams. So
 * this keeps the record with the LARGEST usage per id (the final, complete total)
 * rather than blindly the last one. On real transcripts the last occurrence IS
 * the largest in 99.98% of varying-usage ids; keeping the max also covers the
 * rare out-of-order stragglers and matches reconcileSeenUsage (the live path).
 * Id-less records can't be deduped and are each kept.
 *
 * A worked example lives in the dedupeByMessageId tests.
 *
 * @param records Parsed token usage records
 * @returns Deduplicated records (order not preserved; aggregation is order-independent)
 */
export function dedupeByMessageId(records: TokenUsage[]): TokenUsage[] {
	const byId = new Map<string, TokenUsage>();
	const noId: TokenUsage[] = [];

	for (const record of records) {
		if (!record.messageId) {
			noId.push(record); // no id -> cannot dedupe, always count
			continue;
		}
		const prev = byId.get(record.messageId);
		// Keep the largest usage per id: re-logs grow as the response streams, so
		// the biggest total is the final, complete one.
		if (!prev || getTotalTokens(record) >= getTotalTokens(prev)) {
			byId.set(record.messageId, record);
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
 *   straddle case (a message's streamed re-logs split across two incremental
 *   reads) is rare; token/cost accuracy is the priority here.
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
