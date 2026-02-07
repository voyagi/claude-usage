# Phase 5: Webview Dashboard - Context

**Gathered:** 2026-02-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Sidebar webview panel showing detailed usage breakdown, trend charts, session analysis, and a "Local Only" trust indicator. Opens from the status bar. Does not include command palette commands, export, or settings UI (those are Phase 6).

</domain>

<decisions>
## Implementation Decisions

### Panel layout & structure
- Tabbed sections — separate focused views (e.g., Overview, Trends, Session)
- Dense summary at top of each tab — key numbers visible without scrolling
- Session overview is the priority first view when panel opens (am I on track?)
- VS Code native theme — use CSS variables, looks like built-in panels (Settings, Extensions)

### Charts & visualization
- Stacked bar chart for usage trends over time — bars per period, stacked by token type (input/output/cache)
- Hover tooltips only for interactivity — no click-to-filter or drill-down
- Cost gets its own separate summary card/row, not overlaid on the token chart
- Dual axis and cost-as-annotation rejected

### Session & rate limit display
- Progress bars for rate limit proximity — horizontal bars per limit (session, weekly, sonnet) with % fill and color coding
- Session timing uses both timeline visualization AND text countdown — timeline bar showing 5-hour window with current position, plus "expires in Xh Ym" text below
- Burn rate prediction placement: Claude's discretion
- Session comparison (current vs average): Claude's discretion

### View switching & time periods
- Segmented control for daily/weekly/monthly — button group at top of Trends tab
- Everything updates together when switching — charts, tables, and summary numbers all reflect selected period
- Historical depth per period: Claude's discretion
- Data table is expandable detail — collapsed by default, click to reveal exact numbers per period

### Claude's Discretion
- Color palette for token types (must work in both light and dark VS Code themes)
- Burn rate prediction placement (inline with rate limits vs separate card)
- Session comparison approach (average line on chart vs comparison card)
- Number of historical data points per time period
- Tab naming and exact tab breakdown
- Loading skeleton design
- Error state handling

</decisions>

<specifics>
## Specific Ideas

No specific references — open to standard approaches. Key constraint: sidebar panels are narrow, so information density matters. The existing status bar already shows summary numbers; the dashboard should go deeper, not repeat.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-webview-dashboard*
*Context gathered: 2026-02-07*
