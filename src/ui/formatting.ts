/**
 * Display formatting utilities for status bar and tooltips
 * All functions are pure (no side effects, no VS Code dependencies)
 */

import { differenceInMinutes } from "date-fns";

/**
 * Format tokens with smart K/M abbreviation
 * < 1K: exact number ("500")
 * 1K-9.9K: one decimal ("1.2K")
 * 10K-999K: no decimal ("45K")
 * >= 1M: one decimal ("3.4M")
 */
export function formatTokens(tokens: number): string {
	if (tokens >= 1_000_000) {
		return `${(tokens / 1_000_000).toFixed(1)}M`;
	} else if (tokens >= 10_000) {
		return `${Math.round(tokens / 1_000)}K`;
	} else if (tokens >= 1_000) {
		return `${(tokens / 1_000).toFixed(1)}K`;
	}
	return tokens.toString();
}

/**
 * Format tokens with exact number and commas for tooltips
 * E.g. "1,234,567"
 */
export function formatTokensExact(tokens: number): string {
	return new Intl.NumberFormat("en-US").format(tokens);
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
		return "";
	}

	const now = new Date();
	const minutesRemaining = differenceInMinutes(resetTime, now);

	if (minutesRemaining <= 0) {
		return "Ready";
	}

	if (minutesRemaining < 60) {
		return `${minutesRemaining}m`;
	}

	const hours = Math.floor(minutesRemaining / 60);
	const minutes = minutesRemaining % 60;
	return `${hours}h ${minutes}m`;
}

/**
 * Compact countdown for status bar (no spaces)
 * null: "" | Past: "0m" | <1h: "34m" | <24h: "2h34m" | >=24h: "2d3h"
 */
export function formatCooldownCompact(resetTime: Date | null): string {
	if (!resetTime) {
		return "";
	}

	const minutesRemaining = differenceInMinutes(resetTime, new Date());
	if (minutesRemaining <= 0) {
		return "0m";
	}
	if (minutesRemaining < 60) {
		return `${minutesRemaining}m`;
	}
	const totalHours = Math.floor(minutesRemaining / 60);
	if (totalHours < 24) {
		const mins = minutesRemaining % 60;
		return `${totalHours}h${mins}m`;
	}
	const days = Math.floor(totalHours / 24);
	const hrs = totalHours % 24;
	return `${days}d${hrs}h`;
}

/**
 * Format reset time as 24h local time for tooltip
 * Same day: "14:00" | Different day: "Feb 11 14:00"
 */
export function formatResetTime24h(resetTime: Date | null): string {
	if (!resetTime) {
		return "";
	}
	const now = new Date();
	const hhmm = resetTime.toLocaleTimeString("en-GB", {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
	const sameDay =
		resetTime.getFullYear() === now.getFullYear() &&
		resetTime.getMonth() === now.getMonth() &&
		resetTime.getDate() === now.getDate();
	if (sameDay) {
		return hhmm;
	}
	const monthDay = resetTime.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
	});
	return `${monthDay} ${hhmm}`;
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
		return "$0.00";
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
		return "";
	}

	if (tokensPerMin < 100) {
		return `${Math.round(tokensPerMin)}/min`;
	}

	return `${formatTokens(tokensPerMin)}/min`;
}

/**
 * Visual bar graph for tooltip display
 * E.g. "[████████████░░░░░░░░] 73%"
 * @param percentage 0-100
 * @param width Number of bar segments (default 20)
 */
export function formatBarGraph(percentage: number, width = 20): string {
	const clamped = Math.max(0, Math.min(100, percentage));
	const filled = Math.round((clamped / 100) * width);
	const bar = "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
	return `[${bar}] ${Math.round(clamped)}%`;
}

/**
 * Format pace forecast for tooltip
 * E.g. "Session: ~2h 15m at current pace"
 */
export function formatPaceForecast(
	minutesUntilLimit: number | null,
	limitName: string,
): string {
	if (minutesUntilLimit === null) return "";
	if (minutesUntilLimit === 0) return `${limitName}: LIMIT HIT`;
	if (minutesUntilLimit < 1) return `${limitName}: <1m at current pace`;
	if (minutesUntilLimit < 60) {
		return `${limitName}: ~${Math.round(minutesUntilLimit)}m at current pace`;
	}
	const hours = Math.floor(minutesUntilLimit / 60);
	const mins = Math.round(minutesUntilLimit % 60);
	return `${limitName}: ~${hours}h ${mins}m at current pace`;
}

/**
 * Format estimated time until hitting a rate limit
 * null: '' (idle, can't predict)
 * 0: 'LIMIT HIT'
 * < 1 min: '<1m at current pace'
 * < 60 min: 'Xm at current pace' (e.g. '45m at current pace')
 * >= 60 min: 'Xh Ym at current pace' (e.g. '2h 15m at current pace')
 */
export function formatTimeUntilLimit(minutes: number | null): string {
	if (minutes === null) {
		return "";
	}

	if (minutes === 0) {
		return "LIMIT HIT";
	}

	if (minutes < 1) {
		return "<1m at current pace";
	}

	if (minutes < 60) {
		return `${Math.round(minutes)}m at current pace`;
	}

	const hours = Math.floor(minutes / 60);
	const mins = Math.round(minutes % 60);
	return `${hours}h ${mins}m at current pace`;
}
