/**
 * Overview tab - the main landing page showing key metrics.
 * Displays token breakdown, rate limits, session timing, and burn rate.
 */
import type { DashboardData, WeeklyCapForecast } from "../types";
import { ContributingSection } from "./ContributingSection";
import { ProgressBar } from "./ProgressBar";

interface OverviewTabProps {
	data: DashboardData | null;
}

/**
 * Format currency value
 */
function formatCost(cost: number): string {
	return `$${cost.toFixed(2)}`;
}

/**
 * Money in the currency the API reported, rather than assuming dollars.
 */
function formatMoney(amount: number, currency: string): string {
	try {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency,
		}).format(amount);
	} catch {
		// Unknown/absent currency code: show the number rather than throwing
		return `${currency} ${amount.toFixed(2)}`;
	}
}

/**
 * Format token count with commas
 */
function formatTokens(tokens: number): string {
	return new Intl.NumberFormat("en-US").format(Math.round(tokens));
}

/**
 * Short token count for the metric tiles, where a full comma-separated number
 * would wrap. 3.4M reads better than 3,361,708 at that size.
 */
function formatCompactTokens(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
	return String(Math.round(tokens));
}

/**
 * Format a day count for the weekly-cap forecast
 */
function formatDays(days: number): string {
	if (days >= 999) return "999+ days";
	if (days < 1) {
		const hours = Math.max(1, Math.round(days * 24));
		return `${hours}h`;
	}
	const rounded = Math.round(days * 10) / 10;
	return `${rounded} day${rounded === 1 ? "" : "s"}`;
}

/**
 * Sentence for the weekly-cap forecast.
 *
 * An API-derived forecast projects the average pace across the elapsed part of
 * the window, so it says "at your pace so far" rather than quoting a
 * tokens/day figure that only exists for the local estimate. A local forecast
 * is a guess against a community-estimated plan cap and says so, because when
 * the two disagree the local one is usually the wrong one.
 */
function forecastText(forecast: WeeklyCapForecast): string {
	const resets = `resets in ${formatDays(forecast.daysUntilReset)}`;

	if (!forecast.isFromApi) {
		const pace =
			forecast.avgDailyTokens !== null
				? `~${formatTokens(forecast.avgDailyTokens)} tokens/day`
				: "your recent pace";
		return forecast.willExceedBeforeReset
			? `Estimated from local logs (no live limit data): at ${pace} you would reach the estimated cap in ~${formatDays(forecast.daysUntilCap)}, before it ${resets}.`
			: `Estimated from local logs (no live limit data): ~${formatDays(forecast.daysUntilCap)} to the estimated cap at ${pace}; ${resets}.`;
	}

	// Deliberately not "On track". The pace is the average across the whole
	// elapsed window, so it under-reacts to a burst that started recently: at
	// 80% with half a day left it would still compute several days of headroom.
	// Stating both numbers informs without asserting safety the average cannot
	// support.
	return forecast.willExceedBeforeReset
		? `⚠ At your average pace this week you'd reach the weekly limit in ~${formatDays(forecast.daysUntilCap)}, before it ${resets}.`
		: `At your average pace this week: ~${formatDays(forecast.daysUntilCap)} of headroom, and it ${resets}.`;
}

/**
 * Format time duration
 */
function formatDuration(minutes: number | null): string {
	if (minutes === null || minutes <= 0) return "0m";

	const hours = Math.floor(minutes / 60);
	const mins = Math.floor(minutes % 60);

	if (hours > 0) {
		return `${hours}h ${mins}m`;
	}
	return `${mins}m`;
}

/**
 * Format timestamp to HH:MM
 */
function formatTime(isoString: string): string {
	const date = new Date(isoString);
	const hours = date.getHours().toString().padStart(2, "0");
	const minutes = date.getMinutes().toString().padStart(2, "0");
	return `${hours}:${minutes}`;
}

/**
 * Calculate elapsed percentage for timeline visualization
 */
function calculateElapsedPercentage(windowStart: string | null): number {
	if (!windowStart) return 0;

	const start = new Date(windowStart);
	const now = new Date();
	const elapsedMs = now.getTime() - start.getTime();
	const windowMs = 5 * 60 * 60 * 1000; // 5 hours in ms

	return Math.min((elapsedMs / windowMs) * 100, 100);
}

