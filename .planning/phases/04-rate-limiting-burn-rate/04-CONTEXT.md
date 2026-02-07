# Phase 4: Rate Limiting & Burn Rate - Context

**Gathered:** 2026-02-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Estimate proximity to Claude Code rate limits from local token data, predict when limits will hit, calculate burn rate, and warn the user — all without network calls. Three separate limits to track: Session (5hr rolling), Weekly total, and Weekly per-model (Sonnet). Extension must estimate since exact percentages require API calls we won't make.

</domain>

<decisions>
## Implementation Decisions

### Warning presentation
- Status bar color changes only — no VS Code notifications or pop-ups
- Three-tier thresholds: green < 60%, yellow 60-80%, red > 95%
- Thresholds configurable in VS Code settings with smart defaults (most users never touch them)
- Warnings are non-intrusive — status bar is the single source of truth

### Multi-limit display
- Show all three limits (session, weekly, model-weekly) in the status bar at all times
- Color driven by urgency-weighted logic — session limit weighs more than weekly since it hits sooner
- Tooltip shows all three limits with percentage values
- Per-limit type toggles in settings — users can hide specific limit types they don't care about

### Limit detection & overrides
- Auto-detect plan tier from `~/.claude/.credentials.json` (`rateLimitTier`, `subscriptionType`)
- Manual override in VS Code settings if auto-detection is wrong
- Ship community-estimated token limits per tier (e.g., Max5: 225K output/5hr) as defaults
- User can override limit values in settings if they observe differently
- Silently auto-adjust internal estimates when actual rate-limit events are observed in JSONL data
- No user confirmation needed for auto-adjustments — just learn and apply

### Session window tracking
- Reset countdown always visible in status bar ("Resets in 2h 15m")
- Burn rate displays both tokens/min AND estimated time until limit
- Burn rate calculated from recent activity window (e.g., last 15-30 min)

### Claude's Discretion
- How to determine 5-hour session window start (rolling vs anchored)
- How to handle idle gaps in burn rate calculation
- How to detect tier changes from credentials.json (on activation vs watching)
- Exact urgency weighting formula for multi-limit color
- Burn rate averaging window duration

</decisions>

<specifics>
## Specific Ideas

- Three separate limits (Session/Weekly/Model-Weekly) are more complex than a single limit — status bar must communicate all three without being cluttered
- `~/.claude/.credentials.json` provides `rateLimitTier: "default_claude_max_5x"` and `subscriptionType: "max"` for auto-detection
- Rate limit events in JSONL provide ground truth for calibrating estimates over time
- Community-reported estimates: Pro 45K/500K/500K, Max5 225K/2.5M/2.5M, Max20 900K/10M/10M (output tokens per window)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-rate-limiting-burn-rate*
*Context gathered: 2026-02-07*
