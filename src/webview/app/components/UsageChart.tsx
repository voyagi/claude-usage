/**
 * UsageChart component for displaying token usage trends.
 * Uses Recharts to render a stacked bar chart with four token types.
 */
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { TrendDataPoint } from '../types';

// Token type colors matching app.css custom properties
const COLORS = {
  input: '#4FC3F7',
  output: '#81C784',
  cacheWrite: '#FFB74D',
  cacheRead: '#CE93D8',
};

export interface UsageChartProps {
  data: TrendDataPoint[];
}

/**
 * Format large numbers with K/M abbreviations for Y-axis ticks.
 */
function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(0)}K`;
  }
  return value.toString();
}

/**
 * Format numbers with commas for tooltip display.
 */
function formatWithCommas(value: number): string {
  return value.toLocaleString();
}

/**
 * Custom tooltip component for stacked bar chart.
 * Shows period label, each token type with color dot, and total.
 */
function CustomTooltip(props: any) {
  const { active, payload, label } = props;

  if (!active || !payload || payload.length === 0) {
    return null;
  }

  // Calculate total tokens
  const total = payload.reduce((sum: number, entry: any) => sum + (entry.value || 0), 0);

  return (
    <div
      style={{
        background: 'var(--vscode-editorWidget-background)',
        border: '1px solid var(--vscode-editorWidget-border)',
        borderRadius: '4px',
        padding: '8px 12px',
        color: 'var(--vscode-foreground)',
        fontSize: 'calc(var(--vscode-font-size) * 0.9)',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: '4px' }}>{label}</div>
      {payload.map((entry: any, index: number) => (
        <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
          <div
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: entry.color,
            }}
          />
          <span>
            {entry.name}: {formatWithCommas(entry.value || 0)}
          </span>
        </div>
      ))}
      <div style={{ fontWeight: 700, marginTop: '4px', paddingTop: '4px', borderTop: '1px solid var(--vscode-panel-border)' }}>
        Total: {formatWithCommas(total)}
      </div>
    </div>
  );
}

export function UsageChart({ data }: UsageChartProps) {
  // Handle empty data state
  if (!data || data.length === 0) {
    return (
      <div
        style={{
          height: '250px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--vscode-descriptionForeground)',
          fontSize: 'calc(var(--vscode-font-size) * 0.95)',
        }}
      >
        No trend data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="period"
          stroke="var(--vscode-foreground)"
          tick={{ fill: 'var(--vscode-foreground)', fontSize: 'calc(var(--vscode-font-size) * 0.85)' }}
        />
        <YAxis
          stroke="var(--vscode-foreground)"
          tick={{ fill: 'var(--vscode-foreground)', fontSize: 'calc(var(--vscode-font-size) * 0.85)' }}
          tickFormatter={formatTokenCount}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{
            fontSize: 'calc(var(--vscode-font-size) * 0.9)',
            color: 'var(--vscode-foreground)',
          }}
        />
        <Bar dataKey="inputTokens" stackId="tokens" fill={COLORS.input} name="Input" />
        <Bar dataKey="outputTokens" stackId="tokens" fill={COLORS.output} name="Output" />
        <Bar dataKey="cacheCreationTokens" stackId="tokens" fill={COLORS.cacheWrite} name="Cache Write" />
        <Bar dataKey="cacheReadTokens" stackId="tokens" fill={COLORS.cacheRead} name="Cache Read" />
      </BarChart>
    </ResponsiveContainer>
  );
}
