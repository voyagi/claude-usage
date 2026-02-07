# Phase 3: Basic UI (Status Bar) - Context

**Gathered:** 2026-02-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Always-on VS Code status bar showing Claude usage metrics at a glance: tokens, cost, usage percentage across all three rate limits, burn rate, and cooldown timer. Color-coded by proximity to limits. Compact mode for narrow windows. Lazy activation.

The webview dashboard (Phase 5), rate limit prediction/learning (Phase 4), and power-user commands (Phase 6) are out of scope.

</domain>

<decisions>
## Implementation Decisions

### Information layout
- Two separate status bar items (not one overloaded item)
- All three rate limits (session 5hr, weekly, weekly-sonnet) must be surfaced — not just one
- Tooltip on hover shows full detailed breakdown with exact numbers, all three limits with percentages and reset times

### Number formatting
- Token counts use smart abbreviation: 500, 1.2K, 3.4M — auto-scale by magnitude
- Cooldown timer displays as hours:minutes format (e.g. "2h 34m" or "2:34")
- Tooltip shows exact unabbreviated numbers for full detail

### Click behavior
- Click opens a VS Code quick pick menu (interim before Phase 5 webview)
- Quick pick options: Refresh data, Switch plan tier, View usage summary, Reset session tracking
- Show a spinner icon while data is being reparsed to give visual feedback

### Alert escalation
- Color-only warnings — no notification popups (avoid disrupting flow)
- When a rate limit hits 100%, replace usage % with a reset countdown timer — most actionable info at that point
- Color thresholds: green < 60%, yellow 60-80%, red > 80% (from roadmap)

### Claude's Discretion
- Primary at-a-glance metric choice (cost, usage %, or tokens as the lead number)
- Compact mode behavior (collapse to one item vs. abbreviate both)
- Which click action each of the two status bar items triggers (same or different)
- Cost display format (cents precision vs. smart rounding)
- Color threshold configurability (fixed vs. user settings)
- Multi-limit color logic (worst-case vs. primary limit)

</decisions>

<specifics>
## Specific Ideas

- User wants all three rate limits visible, not just the most critical — full awareness is preferred over simplification
- Quick pick menu should include a "reset session tracking" escape hatch for when data seems off
- Spinner during reparse — user values feedback that something is happening
- No popups — color shift is enough. The status bar should inform, not interrupt.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-basic-ui-status-bar*
*Context gathered: 2026-02-07*
