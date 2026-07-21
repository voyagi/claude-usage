/**
 * Usage attribution: what your limit consumption is actually going to.
 *
 * Mirrors the "What's contributing to your limits usage?" section of Claude
 * Code's own Account & Usage panel, computed from the same local transcripts.
 *
 * Two kinds of answer are produced, and they are NOT a partition of usage:
 *
 * - **Attribution** -- share of usage tagged to a named skill, subagent,
 *   plugin, or MCP server. Claude Code stamps these tags on the transcript
 *   record itself, so these are read, not inferred. One record can carry
 *   several tags (a skill spawning a subagent that calls an MCP tool), so the
 *   groups overlap by design.
 * - **Behaviours** -- independent characteristics of how usage was spent
 *   (huge cache misses, long context, subagent-heavy sessions, many parallel
 *   sessions, marathon sessions). A single request can match several, so these
 *   shares also overlap and will not sum to 100%.
 *
 * Weighting is by cost, not raw token count: cost already applies the per-model
 * and cache-tier multipliers, which makes it the closest local proxy for "share
 * of the limit this consumed". Claude Code's exact weighting is not published
 * (its own implementation ships compiled), so treat these as close estimates of
 * the same idea rather than numbers guaranteed to match its panel.
 */

import type { TokenUsage } from "../types.js";

/** The behaviour signals, matching the vocabulary Claude Code uses. */
export type BehaviorKey =
	| "cacheMiss"
	| "longContext"
	| "subagentHeavy"
	| "highParallel"
	| "longRunning";

/** Named attribution groups. */
export type AttributionGroup = "skills" | "agents" | "plugins" | "mcpServers";

/** One named contributor and its share of usage. */
export interface AttributionEntry {
	name: string;
	/** Cost attributed to this contributor, in dollars */
	cost: number;
	/** Share of total usage in the window, 0-100 */
	percentage: number;
}

/** One behaviour signal and its share of usage. */
export interface BehaviorEntry {
	key: BehaviorKey;
	/** Share of total usage in the window, 0-100 */
	percentage: number;
}

/** Attribution for a single time window. */
export interface AttributionWindow {
	/** Total cost of all records in the window */
	totalCost: number;
	/** Number of records considered */
	recordCount: number;
	behaviors: BehaviorEntry[];
	skills: AttributionEntry[];
	agents: AttributionEntry[];
	plugins: AttributionEntry[];
	mcpServers: AttributionEntry[];
}

/**
 * A request that wrote this much fresh cache was a cold start: the context had
 * to be re-sent rather than read from cache.
 */
const CACHE_MISS_TOKENS = 100_000;

/** Context size at which a request counts as "long context". */
const LONG_CONTEXT_TOKENS = 150_000;

/**
 * A session spanning at least this long reads as a background/loop session.
 * This is wall-clock span between the first and last request in the window, not
 * continuous activity: measuring active time only (ignoring idle gaps) never
 * fired at all on real data, because nobody drives a session for eight
 * uninterrupted hours.
 */
const LONG_RUNNING_SESSION_MS = 8 * 60 * 60 * 1000;

/** Distinct sessions active at once before usage counts as highly parallel. */
const PARALLEL_SESSION_THRESHOLD = 4;

/** Resolution for deciding which sessions were running "at the same time". */
const PARALLEL_BUCKET_MS = 5 * 60 * 1000;

/**
 * Subagent requests a session must make before it counts as subagent-heavy.
 *
 * Counting requests rather than cost share matters: subagents are individually
 * cheap next to a long main thread, so a cost-share rule never fired on real
 * data even for sessions that had spawned dozens of them. The exact figure is
 * not sensitive -- on a real day, thresholds of 1, 3, 5 and 10 all selected the
 * same sessions.
 */
const SUBAGENT_HEAVY_REQUESTS = 3;

/** Contributors below this share are noise; Claude Code hides them too. */
export const MIN_DISPLAY_PERCENTAGE = 10;

/** Most rows shown per attribution group. */
export const MAX_ATTRIBUTION_ROWS = 8;

/** Total context a request carried in (cached or not). */
function contextTokens(record: TokenUsage): number {
	return (
		record.inputTokens + record.cacheReadTokens + record.cacheCreationTokens
	);
}

/** Sort by cost descending, then name, so equal costs render deterministically. */
function toEntries(
	totals: Map<string, number>,
	totalCost: number,
): AttributionEntry[] {
	const entries: AttributionEntry[] = [];
	for (const [name, cost] of totals) {
		entries.push({
			name,
			cost,
			percentage: totalCost > 0 ? (cost / totalCost) * 100 : 0,
		});
	}
	entries.sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name));
	return entries.slice(0, MAX_ATTRIBUTION_ROWS);
}

function addTo(totals: Map<string, number>, name: string, cost: number): void {
	totals.set(name, (totals.get(name) ?? 0) + cost);
}

/**
 * Per-session facts needed by the behaviour signals.
 * Built in one pass so the signals do not each re-scan the records.
 */
interface SessionFacts {
	firstMs: number;
	lastMs: number;
	totalCost: number;
	subagentRequests: number;
}

