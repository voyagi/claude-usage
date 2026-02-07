# Phase 4: Rate Limiting & Burn Rate - Research

**Researched:** 2026-02-07
**Domain:** Rate limiting, burn rate calculation, rolling time windows, VS Code extension configuration
**Confidence:** HIGH

## Summary

Phase 4 implements local rate limit tracking without API calls by computing proximity to three separate limits (5hr session, weekly total, weekly per-model) from token usage data already collected. The extension must track rolling time windows, calculate burn rate (tokens/min), predict time-until-limit, and warn users via status bar color changes. All calculations happen client-side using timestamps from JSONL files.

**Key Technical Challenges:**
1. **Three separate rolling windows** - Session (5hr), Weekly (ISO week), Weekly Sonnet (ISO week + model filter)
2. **Burn rate with idle gaps** - Must handle sporadic usage patterns without assuming continuous activity
3. **Auto-detection and learning** - Detect tier from credentials.json, learn actual limits from observed 429 errors
4. **Urgency-weighted color coding** - Session limit (hits sooner) weighs more than weekly limits

**Primary recommendation:** Use token bucket algorithm concepts for rolling windows, exponential moving average for burn rate smoothing, and VS Code's built-in theme colors (statusBarItem.warningBackground, statusBarItem.errorBackground) for three-tier thresholds. Watch credentials.json with VS Code FileSystemWatcher for tier changes. Parse 429 errors from JSONL to refine limit estimates over time.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| date-fns | 4.1.0 | Date manipulation, ISO week calculations | Already in project, handles ISO weeks correctly, tree-shakeable |
| VS Code API | 1.96.0 | Configuration, FileSystemWatcher, theme colors | Built-in to extension host |
| Zod | 3.24.0 | Schema validation for JSONL parsing | Already in project, type-safe parsing |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| N/A | - | - | All needed libraries already present |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| date-fns | Luxon | Luxon has better timezone support but adds 70KB; date-fns sufficient for UTC timestamps |
| VS Code FileSystemWatcher | chokidar | Chokidar is cross-platform Node.js lib but VS Code API is native and already available |
| Manual EMA calculation | moving-averages npm | Custom EMA is 10 lines of code; npm package adds dependency for trivial logic |

**Installation:**
```bash
# No new dependencies needed - all required libraries already in package.json
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── core/
│   ├── rateLimits.ts        # EXISTING - calculate limits from buckets
│   ├── burnRate.ts          # NEW - burn rate calculation with EMA smoothing
│   └── tierDetection.ts     # NEW - read credentials.json, auto-detect tier
├── ui/
│   ├── formatting.ts        # EXISTING - token/time/cost formatting
│   └── statusBar.ts         # EXISTING - dual status bar items
├── storage/
│   ├── usageStore.ts        # EXISTING - persist learned limits
│   └── credentialsWatcher.ts # NEW - watch ~/.claude/.credentials.json
└── types.ts                 # EXISTING - domain types
```

### Pattern 1: Rolling Time Window Tracking (Token Bucket Algorithm)

**What:** Track usage in a sliding window by filtering to entries with `lastMessage >= (now - windowDuration)`

**When to use:** For 5-hour session limit calculation

**Example:**
```typescript
// Source: Anthropic rate limit docs + token bucket algorithm
// https://platform.claude.com/docs/en/api/rate-limits

import { subHours } from 'date-fns';

function calculateSessionUsage(
  buckets: TimeBuckets,
  windowHours: number
): { tokens: number; oldestSessionTime: Date | null } {
  const now = new Date();
  const windowStart = subHours(now, windowHours);

  let sessionTokens = 0;
  let oldestTime: Date | null = null;

  // Filter sessions with activity in the rolling window
  for (const [sessionId, agg] of buckets.session.entries()) {
    if (agg.lastMessage && agg.lastMessage >= windowStart) {
      sessionTokens += agg.outputTokens; // Rate limits use OUTPUT tokens
      if (!oldestTime || (agg.firstMessage && agg.firstMessage < oldestTime)) {
        oldestTime = agg.firstMessage;
      }
    }
  }

  return { tokens: sessionTokens, oldestSessionTime: oldestTime };
}
```

**Reset time calculation:** Window resets when the oldest active session expires (firstMessage + 5 hours), not at a fixed clock time. This is a true rolling window.

### Pattern 2: ISO Week Aggregation

