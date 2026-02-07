# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-06)

**Core value:** Accurate, trustworthy usage visibility — the user always knows where they stand against their plan limits without trusting third-party code with their data.
**Current focus:** Phase 4 - Rate Limiting & Burn Rate

## Current Position

Phase: 4 of 6 (Rate Limiting & Burn Rate)
Plan: 3 of 4 in current phase
Status: In progress
Last activity: 2026-02-07 — Completed 04-03-PLAN.md

Progress: [█████░░░░░] ~58%

## Performance Metrics

**Velocity:**
- Total plans completed: 11
- Average duration: 3.5 minutes
- Total execution time: 0.6 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 - Foundation | 4 | 20min | 5.0min |
| 02 - File Watching | 2 | 7min | 3.5min |
| 03 - Basic UI | 3 | 9min | 3.0min |
| 04 - Rate Limiting | 3 | 8min | 2.7min |

**Recent Trend:**
- Last 5 plans: 2min, 3min, 4min, 3min, 2min
- Trend: Consistent velocity (2-4 min range)

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Local JSONL parsing only (trust — no API keys or network access needed)
- Always-on status bar (user wants constant visibility, not just alerts)
- Auto-learn + manual override for rate limits (Max plan limits aren't documented; learn from reality but allow correction)
- Account-wide tracking (rate limits are per-account, not per-project)
- esbuild bundler (fast builds, small output, standard for VS Code extensions)
- Strict TypeScript from Day 1 (01-01): Enabled strict mode for early error detection
- Named exports only (01-01): Explicit dependency tracking across all modules
- Zod for runtime validation (01-01): Ensures JSONL parsing handles schema changes gracefully
- Streaming parser approach (01-02): readline + createReadStream avoids file locks and memory issues
- Skip corrupt lines (01-02): Active sessions write incomplete JSON; parser continues instead of failing
- Cache-aware billable tokens (01-02): Exclude cache reads from rate limit calculations per Claude 4.x behavior
- Configurable pricing (01-03): VS Code settings allow users to update rates without extension updates
- Local timezone for calendar boundaries (01-03): Users think "today" in local time, not UTC
- ISO week standard (01-03): Monday start aligns with international business week conventions
- Cached data first (01-04): Load globalState on activation for instant status bar, then reparse
- globalState for offset persistence (02-01): Tracks per-file byte offsets across VS Code reloads for incremental parsing
- Simple byte counting for offset tracking (02-01): Accept rare incomplete line edge case, mitigated by full reparse on activation
- 500ms debounce for file changes (02-02): Balances responsiveness vs duplicate parsing during rapid JSONL writes
- Callback-based watcher architecture (02-02): SessionWatcher notifies extension via onUpdate callback for separation of concerns
- Conservative token limit estimates (03-01): Pro 45K/500K/500K, Max5 225K/2.5M/2.5M, Max20 900K/10M/10M based on community reports
- Output tokens for rate limits (03-01): Rate limit calculations use output tokens since Claude primarily constrains output generation
- Pure data modules (03-01): rateLimits.ts and formatting.ts have no VS Code dependencies for independent testing
- Dual status bar items (03-02): Separate metrics and cooldown items for independent visibility control
- Command-based decoupling (03-02): Status bar items invoke commands via registry, not direct imports
- ThemeColor backgrounds (03-02): Use VS Code ThemeColor API for adaptive status bar colors (green/yellow/red)
- Command registration pattern (03-03): Register all commands in activate() with inline handlers for closure access to context
- Config change auto-refresh (03-03): Auto-refresh on any claude-usage.* config change to ensure UI consistency
- Legacy clearData kept (03-03): Maintain backwards compatibility for early adopters with keyboard shortcuts
- Urgency scoring for rate limits (04-02): Use percentage * 1/sqrt(hoursUntilReset) to identify most critical limit
- Optional burn rate override (04-02): buildStatusBarData accepts EMA-smoothed burn rate while keeping simple fallback
- Callback-only tier changes (04-03): CredentialsWatcher fires onTierChange only when tier actually changes, not on every file write
- Downward-only limit refinement (04-03): When 429 observed, adjust limit estimate to 95% of observed usage (never increase estimates)
- Default warning thresholds (04-03): Yellow at 60%, red at 95%, with 15-minute burn rate window as sensible defaults

### Local Data Sources Discovery (2026-02-07)

Investigated what Claude Code caches locally (relevant to Phases 2-4):

**~/.claude/.credentials.json** — contains `rateLimitTier: "default_claude_max_5x"` and `subscriptionType: "max"`.
→ Can auto-detect plan instead of manual setting. Affects Phase 3-4 design.

**~/.claude/stats-cache.json** — daily message counts, session counts, per-model token breakdowns.
→ Complementary to our JSONL parsing. Could cross-validate or supplement.

**Rate limit structure** (from VS Code "Account & Usage" panel):
- 3 separate limits: Session (5hr), Weekly (7 day), Weekly Sonnet (model-specific)
- Each has its own reset countdown
- Percentages and reset timers are **fetched from API in real-time** — NOT cached locally
→ Phase 4 must estimate proximity from observed tokens, cannot read exact % without network calls.

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 4 rate limit estimation: Exact % and reset timers require API calls (violates zero-network). Must estimate from token counts + known tier structure. Three separate limits (session/weekly/model-weekly) are more complex than originally assumed.
- Token aggregation accuracy is critical from Phase 1. Must verify against Claude.ai web UI to avoid 5-10x inflation errors seen in other extensions.

## Session Continuity

Last session: 2026-02-07 15:37
Stopped at: Completed 04-03-PLAN.md
Resume file: None
Next: Continue Phase 4 (plan 04-04 remaining)
