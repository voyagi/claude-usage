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
				id: z.string().optional(),
				model: z.string(),
				usage: UsageSchema,
			})
			.passthrough(),
	})
	.passthrough();

/**
 * Parse a pre-parsed JSON object and extract token usage data
 * @param json Already-parsed JSON object from a JSONL line
 * @returns TokenUsage object or null if invalid/not an assistant message
 */
export function parseAssistantMessage(json: unknown): TokenUsage | null {
	try {
		// Only process assistant messages
		if (
			typeof json !== "object" ||
			json === null ||
			(json as Record<string, unknown>).type !== "assistant"
		) {
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
			messageId: data.message.id ?? "",
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
