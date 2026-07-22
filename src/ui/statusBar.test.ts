/**
 * Unit tests for StatusBarManager auth-dead display and staleness dimming
 *
 * Covers all 0% coverage in statusBar.ts:
 * - Auth-dead display state (lines 120-129)
 * - Staleness color dimming (lines 132-148)
 * - Auth-dead tooltip (lines 265-268)
 * - setAuthState cache invalidation (lines 298-302)
 * - showRefreshing, showError, showNoData, toggle, dispose
 */

jest.mock(
	"vscode",
	() => {
		const items: any[] = [];
		return {
			window: {
				createStatusBarItem: jest.fn(
					(_id: string, _align: any, _pri: number) => {
						const item = {
							text: "",
							tooltip: undefined as any,
							color: undefined as string | undefined,
							backgroundColor: undefined as any,
							command: undefined as string | undefined,
							show: jest.fn(),
							hide: jest.fn(),
							dispose: jest.fn(),
						};
						items.push(item);
						return item;
					},
				),
			},
			StatusBarAlignment: { Right: 2 },
			// The tooltip asks whether to show cost, which reads settings
			workspace: {
				getConfiguration: () => ({
					get: (_key: string, fallback: unknown) => fallback,
				}),
			},
			MarkdownString: class {
				value = "";
				isTrusted = false;
				supportHtml = false;
				appendMarkdown(s: string) {
					this.value += s;
				}
			},
			// Track items for test access
			_items: items,
		};
	},
	{ virtual: true },
);

import type { RateLimitInfo, StalenessLevel, StatusBarData } from "../types";
import { StatusBarManager } from "./statusBar";

// ── Helpers ──────────────────────────────────────────────────────────

function makeRateLimitInfo(name: string, pct = 50): RateLimitInfo {
	return {
		name,
		currentTokens: pct * 1000,
		estimatedLimit: 100_000,
		percentage: pct,
		resetTime: null,
		isHit: pct >= 100,
	};
}

function makeStatusBarData(
	overrides: Partial<StatusBarData> = {},
): StatusBarData {
	return {
		totalInputTokens: 100_000,
		totalOutputTokens: 50_000,
		totalCost: 5.0,
		todayCost: 1.5,
		monthCost: 30.0,
		todayTokens: 25_000,
		monthTokens: 500_000,
		burnRate: 500,
		rateLimits: {
			session5h: makeRateLimitInfo("Session (5hr)", 40),
			weekly: makeRateLimitInfo("Weekly", 25),
			weeklyScoped: makeRateLimitInfo("Weekly Fable", 15),
			worstPercentage: 40,
		},
		apiUsage: {
			fiveHour: { utilization: 0.4, resetsAt: null },
			sevenDay: { utilization: 0.25, resetsAt: null },
			scopedWeekly: [{ label: "Fable", utilization: 0.15, resetsAt: null }],
			rateLimitTier: "tier4",
			extraUsage: null,
			spend: null,
			fetchedAt: new Date(),
		},
		staleness: "fresh" as StalenessLevel,
		lastUpdated: new Date(),
		filesProcessed: 10,
		linesSkipped: 0,
		...overrides,
	};
}

function createManager(): {
	manager: StatusBarManager;
	sessionItem: any;
	weeklyItem: any;
	scopedItem: any;
} {
	const vscode = require("vscode");
	vscode._items.length = 0;

	const context = {
		subscriptions: { push: jest.fn() },
	} as any;

	const manager = new StatusBarManager(context);

	return {
		manager,
		sessionItem: vscode._items[0],
		weeklyItem: vscode._items[1],
		scopedItem: vscode._items[2],
	};
}

// ── Auth-dead display state ─────────────────────────────────────────

