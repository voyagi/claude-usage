import type { ApiRateLimitWindow } from "../types";
import { resetInstant } from "./resetInstant";

const LOCAL = new Date("2026-07-27T00:00:00.000Z");

function window(resetsAt: string | null): ApiRateLimitWindow {
	return { utilization: 0.13, resetsAt };
}

describe("resetInstant", () => {
	it("uses the API's reset when it states one", () => {
		const at = resetInstant(window("2026-07-31T08:00:00.585182+00:00"), {
			local: LOCAL,
		});
		expect(at?.toISOString()).toBe("2026-07-31T08:00:00.585Z");
	});

	it("returns null when the API answered but stated no reset", () => {
		// Not the local estimate. This is the whole point of the module: the
		// scoped weekly limit reports null at zero usage, and filling it from
		// local data is what rendered a countdown four days early.
		expect(resetInstant(window(null), { local: LOCAL })).toBeNull();
	});

	it("uses the local estimate when the API produced no window at all", () => {
		expect(resetInstant(null, { local: LOCAL })).toBe(LOCAL);
	});

	it("returns null, not an Invalid Date, for an unparseable reset", () => {
		// `resets_at` is typed `string | null`, which asserts rather than checks
		// the server's JSON, and the value round-trips through an on-disk cache.
		// An Invalid Date escaping here throws RangeError from whichever caller
		// formats it first, which took the dashboard build down before the usage
		// save. Falling back to the local estimate would be wrong too: the API
		// did answer, it just answered with something unusable.
		expect(resetInstant(window("not-a-date"), { local: LOCAL })).toBeNull();
		expect(resetInstant(window(""), { local: LOCAL })).toBeNull();
	});

	it("survives being formatted by a caller after an unparseable reset", () => {
		// The failure was never the null itself, it was `.toISOString()` on what
		// the old code returned. This asserts the caller's move does not throw.
		expect(() =>
			resetInstant(window("not-a-date"), { local: LOCAL })?.toISOString(),
		).not.toThrow();
	});
});
