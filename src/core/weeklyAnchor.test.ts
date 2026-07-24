import { projectWeeklyCycle, WEEK_MS } from "./weeklyAnchor";

/**
 * Both instants are real, taken from captured usage payloads a week apart.
 * They are the evidence that the anchor is fixed rather than rolling: same
 * weekday, same wall clock, exactly seven days between them.
 */
const ANCHOR_JUL_24 = "2026-07-24T08:00:00.383291+00:00";
const ANCHOR_JUL_31 = "2026-07-31T08:00:00.585182+00:00";

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
