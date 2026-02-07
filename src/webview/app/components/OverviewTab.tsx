/**
 * Overview tab - the main landing page showing key metrics.
 * Displays token breakdown, rate limits, session timing, and burn rate.
 */
import { DashboardData } from '../types';
import { ProgressBar } from './ProgressBar';

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
 * Format token count with commas
 */
function formatTokens(tokens: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(tokens));
}

/**
 * Format time duration
 */
function formatDuration(minutes: number | null): string {
  if (minutes === null || minutes <= 0) return '0m';

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
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
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
    data.inputTokens + data.outputTokens + data.cacheCreationTokens + data.cacheReadTokens;

  // Calculate worst rate limit percentage for key metrics
  const worstLimitPercentage = Math.max(
    data.session5h.percentage,
    data.weekly.percentage,
    data.weeklySonnet.percentage
  );

  const elapsedPercentage = calculateElapsedPercentage(data.windowStart);

  return (
    <div>
      {/* Section 1: Key Metrics Summary */}
      <div className="metrics-summary">
        <div className="metric-card">
          <div className="metric-value">{formatCost(data.todayCost)}</div>
          <div className="metric-label">Today's Cost</div>
        </div>
        <div className="metric-card">
          <div className="metric-value">{formatCost(data.monthCost)}</div>
          <div className="metric-label">Month Cost</div>
        </div>
        <div className="metric-card">
          <div className="metric-value">{data.tokensPerMinute.toFixed(1)}</div>
          <div className="metric-label">Tokens/Min</div>
        </div>
        <div className="metric-card">
          <div className="metric-value">{worstLimitPercentage.toFixed(0)}%</div>
          <div className="metric-label">Worst Limit</div>
        </div>
      </div>

      {/* Section 2: Token Breakdown */}
      <div className="card">
        <h3 className="card-title">Token Breakdown</h3>
        <div className="token-breakdown">
          <div className="token-row">
            <div className="token-dot input"></div>
            <span className="token-label">Input tokens</span>
            <span className="token-value">{formatTokens(data.inputTokens)}</span>
          </div>
          <div className="token-row">
            <div className="token-dot output"></div>
            <span className="token-label">Output tokens</span>
            <span className="token-value">{formatTokens(data.outputTokens)}</span>
          </div>
          <div className="token-row">
            <div className="token-dot cache-creation"></div>
            <span className="token-label">Cache creation</span>
            <span className="token-value">{formatTokens(data.cacheCreationTokens)}</span>
          </div>
          <div className="token-row">
            <div className="token-dot cache-read"></div>
            <span className="token-label">Cache reads</span>
            <span className="token-value">{formatTokens(data.cacheReadTokens)}</span>
          </div>
          <div className="token-total">
            <span>Total</span>
            <span>{formatTokens(totalTokens)}</span>
          </div>
        </div>
      </div>

      {/* Section 3: Rate Limits */}
      <div className="card">
        <h3 className="card-title">Rate Limits (estimated)</h3>
        <ProgressBar
          label="Session (5hr)"
          current={data.session5h.currentTokens}
          limit={data.session5h.estimatedLimit}
          percentage={data.session5h.percentage}
          resetTime={data.session5h.resetTime}
          isHit={data.session5h.isHit}
        />
        <ProgressBar
          label="Weekly"
          current={data.weekly.currentTokens}
          limit={data.weekly.estimatedLimit}
          percentage={data.weekly.percentage}
          resetTime={data.weekly.resetTime}
          isHit={data.weekly.isHit}
        />
        <ProgressBar
          label="Weekly Sonnet"
          current={data.weeklySonnet.currentTokens}
          limit={data.weeklySonnet.estimatedLimit}
          percentage={data.weeklySonnet.percentage}
          resetTime={data.weeklySonnet.resetTime}
          isHit={data.weeklySonnet.isHit}
        />
      </div>

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
              {data.windowExpiry && <span>Expires: {formatTime(data.windowExpiry)}</span>}
              <span>Remaining: {formatDuration(data.timeRemainingMinutes)}</span>
            </div>
          </>
        ) : (
          <div className="no-data">No active session</div>
        )}

        {/* Section 5: Burn Rate (inline with session) */}
        {data.tokensPerMinute > 0 && (
          <div className="burn-rate">
            <div>
              <span className="burn-rate-value">{data.tokensPerMinute.toFixed(1)}</span>
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
    </div>
  );
}
