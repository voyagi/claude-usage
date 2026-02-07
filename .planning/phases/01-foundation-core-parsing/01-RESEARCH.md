# Phase 1: Foundation & Core Parsing - Research

**Researched:** 2026-02-07
**Domain:** VS Code Extension Development, JSONL Parsing, Token Usage Tracking
**Confidence:** HIGH (JSONL format), MEDIUM (VS Code APIs), LOW (Claude Max rate limits)

## Summary

This phase requires building a VS Code extension that parses Claude Code JSONL session files from `~/.claude/projects/` and calculates accurate token usage. The research confirms the technical feasibility and identifies the standard approaches.

**Key findings:**
- Claude Code stores sessions as JSONL files with a well-defined structure including `message.usage` fields containing token counts
- Each assistant message includes `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, and `cache_read_input_tokens`
- VS Code provides `globalState` API for persistence across sessions, guaranteed to be restored on activation
- Node.js readline with fs.createReadStream handles line-by-line JSONL parsing efficiently, working with actively-written files
- Cache tokens are billed differently: cache_creation at 1.25x-2x base rate, cache_read at 0.1x base rate (90% discount)
- Only uncached input tokens and cache creation count toward API rate limits; cached reads don't count

**Primary recommendation:** Use VS Code globalState for persistence, Node.js readline for streaming JSONL parsing, and match Claude's official token pricing structure exactly (cache_read at 10% of base input price).

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @types/vscode | ^1.96.0 | VS Code Extension API types | Official TypeScript definitions from Microsoft |
| typescript | ^5.7.0 | Type-safe development | Industry standard for VS Code extensions |
| esbuild | ^0.24.0 | Fast bundler | Official VS Code recommendation, minimal config |
| @types/node | ^22.10.0 | Node.js API types | Required for fs, path, readline, os modules |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | ^3.24.0 | Runtime JSON validation | HIGH confidence - validates JSONL structure at runtime |
| date-fns | ^4.1.0 | Date manipulation for time buckets | Standard for TypeScript date handling |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| globalState | workspaceState | workspaceState is per-workspace; usage tracking is account-wide |
| readline | stream-json | stream-json adds dependency for parsing we can do with JSON.parse per line |
| zod | Manual validation | Zod provides type inference and clear error messages vs manual checks |

**Installation:**
```bash
npm install --save-dev @types/vscode @types/node typescript esbuild
npm install zod date-fns
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── extension.ts           # Entry point, activation, deactivation
├── parser/
│   ├── jsonlParser.ts    # Line-by-line JSONL reading
│   ├── tokenCounter.ts   # Extract tokens from usage objects
│   └── schemas.ts        # Zod schemas for JSONL message types
├── storage/
│   ├── usageStore.ts     # globalState wrapper, data aggregation
│   └── types.ts          # TypeScript interfaces for usage data
└── utils/
    ├── paths.ts          # Cross-platform path handling
    └── logger.ts         # OutputChannel wrapper
```

### Pattern 1: Streaming JSONL Parser with Error Recovery
**What:** Read JSONL line-by-line using readline, parse each line independently, skip invalid lines
**When to use:** Parsing files actively being written, where truncation is expected

**Example:**
```typescript
// Source: https://nodejs.org/en/learn/manipulating-files/nodejs-file-paths
// Adapted from: https://shapeshed.com/writing-cross-platform-node/
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function parseSessionFile(sessionPath: string): Promise<TokenUsage[]> {
  const usageRecords: TokenUsage[] = [];

  const fileStream = fs.createReadStream(sessionPath, {
    encoding: 'utf8',
    // Don't lock the file - allow concurrent writes
  });

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity, // Handle both \r\n and \n
  });

  for await (const line of rl) {
    if (!line.trim()) continue; // Skip empty lines

    try {
      const message = JSON.parse(line);

      // Only process assistant messages with usage data
      if (message.type === 'assistant' && message.message?.usage) {
        usageRecords.push(extractTokenUsage(message));
      }
    } catch (err) {
      // Log but don't fail - truncated lines are expected
      console.warn(`Skipping invalid line: ${err.message}`);
      continue;
    }
  }

  return usageRecords;
}

function extractTokenUsage(message: any): TokenUsage {
  const usage = message.message.usage;
  return {
    timestamp: new Date(message.timestamp),
    model: message.message.model,
    sessionId: message.sessionId,
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    cacheCreationTokens: usage.cache_creation_input_tokens || 0,
    cacheReadTokens: usage.cache_read_input_tokens || 0,
  };
}
```

### Pattern 2: Cross-Platform Path Construction
**What:** Use `path.join()` with `os.homedir()` to construct paths to Claude Code directories
**When to use:** Always, for all file system operations

**Example:**
```typescript
// Source: https://shapeshed.com/writing-cross-platform-node/
import * as path from 'path';
import * as os from 'os';

