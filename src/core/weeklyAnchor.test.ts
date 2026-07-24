import {
	latchRepeats,
	pickWeeklyAnchor,
	projectWeeklyCycle,
	WEEK_MS,
} from "./weeklyAnchor";

/**
 * Both instants are real, taken from captured usage payloads a week apart.
 * They are the evidence that the anchor is fixed rather than rolling: same
 * weekday, same wall clock, exactly seven days between them.
 */
const ANCHOR_JUL_24 = "2026-07-24T08:00:00.383291+00:00";
const ANCHOR_JUL_31 = "2026-07-31T08:00:00.585182+00:00";

describe("pickWeeklyAnchor", () => {
	it("prefers the all-model weekly window", () => {
		expect(
			pickWeeklyAnchor({
				sevenDay: { resetsAt: ANCHOR_JUL_24 },
				scopedWeekly: [{ resetsAt: ANCHOR_JUL_31 }],
			}),
		).toBe(ANCHOR_JUL_24);
	});

	it("falls back to a scoped window when the all-model one states nothing", () => {
		// Without this the anchor is never learned in that payload shape, and the
		// weekly window falls back to a Monday calendar week until some later poll
		// happens to populate sevenDay. The alternative here is not "no anchor",
		// it is a known-wrong one.
		expect(
			pickWeeklyAnchor({
				sevenDay: { resetsAt: null },
				scopedWeekly: [{ resetsAt: ANCHOR_JUL_31 }],
			}),
		).toBe(ANCHOR_JUL_31);
	});

	it("skips scoped windows that state nothing either", () => {
		expect(
			pickWeeklyAnchor({
				sevenDay: null,
				scopedWeekly: [{ resetsAt: null }, { resetsAt: ANCHOR_JUL_31 }],
			}),
		).toBe(ANCHOR_JUL_31);
	});

	it("returns null when no window states a reset", () => {
		expect(
			pickWeeklyAnchor({
				sevenDay: { resetsAt: null },
				scopedWeekly: [{ resetsAt: null }],
			}),
		).toBeNull();
		expect(pickWeeklyAnchor({})).toBeNull();
	});
});

/**
 * The shared anchor is the one assumption the whole feature rests on, and it
 * rests on a single captured payload. These pin the tripwire that would tell us
 * if it ever stopped holding, and -- just as importantly -- that it stays quiet
 * the rest of the time.
 */
