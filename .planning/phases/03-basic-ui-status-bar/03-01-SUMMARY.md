---
phase: 03-basic-ui-status-bar
plan: 01
subsystem: ui-data
tags: [rate-limits, formatting, status-bar, data-foundation]
requires: [01-03, 01-04, 02-02]
provides:
  - RateLimitInfo, RateLimitStatus, StatusBarData interfaces
  - Rate limit calculation engine (session 5hr, weekly, weekly-sonnet)
  - Display formatting utilities (tokens, cost, cooldown, percentage)
  - PlanConfig extended with estimated token limits
affects: [03-02, 03-03]
tech-stack:
  added: []
  patterns: [pure functions, separation of data logic from UI, date-fns time calculations]
key-files:
  created:
    - src/core/rateLimits.ts
    - src/ui/formatting.ts
  modified:
    - src/types.ts
    - src/pricing/plans.ts
key-decisions:
  - estimate-token-limits: Conservative output token estimates for Pro/Max5/Max20 (45K/225K/900K session, 500K/2.5M/10M weekly)
  - output-tokens-only: Rate limits primarily constrain output tokens per Claude behavior
  - iso-week-monday-start: Weekly limits use ISO week (Monday start) for international consistency
  - session-5hr-rolling: Session limit sums sessions with lastMessage in last 5 hours
patterns-established:
  - "Pure data modules: rateLimits.ts and formatting.ts have no VS Code dependencies"
  - "Smart formatting: formatTokens uses 1.2K/45K/3.4M with decimal only where helpful"
  - "Percentage capping: Rate limit percentages capped at 100% even if over limit"
  - "Burn rate from recent activity: Calculate tokens/min from last 10 minutes of sessions"
duration: 3min
completed: 2026-02-07
---

# Phase 3 Plan 01: Rate Limit and Formatting Foundation Summary

**Pure data logic for rate limit calculation and display formatting, enabling status bar UI in Plan 02**

## Performance

- **Duration:** 3 minutes
- **Start:** 2026-02-07T13:15:07Z
- **End:** 2026-02-07T13:18:08Z
- **Tasks completed:** 3/3
- **Files created:** 2
- **Files modified:** 2

## Accomplishments

1. **Rate Limit Types:** Extended types.ts with RateLimitInfo (single limit status), RateLimitStatus (all three limits), and StatusBarData (complete status bar payload)
2. **Token Limit Estimates:** Added sessionTokenLimit, weeklyTokenLimit, weeklySonnetLimit to PlanConfig with conservative estimates for Pro/Max5/Max20 plans
3. **Rate Limit Calculator:** Implemented calculateRateLimits producing percentages from session/weekly buckets and plan limits
4. **Burn Rate Tracking:** Added calculateBurnRate for tokens-per-minute from last 10 minutes of activity
5. **Display Formatters:** Created pure formatting functions for tokens (K/M), cost ($X.XX), cooldown (Xh Ym), percentage (N%), and burn rate

## Task Commits

1. **Task 1:** Add rate limit types and extend plan configs - `060d4e5` (feat)
   - Added RateLimitInfo, RateLimitStatus, StatusBarData interfaces to types.ts
   - Extended PlanConfig with optional token limit fields
   - Populated PLAN_CONFIGS with estimated limits (Pro: 45K/500K/500K, Max5: 225K/2.5M/2.5M, Max20: 900K/10M/10M)
   - Documented limits as estimates based on community reports

2. **Task 2:** Create rate limit calculation engine - `3f7d7b1` (feat)
   - Implemented calculateRateLimits with session 5hr rolling window
   - Weekly limits use ISO week buckets (Monday start)
   - Added calculateBurnRate for tokens/min from recent sessions
   - Created buildStatusBarData aggregating all status bar data
   - TODO: Filter weekly sonnet by model once per-model aggregation exists

3. **Task 3:** Create display formatting utilities - `40d7122` (feat)
   - Implemented formatTokens with smart K/M abbreviation (1.2K, 45K, 3.4M)
   - Added formatTokensExact with comma separators for tooltips
   - Created formatCooldown for duration display (2h 34m)
   - Implemented formatCost with smart precision ($0.42, $12.50, $150)
   - Added formatPercentage and formatBurnRate
   - All pure functions, no VS Code dependencies

## Files Created/Modified

### Created

- **src/core/rateLimits.ts** - Rate limit calculation engine with calculateRateLimits (session 5hr/weekly/sonnet), calculateBurnRate (tokens/min), and buildStatusBarData (complete aggregation)
- **src/ui/formatting.ts** - Pure display formatting functions (formatTokens, formatTokensExact, formatCooldown, formatCost, formatPercentage, formatBurnRate)

### Modified

- **src/types.ts** - Added RateLimitInfo, RateLimitStatus, StatusBarData interfaces; extended PlanConfig with optional token limit fields
- **src/pricing/plans.ts** - Populated PLAN_CONFIGS with estimated token limits for all three plan tiers (session/weekly/sonnet)

## Decisions Made

1. **Conservative Token Limit Estimates** - Used output token estimates based on community reports (Pro: 45K session, Max5: 225K, Max20: 900K) since exact limits aren't documented. Phase 4 will refine via observed rate-limit events.
2. **Output Tokens Only** - Rate limit calculations use output tokens from TimeBuckets since Claude rate limits primarily constrain output generation.
3. **ISO Week Standard** - Weekly limits use ISO week with Monday start (aligns with international business conventions).
4. **Rolling 5hr Session Window** - Session limit sums output tokens from sessions with lastMessage within last 5 hours.
5. **Pure Data Modules** - rateLimits.ts and formatting.ts have zero VS Code dependencies for independent testing and separation of concerns.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all tasks completed without blockers.

## Next Phase Readiness

**Ready for Phase 3 Plan 02 (StatusBarManager Implementation)**

- ✅ RateLimitStatus provides all three limit percentages
- ✅ StatusBarData interface defines complete status bar payload
- ✅ buildStatusBarData aggregates from TimeBuckets
- ✅ All formatting functions ready for display rendering
- ✅ Pure modules enable unit testing before UI integration

**Known limitation:** Weekly sonnet limit uses same data as weekly total (no per-model weekly aggregation yet). TODO tracked in rateLimits.ts for Phase 4 enhancement.

---

*Phase: 03-basic-ui-status-bar*
*Completed: 2026-02-07*