/**
 * Compute attribution and behaviour shares for the records in a window.
 *
 * @param records Usage records, already priced (record.cost populated)
 * @param windowStart Only records at or after this time are considered
 * @param windowEnd Only records at or before this time are considered
 */
export function computeAttributionWindow(
	records: TokenUsage[],
	windowStart: Date,
	windowEnd: Date,
): AttributionWindow {
	const startMs = windowStart.getTime();
	const endMs = windowEnd.getTime();

	const skills = new Map<string, number>();
	const agents = new Map<string, number>();
	const plugins = new Map<string, number>();
	const mcpServers = new Map<string, number>();

	const sessions = new Map<string, SessionFacts>();
	// 5-minute bucket -> sessions seen in it, for the parallelism signal
	const bucketSessions = new Map<number, Set<string>>();

	const inWindow: TokenUsage[] = [];
	let totalCost = 0;

	for (const record of records) {
		const ms = record.timestamp.getTime();
		if (Number.isNaN(ms) || ms < startMs || ms > endMs) {
			continue;
		}

		inWindow.push(record);
		const cost = record.cost;
		totalCost += cost;

		const attribution = record.attribution;
		if (attribution) {
			if (attribution.skill) addTo(skills, attribution.skill, cost);
			if (attribution.agent) addTo(agents, attribution.agent, cost);
			if (attribution.plugin) addTo(plugins, attribution.plugin, cost);
			if (attribution.mcpServer) addTo(mcpServers, attribution.mcpServer, cost);
		}

		const facts = sessions.get(record.sessionId);
		if (facts) {
			facts.firstMs = Math.min(facts.firstMs, ms);
			facts.lastMs = Math.max(facts.lastMs, ms);
			facts.totalCost += cost;
			if (attribution?.agent) facts.subagentRequests++;
		} else {
			sessions.set(record.sessionId, {
				firstMs: ms,
				lastMs: ms,
				totalCost: cost,
				subagentRequests: attribution?.agent ? 1 : 0,
			});
		}

		const bucket = Math.floor(ms / PARALLEL_BUCKET_MS);
		const seen = bucketSessions.get(bucket);
		if (seen) {
			seen.add(record.sessionId);
		} else {
			bucketSessions.set(bucket, new Set([record.sessionId]));
		}
	}

	// Second pass: behaviours, now that per-session and per-bucket facts exist
	const behaviorCost: Record<BehaviorKey, number> = {
		cacheMiss: 0,
		longContext: 0,
		subagentHeavy: 0,
		highParallel: 0,
		longRunning: 0,
	};

	for (const record of inWindow) {
		const cost = record.cost;

		if (record.cacheCreationTokens >= CACHE_MISS_TOKENS) {
			behaviorCost.cacheMiss += cost;
		}
		if (contextTokens(record) >= LONG_CONTEXT_TOKENS) {
			behaviorCost.longContext += cost;
		}

		const facts = sessions.get(record.sessionId);
		if (facts) {
			if (facts.subagentRequests >= SUBAGENT_HEAVY_REQUESTS) {
				behaviorCost.subagentHeavy += cost;
			}
			if (facts.lastMs - facts.firstMs >= LONG_RUNNING_SESSION_MS) {
				behaviorCost.longRunning += cost;
			}
		}

		const bucket = Math.floor(record.timestamp.getTime() / PARALLEL_BUCKET_MS);
		const concurrent = bucketSessions.get(bucket)?.size ?? 0;
		if (concurrent >= PARALLEL_SESSION_THRESHOLD) {
			behaviorCost.highParallel += cost;
		}
	}

	const behaviors: BehaviorEntry[] = (
		Object.keys(behaviorCost) as BehaviorKey[]
	)
		.map((key) => ({
			key,
			percentage: totalCost > 0 ? (behaviorCost[key] / totalCost) * 100 : 0,
		}))
		.filter((entry) => entry.percentage > 0)
		.sort((a, b) => b.percentage - a.percentage);

	return {
		totalCost,
		recordCount: inWindow.length,
		behaviors,
		skills: toEntries(skills, totalCost),
		agents: toEntries(agents, totalCost),
		plugins: toEntries(plugins, totalCost),
		mcpServers: toEntries(mcpServers, totalCost),
	};
}

/** Day and week views, matching the toggle in Claude Code's panel. */
export interface UsageAttribution {
	day: AttributionWindow;
	week: AttributionWindow;
}

/**
 * Compute the last-24h and last-7d attribution views.
 *
 * @param records Priced usage records
 * @param now Reference time (injectable for tests)
 */
export function computeAttribution(
	records: TokenUsage[],
	now: Date = new Date(),
): UsageAttribution {
	const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
	const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

	return {
		day: computeAttributionWindow(records, dayStart, now),
		week: computeAttributionWindow(records, weekStart, now),
	};
}

/**
 * True when a window has anything worth rendering: a behaviour over the display
 * floor, or any named contributor at all.
 */
export function hasAttributionContent(window: AttributionWindow): boolean {
	return (
		window.behaviors.some((b) => b.percentage >= MIN_DISPLAY_PERCENTAGE) ||
		window.skills.length > 0 ||
		window.agents.length > 0 ||
		window.plugins.length > 0 ||
		window.mcpServers.length > 0
	);
}
