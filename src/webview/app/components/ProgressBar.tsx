/**
 * Progress bar component for rate limit visualization.
 * Shows current usage vs limit with color-coded severity levels.
 */

interface ProgressBarProps {
	label: string;
	current: number;
	limit: number;
	percentage: number;
	resetTime: string | null;
	isHit: boolean;
}

/**
 * Format a number with commas for readability
 */
function formatNumber(value: number): string {
	return new Intl.NumberFormat("en-US").format(Math.round(value));
}

/**
 * Calculate time remaining until reset
 */
function formatResetTime(isoString: string): string {
	const resetDate = new Date(isoString);
	const now = new Date();
	const diffMs = resetDate.getTime() - now.getTime();

	if (diffMs <= 0) return "Resetting...";

	const hours = Math.floor(diffMs / (1000 * 60 * 60));
	const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

	if (hours > 0) {
		return `Resets: ${hours}h ${minutes}m`;
	}
	return `Resets: ${minutes}m`;
}

/**
 * Determine progress bar color class based on percentage
 */
function getColorClass(percentage: number): string {
	if (percentage >= 95) return "critical";
	if (percentage >= 60) return "warning";
	return "safe";
}

export function ProgressBar({
	label,
	current,
	limit,
	percentage,
	resetTime,
	isHit,
}: ProgressBarProps) {
	const colorClass = getColorClass(percentage);

	return (
		<div className="progress-container">
			<div className="progress-header">
				<span className="progress-label">{label}</span>
				<span className="progress-stats">
					{formatNumber(current)} / {formatNumber(limit)} (
					{percentage.toFixed(1)}%)
				</span>
			</div>

			<div className="progress-bar">
				<div
					className={`progress-fill ${colorClass}`}
					style={{ width: `${Math.min(percentage, 100)}%` }}
				/>
			</div>

			<div className="progress-footer">
				{resetTime && <span>{formatResetTime(resetTime)}</span>}
				{isHit && <span className="progress-badge">LIMIT HIT</span>}
			</div>
		</div>
	);
}
