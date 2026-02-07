---
phase: 04-rate-limiting-burn-rate
verified: 2026-02-07T17:30:00Z
status: passed
score: 6/6 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 4/6
  gaps_closed:
    - Extension learns actual rate limits from observed rate-limit events over time
    - Extension tracks weekly usage limits and shows proximity (per-model filtering)
  gaps_remaining: []
  regressions: []
---

# Phase 4: Rate Limiting & Burn Rate Verification Report

**Phase Goal:** User knows when they will hit rate limits and can plan usage accordingly
**Verified:** 2026-02-07T17:30:00Z
**Status:** passed
**Re-verification:** Yes -- after gap closure (plans 04-05 and 04-06)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Extension tracks 5-hour rolling window with accurate session start and expiry | VERIFIED | rateLimits.ts lines 28-50: subHours(now, 5) cutoff, iterates session buckets, sums outputTokens for sessions with lastMessage in window, calculates resetTime as addHours(oldestSessionTime, 5) |
| 2 | Extension calculates burn rate and predicts time until rate limit | VERIFIED | burnRate.ts lines 39-99: calculateBurnRateEMA with configurable alpha (default 0.2) and lookback window, predictTimeUntilLimit returns minutes remaining. statusBar.ts lines 131-138 displays prediction in tooltip via formatTimeUntilLimit |
| 3 | Extension warns user at configurable thresholds (75%, 80%, 90%) | VERIFIED | package.json lines 85-98 define yellow (default 60) and red (default 95) threshold settings. statusBar.ts lines 80-94 reads config and applies backgroundColor (warningBackground / errorBackground) |
| 4 | User can manually override rate limit settings if auto-detection is inaccurate | VERIFIED | package.json lines 67-84 expose session/weekly/weeklySonnet threshold overrides (0 = auto). extension.ts lines 50-63 use config.inspect() to detect user overrides |
| 5 | Extension tracks weekly usage limits and shows proximity | VERIFIED | rateLimits.ts lines 53-87: weekly general uses all-model outputTokens. Weekly Sonnet iterates buckets.modelWeekly filtering claude-sonnet entries (lines 70-76). timeBuckets.ts lines 55-60 populate modelWeekly. Per-model aggregation fully wired |
| 6 | Extension learns actual rate limits from observed rate-limit events over time | VERIFIED | incrementalParser.ts imports parseRateLimitEvent (line 9), detects error events (lines 96-101). sessionWatcher.ts onRateLimitEvent callback (lines 29, 51, 133-137). extension.ts handleRateLimitEvent (lines 89-123) calls refineLimitEstimate, persists to globalState, applies via effective-limit pattern in rateLimits.ts (lines 23-25) |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|--------|
| src/core/burnRate.ts | EMA burn rate tracker | VERIFIED | 131 lines, createBurnRateTracker, calculateBurnRateEMA, predictTimeUntilLimit. Imported in extension.ts |
| src/core/tierDetection.ts | Auto-detect plan from credentials | VERIFIED | 78 lines, parseCredentialsFile, detectTierFromCredentials. Imported by credentialsWatcher.ts |
| src/storage/credentialsWatcher.ts | Watch credentials for tier changes | VERIFIED | 137 lines, FileSystemWatcher on credentials.json, fires onTierChange. Used in extension.ts line 129 |
| src/parser/rateLimitDetector.ts | Parse 429 events from JSONL | VERIFIED | 100 lines, parseRateLimitEvent + refineLimitEstimate. Imported by incrementalParser.ts and extension.ts. No longer orphaned |
| src/core/rateLimits.ts | Urgency scoring and refined limits | VERIFIED | calculateUrgencyScore, calculateRateLimits with refinedLimits param, buildStatusBarData passes refinedLimits through |
| src/ui/formatting.ts | formatTimeUntilLimit | VERIFIED | Lines 112-133, handles null/0/sub-minute/hours+minutes. Imported by statusBar.ts |
| src/extension.ts | Full Phase 4 wiring with gap closures | VERIFIED | All components wired: credentials, burn rate, refined limits, rate limit events, reset cleanup |
| src/ui/statusBar.ts | Configurable thresholds and predictions | VERIFIED | Reads yellow/red config, shows prediction in tooltip, urgency scores per limit |
| package.json | Config schema | VERIFIED | 9 settings: session/weekly/weeklySonnet thresholds, yellow/red warnings, burnRate.windowMinutes |
| src/types.ts | RefinedLimits + modelWeekly | VERIFIED | RefinedLimits interface (lines 131-136), TimeBuckets.modelWeekly (line 44), backward compat in SerializedTimeBuckets |
| src/aggregation/timeBuckets.ts | Per-model weekly aggregation | VERIFIED | Populate, merge, serialize, deserialize all handle modelWeekly correctly |
| src/parser/incrementalParser.ts | Rate limit event detection | VERIFIED | Imports parseRateLimitEvent, detects error events before assistant filter, all returns include rateLimitEvents |
| src/watcher/sessionWatcher.ts | Rate limit event callback | VERIFIED | onRateLimitEvent callback, processed BEFORE early-return check for 429-only chunks |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|--------|
| extension.ts | credentialsWatcher.ts | new CredentialsWatcher | WIRED | Line 129 creates, line 159 starts, onTierChange updates detectedTier |
| extension.ts | burnRate.ts | createBurnRateTracker | WIRED | Line 126 creates, lines 138-139 calculate EMA in onUpdate |
| statusBar.ts | formatting.ts | formatTimeUntilLimit | WIRED | Line 17 imports, line 137 uses in tooltip |
| statusBar.ts | rateLimits.ts | calculateUrgencyScore | WIRED | Line 18 imports, line 113 calculates per limit |
| incrementalParser.ts | rateLimitDetector.ts | parseRateLimitEvent | WIRED | Line 9 imports, line 97 calls on error events |
| sessionWatcher.ts | extension.ts | onRateLimitEvent callback | WIRED | Constructor line 51 accepts, lines 133-137 invoke |
| extension.ts | rateLimitDetector.ts | refineLimitEstimate | WIRED | Line 22 imports, lines 94+105 call with observed tokens |
| extension.ts | rateLimits.ts | buildStatusBarData+refinedLimits | WIRED | Line 142 passes refinedLimits as 5th arg |
| rateLimits.ts | types.ts | RefinedLimits parameter | WIRED | Line 17 accepts, lines 23-25 use effective limits |
| timeBuckets.ts | types.ts | modelWeekly in TimeBuckets | WIRED | All CRUD paths handle modelWeekly field |
| rateLimits.ts | buckets | modelWeekly iteration | WIRED | Lines 71-76 filter for claude-sonnet model tokens |

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| RL-01: 5-hour rolling session window | SATISFIED | -- |
| RL-02: Auto-detect rate limits from 429 events | SATISFIED | Full pipeline wired |
| RL-03: Manual set/override rate limit thresholds | SATISFIED | package.json + config.inspect() |
| RL-04: Burn rate and time prediction | SATISFIED | EMA burn rate + formatTimeUntilLimit |
| RL-05: Weekly usage limits with proximity | SATISFIED | Weekly general + Sonnet per-model |
| RL-06: Proximity warnings at thresholds | SATISFIED | Yellow/red thresholds in settings |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/extension.ts | 201 | Placeholder comment for Phase 5 viewSummary | Info | Expected for future phase |

