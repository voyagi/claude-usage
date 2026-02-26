/**
 * Zod schemas for validating Claude Code JSONL format
 */

import { z } from "zod";
import type { TokenUsage } from "../types.js";

/**
 * Schema for cache_creation object with ephemeral token breakdowns
 */
const CacheCreationSchema = z
	.object({
		ephemeral_5m_input_tokens: z
			.number()
			.int()
			.nonnegative()
			.optional()
			.default(0),
		ephemeral_1h_input_tokens: z
			.number()
			.int()
			.nonnegative()
			.optional()
			.default(0),
	})
	.passthrough();

/**
 * Schema for usage object from assistant messages
 */
export const UsageSchema = z
	.object({
		input_tokens: z.number().int().nonnegative(),
		output_tokens: z.number().int().nonnegative(),
		cache_creation_input_tokens: z
			.number()
			.int()
			.nonnegative()
			.optional()
			.default(0),
		cache_read_input_tokens: z
			.number()
			.int()
			.nonnegative()
			.optional()
			.default(0),
		cache_creation: CacheCreationSchema.optional(),
	})
	.passthrough();

/**
 * Schema for assistant message from JSONL
 */
export const AssistantMessageSchema = z
	.object({
		type: z.literal("assistant"),
		timestamp: z.string().datetime(),
		sessionId: z.string(),
		message: z
			.object({
				model: z.string(),
				usage: UsageSchema,
			})
			.passthrough(),
	})
	.passthrough();

/**
 * Parse a JSONL line and extract token usage data
 * @param line Raw JSONL line string
 * @returns TokenUsage object or null if invalid/not an assistant message
 */
export function parseAssistantMessage(line: string): TokenUsage | null {
	try {
		const json = JSON.parse(line);

		// Only process assistant messages
		if (json.type !== "assistant") {
			return null;
		}

		const parsed = AssistantMessageSchema.safeParse(json);
		if (!parsed.success) {
			return null;
		}

		const data = parsed.data;
		const usage = data.message.usage;
		const cacheCreation = usage.cache_creation;

		return {
			timestamp: new Date(data.timestamp),
			model: data.message.model,
			sessionId: data.sessionId,
			inputTokens: usage.input_tokens,
			outputTokens: usage.output_tokens,
			cacheCreationTokens: usage.cache_creation_input_tokens,
			cacheReadTokens: usage.cache_read_input_tokens,
			cacheCreation5m: cacheCreation?.ephemeral_5m_input_tokens ?? 0,
			cacheCreation1h: cacheCreation?.ephemeral_1h_input_tokens ?? 0,
			cost: 0, // Will be calculated by pricing module
		};
	} catch (_error) {
		return null;
	}
}