**What:** Aggregate tokens by ISO week (Monday-Sunday, per ISO 8601)

**When to use:** For weekly total and weekly Sonnet limits

**Example:**
```typescript
// Source: date-fns ISO week handling
// https://date-fns.org/

import { startOfWeek, format } from 'date-fns';

function getISOWeekKey(date: Date): string {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 }); // Monday = 1
  return format(weekStart, "yyyy-'W'II"); // e.g. "2026-W06"
}

function calculateWeeklyUsage(
  buckets: TimeBuckets
): { tokens: number; resetTime: Date } {
  const now = new Date();
  const weekKey = getISOWeekKey(now);
  const weekData = buckets.weekly.get(weekKey);

  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const resetTime = addDays(weekStart, 7); // Next Monday

  return {
    tokens: weekData?.outputTokens ?? 0,
    resetTime
  };
}
```

**Important:** ISO weeks can span year boundaries (e.g., 2026-W01 might include Dec 29-31, 2025). Use date-fns `startOfWeek` with `weekStartsOn: 1` to ensure Monday start.

### Pattern 3: Burn Rate with Exponential Moving Average

**What:** Calculate tokens/min from recent activity, smoothed with EMA to handle idle gaps

**When to use:** For predicting time-until-limit

**Example:**
```typescript
// Source: EMA calculation pattern
// https://medium.com/codex/calculating-the-exponential-moving-average-in-javascript-84dfea8d55cc

interface BurnRateTracker {
  ema: number;          // Current EMA value (tokens/min)
  lastUpdate: Date;     // Last calculation timestamp
  alpha: number;        // Smoothing factor (0.2 = 20% weight to new data)
}

function updateBurnRate(
  tracker: BurnRateTracker,
  recentTokens: number,
  recentMinutes: number
): number {
  if (recentMinutes === 0) return tracker.ema;

  const currentRate = recentTokens / recentMinutes;

  // EMA formula: EMA_new = alpha * current + (1 - alpha) * EMA_old
  const newEma = tracker.alpha * currentRate + (1 - tracker.alpha) * tracker.ema;

  return Math.max(0, newEma); // Floor at 0
}

function calculateBurnRate(buckets: TimeBuckets): number {
  const now = new Date();
  const lookbackMinutes = 15; // Configurable averaging window
  const lookbackStart = subMinutes(now, lookbackMinutes);

  let recentTokens = 0;
  let earliestTime: Date | null = null;

  for (const [sessionId, agg] of buckets.session.entries()) {
    if (agg.lastMessage && agg.lastMessage >= lookbackStart) {
      recentTokens += agg.outputTokens;
      if (agg.firstMessage && (!earliestTime || agg.firstMessage < earliestTime)) {
        earliestTime = agg.firstMessage;
      }
    }
  }

  if (recentTokens === 0 || !earliestTime) return 0;

  const minutesElapsed = differenceInMinutes(now, earliestTime);
  return minutesElapsed > 0 ? recentTokens / minutesElapsed : 0;
}
```

**Idle gap handling:** Use a lookback window (15-30 min) instead of "since last message". If no activity in lookback window, burn rate = 0. This prevents inflated rates from short bursts after long idle periods.

### Pattern 4: Tier Detection from credentials.json

**What:** Read `~/.claude/.credentials.json` to auto-detect plan tier

**When to use:** On extension activation and when file changes

**Example:**
```typescript
// Source: VS Code FileSystemWatcher API
// https://code.visualstudio.com/api/references/vscode-api

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

interface ClaudeCredentials {
  rateLimitTier?: string;      // "default_claude_max_5x"
  subscriptionType?: string;   // "max", "pro"
}

async function detectTier(): Promise<PlanType> {
  const credPath = path.join(os.homedir(), '.claude', '.credentials.json');

  try {
    const content = await fs.readFile(credPath, 'utf-8');
    const creds: ClaudeCredentials = JSON.parse(content);

    // Map credentials to plan type
    if (creds.rateLimitTier?.includes('max_20')) return 'max20';
    if (creds.rateLimitTier?.includes('max_5')) return 'max5';
    if (creds.subscriptionType === 'pro') return 'pro';

    // Fallback to user setting
    const config = vscode.workspace.getConfiguration('claude-usage');
    return config.get<PlanType>('planType', 'max5');
  } catch (error) {
    // File doesn't exist or parse error - use setting
    const config = vscode.workspace.getConfiguration('claude-usage');
    return config.get<PlanType>('planType', 'max5');
  }
}

function watchCredentials(context: vscode.ExtensionContext, onChange: () => void): void {
  const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
  const uri = vscode.Uri.file(credPath);

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(path.dirname(credPath), '.credentials.json')
  );

  watcher.onDidChange(() => onChange());
  watcher.onDidCreate(() => onChange());

  context.subscriptions.push(watcher);
}
```

