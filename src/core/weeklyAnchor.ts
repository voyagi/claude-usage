/**
 * The account's weekly reset anchor.
 *
 * Anthropic assigns each account a fixed weekly reset instant and holds it
 * there: two payloads captured a week apart both reset at 08:00 UTC on a
 * Friday, and the help centre states the reset day and time stay the same
 * regardless of when the account starts using Claude. That is a different
 * shape from the ISO calendar week this extension used to assume, and the two
 * disagree by up to six days.
 *
 * The API supplies the instant on any weekly limit carrying usage, so the
 * anchor is learned rather than configured. Every fresh reading replaces the
 * stored one, which is what makes the exact-seven-day arithmetic here safe:
 * drift can only survive until the next successful poll.
 */

/**
 * Exactly seven days.
 *
 * The observed reset instants are UTC and a whole seven days apart, so this is
 * the arithmetic that reproduces them. Both captures fall in the same season
 * though, so they cannot show what happens across a DST change, and a server
 * anchored to a local wall clock would drift an hour past one. What bounds that
 * is not this constant but the re-anchoring in `rememberWeeklyAnchor`: a stale
 * projection is replaced by the server's own figure at the next poll, so an
 * error of that shape lives for one polling interval rather than a season.
 */
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How far apart the two weekly resets may sit before they are a disagreement.
 *
 * Not zero, and not a round number picked for comfort. In the captured payload
 * the all-model limit resets at `...T08:00:00.383291+00:00` and the scoped one
 * at `...T08:00:00.383503+00:00`: the same instant, stamped 212 microseconds
 * apart as the response was assembled. Comparing the strings would therefore
 * report a disagreement on every poll. Comparing the parsed instants hides that
 * particular pair, since `Date` keeps only milliseconds and both land on .383 --
 * but only by luck of where they fell. Two stamps 212 microseconds apart
 * straddle a millisecond boundary roughly a fifth of the time, so a zero
 * tolerance would fire intermittently, which is worse than firing always: an
 * intermittent warning reads as a glitch and gets ignored on the day it is real.
 *
 * A minute is far above that jitter and far below anything meaningful. If
 * Anthropic ever gives the scoped limit an anchor of its own, it will differ by
 * hours or days, not by fractions of a second.
 */
const ANCHOR_AGREEMENT_TOLERANCE_MS = 60_000;

/**
 * The reset instant to anchor the account's weekly cycle to, or null.
 *
 * The all-model weekly window is the natural source and wins whenever it states
 * anything. A scoped weekly window is accepted only to fill a gap: the captured
 * payloads show both weekly limits carrying the same instant, and
 * `calculateRateLimits` already depends on that by reporting the account anchor
 * as the scoped limit's reset, so this reads the shared anchor in the other
 * direction rather than assuming something new.
 *
 * Filling that gap matters because the alternative is not "no anchor". It is
 * the Monday calendar week, which is the wrong phase by construction and is the
 * defect this module exists to remove.
 *
 * That shared anchor is the single assumption the whole feature rests on, and
 * it rests on one observation. Both windows usually carry a reset, so whenever
 * they do this compares them and complains if they have parted company. That
 * turns the assumption from unverified into monitored: the failure it guards
 * against is silent by nature, because a wrong-but-plausible anchor produces a
 * countdown that looks entirely normal and a usage total measured over the
 * wrong days. Passing no logger simply skips the check, which keeps the
 * function usable as a pure helper.
 */
export function pickWeeklyAnchor(
	usage: {
		sevenDay?: { resetsAt: string | null } | null;
		scopedWeekly?: { resetsAt: string | null }[];
	},
	logger?: { warn: (message: string) => void },
): string | null {
	const weekly = usage.sevenDay?.resetsAt ?? null;
	const scoped =
		usage.scopedWeekly?.find((window) => window.resetsAt)?.resetsAt ?? null;

	if (logger && weekly && scoped) {
		const apart = Math.abs(
			new Date(weekly).getTime() - new Date(scoped).getTime(),
		);
		// NaN when either value is unreadable, which is not this check's business
		// -- the parse boundary already warned about that, and comparing against
		// NaN here would either stay silent by luck or report a second, confusing
		// complaint about the same bad value.
		if (Number.isFinite(apart) && apart > ANCHOR_AGREEMENT_TOLERANCE_MS) {
			logger.warn(
				`The weekly and scoped limits report different reset times (${weekly} vs ${scoped}). This build assumes they share one account-wide anchor, so weekly usage totals and countdowns may now be measured over the wrong days. Please report this.`,
			);
		}
	}

	return weekly ?? scoped;
}

/** The weekly window containing a given moment. */
export interface WeeklyCycle {
	/** Start of the cycle now in progress (inclusive). */
	cycleStart: Date;
	/** When the cycle now in progress resets (exclusive). */
	nextReset: Date;
}

/**
 * Project the stored anchor onto the cycle containing `now`.
 *
 * Works in both directions, so an anchor read before it comes due is as usable
 * as one already in the past. Returns null when there is no anchor to project,
 * which callers must treat as "unknown" rather than substituting a guess --
 * substituting one is the bug this module exists to remove.
 */
export function projectWeeklyCycle(
	anchorIso: string | null | undefined,
	now: Date,
): WeeklyCycle | null {
	if (!anchorIso) return null;
	const anchorMs = new Date(anchorIso).getTime();
	if (Number.isNaN(anchorMs)) return null;

	// Smallest anchor + k*WEEK strictly after `now`. At exactly the reset
	// instant the window has already rolled, so the next one is a full week out.
	const elapsedWeeks = Math.floor((now.getTime() - anchorMs) / WEEK_MS);
	const nextResetMs = anchorMs + (elapsedWeeks + 1) * WEEK_MS;

	return {
		cycleStart: new Date(nextResetMs - WEEK_MS),
		nextReset: new Date(nextResetMs),
	};
}
