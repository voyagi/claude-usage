/**
 * Rate Limit Detector
 *
 * Pure data module - no VS Code dependencies
 * Parses rate limit error events from JSONL lines
 * Refines limit estimates based on observed 429 errors
 */

import { z } from 'zod';

/**
 * Rate limit event parsed from JSONL error line
 */
export interface RateLimitEvent {
  timestamp: Date;
  limitType: 'session' | 'weekly' | 'unknown';
  errorMessage: string;
}

/**
 * Zod schema for JSONL error event with rate_limit_error
 */
const rateLimitErrorSchema = z.object({
  type: z.literal('error'),
  timestamp: z.string(),
  error: z.object({
    type: z.literal('rate_limit_error'),
    message: z.string(),
  }),
});

/**
 * Parse rate limit event from JSONL line
 *
 * @param line JSON string from JSONL file
 * @returns Rate limit event or null if not a rate limit error
 */
export function parseRateLimitEvent(line: string): RateLimitEvent | null {
  try {
    const parsed = JSON.parse(line);
    const result = rateLimitErrorSchema.safeParse(parsed);

    if (!result.success) {
      // Not a rate limit error event
      return null;
    }

    const { timestamp, error } = result.data;
    const message = error.message.toLowerCase();

    // Classify limit type from error message
    let limitType: 'session' | 'weekly' | 'unknown' = 'unknown';

    if (message.includes('daily') || message.includes('weekly')) {
      limitType = 'weekly';
    } else if (
      message.includes('per-minute') ||
      message.includes('rpm') ||
      message.includes('session')
    ) {
      limitType = 'session';
    }

    return {
      timestamp: new Date(timestamp),
      limitType,
      errorMessage: error.message,
    };
  } catch (error) {
    // JSON parse error or invalid structure
    return null;
  }
}

/**
 * Refine limit estimate based on observed usage that triggered 429
 *
 * When a 429 is observed, the true limit is at or below observedUsage.
 * Apply a 5% safety margin and adjust estimate downward only.
 *
 * @param currentEstimate Current estimated limit
 * @param observedUsage Token usage that triggered the 429
 * @returns Refined estimate (never higher than current)
 */
export function refineLimitEstimate(
  currentEstimate: number,
  observedUsage: number
): number {
  if (observedUsage <= 0) {
    // Invalid input - return estimate unchanged
    return currentEstimate;
  }

  // Apply 5% safety margin
  const observedLimit = Math.floor(observedUsage * 0.95);

  // Only adjust downward
  return Math.min(currentEstimate, observedLimit);
}
