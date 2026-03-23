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

import type {
	AuthState,
	RateLimitInfo,
	StatusBarData,
	StalenessLevel,
} from "../types";
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
		burnRate: 500,
		rateLimits: {
			session5h: makeRateLimitInfo("Session (5hr)", 40),
			weekly: makeRateLimitInfo("Weekly", 25),
			weeklySonnet: makeRateLimitInfo("Weekly Sonnet", 15),
			worstPercentage: 40,
		},
		apiUsage: {
			fiveHour: { utilization: 0.4, resetsAt: null },
			sevenDay: { utilization: 0.25, resetsAt: null },
			sevenDaySonnet: { utilization: 0.15, resetsAt: null },
			sevenDayOpus: null,
			rateLimitTier: "tier4",
			extraUsage: null,
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
	sonnetItem: any;
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
		sonnetItem: vscode._items[2],
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

	it("still shows weekly and sonnet percentages when auth is dead", () => {
		const { manager, weeklyItem, sonnetItem } = createManager();

		manager.setAuthState("dead");
		manager.update(makeStatusBarData());

		expect(weeklyItem.text).toBe("W:25%");
		expect(sonnetItem.text).toBe("So:15%");
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
	const SONNET_COLOR = "#C586C0";

	it("uses CRITICAL_COLOR when auth is dead", () => {
		const { manager, sessionItem, weeklyItem, sonnetItem } = createManager();

		manager.setAuthState("dead");
		manager.update(makeStatusBarData());

		expect(sessionItem.color).toBe(CRITICAL_COLOR);
		expect(weeklyItem.color).toBe(CRITICAL_COLOR);
		expect(sonnetItem.color).toBe(CRITICAL_COLOR);
	});

	it("uses CRITICAL_COLOR when staleness is critical (even if auth healthy)", () => {
		const { manager, sessionItem, weeklyItem, sonnetItem } = createManager();

		manager.setAuthState("healthy");
		manager.update(makeStatusBarData({ staleness: "critical" }));

		expect(sessionItem.color).toBe(CRITICAL_COLOR);
		expect(weeklyItem.color).toBe(CRITICAL_COLOR);
		expect(sonnetItem.color).toBe(CRITICAL_COLOR);
	});

	it("uses STALE_COLOR for dim staleness", () => {
		const { manager, sessionItem, weeklyItem, sonnetItem } = createManager();

		manager.update(makeStatusBarData({ staleness: "dim" }));

		expect(sessionItem.color).toBe(STALE_COLOR);
		expect(weeklyItem.color).toBe(STALE_COLOR);
		expect(sonnetItem.color).toBe(STALE_COLOR);
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
		const { manager, sessionItem, weeklyItem, sonnetItem } = createManager();

		manager.update(makeStatusBarData({ staleness: "fresh" }));

		expect(sessionItem.color).toBe(SESSION_COLOR);
		expect(weeklyItem.color).toBe(WEEKLY_COLOR);
		expect(sonnetItem.color).toBe(SONNET_COLOR);
	});

	it("uses normal distinct colors for normal staleness", () => {
		const { manager, sessionItem, weeklyItem, sonnetItem } = createManager();

		manager.update(makeStatusBarData({ staleness: "normal" }));

		expect(sessionItem.color).toBe(SESSION_COLOR);
		expect(weeklyItem.color).toBe(WEEKLY_COLOR);
		expect(sonnetItem.color).toBe(SONNET_COLOR);
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
		const { manager, sessionItem, weeklyItem, sonnetItem } = createManager();

		manager.showRefreshing();

		expect(sessionItem.text).toContain("Refreshing");
		expect(weeklyItem.hide).toHaveBeenCalled();
		expect(sonnetItem.hide).toHaveBeenCalled();
	});

	it("showError shows warning and hides secondary items", () => {
		const { manager, sessionItem, weeklyItem, sonnetItem } = createManager();

		manager.showError("Something went wrong");

		expect(sessionItem.text).toContain("Error");
		expect(sessionItem.tooltip).toBe("Something went wrong");
		expect(weeklyItem.hide).toHaveBeenCalled();
		expect(sonnetItem.hide).toHaveBeenCalled();
	});

	it("showNoData shows cloud icon and hides secondary items", () => {
		const { manager, sessionItem, weeklyItem, sonnetItem } = createManager();

		manager.showNoData();

		expect(sessionItem.text).toContain("No data");
		expect(sessionItem.show).toHaveBeenCalled();
		expect(weeklyItem.hide).toHaveBeenCalled();
		expect(sonnetItem.hide).toHaveBeenCalled();
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
	it("hides all items on first toggle, shows on second", () => {
		const { manager, sessionItem, weeklyItem, sonnetItem } = createManager();

		manager.toggle();
		expect(sessionItem.hide).toHaveBeenCalled();
		expect(weeklyItem.hide).toHaveBeenCalled();
		expect(sonnetItem.hide).toHaveBeenCalled();

		manager.toggle();
		expect(sessionItem.show).toHaveBeenCalled();
		expect(weeklyItem.show).toHaveBeenCalled();
		expect(sonnetItem.show).toHaveBeenCalled();
	});
});

// ── dispose ─────────────────────────────────────────────────────────

describe("StatusBarManager: dispose", () => {
	it("disposes all status bar items", () => {
		const { manager, sessionItem, weeklyItem, sonnetItem } = createManager();

		manager.dispose();

		expect(sessionItem.dispose).toHaveBeenCalled();
		expect(weeklyItem.dispose).toHaveBeenCalled();
		expect(sonnetItem.dispose).toHaveBeenCalled();
	});
});

// ── Burn rate and forecast in tooltip ───────────────────────────────

describe("StatusBarManager: tooltip content", () => {
	it("includes burn rate when active", () => {
		const { manager, sessionItem } = createManager();

		manager.update(makeStatusBarData({ burnRate: 1200 }));

		expect(sessionItem.tooltip.value).toContain("Burn Rate");
	});

	it("includes cost info in tooltip", () => {
		const { manager, sessionItem } = createManager();

		manager.update(makeStatusBarData({ todayCost: 3.5, monthCost: 45.0 }));

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
		const { manager, sessionItem, weeklyItem, sonnetItem } = createManager();

		manager.update(makeStatusBarData());

		expect(sessionItem.show).toHaveBeenCalled();
		expect(weeklyItem.show).toHaveBeenCalled();
		expect(sonnetItem.show).toHaveBeenCalled();
	});

	it("shares tooltip across all 3 items", () => {
		const { manager, sessionItem, weeklyItem, sonnetItem } = createManager();

		manager.update(makeStatusBarData());

		expect(sessionItem.tooltip).toBe(weeklyItem.tooltip);
		expect(weeklyItem.tooltip).toBe(sonnetItem.tooltip);
	});
});
