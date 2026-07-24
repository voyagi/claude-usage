/**
 * When a reset instant may come from local data, and when it may not.
 *
 * Shared rather than restated at each display site. Three sites read a reset,
 * two of them in one file, and they had already drifted apart once: the status
 * bar and the dashboard's rate limit cards were corrected while the dashboard's
 * session window panel kept the old behaviour, so a single payload could render
 * a bar with no countdown beside a panel counting down to a locally guessed
 * time. Keeping the rule in one place closes that class rather than the one
 * instance of it.
 */

import type { ApiRateLimitWindow } from "../types.js";

/**
 * The instant a limit resets, or null when nothing can honestly be shown.
 *
 * If the API answered for a window, its answer is the answer INCLUDING a null
 * `resets_at`. What is actually observed is narrow: across the captured
 * payloads the field is populated on every limit carrying usage and null on the
 * one sitting at zero. Why the server omits it is not established, so this does
 * not claim the window is unstarted -- only that we decline to supply a value
 * the API did not. Falling through to the local estimate there is what put a
 * fabricated countdown -- the next Monday midnight, over four days early --
 * beside an API-sourced "0%", with no way for a reader to tell the two apart.
 *
 * The cost of that choice is real and accepted: at zero usage a bar shows no
 * countdown even though the cycle almost certainly still turns over on the
 * account's weekly anchor. Showing nothing withholds a likely-true figure;
 * showing the old fallback asserted a demonstrably false one.
 *
 * The local estimate is still used when the API produced no window at all,
 * because then the percentage beside it is local too and the pair is at least
 * consistent with itself.
 */
export function resetInstant(
	apiWindow: ApiRateLimitWindow | null,
	fallback: { local: Date | null },
): Date | null {
	if (apiWindow) {
		return apiWindow.resetsAt ? new Date(apiWindow.resetsAt) : null;
	}
	return fallback.local;
}