describe("StatusBarManager: auth-dead display", () => {
	it("shows 'Auth expired' text when auth state is dead", () => {
		const { manager, sessionItem } = createManager();

		manager.setAuthState("dead");
		manager.update(makeStatusBarData());

		expect(sessionItem.text).toBe("$(key) Auth expired");
	});

	it("still shows weekly and scoped percentages when auth is dead", () => {
		const { manager, weeklyItem, scopedItem } = createManager();

		manager.setAuthState("dead");
		manager.update(makeStatusBarData());

		expect(weeklyItem.text).toBe("W:25% ?");
		// Prefix follows the API's scoped model name, not a hardcoded "So"
		expect(scopedItem.text).toBe("Fa:15% ?");
	});

	it("labels the scoped item from whatever model the API scopes", () => {
		const { manager, scopedItem } = createManager();

		manager.update(
			makeStatusBarData({
				apiUsage: {
					fiveHour: { utilization: 0.4, resetsAt: null },
					sevenDay: { utilization: 0.25, resetsAt: null },
					scopedWeekly: [
						{ label: "Sonnet", utilization: 0.62, resetsAt: null },
					],
					rateLimitTier: "tier4",
					extraUsage: null,
					spend: null,
					fetchedAt: new Date(),
				},
			}),
		);

		expect(scopedItem.text).toContain("So:62%");
	});

	it("treats an empty scoped label as unknown, not as a label", () => {
		const { manager, scopedItem } = createManager();

		manager.update(
			makeStatusBarData({
				apiUsage: {
					fiveHour: { utilization: 0.4, resetsAt: null },
					sevenDay: { utilization: 0.25, resetsAt: null },
					// An empty label must not slip through and render ":15%"
					scopedWeekly: [{ label: "", utilization: 0.15, resetsAt: null }],
					rateLimitTier: "tier4",
					extraUsage: null,
					spend: null,
					fetchedAt: new Date(),
				},
				rateLimits: {
					session5h: makeRateLimitInfo("Session (5hr)", 40),
					weekly: makeRateLimitInfo("Weekly", 25),
					weeklyScoped: null,
					worstPercentage: 40,
				},
			}),
		);

		expect(scopedItem.hide).toHaveBeenCalled();
		expect(scopedItem.show).not.toHaveBeenCalled();
	});

	it("hides the scoped item when no scoped model is known", () => {
		const { manager, scopedItem } = createManager();

		manager.update(
			makeStatusBarData({
				apiUsage: null,
				rateLimits: {
					session5h: makeRateLimitInfo("Session (5hr)", 40),
					weekly: makeRateLimitInfo("Weekly", 25),
					weeklyScoped: null,
					worstPercentage: 40,
				},
			}),
		);

		expect(scopedItem.hide).toHaveBeenCalled();
		expect(scopedItem.show).not.toHaveBeenCalled();
	});

	it("shows normal text when auth state is healthy", () => {
		const { manager, sessionItem } = createManager();

		manager.setAuthState("healthy");
		manager.update(makeStatusBarData());

		expect(sessionItem.text).toContain("S:40%");
		expect(sessionItem.text).not.toContain("Auth expired");
	});

	it("shows normal text when auth state is degraded", () => {
		const { manager, sessionItem } = createManager();

		manager.setAuthState("degraded");
		manager.update(makeStatusBarData());

		expect(sessionItem.text).toContain("S:40%");
	});
});

// ── Staleness color dimming ─────────────────────────────────────────

