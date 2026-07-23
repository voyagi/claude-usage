/**
 * Rendering tests for the Usage Credits card.
 *
 * These exist because the card's guards were previously unverifiable: jest
 * matched only `.test.ts`, so nothing under the webview could be rendered in a
 * test at all. Three rounds of review found the same defect one branch further
 * along each time -- the card claiming "$0.00" for a balance the API had never
 * reported -- and each fix could only be checked by hand.
 *
 * Rendered with react-dom/server rather than a testing library: react and
 * react-dom are already dependencies, so this adds no package.
 */

import { renderToStaticMarkup } from "react-dom/server";
import type { DashboardData, SpendSummary } from "../types";
import { OverviewTab } from "./OverviewTab";

/** Minimal dashboard payload; only the credits card is under test here. */
function dashboardData(spend: SpendSummary | null): DashboardData {
	const limit = {
		name: "Weekly",
		currentTokens: 0,
		estimatedLimit: 0,
		percentage: 0,
		resetTime: null,
		isHit: false,
		isEstimated: false,
	};
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheCreationTokens: 0,
		cacheReadTokens: 0,
		todayCost: 0,
		monthCost: 0,
		totalCost: 0,
		todayTokens: 0,
		monthTokens: 0,
		session5h: { ...limit, name: "Session (5hr)" },
		weekly: limit,
		scopedWeekly: [],
		spend,
		showCost: spend !== null,
		apiStaleness: "fresh",
		weeklyForecast: null,
		attribution: null,
		windowStart: null,
		windowExpiry: null,
		timeRemainingMinutes: null,
		tokensPerMinute: 0,
		minutesUntilLimit: null,
		trendData: [],
		projects: [],
		currentSessionTokens: 0,
		averageSessionTokens: 0,
		sessionCount: 0,
		lastUpdated: new Date().toISOString(),
		filesProcessed: 0,
		linesSkipped: 0,
		planType: "max5",
		dataSourcePath: "/tmp",
		isFirstRun: false,
		hasCustomPricing: false,
		unparsedUsageRecords: 0,
	};
}

/**
 * The Usage Credits card only, not the whole tab.
 *
 * Scoping matters: the metric tiles also render "$0.00" and the rate-limit bars
 * also render "progress-fill", so a whole-tab assertion for either would fail
 * on markup that has nothing to do with credits, and pass for the wrong reason
 * if the card were removed.
 */
function render(spend: SpendSummary | null): string | null {
	const html = renderToStaticMarkup(
		<OverviewTab data={dashboardData(spend)} />,
	);
	// Both boundaries key on card HEADINGS, never on wrapper markup. Keying
	// either end on `class="card"` fails open: a modifier class on the card
	// AFTER this one makes the terminator miss, the slice runs to end of
	// document, and every assertion below silently starts inspecting the whole
	// tab -- which is exactly what scoping exists to prevent.
	const heading = '<h3 class="card-title">Usage Credits</h3>';
	const headingAt = html.indexOf(heading);
	if (headingAt === -1) {
		// Genuinely not rendered. A slice that has merely stopped matching
		// cannot reach here unnoticed, because every other test goes through
		// card(), which throws rather than reporting absence.
		return null;
	}

	const start = html.lastIndexOf("<div", headingAt);
	// The next card begins at its own heading; walk back to that card's
	// opening tag so this slice stops before it.
	const nextHeading = html.indexOf(
		'<h3 class="card-title"',
		headingAt + heading.length,
	);
	const end =
		nextHeading === -1 ? html.length : html.lastIndexOf("<div", nextHeading);
	return html.slice(start, end);
}

/** Fails loudly if the slice stops finding a card that IS being rendered. */
function card(spend: SpendSummary): string {
	const html = render(spend);
	if (html === null) throw new Error("credits card not found in rendered tab");
	return html;
}

describe("Usage Credits card", () => {
	it("is absent entirely on a subscription with no credits", () => {
		// null means the heading is nowhere in the tab. Every other test in this
		// file calls card(), which throws rather than returning null, so a
		// broken slice cannot masquerade as absence here.
		expect(render(null)).toBeNull();
	});

	it("shows a reported amount against its limit", () => {
		const html = card({
			used: 12.34,
			limit: 50,
			percentage: 24.68,
			currency: "USD",
			isDerived: false,
		});

		expect(html).toContain("Usage Credits");
		expect(html).toContain("$12.34");
		expect(html).toContain("of $50.00");
		expect(html).toContain("25% of your credit limit used");
	});

	it("marks a derived amount rather than presenting it as exact", () => {
		const html = card({
			used: 70,
			limit: 200,
			percentage: 35,
			currency: "USD",
			isDerived: true,
		});

		expect(html).toContain("~$70.00");
	});

	it("shows the percentage alone when there is no amount to state", () => {
		// utilization known, no limit to derive an amount from
		const html = card({
			used: null,
			limit: null,
			percentage: 40,
			currency: "USD",
			isDerived: false,
		});

		expect(html).toContain("40%");
		// Not a fabricated balance
		expect(html).not.toContain("$0.00");
	});

	it("says nothing at all when the API reported no usage figure", () => {
		// The case that survived three review rounds: credits enabled, neither
		// an amount nor a utilization. A zero here is a claim about the account.
		const html = card({
			used: null,
			limit: 50,
			percentage: null,
			currency: "USD",
			isDerived: false,
		});

		expect(html).toContain("Usage Credits");
		expect(html).toContain("—");
		// The limit is known and still worth showing
		expect(html).toContain("of $50.00");
		// But no fabricated balance, no zero bar, no zero share
		expect(html).not.toContain("$0.00");
		expect(html).not.toContain("0% of your credit limit used");
		expect(html).not.toContain("progress-fill");
	});

	it("renders the bar only when a share is actually known", () => {
		const known = card({
			used: 45,
			limit: 50,
			percentage: 90,
			currency: "USD",
			isDerived: false,
		});
		expect(known).toContain("progress-fill");

		const unknown = card({
			used: null,
			limit: 50,
			percentage: null,
			currency: "USD",
			isDerived: false,
		});
		expect(unknown).not.toContain("progress-fill");
	});

	it("draws no bar when there is no limit to draw it against", () => {
		// The other half of the bar gate. Its partner (percentage !== null) is
		// enforced by the type checker, since Math.min rejects a nullable, but
		// this half compiles fine when removed -- so it needs a test.
		const html = card({
			used: 30,
			limit: null,
			percentage: 60,
			currency: "USD",
			isDerived: false,
		});

		// The amount is known and shown; there is simply nothing to draw it
		// against, and no limit to name.
		expect(html).toContain("$30.00");
		expect(html).not.toContain("progress-fill");
		expect(html).not.toContain("of $");
	});

	it("uses the currency the API reported", () => {
		const html = card({
			used: 10,
			limit: 100,
			percentage: 10,
			currency: "EUR",
			isDerived: false,
		});

		expect(html).toMatch(/€10\.00|EUR\s?10\.00/);
	});
});
