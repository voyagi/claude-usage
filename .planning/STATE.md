# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-06)

**Core value:** Accurate, trustworthy usage visibility — the user always knows where they stand against their plan limits without trusting third-party code with their data.
**Current focus:** Phase 1 - Foundation & Core Parsing

## Current Position

Phase: 1 of 6 (Foundation & Core Parsing)
Plan: 3 of 4 in current phase
Status: In progress
Last activity: 2026-02-07 — Completed 01-03-PLAN.md

Progress: [███░░░░░░░] ~30%

## Performance Metrics

**Velocity:**
- Total plans completed: 3
- Average duration: 4.7 minutes
- Total execution time: 0.23 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 - Foundation | 3 | 14min | 4.7min |

**Recent Trend:**
- Last 5 plans: 4min, 5min, 5min
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

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 4 uncertainty: Claude Code JSONL format for rate-limit events is undocumented. May require experimental approach and iteration based on real session data.
- Token aggregation accuracy is critical from Phase 1. Must verify against Claude.ai web UI to avoid 5-10x inflation errors seen in other extensions.

## Session Continuity

Last session: 2026-02-07T11:18:24Z
Stopped at: Completed 01-03-PLAN.md (Pricing Engine & Time Buckets)
Resume file: None
Next: Plan 01-04 (State Management & Data Flow)