describe("StatusBarManager: staleness dimming", () => {
	const CRITICAL_COLOR = "#555555";
	const STALE_COLOR = "#808080";
	const SESSION_COLOR = "#4EC9B0";
	const WEEKLY_COLOR = "#DCDCAA";
	const SCOPED_COLOR = "#C586C0";

	it("uses CRITICAL_COLOR when auth is dead", () => {
		const { manager, sessionItem, weeklyItem, scopedItem } = createManager();

		manager.setAuthState("dead");
		manager.update(makeStatusBarData());

		expect(sessionItem.color).toBe(CRITICAL_COLOR);
		expect(weeklyItem.color).toBe(CRITICAL_COLOR);
		expect(scopedItem.color).toBe(CRITICAL_COLOR);
	});

	it("uses CRITICAL_COLOR when staleness is critical (even if auth healthy)", () => {
		const { manager, sessionItem, weeklyItem, scopedItem } = createManager();

		manager.setAuthState("healthy");
		manager.update(makeStatusBarData({ staleness: "critical" }));

		expect(sessionItem.color).toBe(CRITICAL_COLOR);
		expect(weeklyItem.color).toBe(CRITICAL_COLOR);
		expect(scopedItem.color).toBe(CRITICAL_COLOR);
	});

	it("uses normal colors for dim staleness (1-2h is not concerning)", () => {
		const { manager, sessionItem, weeklyItem, scopedItem } = createManager();

		manager.update(makeStatusBarData({ staleness: "dim" }));

		expect(sessionItem.color).toBe(SESSION_COLOR);
		expect(weeklyItem.color).toBe(WEEKLY_COLOR);
		expect(scopedItem.color).toBe(SCOPED_COLOR);
	});

	it("uses STALE_COLOR for stale staleness", () => {
		const { manager, sessionItem } = createManager();

		manager.update(makeStatusBarData({ staleness: "stale" }));

		expect(sessionItem.color).toBe(STALE_COLOR);
	});

	it("uses STALE_COLOR for unavailable staleness", () => {
		const { manager, sessionItem } = createManager();

		manager.update(makeStatusBarData({ staleness: "unavailable" }));

		expect(sessionItem.color).toBe(STALE_COLOR);
	});

	it("uses normal distinct colors for fresh staleness", () => {
		const { manager, sessionItem, weeklyItem, scopedItem } = createManager();

		manager.update(makeStatusBarData({ staleness: "fresh" }));

		expect(sessionItem.color).toBe(SESSION_COLOR);
		expect(weeklyItem.color).toBe(WEEKLY_COLOR);
		expect(scopedItem.color).toBe(SCOPED_COLOR);
	});

	it("uses normal distinct colors for normal staleness", () => {
		const { manager, sessionItem, weeklyItem, scopedItem } = createManager();

		manager.update(makeStatusBarData({ staleness: "normal" }));

		expect(sessionItem.color).toBe(SESSION_COLOR);
		expect(weeklyItem.color).toBe(WEEKLY_COLOR);
		expect(scopedItem.color).toBe(SCOPED_COLOR);
	});
});

// ── Auth-dead tooltip ───────────────────────────────────────────────

describe("StatusBarManager: auth-dead tooltip", () => {
	it("includes auth expired warning in tooltip when dead", () => {
		const { manager, sessionItem } = createManager();

		manager.setAuthState("dead");
		manager.update(makeStatusBarData());

		expect(sessionItem.tooltip.value).toContain("Auth expired");
		expect(sessionItem.tooltip.value).toContain("Re-authenticate");
	});

	it("includes stale data warning in tooltip when stale (not dead)", () => {
		const { manager, sessionItem } = createManager();

		manager.setAuthState("healthy");
		const data = makeStatusBarData({ staleness: "stale" });
		manager.update(data);

		expect(sessionItem.tooltip.value).toContain("API data is");
		expect(sessionItem.tooltip.value).toContain("old");
	});

	it("includes unavailable notice when no API data", () => {
		const { manager, sessionItem } = createManager();

		manager.update(
			makeStatusBarData({
				staleness: "unavailable",
				apiUsage: null,
			}),
		);

		expect(sessionItem.tooltip.value).toContain("API not connected");
	});

	it("includes estimated notice when API is null but staleness is fresh", () => {
		const { manager, sessionItem } = createManager();

		manager.update(
			makeStatusBarData({
				staleness: "fresh",
				apiUsage: null,
			}),
		);

		expect(sessionItem.tooltip.value).toContain("estimated");
	});

	it("does not show auth warning when healthy", () => {
		const { manager, sessionItem } = createManager();

		manager.setAuthState("healthy");
		manager.update(makeStatusBarData({ staleness: "fresh" }));

		expect(sessionItem.tooltip.value).not.toContain("Auth expired");
		expect(sessionItem.tooltip.value).not.toContain("API data is");
	});
});

// ── setAuthState cache invalidation ─────────────────────────────────

describe("StatusBarManager: setAuthState", () => {
	it("invalidates signature so next update() re-renders", () => {
		const { manager, sessionItem } = createManager();

		// First update establishes signature
		const data = makeStatusBarData();
		manager.update(data);
		const text1 = sessionItem.text;

		// Same data again -> skipped (signature match)
		const showCalls = sessionItem.show.mock.calls.length;
		manager.update(data);
		expect(sessionItem.show.mock.calls.length).toBe(showCalls);

		// setAuthState invalidates -> next update re-renders
		manager.setAuthState("dead");
		manager.update(data);
		expect(sessionItem.text).not.toBe(text1);
		expect(sessionItem.text).toBe("$(key) Auth expired");
	});
});

