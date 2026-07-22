/**
 * The single decision about whether to show money.
 *
 * The status bar tooltip and the dashboard must agree: a tooltip quoting
 * "$3.50 today" beside a dashboard showing token totals is worse than either
 * choice on its own. Two copies of this predicate drifted apart once already,
 * so it lives in one place and both import it.
 */

import * as vscode from "vscode";
import type { ApiUsageData } from "../types.js";

/** How the user wants cost handled. `auto` defers to whether credits exist. */
export type CostDisplayMode = "auto" | "always" | "never";

/**
 * Whether the account actually spends money, as opposed to consuming a flat
 * subscription. Reads both API shapes: `spend` is current, `extra_usage` is the
 * older one some accounts still report.
 */
export function hasUsageCredits(api: ApiUsageData | null | undefined): boolean {
	return api?.spend?.enabled === true || api?.extraUsage?.isEnabled === true;
}

/**
 * Whether to show dollar figures.
 *
 * On a subscription a per-token cost is an API-equivalent estimate, not a bill,
 * so `auto` shows it only when the account has usage credits enabled. With no
 * API reading we cannot tell, and a subscriber is the common case, so we do not
 * assert a dollar figure at them.
 */
export function shouldShowCost(api: ApiUsageData | null | undefined): boolean {
	const mode = vscode.workspace
		.getConfiguration("claude-usage")
		.get<CostDisplayMode>("showCostEstimates", "auto");

	if (mode === "always") return true;
	if (mode === "never") return false;
	return hasUsageCredits(api);
}