export function OverviewTab({ data }: OverviewTabProps) {
	if (!data) return null;

	const totalTokens =
		data.inputTokens +
		data.outputTokens +
		data.cacheCreationTokens +
		data.cacheReadTokens;

	// Calculate worst rate limit percentage for key metrics
	const worstLimitPercentage = Math.max(
		data.session5h.percentage,
		data.weekly.percentage,
		...data.scopedWeekly.map((limit) => limit.percentage),
	);

	const elapsedPercentage = calculateElapsedPercentage(data.windowStart);

	return (
		<div>
			{/* Section 1: Key Metrics Summary.
			    On a subscription the money figures are an API-equivalent estimate,
			    not a bill, so tokens are shown instead unless credits are in play. */}
			<div className="metrics-summary">
				{data.showCost ? (
					<>
						<div className="metric-card">
							<div className="metric-value">{formatCost(data.todayCost)}</div>
							<div className="metric-label">Today's Cost</div>
						</div>
						<div className="metric-card">
							<div className="metric-value">{formatCost(data.monthCost)}</div>
							<div className="metric-label">Month Cost</div>
						</div>
					</>
				) : (
					<>
						<div className="metric-card">
							<div className="metric-value">
								{formatCompactTokens(data.todayTokens)}
							</div>
							<div className="metric-label">Today's Tokens</div>
						</div>
						<div className="metric-card">
							<div className="metric-value">
								{formatCompactTokens(data.monthTokens)}
							</div>
							<div className="metric-label">Month Tokens</div>
						</div>
					</>
				)}
				<div className="metric-card">
					<div className="metric-value">{data.tokensPerMinute.toFixed(1)}</div>
					<div className="metric-label">Tokens/Min</div>
				</div>
				<div className="metric-card">
					<div className="metric-value">{worstLimitPercentage.toFixed(0)}%</div>
					<div className="metric-label">Worst Limit</div>
				</div>
			</div>

			{/* Custom pricing badge */}
			{data.showCost && data.hasCustomPricing && (
				<div
					style={{
						fontSize: "10px",
						opacity: 0.6,
						textAlign: "center",
						marginTop: "4px",
						marginBottom: "8px",
						fontStyle: "italic",
					}}
				>
					Using custom pricing overrides
				</div>
			)}

			{/* Section 2: Token Breakdown */}
			<div className="card">
				<h3 className="card-title">Token Breakdown</h3>
				<div className="token-breakdown">
					<div className="token-row">
						<div className="token-dot input"></div>
						<span className="token-label">Input tokens</span>
						<span className="token-value">
							{formatTokens(data.inputTokens)}
						</span>
					</div>
					<div className="token-row">
						<div className="token-dot output"></div>
						<span className="token-label">Output tokens</span>
						<span className="token-value">
							{formatTokens(data.outputTokens)}
						</span>
					</div>
					<div className="token-row">
						<div className="token-dot cache-creation"></div>
						<span className="token-label">Cache creation</span>
						<span className="token-value">
							{formatTokens(data.cacheCreationTokens)}
						</span>
					</div>
					<div className="token-row">
						<div className="token-dot cache-read"></div>
						<span className="token-label">Cache reads</span>
						<span className="token-value">
							{formatTokens(data.cacheReadTokens)}
						</span>
					</div>
					<div className="token-total">
						<span>Total</span>
						<span>{formatTokens(totalTokens)}</span>
					</div>
				</div>
			</div>

			{/* Section 3: Rate Limits */}
			<div className="card">
				{/* Not "(estimated)" wholesale: with the API reachable these are
				    exact. Each row that fell back to a local estimate says so. */}
				<h3 className="card-title">Rate Limits</h3>
				{/* An exact-but-old percentage is not an estimate, so isEstimated
				    does not cover it. Say it once for the card rather than per row. */}
				{(data.apiStaleness === "stale" ||
					data.apiStaleness === "critical") && (
					<div
						style={{
							fontSize: "calc(var(--vscode-font-size) * 0.85)",
							marginBottom: "8px",
							color: "var(--vscode-descriptionForeground)",
						}}
					>
						These percentages are from an older reading and may have moved
						since.
					</div>
				)}
				<ProgressBar
					label={`Session (5hr)${data.session5h.isEstimated ? " (est.)" : ""}`}
					current={data.session5h.currentTokens}
					limit={data.session5h.estimatedLimit}
					percentage={data.session5h.percentage}
					resetTime={data.session5h.resetTime}
					isHit={data.session5h.isHit}
					isEstimated={data.session5h.isEstimated}
				/>
				<ProgressBar
					label={`Weekly${data.weekly.isEstimated ? " (est.)" : ""}`}
					current={data.weekly.currentTokens}
					limit={data.weekly.estimatedLimit}
					percentage={data.weekly.percentage}
					resetTime={data.weekly.resetTime}
					isHit={data.weekly.isHit}
					isEstimated={data.weekly.isEstimated}
				/>
				{data.weeklyForecast && (
					<div
						style={{
							fontSize: "calc(var(--vscode-font-size) * 0.85)",
							marginTop: "-2px",
							marginBottom: "10px",
							color: data.weeklyForecast.willExceedBeforeReset
								? "var(--vscode-errorForeground)"
								: "var(--vscode-descriptionForeground)",
						}}
					>
						{forecastText(data.weeklyForecast)}
					</div>
				)}
				{data.scopedWeekly.map((limit) => (
					<ProgressBar
						key={limit.label}
						label={`Weekly ${limit.label}${limit.isEstimated ? " (est.)" : ""}`}
						current={limit.currentTokens}
						limit={limit.estimatedLimit}
						percentage={limit.percentage}
						resetTime={limit.resetTime}
						isHit={limit.isHit}
						isEstimated={limit.isEstimated}
					/>
				))}
			</div>

			{/* Section 3b: Usage credits. Only rendered when the account actually
			    has extra usage enabled, so a pure subscription never sees it. */}
			{data.spend && (
				<div className="card">
					<h3 className="card-title">Usage Credits</h3>
					<div className="credits-row">
						{/* No amount when the API reported only a percentage: "$0.00"
						    would claim an empty balance on an account with real spend.
						    A derived amount is marked, not passed off as exact. */}
						<span className="credits-used">
							{data.spend.used === null
								? `${data.spend.percentage.toFixed(0)}%`
								: `${data.spend.isDerived ? "~" : ""}${formatMoney(data.spend.used, data.spend.currency)}`}
						</span>
						{data.spend.used !== null && data.spend.limit !== null && (
							<span className="credits-limit">
								of {formatMoney(data.spend.limit, data.spend.currency)}
							</span>
						)}
					</div>
					{data.spend.limit !== null && (
						<div className="progress-bar">
							<div
								className={`progress-fill ${
									data.spend.percentage >= 95
										? "critical"
										: data.spend.percentage >= 60
											? "warning"
											: "safe"
								}`}
								style={{ width: `${Math.min(data.spend.percentage, 100)}%` }}
							/>
						</div>
					)}
					<div className="attribution-caption">
						{data.spend.limit !== null
							? `${data.spend.percentage.toFixed(0)}% of your credit limit used. Credits cover usage past your plan limits.`
							: "Credits cover usage past your plan limits."}
					</div>
				</div>
			)}

			{/* Section 4: Session Timing */}
			<div className="card">
				<h3 className="card-title">Session Window</h3>
				{data.windowStart ? (
					<>
						<div className="session-timeline">
							<div className="timeline-bar">
								<div
									className="timeline-fill"
									style={{ width: `${elapsedPercentage}%` }}
								/>
								<div
									className="timeline-marker"
									style={{ left: `${elapsedPercentage}%` }}
								/>
							</div>
						</div>
						<div className="session-details">
							<span>Started: {formatTime(data.windowStart)}</span>
							{data.windowExpiry && (
								<span>Expires: {formatTime(data.windowExpiry)}</span>
							)}
							<span>
								Remaining: {formatDuration(data.timeRemainingMinutes)}
							</span>
						</div>
					</>
				) : (
					<div className="no-data">No active session</div>
				)}

				{/* Section 5: Burn Rate (inline with session) */}
				{data.tokensPerMinute > 0 && (
					<div className="burn-rate">
						<div>
							<span className="burn-rate-value">
								{data.tokensPerMinute.toFixed(1)}
							</span>
							<span className="burn-rate-label"> tokens/min</span>
						</div>
						{data.minutesUntilLimit !== null && data.minutesUntilLimit > 0 && (
							<span className="burn-rate-estimate">
								Est. time to limit: {formatDuration(data.minutesUntilLimit)}
							</span>
						)}
					</div>
				)}
				{data.tokensPerMinute === 0 && (
					<div className="burn-rate">
						<span className="muted">Inactive</span>
					</div>
				)}
			</div>

			{/* Section 6: What's driving the usage */}
			<ContributingSection attribution={data.attribution} />
		</div>
	);
}