function getClaudeProjectsDir(): string {
  // ALWAYS use path.join, NEVER string concatenation
  return path.join(os.homedir(), '.claude', 'projects');
}

function getSessionFile(projectDir: string, sessionId: string): string {
  return path.join(projectDir, `${sessionId}.jsonl`);
}

// Find all JSONL files in projects directory
async function findAllSessionFiles(): Promise<string[]> {
  const projectsDir = getClaudeProjectsDir();
  const projectDirs = await fs.promises.readdir(projectsDir, { withFileTypes: true });

  const sessionFiles: string[] = [];

  for (const dir of projectDirs) {
    if (!dir.isDirectory()) continue;

    const projectPath = path.join(projectsDir, dir.name);
    const files = await fs.promises.readdir(projectPath);

    for (const file of files) {
      if (file.endsWith('.jsonl')) {
        sessionFiles.push(path.join(projectPath, file));
      }
    }
  }

  return sessionFiles;
}
```

### Pattern 3: VS Code globalState Persistence
**What:** Store aggregated usage data in globalState, which VS Code persists in SQLite
**When to use:** Extension needs data to survive VS Code restarts

**Example:**
```typescript
// Source: https://code.visualstudio.com/api/extension-capabilities/common-capabilities
import * as vscode from 'vscode';

class UsageStore {
  constructor(private context: vscode.ExtensionContext) {}

  async saveUsageData(data: AggregatedUsage): Promise<void> {
    await this.context.globalState.update('claudeUsage', data);
  }

  async loadUsageData(): Promise<AggregatedUsage | undefined> {
    return this.context.globalState.get<AggregatedUsage>('claudeUsage');
  }

  async clearUsageData(): Promise<void> {
    await this.context.globalState.update('claudeUsage', undefined);
  }

  // Get all stored keys (useful for debugging)
  getAllKeys(): readonly string[] {
    return this.context.globalState.keys();
  }
}

// Register a command to clear data
function registerClearCommand(context: vscode.ExtensionContext, store: UsageStore) {
  const disposable = vscode.commands.registerCommand(
    'claude-usage.clearData',
    async () => {
      await store.clearUsageData();
      vscode.window.showInformationMessage('Usage data cleared');
    }
  );

  context.subscriptions.push(disposable);
}
```

### Pattern 4: Token Cost Calculation
**What:** Calculate billable cost based on Claude's pricing structure with cache multipliers
**When to use:** Converting token counts to dollar amounts

**Example:**
```typescript
// Source: https://platform.claude.com/docs/en/about-claude/pricing
interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cache5mWriteMultiplier: number; // 1.25
  cache1hWriteMultiplier: number; // 2.0
  cacheReadMultiplier: number;    // 0.1
}

const PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-6': {
    inputPerMillion: 5.00,
    outputPerMillion: 25.00,
    cache5mWriteMultiplier: 1.25,
    cache1hWriteMultiplier: 2.0,
    cacheReadMultiplier: 0.1,
  },
  'claude-sonnet-4-5': {
    inputPerMillion: 3.00,
    outputPerMillion: 15.00,
    cache5mWriteMultiplier: 1.25,
    cache1hWriteMultiplier: 2.0,
    cacheReadMultiplier: 0.1,
  },
};

