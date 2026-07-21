/**
 * "What's contributing to your limits usage?" section.
 *
 * Mirrors the section Claude Code shows in its own Account & Usage panel, built
 * from the same local transcripts. Two kinds of row are shown and neither is a
 * breakdown that sums to 100%:
 *
 * - behaviours: independent characteristics of how usage was spent
 * - contributors: named skills, subagents, plugins, and MCP servers
 */

import { useState } from "react";
import type {
	AttributionEntry,
	AttributionWindow,
	BehaviorKey,
	UsageAttribution,
} from "../types";
import { SegmentedControl } from "./SegmentedControl";

interface ContributingSectionProps {
	attribution: UsageAttribution | null;
}

/** Contributors and behaviours below this share are noise, so they are hidden. */
const MIN_DISPLAY_PERCENTAGE = 10;

/** Rows shown per group before the "and N more" line. */
const MAX_VISIBLE_ROWS = 5;

/** Headline and advice per behaviour, phrased for what the user can do about it. */
const BEHAVIOR_COPY: Record<
	BehaviorKey,
	{ headline: (pct: number) => string; advice: string }
> = {
	cacheMiss: {
		headline: (pct) => `${pct}% of your usage hit a large cache miss`,
		advice:
			"Uncached input is expensive, and usually happens when you message a session that has gone idle. Running /compact before stepping away keeps the cold start small.",
	},
	longContext: {
		headline: (pct) => `${pct}% of your usage was at over 150k context`,
		advice:
			"Long sessions cost more even when cached. /compact mid-task, /clear when switching to something new.",
	},
	subagentHeavy: {
		headline: (pct) =>
			`${pct}% of your usage came from subagent-heavy sessions`,
		advice:
			"Every subagent runs its own requests. Spawn them deliberately, and consider a cheaper model for the simpler ones.",
	},
	highParallel: {
		headline: (pct) =>
			`${pct}% of your usage was while 4+ sessions ran at once`,
		advice:
			"Parallel sessions share one limit. Queueing the ones you do not need immediately spreads it more evenly.",
	},
	longRunning: {
		headline: (pct) => `${pct}% of your usage came from sessions open 8+ hours`,
		advice:
			"These are usually background or loop sessions. Continuous usage adds up quietly, so make sure it is intentional.",
	},
};

const GROUPS: { key: keyof AttributionWindow; title: string }[] = [
	{ key: "skills", title: "Skills" },
	{ key: "agents", title: "Subagents" },
	{ key: "plugins", title: "Plugins" },
	{ key: "mcpServers", title: "MCP servers" },
];

function formatPercentage(value: number): string {
	// Anything on screen is at least 1%, so a whole number reads fine
	return `${Math.round(value)}%`;
}

function AttributionRows({ entries }: { entries: AttributionEntry[] }) {
	const visible = entries.slice(0, MAX_VISIBLE_ROWS);
	const hidden = entries.length - visible.length;

	return (
		<>
			{visible.map((entry) => (
				<div key={entry.name} className="attribution-row">
					<span className="attribution-name" title={entry.name}>
						{entry.name}
					</span>
					<span className="attribution-pct">
						{formatPercentage(entry.percentage)}
					</span>
				</div>
			))}
			{hidden > 0 && <div className="attribution-more">and {hidden} more</div>}
		</>
	);
}

export function ContributingSection({ attribution }: ContributingSectionProps) {
	const [window, setWindow] = useState<"day" | "week">("day");

	if (!attribution) return null;

	const active = attribution[window];

	const behaviors = active.behaviors.filter(
		(behavior) => behavior.percentage >= MIN_DISPLAY_PERCENTAGE,
	);
	const groups = GROUPS.map((group) => ({
		title: group.title,
		entries: (active[group.key] as AttributionEntry[]).filter(
			(entry) => entry.percentage >= 1,
		),
	})).filter((group) => group.entries.length > 0);

	// Nothing meaningful in either window: say nothing rather than show an
	// empty shell.
	const otherWindow = window === "day" ? attribution.week : attribution.day;
	const otherHasContent =
		otherWindow.behaviors.some((b) => b.percentage >= MIN_DISPLAY_PERCENTAGE) ||
		otherWindow.recordCount > 0;
	if (behaviors.length === 0 && groups.length === 0 && !otherHasContent) {
		return null;
	}

	return (
		<div className="card">
			<h3 className="card-title">What's contributing to your usage?</h3>

			<div className="attribution-toggle">
				<SegmentedControl
					options={[
						{ value: "day", label: "Day" },
						{ value: "week", label: "Week" },
					]}
					selected={window}
					onChange={(value) => setWindow(value as "day" | "week")}
				/>
			</div>

			<div className="attribution-caption">
				Estimated from local sessions on this machine. Does not include other
				devices or claude.ai.
			</div>
			<div className="attribution-caption">
				Last {window === "day" ? "24h" : "7d"}. These are independent
				characteristics of your usage, not a breakdown, so they will not add up
				to 100%.
			</div>

			{behaviors.length === 0 && groups.length === 0 ? (
				<div className="attribution-caption">
					Nothing above {MIN_DISPLAY_PERCENTAGE}% in this period. Try the other
					window.
				</div>
			) : (
				<>
					{behaviors.map((behavior) => {
						const copy = BEHAVIOR_COPY[behavior.key];
						if (!copy) return null;
						return (
							<div key={behavior.key} className="behavior-item">
								<div className="behavior-headline">
									{copy.headline(Math.round(behavior.percentage))}
								</div>
								<div className="behavior-advice">{copy.advice}</div>
							</div>
						);
					})}

					{groups.map((group) => (
						<div key={group.title} className="attribution-group">
							<div className="attribution-title">{group.title}</div>
							<AttributionRows entries={group.entries} />
						</div>
					))}
				</>
			)}
		</div>
	);
}
