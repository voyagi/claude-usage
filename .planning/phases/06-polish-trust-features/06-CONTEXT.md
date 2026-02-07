# Phase 6: Polish & Trust Features - Context

**Gathered:** 2026-02-07
**Status:** Ready for planning

<domain>

## Phase Boundary

Power-user commands, data export, configuration UI, conditional activation, and trust transparency features. Makes the extension feel trustworthy, configurable, and professional. No new monitoring capabilities — this polishes what Phases 1-5 built.

</domain>

<decisions>

## Implementation Decisions

### Command palette design

- Full power-user command set (~10+ commands): refresh data, switch plan tier, export usage, open dashboard, clear cache, toggle status bar, jump to settings, show data source path, reset rate limit learning, copy session stats
- Plan tier switching uses quick pick dropdown showing current auto-detected tier with option to override or reset to auto
- All frequently changed settings get quick pick command shortcuts (plan tier, warning thresholds, refresh interval, pricing overrides)

### Data export format

- Export scope: everything (full historical data — all sessions, all time buckets)
- JSON contains both formats: top-level 'summary' object with human-friendly data + 'raw' object with full internal representation
- Save via VS Code "Save As" dialog — user picks location and filename
- "Custom pricing" badge/label shown near cost figures in dashboard and tooltip when user has overridden pricing

### Configuration experience

- Data source path shown as small text in dashboard footer (watched directory path)

### Trust indicators

- Three-layer trust messaging: first-run dashboard welcome card + persistent badge + README/marketplace section
- First-run experience: welcome card in dashboard on first open explaining zero network calls, dismissible (not a notification or walkthrough)
- Conditional activation: extension only activates when ~/.claude/ directory exists — invisible to non-Claude users
- "What this extension accesses" section in both dashboard (expandable) AND README — explicitly lists what it reads and what it does NOT do (no telemetry, no API calls, no analytics)

### Claude's Discretion

- Command completion feedback style per command type (notification toast vs status bar flash vs silent)
- Command palette namespace prefix convention
- Settings grouping/namespace structure (flat vs nested)
- Export metadata inclusion decisions

</decisions>

<specifics>

## Specific Ideas

- Quick pick for plan tier should show the auto-detected tier and let user override or reset to auto — mirrors the existing auto-learn + manual override pattern from Phase 4
- Dashboard welcome card should be the first thing users see — builds trust before they even look at data
- README permissions table should be a strong marketplace differentiator ("Here's exactly what we DON'T do")

</specifics>

<deferred>

## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-polish-trust-features*
*Context gathered: 2026-02-07*
