# Claude Usage Monitor

Usage monitoring for Claude Code, built from your local session logs. No telemetry, no third parties, no separate API key.

## Why This Extension?

Existing Claude usage trackers ask for their own API keys or ship telemetry somewhere. This extension takes a different approach:

- **Reads local files** -- parses JSONL session logs from `~/.claude/projects/`
- **Talks only to Anthropic** -- the one network call reads your own limit percentages from the same endpoint Claude Code's Account & Usage panel uses, signed in with the login you already have
- **No API keys needed** -- reuses your existing Claude Code session
- **Minimal dependencies** -- small, auditable codebase

## What You Get

- **Always-on status bar** showing tokens, cost, and rate limit proximity
- **Sidebar dashboard** with token breakdown, trend charts, and session comparison
- **Usage attribution** showing which skills, subagents, plugins, and MCP servers your limit is going to
- **Rate limit tracking** with burn rate calculation and proximity warnings
- **Auto-detection** of your Claude plan tier from local credentials
- **Data export** to JSON for custom analysis

## What This Extension Accesses

Full transparency -- here is exactly what this extension reads, sends, and stores:

| Action | Details |
|--------|---------|
| **Reads** | `~/.claude/projects/**/*.jsonl` (session logs, including archived and subagent transcripts) |
| **Reads** | `~/.claude/.credentials.json` (your existing Claude Code OAuth token) |
| **Sends** | `GET api.anthropic.com/api/oauth/usage` -- your token, to read your own limit percentages |
| **Sends** | `POST platform.claude.com/v1/oauth/token` -- only to refresh that token when it expires |
| **Stores** | VS Code `globalState` (cached aggregations, local only) |
| **Stores** | `~/.claude/cache/usage-api.json` (shared between VS Code windows, local only) |

The network calls carry your OAuth token to Anthropic and nothing else: no transcripts, no prompts, no code. They are what makes the percentages exact instead of estimated. If they fail, the extension falls back to estimates from local logs and keeps working.

### What This Extension Does NOT Do

| Never | Explanation |
|-------|-------------|
| Telemetry | No usage tracking, analytics, or crash reporting |
| Third parties | Nothing is sent anywhere except Anthropic |
| Content transmission | Your prompts, responses, and code never leave your machine |
| API key access | No separate Anthropic API key needed or requested |
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

- **Overview tab**: Token breakdown, rate limits with progress bars, session timing, burn rate, and what your usage is going to
- **Trends tab**: Stacked bar charts for daily/weekly/monthly usage, expandable data table
- **Session tab**: Current session vs. historical average comparison

### What's Contributing To Your Usage

The Overview tab breaks your last 24 hours and 7 days down two ways, matching the section Claude Code shows in its own Account & Usage panel:

- **Named contributors**: skills, subagents, plugins, and MCP servers, read from the attribution tags Claude Code writes on each request
- **Behaviours**: independent characteristics of how the usage was spent, such as large cache misses, long context, subagent-heavy sessions, several sessions running at once, and sessions left open for 8+ hours

Neither list is a partition. One request can be tagged with a skill, a subagent, and an MCP server at once, and can match several behaviours, so the shares deliberately do not add up to 100%. Weighting is by cost, which already accounts for per-model and cache-tier rates. Anthropic does not publish how its own panel weights these, so treat the numbers as close estimates of the same idea rather than an exact match.

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
| Include Archived Sessions | `true` | Parse `archived/` sessions. They hold most of your history and most of the parse cost; turn off for a faster, lighter startup |
| Rate Limit Overrides | `0` | Manual token limit overrides (session/weekly/weeklyScoped) |
| Warning Thresholds | 60% / 95% | Yellow and red warning levels |
| Burn Rate Window | `15` | Minutes for burn rate calculation |

## How It Works

1. Claude Code writes session data as JSONL files under `~/.claude/projects/`, at several nesting levels: top-level sessions, `archived/` sessions, and per-session subagent and workflow transcripts
2. This extension walks that whole tree, so a nesting level Claude Code adds later starts counting the day it appears
3. Those files are watched for changes (500ms debounce) and new records parsed incrementally (byte offset tracking)
4. Usage is aggregated into time buckets (session, daily, weekly, monthly), deduplicated by message id so re-logged streaming writes count once
5. Rate limit percentages come from Anthropic's usage endpoint when reachable, and fall back to local estimates when it is not
6. Status bar and dashboard update in real-time; all aggregated data is cached in VS Code globalState for instant startup

The first parse after installing reads your whole history, which on a large `~/.claude/projects/` takes on the order of half a minute in the background. Cached data is shown immediately while that runs.

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
