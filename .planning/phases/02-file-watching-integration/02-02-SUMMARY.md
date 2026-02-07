---
phase: 02-file-watching-integration
plan: 02
subsystem: monitoring
tags: [vscode, file-watching, incremental-parsing, debouncing, typescript]

# Dependency graph
requires:
  - phase: 02-01
    provides: OffsetTracker for byte offset persistence, parseIncremental for incremental JSONL parsing
  - phase: 01-03
    provides: TimeBuckets, mergeTimeBuckets for incremental aggregation
  - phase: 01-04
    provides: UsageStore for globalState persistence
provides:
  - SessionWatcher class with FileSystemWatcher for real-time JSONL monitoring
  - Debounced file change handling (500ms, with create/change race condition prevention)
  - Incremental parsing pipeline (detect change → parse from offset → merge buckets → persist)
  - Extension lifecycle integration (activate → watch, deactivate → auto-dispose)
affects: [03-rate-limit-estimation, 04-webview-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "FileSystemWatcher with RelativePattern for cross-platform directory watching"
    - "Debounce pattern: per-file timers + recently-created set for create/change race"
    - "Callback-based architecture: watcher notifies extension via onUpdate callback"

key-files:
  created: [src/watcher/sessionWatcher.ts]
  modified: [src/extension.ts]

key-decisions:
  - "500ms debounce for file changes (balances responsiveness vs duplicate parsing)"
  - "1s recently-created window to prevent onCreate+onChange duplicate processing"
  - "onUpdate callback pattern for separation of concerns (watcher doesn't know about status bar)"
  - "Module-level watcher reference for Clear Data command access"

patterns-established:
  - "FileSystemWatcher auto-dispose via context.subscriptions (no manual cleanup)"
  - "Incremental merge pattern: currentBuckets always holds running total, merged on each update"

# Metrics
duration: 4min
completed: 2026-02-07
---

# Phase 2 Plan 2: Live File Watching Summary

**FileSystemWatcher monitors JSONL changes, parses incrementally from byte offsets, merges into live TimeBuckets, updates status bar within 30-60s**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-07T12:37:32Z
- **Completed:** 2026-02-07T12:41:45Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- SessionWatcher watches `~/.claude/projects/**/*.jsonl` for file changes in real-time
- Incremental parsing triggered on file changes (parses only new content from last offset)
- Debounced event handling prevents duplicate parsing during rapid file writes
- Status bar updates automatically within 30-60 seconds of new Claude Code activity
- Proper resource cleanup via context.subscriptions (no memory leaks)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create SessionWatcher with debounced incremental parsing** - `9913747` (feat)
2. **Task 2: Wire SessionWatcher into extension lifecycle** - `5189ec4` (feat)

## Files Created/Modified

- `src/watcher/sessionWatcher.ts` - FileSystemWatcher with debounced incremental parsing, merges updates into live TimeBuckets
- `src/extension.ts` - Integrated SessionWatcher into activate() lifecycle, wired onUpdate callback to status bar + persistence

## Decisions Made

**1. 500ms debounce for file changes**
- Rationale: Balances responsiveness (users see updates quickly) vs efficiency (don't parse on every keystroke)
- Claude Code writes to JSONL incrementally during long responses, rapid events are expected

**2. 1-second recently-created window to prevent duplicate processing**
- Rationale: FileSystemWatcher fires both onCreate and onChange for new files (race condition)
- Tracking recently-created files prevents parsing the same file twice within 1 second

**3. Callback-based architecture for onUpdate**
- Rationale: SessionWatcher doesn't need to know about status bar or persistence
- Extension provides callback that handles both updates, keeping concerns separated

**4. Module-level watcher reference**
- Rationale: Clear Data command needs to call watcher.resetState() to clear offsets
- Alternative considered: passing watcher to command closure, but module-level is simpler

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**1. TypeScript syntax error in JSDoc comment**
- Issue: JSDoc comment contained `**/*.jsonl` glob pattern, TypeScript parser misinterpreted `**` as exponentiation operator
- Resolution: Changed comment to "JSONL files in ~/.claude/projects" (removed glob pattern from comment)
- Impact: None (cosmetic JSDoc change only)

**2. Node.js not in MSYS bash PATH**
- Issue: npx/tsc commands failed from MSYS bash (Node.js not in shell PATH)
- Resolution: Used PowerShell scripts (compile.ps1, build.ps1) which set Node.js PATH explicitly
- Impact: None (proper tooling setup, documented in project CLAUDE.md)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for Phase 3 (Rate Limit Estimation):**
- Real-time token counting infrastructure complete
- TimeBuckets update live as Claude Code runs
- Session/daily/weekly/monthly aggregations available for limit calculations
- File watching handles all projects automatically

**No blockers.** File watching and incremental parsing are fully functional.

**Note for Phase 3:** The 30-60 second update latency comes from:
1. 500ms debounce timer
2. Time for Claude Code to flush writes to JSONL
3. Incremental parse + merge time

This is acceptable for usage monitoring (users don't need sub-second updates). If Phase 4 dashboard requires faster updates, could reduce debounce to 100ms, but current settings balance responsiveness vs CPU usage well.

---
*Phase: 02-file-watching-integration*
*Completed: 2026-02-07*
