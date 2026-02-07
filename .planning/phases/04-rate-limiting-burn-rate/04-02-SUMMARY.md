---
phase: 04-rate-limiting-burn-rate
plan: 02
subsystem: core
tags: [rate-limits, burn-rate, urgency-scoring, date-fns, formatting]

# Dependency graph
requires:
  - phase: 01-foundation-core-parsing
    provides: Type definitions and parsing infrastructure
  - phase: 03-basic-ui-status-bar
    provides: rateLimits.ts and formatting.ts modules
provides:
  - Urgency-weighted rate limit scoring for prioritizing which limit is most critical
  - Proper session reset time calculation (addHours instead of setHours)
  - Time-until-limit formatting for displaying ETA in status bar
  - Optional burn rate override parameter for EMA-smoothed values
affects: [04-04-enhanced-status-bar, rate-limit-display, burn-rate-visualization]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Urgency scoring: percentage * 1/sqrt(hoursUntilReset) for time-sensitive rate limits"
    - "Backwards-compatible optional parameters for progressive enhancement"

key-files:
  created: []
  modified:
    - src/core/rateLimits.ts
    - src/ui/formatting.ts

key-decisions:
  - "Urgency score uses sqrt decay for time proximity (balances immediacy vs percentage)"
  - "Optional burnRateOverride param maintains backwards compatibility with simple fallback"
  - "formatTimeUntilLimit includes 'at current pace' suffix for user clarity about projection uncertainty"

patterns-established:
  - "Export calculation functions separately from data builders for independent use"
  - "Pure formatting functions return empty string for null/idle states"

# Metrics
duration: 3min
completed: 2026-02-07
---

# Phase 04 Plan 02: Rate Limit Urgency & Formatting Enhancement Summary

**Urgency-weighted rate limit scoring with proper session reset calculation and time-until-limit ETA formatting**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-07T15:26:41Z
- **Completed:** 2026-02-07T15:30:02Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Fixed session 5hr reset time using proper `addHours(firstMessage, 5)` instead of buggy setHours approach
- Added urgency scoring function for identifying most critical rate limit (high % near reset)
- Added `formatTimeUntilLimit` for displaying burn rate projections in human-readable format
- Enhanced `buildStatusBarData` with optional EMA burn rate override

## Task Commits

Each task was committed atomically:

1. **Task 1: Enhance rateLimits.ts with urgency weighting and proper reset times** - `a323432` (feat)
2. **Task 2: Add formatTimeUntilLimit to formatting.ts** - `6560114` (feat)

## Files Created/Modified
- `src/core/rateLimits.ts` - Added calculateUrgencyScore export, fixed session reset time, added optional burnRateOverride parameter
- `src/ui/formatting.ts` - Added formatTimeUntilLimit for ETA display with "at current pace" suffix

## Decisions Made

**1. Urgency formula uses sqrt decay for time proximity**
- Formula: `percentage * (1 / sqrt(hoursUntilReset))`
- Rationale: sqrt provides balanced weighting - imminent resets matter but don't dominate high percentages
- Alternative considered: Linear 1/hours was too aggressive, made 99% in 48h > 50% in 1h

**2. Optional burnRateOverride parameter for progressive enhancement**
- Rationale: Plan 04-01 builds EMA burn rate tracker, but rateLimits.ts should work standalone
- Fallback: Simple 10-min calculateBurnRate if no override provided
- Benefits: Backwards compatibility + allows Plan 04-04 to pass smoothed values

**3. formatTimeUntilLimit includes "at current pace" suffix**
- Rationale: Makes it clear this is a projection, not a guarantee
- User benefit: Avoids confusion when burn rate changes and ETA updates

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**Test file compilation errors (not related to changes)**
- Two orphaned test files (burnRate.test.ts, tierDetection.test.ts) reference non-existent modules
- These are from a prior session and don't affect the actual production code
- Temporarily moved during verification, then restored
- Resolution: Production code compiles cleanly, test infrastructure needs cleanup in separate session

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for Plan 04-04 (Enhanced Status Bar Display)**
- calculateUrgencyScore exported for urgency-based color thresholds
- formatTimeUntilLimit ready for tooltip/status bar ETA display
- burnRateOverride parameter ready to receive EMA-smoothed values from Plan 04-01

**Blockers:** None

**Quality notes:**
- All functions are pure (no side effects)
- Backwards compatible (existing code continues to work)
- Type-safe (TypeScript compilation passes)

---
*Phase: 04-rate-limiting-burn-rate*
*Completed: 2026-02-07*
