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
 * Bucket size for the repeat key on a disagreement warning.
 *
 * Deliberately the same value, because both uses need the same property:
 * coarser than the per-response assembly jitter, finer than any real move. It
 * is named separately so the sharing is a decision rather than a coincidence.
 * They would part company if the tolerance were ever widened for a reason
 * unrelated to jitter -- a benign few-minute offset turning out to be normal --
 * since the dedupe resolution would otherwise coarsen with it and start
 * swallowing real moves smaller than the new value.
 */
const ANCHOR_DEDUPE_BUCKET_MS = ANCHOR_AGREEMENT_TOLERANCE_MS;

/**
 * Somewhere a warning can be sent, optionally with a key that decides whether
 * it counts as a repeat of the last one.
 *
 * The key exists because the message cannot serve as one. A message that quotes
 * server timestamps is different on every poll even when the condition it
 * reports has not changed by a microsecond, so deduplicating on message text
 * silently never deduplicates. A plain logger satisfies this type and ignores
 * the second argument.
 */
export interface WarningSink {
	warn(message: string, dedupeKey?: string): void;
}

/**
 * Wrap a sink so a repeat of the same condition is stated once, not endlessly.
 *
 * For a condition that is permanent rather than transient. A malformed
 * timestamp is a server bug whose warning stops when the server is fixed, so
 * repeating it is proportionate. Two weekly limits parting company would be the
 * new normal, and at one poll every five minutes the same sentence would arrive
 * roughly 288 times a day forever, asking its reader to report something they
 * can report once. That is the reasoning behind the tolerance above applied to
 * how long a warning repeats rather than how erratically it fires: a warning
 * nobody can act on teaches its channel to be ignored.
 *
 * What counts as "the same" is the caller's `dedupeKey`, falling back to the
 * message only when none is given. Keying on the message was the first attempt
 * here and it did not work: the message embeds raw `resets_at` strings, whose
 * sub-second field is stamped per response, so every poll produced a new message
 * and nothing was ever suppressed. The tests passed because their fixtures fed
 * literal strings the API never emits. A latch that cannot fire is worse than no
 * latch, because the code says the volume problem is handled.
 *
 * Only consecutive repeats are suppressed, so a condition that clears and
 * returns is stated again, and a genuinely different one is never swallowed.
 *
 * The contract on a key, stated as a rule rather than as the incident above,
 * because the rule is what a future caller needs: it must identify the
 * condition, and must not embed anything that varies while the condition does
 * not. A key built per call from freshly stamped data satisfies neither, and
 * fails silently -- every warning is emitted, every test still passes, and the
 * only symptom is volume nobody is watching for.
 */
export function latchRepeats(sink: WarningSink): WarningSink {
	let previous: string | null = null;
	return {
		warn(message: string, dedupeKey?: string) {
			const key = dedupeKey ?? message;
			if (key === previous) return;
			previous = key;
			sink.warn(message);
		},
	};
}

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
	logger?: WarningSink,
): string | null {
	const weekly = usage.sevenDay?.resetsAt ?? null;
	const scoped =
		usage.scopedWeekly?.find((window) => window.resetsAt)?.resetsAt ?? null;

	if (logger && weekly && scoped) {
		const weeklyMs = new Date(weekly).getTime();
		const scopedMs = new Date(scoped).getTime();
		const apart = Math.abs(weeklyMs - scopedMs);
		// An unreadable value makes `apart` NaN, and every NaN comparison is
		// false, so it declines to complain on its own. That is the outcome we
		// want and it needs no guard: the parse boundary has already named the
		// bad value, and a second complaint here would only describe it worse.
		// An explicit `Number.isFinite` check stood here first and was removed
		// once a mutation showed the whole suite passing without it -- `apart` is
		// finite or NaN, never Infinity, so the check could not change any
		// outcome. A guard that cannot fire reads as protection and provides
		// none, which is the pattern this file exists to keep out.
		if (apart > ANCHOR_AGREEMENT_TOLERANCE_MS) {
			// The message quotes the raw instants because that is what a reader
			// needs, but it cannot double as the repeat key: the sub-second field
			// is stamped per response, so the text differs on every poll while the
			// condition is unchanged, and a latch keyed on it never fires. The key
			// buckets both instants at a resolution coarser than the jitter and
			// finer than any real move.
			//
			// `Math.round`, not `Math.floor`, and that is not a coin toss. Reset
			// instants land on whole minutes with the stamp adding 0-999 ms, so
			// flooring would put every real value within a millisecond of a bucket
			// edge, where a stamp could flip it. Rounding puts them at bucket
			// centres instead, measured 29.0-30.0 s from either edge. A pair near
			// an edge would emit one extra warning rather than miss one, so even
			// the residual errs toward speaking up -- but with this data shape it
			// cannot arise, since it would need a reset about thirty seconds past
			// the minute.
			const bucket = (ms: number) => Math.round(ms / ANCHOR_DEDUPE_BUCKET_MS);
			logger.warn(
				`The weekly and scoped limits report different reset times (${weekly} vs ${scoped}). This build assumes they share one account-wide anchor, so weekly usage totals and countdowns may now be measured over the wrong days. Please report this.`,
				`anchor-disagreement:${bucket(weeklyMs)}|${bucket(scopedMs)}`,
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