**Mapping logic:** `rateLimitTier` contains strings like `"default_claude_max_5x"` or `"default_claude_pro"`. Parse the suffix to determine tier. If field is missing, fall back to VS Code setting.

### Pattern 5: Learning from 429 Errors in JSONL

**What:** Detect rate limit errors in JSONL files and refine limit estimates

**When to use:** During incremental JSONL parsing, when processing error messages

**Example:**
```typescript
// Source: Anthropic error response format
// https://platform.claude.com/docs/en/api/errors

interface RateLimitError {
  type: 'error';
  error: {
    type: 'rate_limit_error';
    message: string; // "Number of request tokens has exceeded your per-minute rate limit"
  };
  timestamp?: string;
}

function parseRateLimitEvent(line: string): { limitType: string; timestamp: Date } | null {
  try {
    const json = JSON.parse(line);

    if (json.type === 'error' && json.error?.type === 'rate_limit_error') {
      const message = json.error.message.toLowerCase();

      // Classify limit type from error message
      let limitType = 'unknown';
      if (message.includes('per-minute') || message.includes('rpm')) {
        limitType = 'session'; // Likely 5hr session limit
      } else if (message.includes('daily') || message.includes('weekly')) {
        limitType = 'weekly';
      } else if (message.includes('output token')) {
        limitType = 'output';
      }

      return {
        limitType,
        timestamp: json.timestamp ? new Date(json.timestamp) : new Date()
      };
    }

    return null;
  } catch {
    return null;
  }
}

function refineLimitEstimate(
  currentEstimate: number,
  observedUsage: number,
  limitType: string
): number {
  // When we hit a limit, we know the true limit is <= observedUsage
  // Refine estimate conservatively (95% of observed to account for timing)
  const observedLimit = Math.floor(observedUsage * 0.95);

  // Only adjust downward (tighter limits) to be conservative
  return Math.min(currentEstimate, observedLimit);
}
```

**Auto-learning strategy:** When a 429 error is observed, calculate total tokens consumed in the relevant window at that timestamp. The true limit is at or below that value. Silently update the internal estimate to 95% of observed usage (5% safety margin for timing uncertainty).

### Pattern 6: Urgency-Weighted Color Coding

**What:** Determine status bar color based on which limit is most urgent (soonest to hit)

**When to use:** When updating status bar colors

**Example:**
```typescript
// Source: VS Code theme colors
// https://code.visualstudio.com/api/references/theme-color

function calculateUrgencyScore(limit: RateLimitInfo, now: Date): number {
  const pct = limit.percentage;

  // Time factor: How soon will this limit reset?
  let timeFactor = 1.0;
  if (limit.resetTime) {
    const hoursUntilReset = differenceInHours(limit.resetTime, now);
    // Session (5hr) resets sooner, weekly resets later
    // Weight by 1 / sqrt(hoursUntilReset) so shorter windows weigh more
    timeFactor = 1 / Math.sqrt(Math.max(1, hoursUntilReset));
  }

  // Urgency = percentage * timeFactor
  // Session at 70% with 2hr reset: 70 * (1 / sqrt(2)) = 49.5
  // Weekly at 70% with 48hr reset: 70 * (1 / sqrt(48)) = 10.1
  return pct * timeFactor;
}

function selectColorTheme(limits: RateLimitStatus): vscode.ThemeColor | undefined {
  const now = new Date();

  const urgencies = [
    calculateUrgencyScore(limits.session5h, now),
    calculateUrgencyScore(limits.weekly, now),
    calculateUrgencyScore(limits.weeklySonnet, now)
  ];

  const maxUrgency = Math.max(...urgencies);
  const worstPercentage = limits.worstPercentage;

  // Three-tier thresholds from CONTEXT.md
  if (worstPercentage >= 95) {
    return new vscode.ThemeColor('statusBarItem.errorBackground');
  } else if (worstPercentage >= 60) {
    return new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    return undefined; // Default color
  }
}
```

