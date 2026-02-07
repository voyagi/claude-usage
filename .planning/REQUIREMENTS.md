# Requirements — Claude Usage Monitor

## v1 Requirements

### Status Bar (SB)

- [x] **SB-01**: User sees an always-on status bar item showing input tokens, output tokens, estimated cost ($), and usage percentage against plan limit
- [x] **SB-02**: Status bar item is color-coded by usage threshold (green < 60%, yellow 60-80%, red > 80%)
- [x] **SB-03**: Status bar displays current burn rate (tokens/min) inline
- [x] **SB-04**: Status bar shows cooldown/reset timer counting down to session window expiry
- [x] **SB-05**: Status bar adapts to narrow widths with compact mode (abbreviations, truncated labels)

### Sidebar Panel (SP)

- [ ] **SP-01**: Clicking the status bar item opens a sidebar webview panel
- [ ] **SP-02**: Sidebar shows detailed token breakdown: input, output, cache_creation, cache_read — separated clearly
- [ ] **SP-03**: Sidebar displays session timing: window start time, expiry time, time remaining
- [ ] **SP-04**: Sidebar includes trend charts (bar/line) showing usage over time using Recharts
- [ ] **SP-05**: Sidebar provides daily, weekly, and monthly aggregation views with totals
- [ ] **SP-06**: Sidebar shows session comparison — how current session compares to user's average

### Rate Limiting (RL)

- [ ] **RL-01**: Extension tracks the 5-hour rolling session window with accurate first-message detection and expiry calculation
- [ ] **RL-02**: Extension auto-detects rate limits from observed rate-limit events in JSONL files and builds a model of the user's actual limits over time
- [ ] **RL-03**: User can manually set/override rate limit thresholds via settings
- [ ] **RL-04**: Extension calculates burn rate and predicts time until rate limit hit ("~45 min remaining at current pace")
- [ ] **RL-05**: Extension tracks weekly usage limits (active hours, not wall-clock) and shows proximity
- [ ] **RL-06**: Extension shows proximity warnings (notifications at configurable thresholds: 75%, 80%, 90%)

### Data & Parsing (DP)

- [x] **DP-01**: Extension reads JSONL session files from ~/.claude/projects/ across all project subdirectories (account-wide)
- [x] **DP-02**: Extension auto-refreshes by watching for file changes (30-60 second intervals, configurable)
- [x] **DP-03**: Extension handles cross-platform path resolution (Windows %USERPROFILE%, macOS/Linux ~)
- [x] **DP-04**: Extension detects and supports multiple JSONL format versions (legacy + current) gracefully
- [x] **DP-05**: Extension handles race conditions when reading JSONL files being actively written by Claude Code
- [x] **DP-06**: Extension aggregates usage data correctly, distinguishing cached tokens (not rate-limited) from billable tokens (rate-limited)

### Trust & Privacy (TP)

- [x] **TP-01**: Extension makes zero network calls — all data stays local, no telemetry, no analytics
- [ ] **TP-02**: Extension displays a visible "Local Only" indicator in the sidebar panel
- [ ] **TP-03**: Extension shows data source path in settings so user can verify what files are being read
- [x] **TP-04**: Extension uses configurable pricing tables (not hardcoded) so rates can be updated without code changes

### Configuration & UX (CX)

- [ ] **CX-01**: Extension registers command palette commands for: manual refresh, plan selection, toggle views, export data
- [ ] **CX-02**: User can export usage data to JSON for custom analysis
- [x] **CX-03**: Extension supports plan selection (Pro $20, Max5 $100, Max20 $200) with correct limits per plan
- [ ] **CX-04**: Extension activates lazily (only when Claude Code data directory exists)
- [ ] **CX-05**: Extension provides a settings UI for configuring refresh interval, warning thresholds, plan type, and pricing overrides

## v2 Requirements (Deferred)

- Model-specific breakdown (per-model token/cost attribution — Opus vs Sonnet vs Haiku)
- Multi-account support (work vs personal Claude accounts)
- Inline editor token estimate before sending prompts
- Budget alerts ("warn me if I'll exceed $X this month")
- Project-level budgeting (allocate % of tokens to specific projects)
- Cooldown optimization suggestions ("consider pausing to preserve tokens")
- Live dashboard mode (1-second refresh, real-time interactive)
- Model recommendation ("Haiku would handle this; save Opus tokens")

## Out of Scope

- Network API calls to Anthropic — trust is the core differentiator, local-only is non-negotiable
- Per-project filtering/breakdown in v1 — rate limits are account-wide so combined view is correct
- API pay-as-you-go billing integration — built for subscription plans only
- Launching or managing Claude Code sessions — this is a monitor, not a launcher
- Mobile or web dashboard — VS Code extension only
- MCP server management — stay focused on usage monitoring

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SB-01 | Phase 3 | Done |
| SB-02 | Phase 3 | Done |
| SB-03 | Phase 3 | Done |
| SB-04 | Phase 3 | Done |
| SB-05 | Phase 3 | Done |
| SP-01 | Phase 5 | Pending |
| SP-02 | Phase 5 | Pending |
| SP-03 | Phase 5 | Pending |
| SP-04 | Phase 5 | Pending |
| SP-05 | Phase 5 | Pending |
| SP-06 | Phase 5 | Pending |
| RL-01 | Phase 4 | Pending |
| RL-02 | Phase 4 | Pending |
| RL-03 | Phase 4 | Pending |
| RL-04 | Phase 4 | Pending |
| RL-05 | Phase 4 | Pending |
| RL-06 | Phase 4 | Pending |
| DP-01 | Phase 2 | Done |
| DP-02 | Phase 2 | Done |
| DP-03 | Phase 2 | Done |
| DP-04 | Phase 1 | Done |
| DP-05 | Phase 2 | Done |
| DP-06 | Phase 1 | Done |
| TP-01 | Phase 3 | Done |
| TP-02 | Phase 5 | Pending |
| TP-03 | Phase 6 | Pending |
| TP-04 | Phase 1 | Done |
| CX-01 | Phase 6 | Pending |
| CX-02 | Phase 6 | Pending |
| CX-03 | Phase 1 | Done |
| CX-04 | Phase 6 | Pending |
| CX-05 | Phase 6 | Pending |

**Coverage: 30/30 requirements mapped (100%)**

---
*Last updated: 2026-02-07 after Phase 3 completion*
