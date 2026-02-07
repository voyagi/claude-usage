/**
 * Display formatting utilities for status bar and tooltips
 * All functions are pure (no side effects, no VS Code dependencies)
 */

import { differenceInMinutes } from 'date-fns';

/**
 * Format tokens with smart K/M abbreviation
 * < 1K: exact number ("500")
 * 1K-9.9K: one decimal ("1.2K")
 * 10K-999K: no decimal ("45K")
 * >= 1M: one decimal ("3.4M")
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return (tokens / 1_000_000).toFixed(1) + 'M';
  } else if (tokens >= 10_000) {
    return Math.round(tokens / 1_000) + 'K';
  } else if (tokens >= 1_000) {
    return (tokens / 1_000).toFixed(1) + 'K';
  }
  return tokens.toString();
}

/**
 * Format tokens with exact number and commas for tooltips
 * E.g. "1,234,567"
 */
export function formatTokensExact(tokens: number): string {
  return new Intl.NumberFormat('en-US').format(tokens);
}

/**
 * Format cooldown duration until reset time
 * null: "" (no active limit)
 * Past: "Ready"
 * < 1 hour: "Xm" (e.g. "34m")
 * >= 1 hour: "Xh Ym" (e.g. "2h 34m")
 */
export function formatCooldown(resetTime: Date | null): string {
  if (!resetTime) {
    return '';
  }

  const now = new Date();
  const minutesRemaining = differenceInMinutes(resetTime, now);

  if (minutesRemaining <= 0) {
    return 'Ready';
  }

  if (minutesRemaining < 60) {
    return `${minutesRemaining}m`;
  }

  const hours = Math.floor(minutesRemaining / 60);
  const minutes = minutesRemaining % 60;
  return `${hours}h ${minutes}m`;
}

/**
 * Format cost with smart precision
 * < $0.01: "$0.00"
 * < $1.00: two decimals ("$0.42")
 * < $100: two decimals ("$12.50")
 * >= $100: no decimals ("$150")
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return '$0.00';
  } else if (cost < 100) {
    return `$${cost.toFixed(2)}`;
  } else {
    return `$${Math.round(cost)}`;
  }
}

/**
 * Format percentage with no decimals
 * E.g. "73%"
 */
export function formatPercentage(percent: number): string {
  return `${Math.round(percent)}%`;
}

/**
 * Format burn rate (tokens per minute)
 * 0: "" (no display when inactive)
 * < 100: exact number + "/min" (e.g. "42/min")
 * >= 100: abbreviated + "/min" (e.g. "1.2K/min")
 */
export function formatBurnRate(tokensPerMin: number): string {
  if (tokensPerMin === 0) {
    return '';
  }

  if (tokensPerMin < 100) {
    return `${Math.round(tokensPerMin)}/min`;
  }

  return `${formatTokens(tokensPerMin)}/min`;
}