**Decision rationale:** Session limits (5hr) hit sooner than weekly limits (7 days), so a session at 70% is more urgent than weekly at 70%. Weight by inverse square root of hours-until-reset to prioritize imminent limits.

### Pattern 7: Time-Until-Limit Prediction

**What:** Estimate how much time remains until hitting a limit based on current burn rate

**When to use:** For status bar tooltip and cooldown display

**Example:**
```typescript
function predictTimeUntilLimit(
  currentTokens: number,
  limitTokens: number,
  burnRatePerMin: number
): number | null {
  if (burnRatePerMin === 0) return null; // Idle, can't predict

  const remainingTokens = limitTokens - currentTokens;
  if (remainingTokens <= 0) return 0; // Already hit

  const minutesRemaining = remainingTokens / burnRatePerMin;
  return minutesRemaining;
}

function formatTimeUntilLimit(minutes: number | null): string {
  if (minutes === null) return '';
  if (minutes === 0) return 'LIMIT HIT';
  if (minutes < 60) return `~${Math.round(minutes)}m remaining`;

  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `~${hours}h ${mins}m remaining`;
}
```

**Accuracy notes:** Prediction assumes constant burn rate. Add disclaimer "at current pace" in tooltip. If burn rate is 0 (idle), don't show prediction (user isn't actively consuming tokens).

### Anti-Patterns to Avoid

- **Fixed window reset times:** Don't reset session limits at midnight or fixed intervals. Use true rolling windows based on `firstMessage` timestamp.
- **Including input tokens in rate limit calculations:** Claude API rate limits are primarily **output token** based. Input tokens (especially cached) don't count toward most limits.
- **Aggressive limit learning:** Don't immediately set limit to observed usage when hitting 429. Use 95% of observed with a safety margin.
- **Single color for all limits:** Don't just show worst percentage. Use urgency weighting so session limits (which hit sooner) drive color even if weekly is higher percentage.
- **Burn rate from all-time average:** Don't calculate burn rate from total tokens / total time. Use recent window (10-30 min) to reflect current usage pace.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Date/time calculations | Custom date math, manual ISO week logic | date-fns (already in project) | Edge cases with timezones, DST, ISO week boundaries are subtle and well-tested in date-fns |
| File watching | Polling credentials.json with setInterval | VS Code FileSystemWatcher API | Built-in, efficient, handles file system events natively, no CPU waste |
| Configuration validation | Manual JSON parsing and validation | VS Code configuration schema + Zod for JSONL | VS Code provides type-safe config API; Zod already in project for JSONL validation |
| Moving average | Custom weighted average logic | Simple EMA formula (10 lines) | EMA is trivial to implement; npm packages add dependency for no benefit |
| Theme colors | Hardcoded color strings (#FFA500) | VS Code ThemeColor API | Respects user's theme (light/dark/high-contrast), accessible, future-proof |

**Key insight:** VS Code extension API provides most infrastructure needed (FileSystemWatcher, configuration, theme colors). Don't rebuild what's already available.

## Common Pitfalls

### Pitfall 1: ISO Week Year Boundary Confusion

**What goes wrong:** Early January dates can belong to the previous year's last ISO week (e.g., Jan 1, 2026 is in 2025-W53)

**Why it happens:** ISO week 1 is the first week with a Thursday in the new year. Days before that belong to the previous year's last week.

**How to avoid:** Always use date-fns `startOfWeek` with `weekStartsOn: 1` and format with `"yyyy-'W'II"` (capital I for ISO week). Never manually calculate week numbers.

**Warning signs:** Weekly usage resets unexpectedly in early January, or shows duplicate weeks across year boundary.

### Pitfall 2: Burn Rate Inflation from Idle Gaps

**What goes wrong:** User makes 10K token request, then idles for 3 hours, then makes another 1K request. Burn rate calculates as 11K tokens / 180 min = 61 tokens/min, but this doesn't reflect current pace.

**Why it happens:** Using `firstMessage` to `lastMessage` span includes idle time where no tokens were consumed.

**How to avoid:** Use a fixed lookback window (e.g., last 15 minutes) instead of session duration. If no activity in lookback window, burn rate = 0.

**Warning signs:** Burn rate is non-zero but very low (<5 tokens/min) despite active usage, or burn rate doesn't drop to 0 when idle.

### Pitfall 3: Credentials File Not Found on Fresh Install

**What goes wrong:** Extension crashes or shows error when `~/.claude/.credentials.json` doesn't exist (e.g., user hasn't authenticated Claude Code yet)

