# Claude Usage Monitor

Local-only usage monitoring for Claude Code. Zero network calls. Zero telemetry. Your data stays on your machine.

## Why This Extension?

Existing Claude usage trackers require API keys, make network calls, or send telemetry. This extension takes a different approach:

- **Reads local files only** -- parses JSONL session logs from `~/.claude/projects/`
- **Zero network calls** -- no outbound requests, ever
- **No API keys needed** -- works entirely from local data
- **Minimal dependencies** -- small, auditable codebase

## What You Get

- **Always-on status bar** showing tokens, cost, and rate limit proximity
- **Sidebar dashboard** with token breakdown, trend charts, and session comparison
- **Rate limit tracking** with burn rate calculation and proximity warnings
- **Auto-detection** of your Claude plan tier from local credentials
- **Data export** to JSON for custom analysis

## What This Extension Accesses

Full transparency -- here is exactly what this extension reads and stores:

| Action | Details |
|--------|---------|
| **Reads** | `~/.claude/projects/**/*.jsonl` (session logs) |
| **Reads** | `~/.claude/.credentials.json` (plan tier auto-detection) |
| **Stores** | VS Code `globalState` (cached aggregations, local only) |

### What This Extension Does NOT Do

| Never | Explanation |
|-------|-------------|
| Network requests | No HTTP, WebSocket, or any outbound connections |
| Telemetry | No usage tracking, analytics, or crash reporting |
| Data transmission | No data leaves your machine, period |
| API key access | No Anthropic API keys needed or requested |
| File modification | Only reads Claude session files, never writes to them |
| Workspace access | Does not read your project source code |

## Installation

1. Install from the VS Code marketplace (or `code --install-extension Taranity.claude-usage-monitor`)
2. The extension activates automatically when `~/.claude/` exists
3. Look for the Claude Usage icon in the activity bar

## Features

### Status Bar

Always-visible metrics showing:

- Token count and estimated cost
- Rate limit proximity with color coding (green/yellow/red)
- Burn rate and cooldown timer
- Click either item to open the dashboard

### Dashboard (Sidebar Panel)

- **Overview tab**: Token breakdown, rate limits with progress bars, session timing, burn rate
- **Trends tab**: Stacked bar charts for daily/weekly/monthly usage, expandable data table
- **Session tab**: Current session vs. historical average comparison

### Command Palette

All commands are available under `Claude Usage:` in the command palette:

| Command | Description |
|---------|-------------|
| Refresh Usage Data | Reparse all session files |
| Switch Plan Tier | Change between Pro, Max 5x, Max 20x |
| Export Usage Data | Save all usage data as JSON |
| Open Dashboard | Focus the sidebar dashboard |
| Toggle Status Bar | Show/hide status bar items |
| Show Data Source Path | Display the watched directory |
| Open Settings | Jump to extension settings |
| Reset Rate Limit Estimates | Clear learned rate limits |
| Reset Session Tracking | Clear all cached data and reparse |

### Data Export

Export all usage data to JSON with:

- **Summary**: Human-friendly totals (tokens, cost, session count)
- **Raw**: Complete time bucket data for custom analysis

### Configuration

Configure via VS Code Settings (`Ctrl+,` then search "Claude Usage"):

| Setting | Default | Description |
|---------|---------|-------------|
| Plan Type | `max5` | Your Claude plan (pro, max5, max20) |
| Pricing | `{}` | Custom per-model pricing overrides |
| Compact Mode | `false` | Shorter status bar text |
| Refresh Interval | `60` | Seconds between usage checks |
| Rate Limit Overrides | `0` | Manual token limit overrides (session/weekly/weeklySonnet) |
| Warning Thresholds | 60% / 95% | Yellow and red warning levels |
| Burn Rate Window | `15` | Minutes for burn rate calculation |

## How It Works

1. Claude Code writes session data as JSONL files to `~/.claude/projects/`
2. This extension watches those files for changes (500ms debounce)
3. New records are parsed incrementally (byte offset tracking)
4. Usage is aggregated into time buckets (session, daily, weekly, monthly)
5. Status bar and dashboard update in real-time
6. All aggregated data is cached in VS Code globalState for instant startup

## Supported Plans

| Plan | Status |
|------|--------|
| Pro ($20/mo) | Supported |
| Max 5x ($100/mo) | Supported (default) |
| Max 20x ($200/mo) | Supported |
| Free | Partial (no rate limit tracking) |

Plan is auto-detected from `~/.claude/.credentials.json` with manual override available.

## Requirements

- VS Code 1.96.0 or later
- Claude Code installed (creates `~/.claude/` directory)
- No additional setup needed

## License

MIT
