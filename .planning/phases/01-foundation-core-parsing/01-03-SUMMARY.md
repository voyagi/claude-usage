---
phase: 01-foundation-core-parsing
plan: 03
subsystem: pricing
tags: [pricing, cost-calculation, time-aggregation, date-fns, vscode-config]

# Dependency graph
requires:
  - phase: 01-01
    provides: Domain types (TokenUsage, AggregatedUsage, TimeBuckets, ModelPricing, PlanConfig)
  - phase: 01-02
    provides: Token counter utilities (createEmptyAggregatedUsage, addToAggregation)
provides:
  - Configurable pricing engine with VS Code settings integration
  - Cost calculation for all token types with correct cache multipliers
  - Plan configurations for Pro ($20), Max5 ($100), Max20 ($200)
  - Time bucket aggregation (session, daily, weekly, monthly)
  - Serialization/deserialization for globalState persistence
affects: [01-04, state-management, webview-ui]

# Tech tracking
tech-stack:
  added: [date-fns@4.1.0]
  patterns: [Configurable pricing via VS Code workspace settings, Local timezone for calendar boundaries, ISO week standard (Monday start)]

key-files:
  created:
    - src/pricing/pricingEngine.ts
    - src/pricing/plans.ts
    - src/aggregation/timeBuckets.ts
  modified: []

key-decisions:
  - "Pricing configurable via VS Code settings (not hardcoded) - allows users to update rates without extension updates"
  - "Local timezone for calendar boundaries - matches user expectations for 'today'"
  - "ISO week standard with Monday start - international standard for weekly rollups"
  - "Fallback to claude-sonnet-4-5 pricing for unknown models - most common model in Claude Code"
  - "Default to 5m cache multiplier when no breakdown available - conservative estimate"

patterns-established:
  - "Pattern 1: All pricing MUST be configurable via vscode.workspace.getConfiguration() to avoid hardcoding rates"
  - "Pattern 2: Use date-fns for all date operations (startOfDay, startOfWeek, startOfMonth) - consistent date handling"
  - "Pattern 3: Serialize/deserialize Maps for globalState persistence - enables incremental aggregation"

# Metrics
duration: 5min
completed: 2026-02-07
---

# Phase 01 Plan 03: Pricing Engine & Time Buckets Summary

**Configurable pricing engine with official Claude rates (5m/1h cache multipliers) and time bucket aggregation for session/daily/weekly/monthly rollups**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-07T11:13:11Z
- **Completed:** 2026-02-07T11:18:24Z
- **Tasks:** 2 (1 already completed by parallel plan 01-02)
- **Files modified:** 3

## Accomplishments

- Pricing engine correctly calculates cost for all token types (input, output, cache creation 5m/1h, cache read) with official multipliers (1.25x/2x write, 0.1x read)
- Pricing fully configurable via VS Code settings with Zod validation - users can update rates without waiting for extension updates
- Time bucket aggregation groups TokenUsage by session, calendar day, ISO week, and calendar month using local timezone
- Serialization/deserialization supports globalState persistence for incremental aggregation

## Task Commits

Each task was committed atomically:

1. **Task 1: Create configurable pricing engine with plan definitions** - Already completed by plan 01-02
   - `1fcc4c2` (feat) - pricingEngine.ts created with Logger fix
   - `bfdc571` (feat) - plans.ts added with Pro/Max5/Max20 configs

2. **Task 2: Create time bucket aggregation** - `f63e8a4` (feat)
   - Implements aggregateUsage(), mergeTimeBuckets(), getTimeBucketSummary()
   - Implements serializeTimeBuckets(), deserializeTimeBuckets()

## Files Created/Modified

- `src/pricing/pricingEngine.ts` - Cost calculation with configurable per-model pricing, VS Code settings integration, Zod validation
- `src/pricing/plans.ts` - Plan definitions (Pro $20, Max5 $100, Max20 $200) with getPlanConfig() helper
- `src/aggregation/timeBuckets.ts` - Time bucket aggregation for session/daily/weekly/monthly with serialization support

## Decisions Made

**1. Pricing configurable via VS Code settings**
- **Rationale:** Claude updates pricing periodically. Hardcoded rates would require extension updates and user reinstalls. VS Code settings allow users to update rates immediately when Claude announces changes.
- **Implementation:** vscode.workspace.getConfiguration('claude-usage').get('pricing') with deep merge and Zod validation

**2. Local timezone for calendar boundaries**
- **Rationale:** Users think "today" in their local timezone, not UTC. Using UTC for daily buckets would split user activity across two "days" at midnight.
- **Implementation:** date-fns functions without timezone conversion (uses system local timezone)

**3. ISO week standard (Monday start)**
- **Rationale:** International standard for weekly rollups. Monday start aligns with business week conventions.
- **Implementation:** startOfWeek(timestamp, { weekStartsOn: 1 })

**4. Fallback to claude-sonnet-4-5 for unknown models**
- **Rationale:** Claude Code primarily uses Sonnet. If a new model appears before extension updates, using Sonnet pricing provides reasonable estimate rather than crashing.
- **Implementation:** Log warning, use pricing['claude-sonnet-4-5']

**5. Default to 5m multiplier when no cache breakdown available**
- **Rationale:** Older JSONL formats may lack cache_creation.ephemeral_5m/1h breakdown. 5m is more common and provides conservative estimate.
- **Implementation:** if (cacheCreation5m === 0 && cacheCreation1h === 0 && cacheCreationTokens > 0) use 5m multiplier

## Deviations from Plan

**Discovery: Task 1 was already completed by parallel plan 01-02**

Plan 01-02 and 01-03 were executed in parallel (wave 2). During plan 01-02 execution, the agent discovered that:
- pricingEngine.ts was needed for Logger instantiation pattern (deviation Rule 1 - bug fix)
- plans.ts was created alongside tokenCounter.ts as part of the pricing/counting module pair

**Impact:** No duplication - this plan verified the existing files matched requirements and only needed to add timeBuckets.ts (Task 2).

**Total deviations:** None from plan 01-03 execution (Task 1 pre-completed was coordination, not deviation)
**Impact on plan:** Plan executed as designed - parallel wave coordination worked correctly

## Issues Encountered

**Issue 1: Node.js not in MSYS bash PATH**
- **Problem:** `npm run compile` failed with "node: not found"
- **Resolution:** Added `/c/Program Files/nodejs` to PATH for bash session
- **Impact:** Verification delayed by ~2 minutes
- **Note:** This is a known limitation documented in CLAUDE.md learned rules

**Issue 2: Task 1 appeared incomplete initially**
- **Problem:** Pricing files created by plan 01-02 weren't visible until git log check
- **Resolution:** Verified files existed in HEAD via git ls-tree
- **Impact:** None - files were already committed correctly

## Next Phase Readiness

**Ready for Phase 01-04 (State Management & Data Flow):**
- Pricing engine ready to calculate costs for TokenUsage records
- Time bucket aggregation ready to organize usage data for display
- Serialization/deserialization ready for globalState persistence
- All exports use named exports for explicit dependency tracking

**No blockers or concerns.**

---
*Phase: 01-foundation-core-parsing*
*Completed: 2026-02-07*
