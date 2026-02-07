---
phase: 04-rate-limiting-burn-rate
plan: 01
subsystem: analytics
tags: [burn-rate, ema, tier-detection, credentials, date-fns, jest, tdd]

# Dependency graph
requires:
  - phase: 01-foundation-core-parsing
    provides: TimeBuckets interface with session/daily/weekly/monthly aggregations
  - phase: 01-foundation-core-parsing
    provides: PlanType enum and type definitions
provides:
  - BurnRateTracker with EMA smoothing for rate calculation
  - calculateBurnRateEMA function for tokens/min with lookback window
  - predictTimeUntilLimit function for ETA calculations
  - Tier detection from ~/.claude/.credentials.json
  - Jest test infrastructure for TDD workflow
affects: [04-02-rate-limit-tracking, 04-03-status-bar-integration]

# Tech tracking
tech-stack:
  added: [jest, @types/jest, ts-jest]
  patterns: [TDD red-green-refactor, pure data modules, EMA smoothing, immutable state updates]

key-files:
  created:
    - src/core/burnRate.ts
    - src/core/tierDetection.ts
    - src/core/burnRate.test.ts
    - src/core/tierDetection.test.ts
    - jest.config.js
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "Jest test framework for TypeScript project (ts-jest preset)"
  - "EMA smoothing with alpha=0.2 default for burn rate calculation"
  - "Output tokens only for burn rate (input tokens don't affect rate limits)"
  - "Actual time span (earliest firstMessage to now) for accurate rate calculation"
  - "Case-insensitive tier detection for robustness"
  - "Graceful fallback when credentials.json missing or malformed"

patterns-established:
  - "TDD cycle: RED (failing tests) → GREEN (minimal implementation) → REFACTOR (cleanup)"
  - "Pure data modules with no VS Code dependencies for independent testing"
  - "Immutable state updates (return new tracker object, don't mutate)"

# Metrics
duration: 5min
completed: 2026-02-07
---

# Phase 04 Plan 01: Core Burn Rate & Tier Detection Summary

**EMA-smoothed burn rate calculator and auto-tier detection from credentials.json, implemented via TDD with 23 passing tests**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-07T15:25:51Z
- **Completed:** 2026-02-07T15:30:45Z
- **Tasks:** 3 TDD phases (RED/GREEN/REFACTOR)
- **Files modified:** 7

## Accomplishments

- Jest test framework configured for TypeScript with ts-jest
- BurnRateTracker with configurable EMA smoothing (alpha default 0.2)
- calculateBurnRateEMA: sums output tokens in lookback window, applies EMA over actual time span
- predictTimeUntilLimit: returns minutes remaining or null if idle
- Tier detection from credentials.json rateLimitTier (max_5/max_20) and subscriptionType (pro)
- Case-insensitive tier matching for robustness
- 23 unit tests covering all behavior specifications

## Task Commits

Each TDD phase was committed atomically:

1. **RED - Write failing tests** - `6260fd4` (test)
   - BurnRateTracker creation tests
   - EMA calculation tests (empty/old/recent activity)
   - Time-until-limit prediction tests
   - Credentials parsing and tier detection tests
   - Jest framework setup

2. **GREEN - Implement to pass** - `9a1db57` (feat)
   - burnRate.ts with BurnRateTracker interface
   - calculateBurnRateEMA with EMA smoothing
   - predictTimeUntilLimit with idle detection
   - tierDetection.ts with parseCredentialsFile
   - detectTierFromCredentials with case-insensitive matching
   - All 23 tests passing

3. **REFACTOR** - (skipped)
   - No refactoring needed - code already clean

## Files Created/Modified

- `src/core/burnRate.ts` - Burn rate calculation with EMA smoothing (131 lines)
- `src/core/tierDetection.ts` - Auto-detect plan tier from credentials (78 lines)
- `src/core/burnRate.test.ts` - 15 test cases for burn rate functions
- `src/core/tierDetection.test.ts` - 8 test cases for tier detection
- `jest.config.js` - Jest configuration with ts-jest preset
- `package.json` - Added test scripts and Jest dependencies

## Decisions Made

1. **Jest for test framework**: Industry-standard for TypeScript projects, ts-jest provides seamless integration
2. **EMA smoothing with alpha=0.2**: Balances responsiveness vs stability for burn rate tracking
3. **Output tokens only**: Rate limits constrain output generation, not input consumption
4. **Actual time span for rate**: Uses earliest firstMessage to now instead of full lookback window for accuracy
5. **Case-insensitive tier detection**: Handles variations in credentials.json format
6. **Graceful fallback**: Returns fallback tier when credentials missing/invalid instead of crashing
7. **Pure data modules**: No VS Code dependencies enables independent testing and composability

## Deviations from Plan

None - plan executed exactly as written via TDD workflow.

## Issues Encountered

None. TDD workflow ensured correctness:
- RED phase: Tests failed as expected (modules didn't exist)
- GREEN phase: All 23 tests passed after implementation
- Compilation and build verified clean

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Burn rate calculation ready for integration into rate limit tracking
- Tier detection ready for automatic plan configuration
- Test infrastructure ready for future TDD plans
- Next: 04-02 will use these modules to build RateLimitTracker

---
*Phase: 04-rate-limiting-burn-rate*
*Completed: 2026-02-07*