### Human Verification Required

#### 1. Status Bar Color Coding at Thresholds

**Test:** Set yellow threshold to 30% and red to 50%. Use Claude until tokens exceed these.
**Expected:** Status bar background changes to yellow at 30% and red at 50%.
**Why human:** Cannot verify visual theming programmatically.

#### 2. Burn Rate Prediction Accuracy

**Test:** Use Claude actively for 5+ minutes, check tooltip for Est Time to Session Limit.
**Expected:** Shows reasonable time estimate that decreases as usage continues.
**Why human:** Requires real-time usage to generate EMA data.

#### 3. Rate Limit Learning from Real 429 Events

**Test:** Continue using Claude until an actual rate_limit_error appears in JSONL.
**Expected:** Extension detects the 429, refines limit downward, adjusts percentage display.
**Why human:** Requires triggering an actual rate limit from Anthropic servers.

### Gaps Summary

No gaps remain. Both gaps from the initial verification have been closed:

**Gap 1 (Closed): Rate limit learning now wired.** The rateLimitDetector module is no longer orphaned. The full pipeline flows: JSONL error events detected in incrementalParser.ts (line 97), surfaced via onRateLimitEvent callback in sessionWatcher.ts (lines 133-137), handled in extension.ts (lines 89-123) where refineLimitEstimate adjusts limits downward, persisted in globalState (lines 78-80), and applied through the effective-limit pattern in rateLimits.ts (lines 23-25).

**Gap 2 (Closed): Weekly Sonnet limit now per-model.** The TODO comment is removed. timeBuckets.ts populates modelWeekly with composite keys (lines 55-60), and rateLimits.ts iterates modelWeekly entries filtering for claude-sonnet (lines 71-76) to compute weeklySonnetTokens separately from the general weekly total.

**Compilation:** TypeScript compiles cleanly with zero errors.
**Tests:** All 23 tests pass (tierDetection: 11, burnRate: 12).

---

_Verified: 2026-02-07T17:30:00Z_
_Verifier: Claude (gsd-verifier)_