**Why it happens:** Assuming file exists without try/catch, or not handling JSON parse errors gracefully.

**How to avoid:** Wrap file read in try/catch. If file doesn't exist or parse fails, fall back to VS Code setting. Don't block extension activation on credentials.json.

**Warning signs:** Extension fails to activate for users who haven't used Claude Code yet, or shows "file not found" errors in developer console.

### Pitfall 4: Rate Limit Estimates Too Aggressive

**What goes wrong:** User sees "95% of limit" warning but isn't actually rate limited. Extension's estimates are higher than actual limits.

**Why it happens:** Community-reported limits are estimates, not official values. Actual limits vary by tier and may change over time.

**How to avoid:** Ship conservative estimates (lower than community reports). When 429 errors are observed, refine estimates downward. Never claim "exact" limits—always say "estimated".

**Warning signs:** Users report hitting 95% warning but never see 429 errors, or hitting 429s when extension shows 70%.

### Pitfall 5: FileSystemWatcher Not Triggering on Windows

**What goes wrong:** Credentials.json changes but watcher doesn't fire onChange event on Windows with certain file systems (NTFS vs FAT32).

**Why it happens:** VS Code's FileSystemWatcher uses native OS events which behave differently across platforms and file systems.

**How to avoid:** Use VS Code's FileSystemWatcher (not Node.js `fs.watch`) for better cross-platform support. Test on Windows, macOS, and Linux. Add polling fallback if critical.

**Warning signs:** Tier changes not detected on Windows, watcher works on macOS but not Windows.

### Pitfall 6: Not Handling Multiple Models in Weekly Sonnet Limit

**What goes wrong:** Weekly Sonnet limit includes tokens from Haiku or Opus models.

**Why it happens:** Not filtering by model name when aggregating weekly model-specific usage.

**How to avoid:** When calculating weeklySonnet limit, filter `buckets.session` entries to only include sessions where `model` field contains "sonnet". Add per-model weekly buckets if needed.

**Warning signs:** Weekly Sonnet limit shows 100% but user only used Sonnet for 20% of weekly usage.

## Code Examples

Verified patterns from official sources:

### VS Code Configuration Schema (Contribution Points)

```typescript
// Source: VS Code Extension API - Configuration
// https://code.visualstudio.com/api/references/contribution-points#contributes.configuration

// In package.json contributes.configuration
{
  "claude-usage.rateLimits.session.threshold": {
    "type": "number",
    "default": 225000,
    "minimum": 1000,
    "description": "Estimated 5-hour session output token limit. Auto-detected from plan tier."
  },
  "claude-usage.rateLimits.weekly.threshold": {
    "type": "number",
    "default": 2500000,
    "minimum": 1000,
    "description": "Estimated weekly output token limit. Auto-detected from plan tier."
  },
  "claude-usage.rateLimits.weeklySonnet.threshold": {
    "type": "number",
    "default": 2500000,
    "minimum": 1000,
    "description": "Estimated weekly Sonnet model output token limit."
  },
  "claude-usage.rateLimits.warnings.yellow": {
    "type": "number",
    "default": 60,
    "minimum": 0,
    "maximum": 100,
    "description": "Yellow warning threshold (percentage)"
  },
  "claude-usage.rateLimits.warnings.red": {
    "type": "number",
    "default": 95,
    "minimum": 0,
    "maximum": 100,
    "description": "Red warning threshold (percentage)"
  },
  "claude-usage.rateLimits.burnRate.windowMinutes": {
    "type": "number",
    "default": 15,
    "minimum": 5,
    "maximum": 60,
    "description": "Lookback window for burn rate calculation (minutes)"
  }
}
```

### Reading Configuration with Overrides

```typescript
// Source: VS Code Settings API
// https://code.visualstudio.com/docs/configure/settings

import * as vscode from 'vscode';

function getRateLimitConfig(
  planType: PlanType,
  autoDetectedLimits: PlanConfig
): { session: number; weekly: number; weeklySonnet: number } {
  const config = vscode.workspace.getConfiguration('claude-usage.rateLimits');

  // User can override auto-detected limits
  const session = config.get<number>('session.threshold', autoDetectedLimits.sessionTokenLimit ?? 0);
  const weekly = config.get<number>('weekly.threshold', autoDetectedLimits.weeklyTokenLimit ?? 0);
  const weeklySonnet = config.get<number>('weeklySonnet.threshold', autoDetectedLimits.weeklySonnetLimit ?? 0);

  return { session, weekly, weeklySonnet };
}
```

