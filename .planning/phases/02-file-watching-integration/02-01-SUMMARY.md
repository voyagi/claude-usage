---
phase: 02-file-watching-integration
plan: 01
subsystem: parser
tags: [incremental-parsing, file-watching, globalState, byte-offsets]

# Dependency graph
requires:
  - phase: 01-foundation-core-parsing
    provides: "parseAssistantMessage for line validation, streaming parser pattern, globalState persistence"
provides:
  - "OffsetTracker class for persisting per-file byte offsets across VS Code reloads"
  - "parseIncremental function for reading only new lines from JSONL files"
  - "Infrastructure for real-time file watching without re-parsing entire files"
affects: [02-02-session-watcher, 02-03-integration, file-watching, real-time-updates]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Byte offset tracking pattern for incremental file parsing"
    - "globalState key prefixing for namespaced storage (fileOffset:)"

key-files:
  created:
    - src/watcher/offsetTracker.ts
    - src/parser/incrementalParser.ts
  modified: []

key-decisions:
  - "Use globalState for offset persistence (enables tracking across VS Code reloads)"
  - "Simple byte counting approach (accept rare incomplete line edge case, mitigated by full reparse on activation)"
  - "Early return on no-new-data (offset === size avoids unnecessary stream creation)"

patterns-established:
  - "OffsetTracker pattern: Per-entity state tracking using globalState with key prefixes"
  - "Incremental parser pattern: fs.createReadStream({ start: offset }) with byte tracking"

# Metrics
duration: 3min
completed: 2026-02-07
---

# Phase 2 Plan 1: Incremental Parsing Foundation Summary

**Byte offset tracking and incremental JSONL parsing infrastructure for real-time file watching**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-07T11:29:57Z
- **Completed:** 2026-02-07T11:32:54Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- OffsetTracker persists per-file byte offsets in globalState across VS Code reloads
- Incremental parser reads only new lines from JSONL files starting at byte offset
- Handles truncated files (offset > size) and no-new-data cases (offset === size)
- Gracefully skips corrupt/incomplete lines during active sessions

## Task Commits

Each task was committed atomically:

1. **Task 1: Create OffsetTracker for per-file byte offset persistence** - `eac56e2` (feat)
2. **Task 2: Create incremental JSONL parser with offset support** - `f38840f` (feat)

## Files Created/Modified
- `src/watcher/offsetTracker.ts` - Persists byte offsets per file using globalState with key prefix pattern
- `src/parser/incrementalParser.ts` - Reads JSONL from byte offset, returns new records + updated offset

## Decisions Made

1. **Use globalState for offset persistence**: Enables tracking read positions across VS Code reloads without needing separate storage file
2. **Simple byte counting approach**: Track bytesRead = startOffset + sum(line length + 1). Accept rare edge case of incomplete final line being read twice, mitigated by full reparse on activation and watcher firing again
3. **Early return on no-new-data**: When offset === file size, skip stream creation entirely for performance
4. **Reset offset on truncation**: When stored offset > current file size, reset to 0 (handles Claude Code rotating/clearing session files)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - both modules compiled cleanly and build succeeded on first attempt.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for Plan 02 (SessionWatcher):
- OffsetTracker provides persistence layer for tracking file positions
- parseIncremental provides offset-based parsing capability
- Both modules handle edge cases (truncation, no new data, corrupt lines)

**Next steps:** Build SessionWatcher that uses fs.watch to monitor JSONL files, calls parseIncremental on changes, and updates OffsetTracker.

---
*Phase: 02-file-watching-integration*
*Completed: 2026-02-07*
