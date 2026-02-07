# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-06)

**Core value:** Accurate, trustworthy usage visibility — the user always knows where they stand against their plan limits without trusting third-party code with their data.
**Current focus:** Phase 2 - File Watching & Integration

## Current Position

Phase: 2 of 6 (File Watching & Integration)
Plan: 0 of TBD in current phase
Status: Not started (needs planning)
Last activity: 2026-02-07 — Completed Phase 1

Progress: [██░░░░░░░░] ~17%

## Performance Metrics

**Velocity:**
- Total plans completed: 4
- Average duration: 5.0 minutes
- Total execution time: 0.33 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 - Foundation | 4 | 20min | 5.0min |

**Recent Trend:**
- Last 5 plans: 4min, 5min, 5min, 6min
- Trend: Consistent velocity (~5min/plan)

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

Last session: 2026-02-07T11:45:00Z
Stopped at: Completed Phase 1 (Foundation & Core Parsing) — all 4 plans done, verified
Resume file: None
Next: Phase 2 planning (File Watching & Integration)