### Status Bar Color and Tooltip

```typescript
// Source: VS Code Extension API - Status Bar
// https://code.visualstudio.com/api/ux-guidelines/status-bar

function updateStatusBarWithRateLimits(
  statusBar: vscode.StatusBarItem,
  rateLimits: RateLimitStatus,
  burnRate: number
): void {
  const worstPct = rateLimits.worstPercentage;

  // Set background color based on threshold
  if (worstPct >= 95) {
    statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  } else if (worstPct >= 60) {
    statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    statusBar.backgroundColor = undefined;
  }

  // Build tooltip with all three limits
  const tooltip = new vscode.MarkdownString();
  tooltip.appendMarkdown('**Rate Limits** _(estimated)_\n\n');

  for (const limit of [rateLimits.session5h, rateLimits.weekly, rateLimits.weeklySonnet]) {
    tooltip.appendMarkdown(
      `- ${limit.name}: ${limit.percentage}% ` +
      `(${formatTokensExact(limit.currentTokens)} / ${formatTokensExact(limit.estimatedLimit)})\n\n`
    );

    if (limit.resetTime) {
      tooltip.appendMarkdown(`  Resets: ${formatCooldown(limit.resetTime)}\n\n`);
    }
  }

  if (burnRate > 0) {
    const timeUntilSession = predictTimeUntilLimit(
      rateLimits.session5h.currentTokens,
      rateLimits.session5h.estimatedLimit,
      burnRate
    );
    if (timeUntilSession !== null) {
      tooltip.appendMarkdown(`\n**Burn Rate:** ${formatBurnRate(burnRate)}\n\n`);
      tooltip.appendMarkdown(`**Est. Time to Session Limit:** ${formatTimeUntilLimit(timeUntilSession)} _(at current pace)_\n\n`);
    }
  }

  statusBar.tooltip = tooltip;
}
```

### Parsing 429 Errors from JSONL