// ── Stale marker in status bar text ─────────────────────────────────

describe("StatusBarManager: stale marker", () => {
	it("appends ? to session text when data is stale", () => {
		const { manager, sessionItem } = createManager();

		manager.update(makeStatusBarData({ staleness: "stale" }));

		expect(sessionItem.text).toContain("?");
	});

	it("appends ? to session text when data is critical", () => {
		const { manager, sessionItem } = createManager();

		manager.update(makeStatusBarData({ staleness: "critical" }));

		expect(sessionItem.text).toContain("?");
	});

	it("does not append ? when fresh", () => {
		const { manager, sessionItem } = createManager();

		manager.update(makeStatusBarData({ staleness: "fresh" }));

		expect(sessionItem.text).not.toContain("?");
	});
});

// ── showRefreshing, showError, showNoData ───────────────────────────

describe("StatusBarManager: display states", () => {
	it("showRefreshing shows spinner and hides secondary items", () => {
		const { manager, sessionItem, weeklyItem, scopedItem } = createManager();

		manager.showRefreshing();

		expect(sessionItem.text).toContain("Refreshing");
		expect(weeklyItem.hide).toHaveBeenCalled();
		expect(scopedItem.hide).toHaveBeenCalled();
	});

	it("showError shows warning and hides secondary items", () => {
		const { manager, sessionItem, weeklyItem, scopedItem } = createManager();

		manager.showError("Something went wrong");

		expect(sessionItem.text).toContain("Error");
		expect(sessionItem.tooltip).toBe("Something went wrong");
		expect(weeklyItem.hide).toHaveBeenCalled();
		expect(scopedItem.hide).toHaveBeenCalled();

		// showError arms a 5s errorTimer; dispose clears it so the timer doesn't
		// leak into other tests (Jest "worker failed to exit" / flaky runs).
		manager.dispose();
	});

	it("showNoData shows cloud icon and hides secondary items", () => {
		const { manager, sessionItem, weeklyItem, scopedItem } = createManager();

		manager.showNoData();

		expect(sessionItem.text).toContain("No data");
		expect(sessionItem.show).toHaveBeenCalled();
		expect(weeklyItem.hide).toHaveBeenCalled();
		expect(scopedItem.hide).toHaveBeenCalled();
	});

	it("showError auto-clears to showNoData after timeout", () => {
		jest.useFakeTimers();
		const { manager, sessionItem } = createManager();

		manager.showError("test error");
		expect(sessionItem.text).toContain("Error");

		jest.advanceTimersByTime(5000);
		expect(sessionItem.text).toContain("No data");

		jest.useRealTimers();
	});

	it("update() clears error timer", () => {
		jest.useFakeTimers();
		const { manager, sessionItem } = createManager();

		manager.showError("test error");
		manager.update(makeStatusBarData());

		// After timeout, should NOT revert to No data because update() cleared the timer
		jest.advanceTimersByTime(5000);
		expect(sessionItem.text).not.toContain("Error");
		expect(sessionItem.text).not.toContain("No data");

		jest.useRealTimers();
	});
});

// ── toggle ──────────────────────────────────────────────────────────

describe("StatusBarManager: toggle", () => {
	it("hides all items on first toggle, shows them again on second", () => {
		const { manager, sessionItem, weeklyItem, scopedItem } = createManager();

		// A scoped model must be known, or the scoped item stays hidden by design
		manager.update(makeStatusBarData());

		// Counts, not "was ever called": the constructor already hid these and
		// update() already showed them, so toHaveBeenCalled() is satisfied before
		// toggle() runs and cannot fail even if toggle touched nothing.
		const before = {
			sessionHide: sessionItem.hide.mock.calls.length,
			weeklyHide: weeklyItem.hide.mock.calls.length,
			scopedHide: scopedItem.hide.mock.calls.length,
		};

		manager.toggle();
		expect(sessionItem.hide.mock.calls.length).toBeGreaterThan(
			before.sessionHide,
		);
		expect(weeklyItem.hide.mock.calls.length).toBeGreaterThan(
			before.weeklyHide,
		);
		expect(scopedItem.hide.mock.calls.length).toBeGreaterThan(
			before.scopedHide,
		);

		const afterHide = {
			sessionShow: sessionItem.show.mock.calls.length,
			weeklyShow: weeklyItem.show.mock.calls.length,
			scopedShow: scopedItem.show.mock.calls.length,
		};

		manager.toggle();
		expect(sessionItem.show.mock.calls.length).toBeGreaterThan(
			afterHide.sessionShow,
		);
		expect(weeklyItem.show.mock.calls.length).toBeGreaterThan(
			afterHide.weeklyShow,
		);
		expect(scopedItem.show.mock.calls.length).toBeGreaterThan(
			afterHide.scopedShow,
		);
	});

	it("does not resurrect the scoped item when no scoped model is known", () => {
		const { manager, scopedItem } = createManager();

		// Toggling off and back on must not bypass the hide-when-unknown rule,
		// which would show a nameless ":0%".
		manager.toggle();
		manager.toggle();

		expect(scopedItem.show).not.toHaveBeenCalled();
	});
});

