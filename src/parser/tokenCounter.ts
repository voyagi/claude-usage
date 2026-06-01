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