```typescript
// Source: Claude API Errors documentation
// https://platform.claude.com/docs/en/api/errors

import { z } from 'zod';

const RateLimitErrorSchema = z.object({
  type: z.literal('error'),
  error: z.object({
    type: z.literal('rate_limit_error'),
    message: z.string(),
  }),
  timestamp: z.string().datetime().optional(),
});

function parseRateLimitError(line: string): Date | null {
  try {
    const json = JSON.parse(line);
    const result = RateLimitErrorSchema.safeParse(json);

    if (result.success) {
      return result.data.timestamp ? new Date(result.data.timestamp) : new Date();
    }

    return null;
  } catch {
    return null;
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fixed window rate limiting | Token bucket (rolling window) | 2023+ | More accurate limit tracking, no boundary spikes |
| Single TPM limit | Separate ITPM/OTPM + cache-aware | Claude API 2024+ | Cached tokens don't count toward limits |
| Polling for file changes | FileSystemWatcher events | VS Code 1.0+ | Lower CPU usage, instant detection |
| Hardcoded tier limits | Auto-detect from credentials + learn from 429s | This phase | Accurate limits without user configuration |
| Simple average burn rate | EMA-smoothed with lookback window | Best practice 2025+ | Handles idle gaps, reflects current pace |

**Deprecated/outdated:**
- **Manual ISO week calculation:** date-fns handles edge cases (year boundaries, leap years) correctly
- **Combined input+output TPM limits:** Claude API uses separate ITPM/OTPM with cache-aware counting
- **Fixed midnight reset windows:** Token bucket algorithm uses continuous rolling windows

## Open Questions

Things that couldn't be fully resolved:

1. **Exact Claude Code subscription tier limits**
   - What we know: API limits are well-documented for API tiers (Tier 1-4), but Claude Code subscription plans (Pro $20/mo, Max 5x $100/mo, Max 20x $200/mo) may have different limits
   - What's unclear: Do Claude Code plans map 1:1 to API tiers, or are limits different?
   - Recommendation: Ship with community-estimated limits (Pro 45K/500K/500K, Max5 225K/2.5M/2.5M, Max20 900K/10M/10M output tokens), add auto-learning from observed 429s, allow user overrides

2. **5-hour session window: anchored or pure rolling?**
   - What we know: Claude API docs say "5-hour session" but don't specify if it's anchored to first message or truly rolling per-token
   - What's unclear: Does the window reset 5 hours after the *first* message in the session, or does each message extend the window?
   - Recommendation: Implement as "rolling based on oldest active session" - track sessions with `lastMessage >= now - 5hr`, reset when `firstMessage + 5hr` expires. This matches token bucket behavior.

3. **Model filtering for Weekly Sonnet limit**
   - What we know: There's a separate weekly per-model limit for Sonnet
   - What's unclear: Does "Sonnet" include all Sonnet versions (3.5, 4, 4.5), or is it per-version? Does it include Opus/Haiku?
   - Recommendation: Filter by model name containing "sonnet" (case-insensitive). Add per-model weekly buckets in TimeBuckets type if needed.

4. **Burn rate smoothing alpha value**
   - What we know: EMA requires an alpha (smoothing factor) between 0 and 1
   - What's unclear: What's the optimal alpha for token burn rate? Too high (0.8+) = jittery, too low (0.1) = slow to react
   - Recommendation: Start with alpha = 0.2 (20% weight to new data), make it configurable in settings for experimentation

5. **Credentials.json reliability across platforms**
   - What we know: File should exist at `~/.claude/.credentials.json` after Claude Code authentication
   - What's unclear: Does this path work on Windows (C:\Users\<name>\.claude\) and is the file always JSON?
   - Recommendation: Test on Windows/macOS/Linux, handle file-not-found gracefully, validate JSON schema with Zod

## Sources

### Primary (HIGH confidence)

- **Claude API Rate Limits:** https://platform.claude.com/docs/en/api/rate-limits
  - Token bucket algorithm, per-minute limits (RPM/ITPM/OTPM), cache-aware counting
- **Claude API Errors:** https://platform.claude.com/docs/en/api/errors
  - 429 error structure, rate_limit_error type, retry-after header
- **VS Code Theme Colors:** https://code.visualstudio.com/api/references/theme-color
  - statusBarItem.warningBackground, statusBarItem.errorBackground, theme color properties
- **VS Code Status Bar Guidelines:** https://code.visualstudio.com/api/ux-guidelines/status-bar
  - Best practices for colored backgrounds (use sparingly), short text labels
- **date-fns Documentation:** https://date-fns.org/
  - ISO week functions (startOfWeek, format with 'W'), date arithmetic

### Secondary (MEDIUM confidence)

- **Sliding Window Rate Limiting:** https://oneuptime.com/blog/post/2026-01-30-sliding-window-rate-limiting/view
  - Token bucket vs sliding window algorithms, best practices
- **API Rate Limit Handling (2026 Guide):** https://apistatuscheck.com/blog/how-to-handle-api-rate-limits
  - 429 handling, retry-after header, exponential backoff patterns
- **VS Code Extension Configuration:** https://code.visualstudio.com/api/references/contribution-points
  - Configuration schema, setting scopes (user/workspace), validation
- **EMA Calculation (JavaScript):** https://medium.com/codex/calculating-the-exponential-moving-average-in-javascript-84dfea8d55cc
  - EMA formula implementation, smoothing factor selection

### Tertiary (LOW confidence - community reports)

- **Claude Code plan limits (community estimates):** Not officially documented
  - Pro: 45K session / 500K weekly / 500K weekly Sonnet (output tokens)
  - Max 5x: 225K session / 2.5M weekly / 2.5M weekly Sonnet
  - Max 20x: 900K session / 10M weekly / 10M weekly Sonnet
  - **Recommendation:** Ship these as defaults, clearly mark as "estimated", allow overrides, auto-learn from 429s

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in project (date-fns, Zod, VS Code API)
- Architecture: HIGH - Patterns verified with official docs (VS Code API, Claude API, date-fns)
- Pitfalls: MEDIUM - Based on common issues reported in GitHub issues and VS Code extension best practices
- Tier detection: MEDIUM - credentials.json structure assumed from context, needs verification
- Limit values: LOW - Community estimates for Claude Code plans, not officially documented

**Research date:** 2026-02-07
**Valid until:** 2026-03-07 (30 days - stable domain, but Claude API limits may change)
