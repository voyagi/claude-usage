/**
 * SessionTab component for displaying current session details and comparison to averages.
 * Shows session summary, comparison to average session, and session history insights.
 */
import { DashboardData } from '../types';

export interface SessionTabProps {
  data: DashboardData | null;
}

/**
 * Format token count with commas for readability.
 */
function formatTokens(tokens: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(tokens));
}

/**
 * Format time duration from minutes
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
 * Calculate percentage difference (current vs average)
 */
function calculatePercentage(current: number, average: number): string {
  if (average === 0) return 'N/A';
  const percentage = ((current / average) * 100).toFixed(0);
  return `${percentage}%`;
}

export function SessionTab({ data }: SessionTabProps) {
  if (!data) return null;

  const hasActiveSession = data.windowStart !== null && data.currentSessionTokens > 0;
  const hasEnoughSessions = data.sessionCount >= 2;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Section 1: Current Session Summary */}
      <div
        style={{
          background: 'var(--vscode-editor-background)',
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: '6px',
          padding: '16px',
        }}
      >
        <h3
          style={{
            margin: '0 0 12px 0',
            fontSize: 'calc(var(--vscode-font-size) * 1.1)',
            fontWeight: 600,
          }}
        >
          Current Session
        </h3>

        {hasActiveSession ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
            <div>
              <div
                style={{
                  fontSize: 'calc(var(--vscode-font-size) * 0.85)',
                  color: 'var(--vscode-descriptionForeground)',
                  marginBottom: '4px',
                }}
              >
                Session Tokens (Output)
              </div>
              <div style={{ fontSize: 'calc(var(--vscode-font-size) * 1.6)', fontWeight: 600 }}>
                {formatTokens(data.currentSessionTokens)}
              </div>
            </div>

            <div>
              <div
                style={{
                  fontSize: 'calc(var(--vscode-font-size) * 0.85)',
                  color: 'var(--vscode-descriptionForeground)',
                  marginBottom: '4px',
                }}
              >
                Session Duration
              </div>
              <div style={{ fontSize: 'calc(var(--vscode-font-size) * 1.6)', fontWeight: 600 }}>
                {formatDuration(data.timeRemainingMinutes !== null
                  ? 300 - data.timeRemainingMinutes
                  : null)}
              </div>
            </div>

            <div>
              <div
                style={{
                  fontSize: 'calc(var(--vscode-font-size) * 0.85)',
                  color: 'var(--vscode-descriptionForeground)',
                  marginBottom: '4px',
                }}
              >
                Burn Rate
              </div>
              <div style={{ fontSize: 'calc(var(--vscode-font-size) * 1.6)', fontWeight: 600 }}>
                {data.tokensPerMinute.toFixed(1)}/min
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              padding: '24px',
              textAlign: 'center',
              color: 'var(--vscode-descriptionForeground)',
              fontSize: 'calc(var(--vscode-font-size) * 0.95)',
            }}
          >
            No active session detected
          </div>
        )}
      </div>

      {/* Section 2: Session vs Average Comparison */}
      <div
        style={{
          background: 'var(--vscode-editor-background)',
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: '6px',
          padding: '16px',
        }}
      >
        <h3
          style={{
            margin: '0 0 12px 0',
            fontSize: 'calc(var(--vscode-font-size) * 1.1)',
            fontWeight: 600,
          }}
        >
          Session Comparison
        </h3>

        {hasEnoughSessions ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Comparison bars */}
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '8px',
                  fontSize: 'calc(var(--vscode-font-size) * 0.9)',
                }}
              >
                <span>This Session</span>
                <span style={{ fontWeight: 600 }}>
                  {formatTokens(data.currentSessionTokens)} tokens
                </span>
              </div>
              <div
                style={{
                  height: '24px',
                  background: 'var(--vscode-input-background)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                  border: '1px solid var(--vscode-panel-border)',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    background: 'var(--token-output)',
                    width: `${Math.min((data.currentSessionTokens / Math.max(data.currentSessionTokens, data.averageSessionTokens)) * 100, 100)}%`,
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            </div>

            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '8px',
                  fontSize: 'calc(var(--vscode-font-size) * 0.9)',
                }}
              >
                <span>Average Session</span>
                <span style={{ fontWeight: 600 }}>
                  {formatTokens(data.averageSessionTokens)} tokens
                </span>
              </div>
              <div
                style={{
                  height: '24px',
                  background: 'var(--vscode-input-background)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                  border: '1px solid var(--vscode-panel-border)',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    background: 'var(--vscode-descriptionForeground)',
                    opacity: 0.5,
                    width: `${Math.min((data.averageSessionTokens / Math.max(data.currentSessionTokens, data.averageSessionTokens)) * 100, 100)}%`,
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            </div>

            {/* Percentage comparison */}
            <div
              style={{
                padding: '12px',
                background: 'var(--vscode-input-background)',
                borderRadius: '4px',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: 'calc(var(--vscode-font-size) * 1.8)',
                  fontWeight: 700,
                  color: data.currentSessionTokens > data.averageSessionTokens
                    ? 'var(--vscode-charts-orange)'
                    : 'var(--vscode-charts-green)',
                }}
              >
                {calculatePercentage(data.currentSessionTokens, data.averageSessionTokens)}
              </div>
              <div
                style={{
                  fontSize: 'calc(var(--vscode-font-size) * 0.85)',
                  color: 'var(--vscode-descriptionForeground)',
                  marginTop: '4px',
                }}
              >
                of average session
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              padding: '24px',
              textAlign: 'center',
              color: 'var(--vscode-descriptionForeground)',
              fontSize: 'calc(var(--vscode-font-size) * 0.95)',
            }}
          >
            Not enough sessions for comparison (need at least 2 sessions)
          </div>
        )}
      </div>

      {/* Section 3: Session History Insights */}
      <div
        style={{
          background: 'var(--vscode-editor-background)',
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: '6px',
          padding: '16px',
        }}
      >
        <h3
          style={{
            margin: '0 0 12px 0',
            fontSize: 'calc(var(--vscode-font-size) * 1.1)',
            fontWeight: 600,
          }}
        >
          Session History
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
          <div>
            <div
              style={{
                fontSize: 'calc(var(--vscode-font-size) * 0.85)',
                color: 'var(--vscode-descriptionForeground)',
                marginBottom: '4px',
              }}
            >
              Total Sessions Tracked
            </div>
            <div style={{ fontSize: 'calc(var(--vscode-font-size) * 1.4)', fontWeight: 600 }}>
              {data.sessionCount}
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: 'calc(var(--vscode-font-size) * 0.85)',
                color: 'var(--vscode-descriptionForeground)',
                marginBottom: '4px',
              }}
            >
              Average Session Tokens
            </div>
            <div style={{ fontSize: 'calc(var(--vscode-font-size) * 1.4)', fontWeight: 600 }}>
              {formatTokens(data.averageSessionTokens)}
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: '12px',
            padding: '8px',
            background: 'var(--vscode-input-background)',
            borderRadius: '4px',
            fontSize: 'calc(var(--vscode-font-size) * 0.85)',
            color: 'var(--vscode-descriptionForeground)',
            textAlign: 'center',
          }}
        >
          Based on {data.sessionCount} session{data.sessionCount !== 1 ? 's' : ''}
        </div>
      </div>
    </div>
  );
}
