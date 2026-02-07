---
phase: 04-rate-limiting-burn-rate
plan: 03
subsystem: rate-limiting
tags: [file-watcher, credentials, rate-limit-detection, zod, vscode-config]

# Dependency graph
requires:
  - phase: 04-01
    provides: tierDetection module with parseCredentialsFile and detectTierFromCredentials
provides:
  - CredentialsWatcher for auto-detecting tier changes from ~/.claude/.credentials.json
  - Rate limit event parser for learning from 429 errors
  - User-configurable rate limit thresholds and burn rate settings
affects: [04-04, status-bar-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "FileSystemWatcher for credentials monitoring"
    - "Pure data modules with no VS Code dependencies for testability"
    - "Zod schemas for safe JSONL parsing"

key-files:
  created:
    - src/storage/credentialsWatcher.ts
    - src/parser/rateLimitDetector.ts
  modified:
    - package.json

key-decisions:
  - "Only fire onTierChange callback when tier actually changes (avoid redundant updates)"
  - "Gracefully handle missing credentials file (normal for fresh installs)"
  - "5% safety margin when refining limits from 429 errors"
  - "Default thresholds: 60% yellow, 95% red, 15min burn rate window"

patterns-established:
  - "Callback-based watcher pattern for tier change notifications"
  - "Downward-only limit refinement (never increase estimates)"

# Metrics
duration: 2min
completed: 2026-02-07
---

# Phase 04 Plan 03: Intelligence Layer Summary

**Auto-detection, auto-learning, and user-configurable overrides for rate limit estimates**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-07T15:35:10Z
- **Completed:** 2026-02-07T15:37:42Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created CredentialsWatcher that monitors ~/.claude/.credentials.json for tier changes and auto-detects plan type on startup
- Implemented rate limit event detector that parses 429 errors from JSONL and refines limit estimates conservatively
- Added 6 VS Code configuration properties for user overrides of rate limits, warning thresholds, and burn rate window

## Task Commits

Each task was committed atomically:

1. **Task 1: Create CredentialsWatcher** - `e210d1e` (feat)
2. **Task 2: Create rate limit event detector and add package.json config** - `76aff99` (feat)

**Plan metadata:** (committed with this summary)

## Files Created/Modified

- `src/storage/credentialsWatcher.ts` - Watches credentials file, detects tier changes, fires callbacks only on actual tier change
- `src/parser/rateLimitDetector.ts` - Parses rate_limit_error events from JSONL, classifies limit type (session/weekly), refines estimates with 5% safety margin
- `package.json` - Added 6 configuration properties: session/weekly/weeklySonnet thresholds, yellow/red warning levels, burn rate window

## Decisions Made

- **Only fire callbacks on actual tier changes** - Store lastKnownTier to avoid redundant updates when credentials file is rewritten with same tier
- **Graceful handling of missing credentials** - Return fallback tier without error logging (normal for fresh installs)
- **5% safety margin for limit refinement** - When 429 observed, set limit to 95% of observed usage to prevent repeated hits
- **Default warning thresholds** - Yellow at 60%, red at 95%, matching common alerting practices
- **15-minute burn rate window** - Balance between responsiveness and noise reduction

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Intelligence layer complete. Ready for 04-04 (integrate into status bar):

- CredentialsWatcher can be instantiated in extension.ts to auto-detect tier
- Rate limit detector ready for use by session watcher when parsing JSONL
- Configuration schema ready for UI to read user overrides
- All modules compile and build cleanly

---
*Phase: 04-rate-limiting-burn-rate*
*Completed: 2026-02-07*
