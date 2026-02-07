---
phase: 01-foundation-core-parsing
verified: 2026-02-07T18:00:00Z
status: gaps_found
score: 3/5 must-haves verified
gaps:
  - truth: "Extension persists state across VS Code restarts using globalState"
    status: partial
    reason: "UsageStore.saveUsageData() is called, but loadUsageData() is never called in extension.ts. Data is written to globalState but never read back on restart."
    artifacts:
      - path: "src/storage/usageStore.ts"
        issue: "loadUsageData() is defined (line 58) but never called anywhere"
      - path: "src/extension.ts"
        issue: "performInitialParse() does a full reparse every time; never checks for persisted state first"
    missing:
      - "Call store.loadUsageData() in performInitialParse() before full reparse"
      - "Use persisted state as initial data or skip reparse when recent data exists"
  - truth: "Plan selection (CX-03) is wired and functional"
    status: failed
    reason: "plans.ts exports getPlanConfig() and PLAN_CONFIGS, but nothing imports or uses them. The planType setting is registered in package.json but never read."
    artifacts:
      - path: "src/pricing/plans.ts"
        issue: "ORPHANED -- exports are never imported by any other module"
      - path: "src/extension.ts"
        issue: "Does not import plans.ts or read claude-usage.planType setting"
    missing:
      - "Import and use plan configuration in extension.ts or pricingEngine.ts"
      - "Read claude-usage.planType from VS Code settings"
      - "Display plan name or monthly budget in status bar or tooltip"
---

# Phase 1: Foundation & Core Parsing Verification Report

**Phase Goal:** Extension can accurately parse JSONL files and calculate token usage
**Verified:** 2026-02-07
**Status:** gaps_found
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Extension correctly parses JSONL session files from Claude Code 2.1.34+ format | VERIFIED | schemas.ts has Zod schemas matching Claude format (assistant type, usage object with cache_creation). jsonlParser.ts streams files line-by-line. Human-verified: 144/144 files parsed, 4518 records, 0 lines skipped. |
| 2 | Extension accurately calculates billable vs cached token usage | VERIFIED | tokenCounter.ts correctly separates billable (inputTokens + cacheCreationTokens) from non-billable (cacheReadTokens). pricingEngine.ts applies correct per-model rates with 5m/1h cache write multipliers (1.25x/2.0x) and cache read multiplier (0.1x). Human-verified: $243.70 total cost. |
| 3 | Extension aggregates usage into time buckets (session, daily, weekly, monthly) with correct totals | VERIFIED | timeBuckets.ts uses date-fns for local-timezone calendar boundaries. Groups by sessionId, YYYY-MM-DD, ISO week (Monday start), YYYY-MM. Human-verified: tooltip shows today/month breakdown, 55 sessions. |
| 4 | Extension handles incomplete JSONL writes without crashing | VERIFIED | jsonlParser.ts wraps JSON.parse in try/catch per line (line 43-68), logs warnings for corrupt lines, continues processing. File-level errors caught separately (line 77-89). 0 lines skipped in production data confirms graceful handling. |
| 5 | Extension persists state across VS Code restarts using globalState | PARTIAL | usageStore.ts has complete save/load/clear implementation. saveUsageData() IS called in extension.ts (line 110). However, loadUsageData() is NEVER called -- the extension always does a full reparse on activation. |

**Score:** 3/5 truths fully verified, 1 partial, 1 requirement-level gap (CX-03)

### Required Artifacts