describe("pickWeeklyAnchor: the shared-anchor tripwire", () => {
	function spyLogger() {
		return { warn: jest.fn() };
	}

	it("stays quiet on the exact instants a real payload carries", () => {
		// Verbatim from the captured response: the same instant, stamped 212
		// microseconds apart as the response is assembled. Comparing the strings
		// would fire here on every poll. This pair happens to survive a zero
		// tolerance too, because Date keeps only milliseconds and both land on
		// .383 -- see the next test for the half of the jitter that does not.
		const logger = spyLogger();

		pickWeeklyAnchor(
			{
				sevenDay: { resetsAt: "2026-07-24T08:00:00.383291+00:00" },
				scopedWeekly: [{ resetsAt: "2026-07-24T08:00:00.383503+00:00" }],
			},
			logger,
		);

		expect(logger.warn).not.toHaveBeenCalled();
	});

	it("stays quiet when that same jitter straddles a millisecond", () => {
		// The other side of the coin, and the reason the tolerance is not zero.
		// Two stamps this far apart land in different milliseconds roughly a fifth
		// of the time, so a zero tolerance would complain intermittently. An
		// intermittent warning is worse than a constant one: it reads as a glitch,
		// and gets waved away on the day it finally means something.
		const logger = spyLogger();

		pickWeeklyAnchor(
			{
				sevenDay: { resetsAt: "2026-07-24T08:00:00.383900+00:00" },
				scopedWeekly: [{ resetsAt: "2026-07-24T08:00:00.384112+00:00" }],
			},
			logger,
		);

		expect(logger.warn).not.toHaveBeenCalled();
	});

	it("stays quiet a whole second apart, still far below anything meaningful", () => {
		const logger = spyLogger();

		pickWeeklyAnchor(
			{
				sevenDay: { resetsAt: "2026-07-24T08:00:00.000Z" },
				scopedWeekly: [{ resetsAt: "2026-07-24T08:00:01.000Z" }],
			},
			logger,
		);

		expect(logger.warn).not.toHaveBeenCalled();
	});

	it("complains when the two limits are genuinely on different cycles", () => {
		// What a real divergence would look like: a separate anchor, days out.
		// Silent by nature without this, because the countdown it produces looks
		// perfectly ordinary and only the days it measures over are wrong.
		const logger = spyLogger();

		pickWeeklyAnchor(
			{
				sevenDay: { resetsAt: ANCHOR_JUL_24 },
				scopedWeekly: [{ resetsAt: ANCHOR_JUL_31 }],
			},
			logger,
		);

		expect(logger.warn).toHaveBeenCalledTimes(1);
		// Both values named: a divergence is only actionable if the report says
		// which two instants parted company.
		const message = logger.warn.mock.calls[0][0];
		expect(message).toContain(ANCHOR_JUL_24);
		expect(message).toContain(ANCHOR_JUL_31);
	});

	it("complains about an hour's difference, well inside a single cycle", () => {
		const logger = spyLogger();

		pickWeeklyAnchor(
			{
				sevenDay: { resetsAt: "2026-07-24T08:00:00.000Z" },
				scopedWeekly: [{ resetsAt: "2026-07-24T09:00:00.000Z" }],
			},
			logger,
		);

		expect(logger.warn).toHaveBeenCalledTimes(1);
	});

	it("says nothing when only one window carries a reset", () => {
		// Nothing to compare. This is the ordinary state at zero scoped usage, and
		// warning here would make the signal noise from the first poll.
		const logger = spyLogger();

		pickWeeklyAnchor(
			{ sevenDay: { resetsAt: ANCHOR_JUL_24 }, scopedWeekly: [] },
			logger,
		);
		pickWeeklyAnchor(
			{
				sevenDay: { resetsAt: null },
				scopedWeekly: [{ resetsAt: ANCHOR_JUL_31 }],
			},
			logger,
		);

		expect(logger.warn).not.toHaveBeenCalled();
	});

	it("leaves an unreadable value to the parse boundary that already warned", () => {
		// Comparing against NaN would either stay silent by luck or raise a second,
		// confusing complaint about a value the parse layer has already named.
		const logger = spyLogger();

		pickWeeklyAnchor(
			{
				sevenDay: { resetsAt: "not-a-date" },
				scopedWeekly: [{ resetsAt: ANCHOR_JUL_31 }],
			},
			logger,
		);

		expect(logger.warn).not.toHaveBeenCalled();
	});

	it("still returns the anchor it picked when it complains", () => {
		// The tripwire reports; it does not change the answer. Suppressing the
		// anchor on disagreement would trade a possibly-wrong instant for the
		// certainly-wrong Monday fallback.
		const logger = spyLogger();

		const picked = pickWeeklyAnchor(
			{
				sevenDay: { resetsAt: ANCHOR_JUL_24 },
				scopedWeekly: [{ resetsAt: ANCHOR_JUL_31 }],
			},
			logger,
		);

		expect(picked).toBe(ANCHOR_JUL_24);
	});

	it("skips the comparison entirely when given no logger", () => {
		// Keeps the function usable as a pure helper, and is why every existing
		// caller in the tests above needs no change.
		expect(() =>
			pickWeeklyAnchor({
				sevenDay: { resetsAt: ANCHOR_JUL_24 },
				scopedWeekly: [{ resetsAt: ANCHOR_JUL_31 }],
			}),
		).not.toThrow();
	});
});

describe("latchRepeats", () => {
	function spySink() {
		return { warn: jest.fn() };
	}

	it("states a message once, however many times it arrives", () => {
		// The condition it exists for is permanent: at one poll every five
		// minutes an unlatched warning arrives ~288 times a day, forever, asking
		// its reader to report something they can only report once.
		const sink = spySink();
		const latched = latchRepeats(sink);

		latched.warn("anchors disagree");
		latched.warn("anchors disagree");
		latched.warn("anchors disagree");

		expect(sink.warn).toHaveBeenCalledTimes(1);
	});

	it("speaks again when the message changes", () => {
		// Latching on the message rather than a flag is the whole point: a
		// divergence that moves is a new state of affairs, not a repeat, and a
		// fired-once flag would swallow it.
		const sink = spySink();
		const latched = latchRepeats(sink);

		latched.warn("anchors disagree: A vs B");
		latched.warn("anchors disagree: A vs C");

		expect(sink.warn).toHaveBeenCalledTimes(2);
		expect(sink.warn).toHaveBeenLastCalledWith("anchors disagree: A vs C");
	});

	it("re-states a message that returns after a different one", () => {
		// Only consecutive repeats are suppressed. A condition that clears and
		// comes back is worth hearing about again.
		const sink = spySink();
		const latched = latchRepeats(sink);

		latched.warn("A");
		latched.warn("B");
		latched.warn("A");

		expect(sink.warn).toHaveBeenCalledTimes(3);
	});

	it("keeps its own latch per instance", () => {
		// The failure that would look right while being wrong: build one of these
		// per call instead of once, and the latch resets every time, restoring
		// the every-poll repetition it exists to prevent. `extension.ts` builds
		// it once per activation for exactly this reason.
		const sink = spySink();

		latchRepeats(sink).warn("same message");
		latchRepeats(sink).warn("same message");

		expect(sink.warn).toHaveBeenCalledTimes(2);
	});

	it("passes the message through untouched", () => {
		const sink = spySink();
		latchRepeats(sink).warn("verbatim text, unchanged");
		expect(sink.warn).toHaveBeenCalledWith("verbatim text, unchanged");
	});
});