function calculateCost(usage: TokenUsage, cacheType: '5m' | '1h' = '5m'): number {
  const pricing = PRICING[usage.model];
  if (!pricing) {
    throw new Error(`Unknown model: ${usage.model}`);
  }

  const multiplier = cacheType === '5m'
    ? pricing.cache5mWriteMultiplier
    : pricing.cache1hWriteMultiplier;

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;
  const cacheWriteCost = (usage.cacheCreationTokens / 1_000_000) * pricing.inputPerMillion * multiplier;
  const cacheReadCost = (usage.cacheReadTokens / 1_000_000) * pricing.inputPerMillion * pricing.cacheReadMultiplier;

  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

// What counts as "billable" for rate limiting?
function getBillableTokenCount(usage: TokenUsage): number {
  // Source: https://platform.claude.com/docs/en/api/rate-limits
  // Only uncached input + cache creation count toward rate limits
  // cache_read_input_tokens do NOT count (for most models)
  return usage.inputTokens + usage.cacheCreationTokens;
}
```

### Anti-Patterns to Avoid
- **Don't lock files during reads:** Claude Code writes JSONL files concurrently; use streaming reads without exclusive locks
- **Don't fail on first parse error:** Truncated lines are expected during active sessions; skip and continue
- **Don't hardcode path separators:** Use `path.join()` instead of string concatenation with `/` or `\\`
- **Don't assume all messages have usage:** Only `type: "assistant"` messages contain `message.usage` fields
- **Don't ignore cache tokens in cost calculations:** They're billed differently but still cost money

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON validation | Manual property checks with typeof | `zod` | Type inference, clear errors, handles nested objects, validates at runtime |
| Date manipulation | String parsing and math | `date-fns` | Handles timezones, DST, edge cases in date arithmetic |
| Path construction | String concatenation | `path.join()`, `path.normalize()` | Cross-platform separator handling, relative path resolution |
| Home directory | Environment variables like $HOME | `os.homedir()` | Works across Windows/Mac/Linux, handles edge cases |
| Streaming large files | Loading entire file with readFileSync | `readline` + `createReadStream` | Memory-efficient, works with files being written |

**Key insight:** JSONL parsing looks trivial (split by newline, JSON.parse each line) but handling concurrent writes, truncated lines, and cross-platform paths has edge cases. Use established Node.js APIs instead of reinventing.

## Common Pitfalls

### Pitfall 1: Counting All Tokens Toward Rate Limits
**What goes wrong:** Treating all token types equally when checking against rate limits
**Why it happens:** Intuition suggests all tokens count, but Claude's rate limiting is cache-aware
**How to avoid:** Only count `input_tokens + cache_creation_input_tokens` toward rate limits; `cache_read_input_tokens` are excluded (for most models)
**Warning signs:** Rate limit estimates don't match actual Claude Console usage; predicted limits much lower than reality

### Pitfall 2: File Locking on Concurrent Reads
**What goes wrong:** Using exclusive file locks or modes that prevent Claude Code from writing
**Why it happens:** Default file reading patterns in many languages use exclusive access
**How to avoid:** Use `fs.createReadStream()` without exclusive locks; it allows concurrent reads/writes
**Warning signs:** Claude Code sessions freeze or error when extension is active; "file in use" errors

### Pitfall 3: JSON.parse Without Try-Catch
**What goes wrong:** Extension crashes when encountering truncated lines in active session files
**Why it happens:** Claude Code writes JSONL incrementally; last line may be incomplete
**How to avoid:** Wrap JSON.parse in try-catch, log warning, continue to next line
**Warning signs:** Extension crashes during active Claude Code sessions but works on old/complete files

### Pitfall 4: Assuming Consistent Message Structure
**What goes wrong:** Extension errors when encountering unknown message types or missing fields
**Why it happens:** Claude Code's JSONL format includes many message types (user, assistant, progress, tool_use, etc.)
**How to avoid:** Check `message.type === 'assistant'` and `message.message?.usage` exists before accessing usage fields
**Warning signs:** Extension works for some sessions but crashes on others; TypeScript errors about undefined properties

### Pitfall 5: Hardcoded Windows Paths
**What goes wrong:** Paths like `C:\Users\...` or string concatenation with `\` fail on macOS/Linux
**Why it happens:** Development on Windows without testing cross-platform
**How to avoid:** Always use `path.join(os.homedir(), '.claude', 'projects')` instead of hardcoded paths
**Warning signs:** Works on Windows but fails on macOS/Linux; errors about invalid paths

### Pitfall 6: Ignoring Subagent JSONL Files
**What goes wrong:** Token usage undercounted because subagent files in subdirectories are missed
**Why it happens:** Only reading top-level `*.jsonl` files, not recursing into session subdirectories
**How to avoid:** Scan for `{sessionId}/subagents/*.jsonl` files in addition to `{sessionId}.jsonl`
**Warning signs:** Usage totals lower than expected; discrepancy with Claude Console numbers

### Pitfall 7: Incorrect Cache Token Billing
**What goes wrong:** Calculating cache tokens at base input price instead of discounted 10% rate
**Why it happens:** Misunderstanding cache pricing multipliers
**How to avoid:** `cache_read_input_tokens` cost 0.1x base input price, `cache_creation_input_tokens` cost 1.25x (5m) or 2x (1h)
**Warning signs:** Cost calculations much higher than actual Claude Console billing

## Code Examples

Verified patterns from official sources:

### JSONL Message Structure (Actual Claude Code Format)
```typescript
// Source: Examined actual JSONL from ~/.claude/projects/
interface ClaudeMessage {
  type: 'assistant' | 'user' | 'progress' | 'tool_result' | 'queue-operation' | string;
  timestamp: string; // ISO 8601: "2026-02-06T23:52:12.381Z"
  sessionId: string; // UUID: "43a62d99-7775-493c-863f-84d1c15e1986"
  uuid: string;
  parentUuid: string | null;

  // Only present for type === 'assistant'
  message?: {
    model: string; // e.g., "claude-opus-4-6", "claude-sonnet-4-5"
    id: string;
    role: 'assistant';
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
      cache_creation?: {
        ephemeral_5m_input_tokens: number;
        ephemeral_1h_input_tokens: number;
      };
      service_tier?: string;
      inference_geo?: string;
    };
  };
}
```

### Zod Schema for Runtime Validation
```typescript
// Source: https://betterstack.com/community/guides/scaling-nodejs/typescript-json-type-safety/
import { z } from 'zod';

const UsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_creation_input_tokens: z.number().int().nonnegative().optional().default(0),
  cache_read_input_tokens: z.number().int().nonnegative().optional().default(0),
});

const AssistantMessageSchema = z.object({
  type: z.literal('assistant'),
  timestamp: z.string().datetime(),
  sessionId: z.string().uuid(),
  message: z.object({
    model: z.string(),
    usage: UsageSchema.optional(),
  }).optional(),
});

// Usage:
function parseAssistantMessage(line: string): TokenUsage | null {
  try {
    const parsed = JSON.parse(line);
    const validated = AssistantMessageSchema.parse(parsed);

    if (!validated.message?.usage) return null;

    return {
      timestamp: new Date(validated.timestamp),
      model: validated.message.model,
      sessionId: validated.sessionId,
      ...validated.message.usage,
    };
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.warn('Schema validation failed:', err.errors);
    }
    return null;
  }
}
```

### Time Bucket Aggregation
```typescript
// Source: https://date-fns.org/docs/
import { startOfDay, startOfWeek, startOfMonth, format } from 'date-fns';

interface TimeBuckets {
  session: Map<string, SessionUsage>; // sessionId -> usage
  daily: Map<string, DailyUsage>;     // YYYY-MM-DD -> usage
  weekly: Map<string, WeeklyUsage>;   // YYYY-Www -> usage
  monthly: Map<string, MonthlyUsage>; // YYYY-MM -> usage
}

function aggregateUsage(records: TokenUsage[]): TimeBuckets {
  const buckets: TimeBuckets = {
    session: new Map(),
    daily: new Map(),
    weekly: new Map(),
    monthly: new Map(),
  };

  for (const record of records) {
    // Session bucket
    const sessionKey = record.sessionId;
    if (!buckets.session.has(sessionKey)) {
      buckets.session.set(sessionKey, createEmptyUsage());
    }
    addUsage(buckets.session.get(sessionKey)!, record);

    // Daily bucket (calendar day in local timezone)
    const dayKey = format(startOfDay(record.timestamp), 'yyyy-MM-dd');
    if (!buckets.daily.has(dayKey)) {
      buckets.daily.set(dayKey, createEmptyUsage());
    }
    addUsage(buckets.daily.get(dayKey)!, record);

    // Weekly bucket (ISO week starting Monday)
    const weekKey = format(startOfWeek(record.timestamp, { weekStartsOn: 1 }), 'yyyy-\'W\'II');
    if (!buckets.weekly.has(weekKey)) {
      buckets.weekly.set(weekKey, createEmptyUsage());
    }
    addUsage(buckets.weekly.get(weekKey)!, record);

    // Monthly bucket (calendar month)
    const monthKey = format(startOfMonth(record.timestamp), 'yyyy-MM');
    if (!buckets.monthly.has(monthKey)) {
      buckets.monthly.set(monthKey, createEmptyUsage());
    }
    addUsage(buckets.monthly.get(monthKey)!, record);
  }

  return buckets;
}

function addUsage(target: AggregatedUsage, source: TokenUsage): void {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.cacheCreationTokens += source.cacheCreationTokens;
  target.cacheReadTokens += source.cacheReadTokens;
  target.totalCost += calculateCost(source);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Webpack bundler | esbuild | VS Code 1.61+ | 10-100x faster builds, simpler config |
| Manual JSON validation | Zod/TypeBox schemas | TypeScript 3.7+ | Runtime type safety, automatic inference |
| Organization-level cache isolation | Workspace-level cache isolation | Feb 5, 2026 | Cache tokens now isolated per workspace |
| Combined TPM rate limits | Cache-aware ITPM limits | Claude 4.x models | Cached reads don't count toward rate limits |
| Claude Opus 4.1 at $15/$75 per MTok | Claude Opus 4.6 at $5/$25 per MTok | Jan 2026 | 67% cost reduction |

**Deprecated/outdated:**
- Claude Sonnet 3.7: Still works but cache_read tokens count toward rate limits (marked with †)
- Claude Opus 3: Deprecated, higher pricing, less capable
- Organization-level prompt caching: As of Feb 5, 2026, caches are workspace-isolated

## Open Questions

Things that couldn't be fully resolved:

1. **Claude Max Plan Token Limits**
   - What we know: Max plans have weekly limits that reset every 7 days; there are Max 5x and Max 20x tiers
   - What's unclear: Exact token-per-minute or tokens-per-week numbers for $100/month and $200/month plans
   - Recommendation: AUTO-LEARN limits from user's actual rate limit errors; provide manual override in settings

2. **Session Definition**
   - What we know: Each JSONL file represents one session; sessions have UUIDs
   - What's unclear: What constitutes session "end"? Is it when user closes terminal, after timeout, or explicit end marker?
   - Recommendation: Treat each JSONL file as complete session; aggregate by sessionId

3. **Cache Type Detection (5-minute vs 1-hour)**
   - What we know: JSONL has `cache_creation.ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens` fields
   - What's unclear: Should extension calculate cost based on detected cache type or default to 5-minute?
   - Recommendation: Use detected cache type from `cache_creation` field; default to 5-minute if missing

4. **Subagent Token Attribution**
   - What we know: Subagents create `{sessionId}/subagents/agent-*.jsonl` files with their own usage
   - What's unclear: Should subagent tokens roll up into parent session, or be tracked separately?
   - Recommendation: Roll up into parent session for daily/weekly/monthly totals; keep separate for session-level breakdown

## Sources

### Primary (HIGH confidence)
- [VS Code Extension API - Common Capabilities](https://code.visualstudio.com/api/extension-capabilities/common-capabilities) - globalState persistence, storage mechanisms
- [Claude API Pricing](https://platform.claude.com/docs/en/about-claude/pricing) - Token costs, cache multipliers, batch discounts
- [Claude API Rate Limits](https://platform.claude.com/docs/en/api/rate-limits) - Cache-aware rate limiting, ITPM/OTPM definitions
- [Node.js File Paths](https://nodejs.org/en/learn/manipulating-files/nodejs-file-paths) - path module, cross-platform handling
- Actual JSONL examination: ~/.claude/projects/c--Users-Eagi-claude-usage/*.jsonl

### Secondary (MEDIUM confidence)
- [VS Code Extension Bundling](https://code.visualstudio.com/api/working-with-extensions/bundling-extension) - esbuild setup
- [Building VS Code Extensions in 2026](https://abdulkadersafi.com/blog/building-vs-code-extensions-in-2026-the-complete-modern-guide) - Modern patterns
- [Writing cross-platform Node.js](https://shapeshed.com/writing-cross-platform-node/) - Path handling best practices
- [Type-Safe JSON in TypeScript](https://betterstack.com/community/guides/scaling-nodejs/typescript-json-type-safety/) - Zod validation patterns
- [Working with JSONL in NodeJS](https://dhavalsoni9989.medium.com/working-with-jsonl-in-nodejs-513174a6ca6e) - Streaming patterns

### Tertiary (LOW confidence)
- [Claude Code Limits Explained](https://www.truefoundry.com/blog/claude-code-limits-explained) - Max plan limits (not officially documented)
- [Everything We Know About Claude Code Limits](https://portkey.ai/blog/claude-code-limits/) - Rate limit speculation
- [Understanding Claude Code Sessions](http://www.bricoleur.org/2025/05/understanding-claude-code-sessions.html?m=1) - Community observations

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries are well-documented, officially recommended, or industry standard
- Architecture: HIGH - Patterns verified against official documentation and actual JSONL files
- JSONL format: HIGH - Examined actual files from Claude Code 2.1.34
- Token pricing: HIGH - Official Anthropic documentation
- Rate limits (API): HIGH - Official Anthropic documentation
- Rate limits (Max plan): LOW - Not publicly documented; must be learned from usage
- Pitfalls: MEDIUM - Based on common Node.js/TypeScript mistakes and actual JSONL structure

**Research date:** 2026-02-07
**Valid until:** 2026-03-07 (30 days - stable domain, but Claude pricing/models may update)