| Artifact | Expected | Exists | Substantive | Wired | Status |
|----------|----------|--------|-------------|-------|--------|
| src/types.ts | Domain types | YES (100 lines) | YES -- 8 interfaces/types, no stubs | YES -- imported by all modules | VERIFIED |
| src/parser/schemas.ts | Zod JSONL validation | YES (79 lines) | YES -- Zod schemas + parseAssistantMessage() | YES -- imported by jsonlParser.ts | VERIFIED |
| src/parser/jsonlParser.ts | Streaming parser | YES (143 lines) | YES -- readline streaming, per-line error recovery | YES -- called by extension.ts | VERIFIED |
| src/parser/tokenCounter.ts | Token extraction | YES (126 lines) | YES -- 5 exported functions | PARTIAL -- createEmptyAggregatedUsage/addToAggregation used; extractTokenUsage/getBillableTokenCount/getTotalTokens not imported | PARTIAL |
| src/pricing/pricingEngine.ts | Configurable pricing | YES (143 lines) | YES -- loadPricingFromConfig + calculateCost | YES -- both called in extension.ts | VERIFIED |
| src/pricing/plans.ts | Plan configs | YES (34 lines) | YES -- PLAN_CONFIGS + getPlanConfig | NO -- not imported or used by any module | ORPHANED |
| src/aggregation/timeBuckets.ts | Time bucket aggregation | YES (206 lines) | YES -- aggregate, merge, summary, serialize | YES -- called by extension.ts and usageStore.ts | VERIFIED |
| src/storage/usageStore.ts | globalState persistence | YES (117 lines) | YES -- save, load, clear | PARTIAL -- saveUsageData and clearUsageData called; loadUsageData never called | PARTIAL |
| src/extension.ts | Entry point wiring | YES (168 lines) | YES -- full pipeline | YES -- imports and calls parser, pricing, aggregation, store | VERIFIED |
| src/utils/paths.ts | File discovery | YES (82 lines) | YES -- cross-platform paths + nested dir handling | YES -- both functions used | VERIFIED |
| src/utils/logger.ts | Logging utility | YES (90 lines) | YES -- Logger class with OutputChannel | YES -- used by extension.ts, pricingEngine.ts, usageStore.ts | VERIFIED |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| extension.ts | jsonlParser.ts | parseAllSessions() | WIRED | Called at line 89; result used for cost calc and aggregation |
| extension.ts | pricingEngine.ts | loadPricingFromConfig() + calculateCost() | WIRED | Pricing loaded at line 99; cost applied per record at line 103 |
| extension.ts | timeBuckets.ts | aggregateUsage() + getTimeBucketSummary() | WIRED | Aggregation at line 107; summary at line 116 |
| extension.ts | usageStore.ts (save) | store.saveUsageData() | WIRED | Called at line 110 with buckets and stats |
| extension.ts | usageStore.ts (load) | store.loadUsageData() | NOT WIRED | loadUsageData() exists but is never called |
| extension.ts | plans.ts | getPlanConfig() or PLAN_CONFIGS | NOT WIRED | plans.ts is never imported; planType setting is never read |
| jsonlParser.ts | schemas.ts | parseAssistantMessage() | WIRED | Called per assistant message at line 53 |
| jsonlParser.ts | paths.ts | findAllSessionFiles() | WIRED | Called at line 109 |
| usageStore.ts | timeBuckets.ts | serialize/deserializeTimeBuckets() | WIRED | Used in save (line 45) and load (line 78) |
| timeBuckets.ts | tokenCounter.ts | createEmptyAggregatedUsage/addToAggregation | WIRED | Used throughout aggregateUsage() |

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| DP-04: Multiple JSONL format versions | SATISFIED | Zod schemas use .passthrough() and .optional().default(0) for forward/backward compat |
| DP-06: Aggregation distinguishing cached vs billable | SATISFIED | tokenCounter.ts separates billable from cached. AggregatedUsage tracks all four types separately. |
| TP-04: Configurable pricing tables | SATISFIED | pricingEngine.ts reads from vscode.workspace.getConfiguration. Overrides validated with Zod. |
| CX-03: Plan selection (Pro/Max5/Max20) | BLOCKED | plans.ts defines all three plans correctly but is never imported or used. planType setting never read. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/utils/paths.ts | 65, 71, 76 | console.warn/console.error instead of Logger | Warning | Inconsistent logging; messages go to dev console not OutputChannel |
| src/parser/jsonlParser.ts | 110-111 | require(path) and require(os) inline | Info | Works but inconsistent with other files using top-level imports |
| src/parser/schemas.ts | 73 | cost: 0 hardcoded | Info | Expected -- cost calculated separately by pricing engine |
| src/parser/tokenCounter.ts | 46 | cost: 0 hardcoded | Info | Expected -- same pattern as schemas.ts |

### Human Verification Required

### 1. Cost Accuracy Against Claude.ai Web UI

**Test:** Compare extension total cost ($243.70) against Claude.ai web billing page
**Expected:** Values should be within ~5% (cache timing differences are acceptable)
**Why human:** Extension calculates cost from JSONL token counts; only comparing with billing confirms accuracy

### 2. Status Bar Display After VS Code Restart

**Test:** Close and reopen VS Code. Observe whether usage data appears immediately or after full reparse.
**Expected:** Expect a loading delay on every restart while full reparse runs (loadUsageData never called)
**Why human:** Need to observe actual startup behavior and timing

### 3. Plan Type Setting Effect

**Test:** Change claude-usage.planType setting to pro or max20 and reload
**Expected:** Currently nothing changes (plans.ts is orphaned). This confirms the CX-03 gap.
**Why human:** Need to observe actual settings behavior

### Gaps Summary

Two gaps prevent full phase goal achievement:

**Gap 1: Persistence read is dead code (Truth #5 partial)**

UsageStore correctly saves data to globalState on every parse (confirmed at src/extension.ts line 110).
However, loadUsageData() is never called by extension.ts. Persistence WRITES work but the persisted
state is never READ back. Every VS Code restart triggers a full JSONL reparse of all 144 files.
The persistence infrastructure is complete and correct -- it just needs to be wired into the
activation flow.

Evidence:
- src/storage/usageStore.ts line 58: loadUsageData() defined with full deserialization logic
- src/extension.ts: grep for loadUsageData returns zero results
- src/extension.ts performInitialParse(): always calls parseAllSessions() unconditionally

**Gap 2: Plan selection is orphaned (CX-03 blocked)**

plans.ts defines Pro ($20), Max5 ($100), Max20 ($200) configs correctly. The package.json registers
a claude-usage.planType enum setting with three options. However, no code ever reads this setting
or imports plans.ts. Plan selection currently has zero functional effect on the extension behavior.

Evidence:
- src/pricing/plans.ts: exports getPlanConfig() and PLAN_CONFIGS
- grep for plans across src/: only hits within plans.ts itself
- grep for planType across src/: zero results
- package.json line 27-34: planType setting registered but unused

**Root cause analysis:** Both gaps share the same root cause -- the final wiring plan (01-04)
connected the main parsing pipeline (parser to pricing to aggregation to save) but missed two
secondary wirings: (1) loading persisted state before parsing, and (2) reading the plan type
setting. The primary pipeline works end-to-end as confirmed by human testing.

---

_Verified: 2026-02-07_
_Verifier: Claude (gsd-verifier)_
