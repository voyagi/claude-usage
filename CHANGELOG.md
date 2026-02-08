# Changelog

All notable changes to Claude Usage Monitor will be documented in this file.

## [1.0.0] - 2026-02-08

### Added

- Always-on status bar showing tokens, cost, and rate limit proximity
- Color-coded usage thresholds (green/yellow/red)
- Burn rate display with time-until-limit prediction
- Cooldown timer counting down to session window expiry
- Compact mode for narrow windows
- Sidebar dashboard with three tabs:
  - Overview: token breakdown, rate limits, session timing
  - Trends: stacked bar charts with daily/weekly/monthly views
  - Session: current vs. average session comparison
- Rate limit intelligence:
  - 5-hour rolling session window tracking
  - Auto-detection from observed 429 events
  - Per-model weekly Sonnet limit tracking
  - Configurable warning thresholds
- Auto-detection of Claude plan tier from credentials
- 12 command palette commands (refresh, export, plan switch, etc.)
- JSON data export (summary + raw time buckets)
- Activation guard (silent when ~/.claude/ not found)
- Trust-first design: zero network calls, zero telemetry
- Support for Pro, Max 5x, and Max 20x plans
- Configurable pricing overrides