describe("projectWeeklyCycle", () => {
	it("returns null without an anchor, rather than guessing one", () => {
		const now = new Date("2026-07-24T09:47:00Z");
		expect(projectWeeklyCycle(null, now)).toBeNull();
		expect(projectWeeklyCycle(undefined, now)).toBeNull();
		expect(projectWeeklyCycle("", now)).toBeNull();
	});

	it("returns null for an unparseable anchor", () => {
		// A corrupted globalState value must not become NaN dates downstream.
		expect(
			projectWeeklyCycle("not-a-date", new Date("2026-07-24T09:47:00Z")),
		).toBeNull();
	});

	it("projects an anchor already in the past forward to the live cycle", () => {
		// Jul 24 anchor, read on Jul 24 at 09:47Z: the 08:00Z reset has just
		// passed, so the cycle in progress ends a week later. This is the exact
		// case that put a Monday-midnight countdown on the status bar.
		const cycle = projectWeeklyCycle(
			ANCHOR_JUL_24,
			new Date("2026-07-24T09:47:00Z"),
		);
		expect(cycle?.nextReset.toISOString()).toBe("2026-07-31T08:00:00.383Z");
		expect(cycle?.cycleStart.toISOString()).toBe("2026-07-24T08:00:00.383Z");
	});

	it("agrees with the anchor the API supplied a week later", () => {
		// Projecting the Jul 24 reading forward must land on the Jul 31 reading
		// the server actually sent. If these two ever disagree, the fixed-anchor
		// model is wrong and this test is where that shows up.
		const projected = projectWeeklyCycle(
			ANCHOR_JUL_24,
			new Date("2026-07-30T12:00:00Z"),
		);
		const observed = new Date(ANCHOR_JUL_31).getTime();
		// Sub-second jitter differs per response; the instant does not.
		expect(
			Math.abs(projected!.nextReset.getTime() - observed),
		).toBeLessThanOrEqual(1000);
	});

	it("holds the cycle steady across many weeks of absence", () => {
		// An anchor learned once and not refreshed for a month still resolves.
		const cycle = projectWeeklyCycle(
			ANCHOR_JUL_24,
			new Date("2026-08-20T00:00:00Z"),
		);
		expect(cycle?.nextReset.toISOString()).toBe("2026-08-21T08:00:00.383Z");
		expect(cycle!.nextReset.getTime() - cycle!.cycleStart.getTime()).toBe(
			WEEK_MS,
		);
	});

	it("rolls at the reset instant itself, not one week late", () => {
		// Exactly at the reset the window has already turned over, so the answer
		// is a full week out. Using >= here instead would strand the bar on a
		// countdown of zero for the whole following week.
		const atReset = new Date("2026-07-24T08:00:00.383291Z");
		const cycle = projectWeeklyCycle(ANCHOR_JUL_24, atReset);
		expect(cycle?.nextReset.toISOString()).toBe("2026-07-31T08:00:00.383Z");
		expect(cycle?.cycleStart.getTime()).toBe(
			new Date("2026-07-24T08:00:00.383Z").getTime(),
		);
	});

	it("projects backwards for an anchor not yet due", () => {
		// The API hands out a FUTURE reset instant, so on the first reading the
		// anchor is always ahead of now. Getting this direction wrong would put
		// the cycle start a week late and read every total as near-zero.
		const cycle = projectWeeklyCycle(
			ANCHOR_JUL_31,
			new Date("2026-07-28T00:00:00Z"),
		);
		expect(cycle?.nextReset.toISOString()).toBe("2026-07-31T08:00:00.585Z");
		expect(cycle?.cycleStart.toISOString()).toBe("2026-07-24T08:00:00.585Z");
	});

	it("projects backwards across more than one week", () => {
		const cycle = projectWeeklyCycle(
			ANCHOR_JUL_31,
			new Date("2026-07-15T00:00:00Z"),
		);
		expect(cycle?.nextReset.toISOString()).toBe("2026-07-17T08:00:00.585Z");
	});

	it("projects a constant UTC time of day, by construction", () => {
		// Honest about what this pins: exact-week arithmetic, so the UTC time of
		// day cannot move. It does NOT show that Anthropic's reset behaves this
		// way across a DST change -- both captured payloads are from the same
		// season, so that is unobserved. What keeps a wrong assumption cheap is
		// re-anchoring on every poll, not this test.
		const beforeDst = projectWeeklyCycle(
			ANCHOR_JUL_24,
			new Date("2026-10-20T00:00:00Z"),
		);
		const afterDst = projectWeeklyCycle(
			ANCHOR_JUL_24,
			new Date("2026-11-10T00:00:00Z"),
		);
		expect(beforeDst?.nextReset.toISOString().slice(11)).toBe(
			afterDst?.nextReset.toISOString().slice(11),
		);
	});
});