// ── dispose ─────────────────────────────────────────────────────────

describe("StatusBarManager: dispose", () => {
	it("disposes all status bar items", () => {
		const { manager, sessionItem, weeklyItem, scopedItem } = createManager();

		manager.dispose();

		expect(sessionItem.dispose).toHaveBeenCalled();
		expect(weeklyItem.dispose).toHaveBeenCalled();
		expect(scopedItem.dispose).toHaveBeenCalled();
	});
});

// ── Burn rate and forecast in tooltip ───────────────────────────────

describe("StatusBarManager: tooltip content", () => {
	it("includes burn rate when active", () => {
		const { manager, sessionItem } = createManager();

		manager.update(makeStatusBarData({ burnRate: 1200 }));

		expect(sessionItem.tooltip.value).toContain("Burn Rate");
	});

	it("omits cost from the tooltip on a subscription", () => {
		const { manager, sessionItem } = createManager();

		// No credits enabled: a per-token cost is an API-equivalent estimate,
		// not a bill, so it must not appear next to real limit percentages.
		manager.update(makeStatusBarData({ todayCost: 3.5, monthCost: 45.0 }));

		// No dollar figure...
		expect(sessionItem.tooltip.value).not.toContain("$3.50");
		expect(sessionItem.tooltip.value).not.toContain("$45.00");
		// ...but the per-period line survives in tokens. Dropping it entirely
		// would leave the tooltip with only all-time totals.
		expect(sessionItem.tooltip.value).toContain("**Today:** 25,000");
		expect(sessionItem.tooltip.value).toContain("500,000 tokens");
	});

	it("re-renders when only the cost-visibility decision changes", () => {
		const { manager, sessionItem } = createManager();

		// Identical limit percentages and costs; the ONLY difference is that
		// credits become enabled. The render signature has to notice, or the
		// tooltip keeps showing tokens until some unrelated number moves.
		const withoutCredits = makeStatusBarData();
		manager.update(withoutCredits);
		expect(sessionItem.tooltip.value).not.toContain("$1.50");

		const apiWithCredits = {
			...(withoutCredits.apiUsage as NonNullable<StatusBarData["apiUsage"]>),
			spend: {
				used: 1.5,
				limit: 50,
				percent: 3,
				currency: "USD",
				severity: "normal",
				enabled: true,
			},
		};
		manager.update(makeStatusBarData({ apiUsage: apiWithCredits }));

		expect(sessionItem.tooltip.value).toContain("$1.50");
	});

	it("re-renders when only today's tokens change", () => {
		// The tokens line is the ONLY per-period figure the tooltip shows when
		// cost is hidden, so it has to be in the signature. Percentages, costs
		// and burn rate are held identical here.
		const { manager, sessionItem } = createManager();
		manager.update(makeStatusBarData({ todayTokens: 25_000 }));
		expect(sessionItem.tooltip.value).toContain("25,000");

		manager.update(makeStatusBarData({ todayTokens: 90_000 }));
		expect(sessionItem.tooltip.value).toContain("90,000");
	});

	it("re-renders when only the month's tokens change", () => {
		// Separately pinned: moving only todayTokens leaves monthTokens free to
		// fall out of the signature unnoticed.
		const { manager, sessionItem } = createManager();
		manager.update(makeStatusBarData({ monthTokens: 500_000 }));
		expect(sessionItem.tooltip.value).toContain("500,000");

		manager.update(makeStatusBarData({ monthTokens: 750_000 }));
		expect(sessionItem.tooltip.value).toContain("750,000");
	});

	it("re-renders when only the month cost changes", () => {
		const { manager, sessionItem } = createManager();
		const withCredits = (monthCost: number) =>
			makeStatusBarData({
				monthCost,
				apiUsage: {
					fiveHour: { utilization: 0.4, resetsAt: null },
					sevenDay: { utilization: 0.25, resetsAt: null },
					scopedWeekly: [],
					rateLimitTier: "tier4",
					extraUsage: null,
					spend: {
						used: 1,
						limit: 50,
						percent: 2,
						currency: "USD",
						severity: "normal",
						enabled: true,
					},
					fetchedAt: new Date(),
				},
			});

		manager.update(withCredits(45.0));
		expect(sessionItem.tooltip.value).toContain("$45.00");

		manager.update(withCredits(60.0));
		expect(sessionItem.tooltip.value).toContain("$60.00");
	});

	// All three overwrite the items outside the render path. Without
	// invalidating the signature, the next update carrying identical values
	// takes the early return and the bar stays stranded on whatever they wrote.
	it.each([
		["showRefreshing", "Refreshing"],
		["showNoData", "No data"],
	])("recovers from %s on an unchanged update", (method, stranded) => {
		const { manager, sessionItem, weeklyItem } = createManager();
		manager.update(makeStatusBarData());
		const showsBefore = weeklyItem.show.mock.calls.length;

		(manager as unknown as Record<string, () => void>)[method]();
		expect(sessionItem.text).toContain(stranded);

		manager.update(makeStatusBarData());
		expect(sessionItem.text).not.toContain(stranded);
		// A fresh show() call, not merely "was ever called" -- the mock already
		// has one from the first update, so the looser assertion cannot fail.
		expect(weeklyItem.show.mock.calls.length).toBeGreaterThan(showsBefore);
	});

	it("recovers from an error message on an unchanged update", () => {
		const { manager, sessionItem } = createManager();
		manager.update(makeStatusBarData());

		manager.showError("Something went wrong");
		expect(sessionItem.text).toContain("Error");

		manager.update(makeStatusBarData());
		expect(sessionItem.text).not.toContain("Error");

		// The update() above already cleared the 5s timer showError armed, so
		// this dispose() is belt-and-braces rather than the thing preventing a
		// leak. Kept so the test holds if that ordering ever changes.
		manager.dispose();
	});

	it("includes cost in the tooltip once credits are enabled", () => {
		const { manager, sessionItem } = createManager();

		manager.update(
			makeStatusBarData({
				todayCost: 3.5,
				monthCost: 45.0,
				apiUsage: {
					fiveHour: { utilization: 0.4, resetsAt: null },
					sevenDay: { utilization: 0.25, resetsAt: null },
					scopedWeekly: [],
					rateLimitTier: "tier4",
					extraUsage: null,
					spend: {
						used: 3.5,
						limit: 50,
						percent: 7,
						currency: "USD",
						severity: "normal",
						enabled: true,
					},
					fetchedAt: new Date(),
				},
			}),
		);

		expect(sessionItem.tooltip.value).toContain("Today");
		expect(sessionItem.tooltip.value).toContain("Month");
	});

	it("includes token counts in tooltip", () => {
		const { manager, sessionItem } = createManager();

		manager.update(
			makeStatusBarData({
				totalInputTokens: 500_000,
				totalOutputTokens: 250_000,
			}),
		);

		expect(sessionItem.tooltip.value).toContain("Tokens");
	});

	it("shows all 3 items after update", () => {
		const { manager, sessionItem, weeklyItem, scopedItem } = createManager();

		manager.update(makeStatusBarData());

		expect(sessionItem.show).toHaveBeenCalled();
		expect(weeklyItem.show).toHaveBeenCalled();
		expect(scopedItem.show).toHaveBeenCalled();
	});

	it("shares tooltip across all 3 items", () => {
		const { manager, sessionItem, weeklyItem, scopedItem } = createManager();

		manager.update(makeStatusBarData());

		expect(sessionItem.tooltip).toBe(weeklyItem.tooltip);
		expect(weeklyItem.tooltip).toBe(scopedItem.tooltip);
	});
});
