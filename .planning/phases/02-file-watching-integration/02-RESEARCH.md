# Phase 2: File Watching & Integration - Research

**Researched:** 2026-02-07
**Domain:** VS Code extension file watching, Node.js streaming I/O, cross-platform path handling
**Confidence:** HIGH

## Summary

Phase 2 builds on Phase 1's streaming JSONL parser to add real-time file watching across all Claude Code projects. The extension must monitor `~/.claude/projects/` for changes, detect new activity within 30-60 seconds, and handle incremental parsing without re-reading entire files.

**Key technical challenges:**
1. **Cross-platform file watching** - VS Code's FileSystemWatcher has platform-specific limitations (symbolic links not followed, network drives unreliable, Linux inotify handle exhaustion)
2. **Incremental parsing** - Must track file offsets to parse only new lines, avoiding re-parsing of entire files on each change
3. **Race condition handling** - Active sessions write incomplete JSON lines; parser must skip gracefully
4. **Resource management** - Watchers must be properly disposed in `deactivate()` to prevent memory leaks

**Primary recommendation:** Use VS Code's `workspace.createFileSystemWatcher()` with glob pattern `**/*.jsonl` on the projects directory, combined with file offset tracking in `globalState` to enable incremental reads. Dispose watchers in `deactivate()` to prevent memory leaks.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vscode.workspace.createFileSystemWatcher | VS Code API | File watching | Official VS Code extension API, handles platform differences |
| fs.createReadStream (Node.js) | Built-in | Incremental file reads | Already used in Phase 1, supports offset-based reads via `start` option |
| readline (Node.js) | Built-in | Line-by-line parsing | Already used in Phase 1, works with streams |
| os.homedir() (Node.js) | Built-in | Cross-platform home directory | Official Node.js API, handles Windows/macOS/Linux differences |
| path.join() (Node.js) | Built-in | Cross-platform path construction | Prevents string concatenation bugs across platforms |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ParcelWatcher | VS Code internal | Recursive watching | Used internally by VS Code, not directly accessible to extensions |
| fs.watch (Node.js) | Built-in | Non-recursive watching | Used internally by VS Code, prefer FileSystemWatcher API |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| workspace.createFileSystemWatcher | chokidar (npm) | Chokidar requires additional dependency, VS Code API is native and well-tested |
| Incremental offset tracking | Full file re-parsing | Re-parsing wastes CPU/memory, especially with large session histories |
| globalState for offsets | In-memory Map only | Loses position on reload, forces full re-parse on activation |

**Installation:**
```bash
# No additional dependencies needed - all APIs are VS Code built-in or Node.js built-in
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── watcher/             # File watching logic
│   ├── sessionWatcher.ts    # FileSystemWatcher setup and event handlers
│   └── offsetTracker.ts     # Track last-read position per file
├── parser/              # Existing JSONL parsing (Phase 1)
├── utils/               # Existing utilities (Phase 1)
└── extension.ts         # Wire watchers, dispose on deactivate
```

### Pattern 1: FileSystemWatcher Setup
**What:** Create a file watcher for all JSONL files in `~/.claude/projects/`
**When to use:** During extension `activate()` to monitor session files
**Example:**
```typescript
// Source: VS Code Extension API + File Watcher Internals Wiki
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

const projectsDir = path.join(os.homedir(), '.claude', 'projects');
const pattern = new vscode.RelativePattern(projectsDir, '**/*.jsonl');

const watcher = vscode.workspace.createFileSystemWatcher(
  pattern,
  false, // ignoreCreateEvents - watch for new files
  false, // ignoreChangeEvents - watch for modifications
  true   // ignoreDeleteEvents - don't care about deletions
);

// Handle file changes
watcher.onDidChange((uri) => {
  // Incremental parse logic here
});

watcher.onDidCreate((uri) => {
  // Parse new file from beginning
});

// CRITICAL: Dispose in deactivate()
context.subscriptions.push(watcher);
```

**Key insights from official docs:**
- Pattern with `**` triggers recursive watching via ParcelWatcher
- Respects `files.watcherExclude` setting (user can tune performance)
- Symbolic links NOT followed automatically (but unlikely in `.claude/projects/`)
- Events may be dropped on heavy I/O load (no 100% guarantee from OS)

### Pattern 2: Incremental File Parsing with Offset Tracking
**What:** Track byte offset per file to parse only new lines on change events
**When to use:** On `onDidChange` events to avoid re-parsing entire session history
**Example:**
```typescript
// Source: Node.js stream documentation + existing Phase 1 parser
import * as fs from 'fs';
import * as readline from 'readline';

interface FileOffset {
  filePath: string;
  lastByteOffset: number;
}

async function parseIncrementally(
  filePath: string,
  startOffset: number
): Promise<{ records: TokenUsage[]; newOffset: number }> {
  const records: TokenUsage[] = [];

  // Create stream starting from last read position
  const fileStream = fs.createReadStream(filePath, {
    encoding: 'utf8',
    start: startOffset,
  });

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let bytesRead = startOffset;

  for await (const line of rl) {
    bytesRead += Buffer.byteLength(line, 'utf8') + 1; // +1 for newline

    if (!line.trim()) continue;

    try {
      const parsed = JSON.parse(line);
      // ... existing Phase 1 parsing logic
      records.push(tokenUsage);
    } catch (err) {
      // Skip incomplete lines (active session writes)
      continue;
    }
  }

  return { records, newOffset: bytesRead };
}
```

**Critical details:**
- `createReadStream({ start: N })` resumes from byte offset N
- Track `bytesRead` manually (line length + 1 for `\n`)
- Store offsets in `ExtensionContext.globalState` for persistence across reloads

### Pattern 3: Cross-Platform Home Directory Resolution
**What:** Use `os.homedir()` with `path.join()` for all paths
**When to use:** Everywhere you construct paths to `~/.claude/projects/`
**Example:**
```typescript
// Source: Node.js os module documentation + cross-platform-node-guide
import * as path from 'path';
import * as os from 'os';

// ✅ CORRECT: Cross-platform
const projectsDir = path.join(os.homedir(), '.claude', 'projects');
// Returns: C:\Users\username\.claude\projects (Windows)
// Returns: /Users/username/.claude/projects (macOS)
// Returns: /home/username/.claude/projects (Linux)

// ❌ WRONG: Breaks on Windows
const projectsDir = os.homedir() + '/.claude/projects';
```

**Critical insights:**
- `os.homedir()` uses `$USERPROFILE` (Windows) or `$HOME` (POSIX) automatically
- `path.join()` uses correct separator (`\` on Windows, `/` on POSIX)
- **Never** concatenate paths with string `+` or template literals

### Pattern 4: Proper Watcher Disposal
**What:** Add watchers to `context.subscriptions` for automatic cleanup
**When to use:** Immediately after creating any `FileSystemWatcher`
**Example:**
```typescript
// Source: VS Code Extension API + memory leak prevention patterns
export function activate(context: vscode.ExtensionContext) {
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);

  // ✅ CORRECT: Auto-disposal on deactivate
  context.subscriptions.push(watcher);

  // Event handlers
  watcher.onDidChange((uri) => { /* ... */ });
}

export function deactivate() {
  // VS Code automatically calls dispose() on all subscriptions
  // No manual cleanup needed IF you used context.subscriptions.push()
}
```

**Critical insight from VS Code memory leak issues:**
- FileSystemWatcher has a `dispose()` method that MUST be called
- Creating many short-lived watchers without disposal causes memory leaks
- `context.subscriptions` provides automatic cleanup on extension deactivation

### Anti-Patterns to Avoid
- **String path concatenation:** Use `path.join()` instead of `+` or template literals (breaks on Windows)
- **Full file re-parsing on change:** Track offsets and read incrementally (wastes CPU/memory)
- **Ignoring disposal:** Always push watchers to `context.subscriptions` (memory leaks)
- **Watching with broad patterns:** Use specific `**/*.jsonl` pattern (reduces events, respects `files.watcherExclude`)
- **Assuming event delivery:** OS may drop events under heavy load (not 100% reliable, handle gracefully)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-platform file watching | Custom polling loop with `fs.watch` | `vscode.workspace.createFileSystemWatcher` | Handles platform differences (fsevents/inotify/ReadDirectoryChangesW), respects user settings |
| Home directory resolution | Parse `%USERPROFILE%` or `$HOME` manually | `os.homedir()` | Automatically chooses correct env var per platform, has fallback logic |
| Path construction | String concatenation with `/` | `path.join()` | Handles Windows `\` vs POSIX `/` automatically |
| Byte offset tracking for streams | Manual buffer position math | `fs.createReadStream({ start })` | Node.js handles complex offset logic internally |
| JSONL line parsing | Manual buffer splitting on `\n` | `readline.createInterface()` | Handles `\r\n` vs `\n`, partial lines, encoding |

**Key insight:** VS Code and Node.js provide battle-tested cross-platform abstractions. Custom implementations introduce subtle bugs (e.g., Windows drive letters, long path support, symbolic links, network shares).

## Common Pitfalls

### Pitfall 1: File Watcher Events May Be Dropped
**What goes wrong:** Extension assumes every file change triggers an event
**Why it happens:** OS file watchers provide no 100% delivery guarantee; heavy I/O can cause event loss
**How to avoid:**
- On extension activation, always perform full directory scan as baseline
- Treat file watching as "optimization" not "source of truth"
- Cache last-known state in `globalState` to detect drift
**Warning signs:** Users report stale data in status bar despite active Claude sessions

### Pitfall 2: Symbolic Links Not Followed
**What goes wrong:** Extension doesn't detect changes to files accessed via symlinks
**Why it happens:** VS Code FileSystemWatcher explicitly does NOT follow symbolic links automatically
**How to avoid:**
- Assume `~/.claude/projects/` is a real directory (symlinks unlikely here)
- If users report missing data, check if `.claude` is symlinked
- Document limitation if symlinks are unsupported
**Warning signs:** Data missing for users who symlink `.claude` directory

### Pitfall 3: Linux Inotify Handle Exhaustion
**What goes wrong:** Recursive watching fails on Linux with "too many open files" errors
**Why it happens:** Linux `inotify` has limited file handles; recursive watches consume many
**How to avoid:**
- VS Code shows notification when limit hit (user must increase `fs.inotify.max_user_watches`)
- Use specific patterns (`**/*.jsonl`) not broad recursive watches
- Trust VS Code to warn users, don't try to work around it
**Warning signs:** Extension stops watching on Linux, VS Code shows inotify warning

### Pitfall 4: Memory Leak from Undisposed Watchers
**What goes wrong:** Extension consumes increasing memory over time
**Why it happens:** FileSystemWatcher objects are not garbage collected until `dispose()` is called
**How to avoid:**
- ALWAYS push watchers to `context.subscriptions` immediately after creation
- Never create new watchers without disposing old ones
- Test by reloading window repeatedly and checking memory (Task Manager / Activity Monitor)
**Warning signs:** VS Code memory usage grows after each window reload

### Pitfall 5: Reading Beyond EOF Due to Stale Offsets
**What goes wrong:** Extension tries to read from byte offset beyond file size (crashes or returns empty)
**Why it happens:** File was truncated (rare) or offset cache is stale
**How to avoid:**
- Before incremental read, `fs.stat()` to check file size
- If `startOffset > fileSize`, reset to 0 (full re-parse)
- Log warning when this occurs (indicates unusual condition)
**Warning signs:** Extension shows no new data despite active sessions, logs show "start offset out of range" errors

### Pitfall 6: Incomplete JSON Lines from Active Writes
**What goes wrong:** Parser crashes on malformed JSON during active Claude sessions
**Why it happens:** File watcher fires mid-write; last line may be truncated JSON
**How to avoid:**
- Already handled in Phase 1 parser: `try/catch` around `JSON.parse()`
- Skip invalid lines with warning, continue parsing
- This is expected behavior, not an error
**Warning signs:** Parser errors logged but extension continues working (this is correct)

### Pitfall 7: Race Condition on File Create vs Change Events
**What goes wrong:** New file created, `onDidCreate` fires, then `onDidChange` fires immediately after
**Why it happens:** File creation and first write are separate OS events
**How to avoid:**
- Track "files seen" set to debounce duplicate parsing
- If `onDidChange` fires within 1 second of `onDidCreate`, skip (already parsed)
- Use `setTimeout` to debounce rapid events
**Warning signs:** Extension parses same file twice on new session creation, duplicate records in aggregation

## Code Examples

Verified patterns from official sources:

### FileSystemWatcher with Glob Pattern
```typescript
// Source: VS Code Extension API Reference
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

export function activate(context: vscode.ExtensionContext) {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  const pattern = new vscode.RelativePattern(projectsDir, '**/*.jsonl');

  const watcher = vscode.workspace.createFileSystemWatcher(
    pattern,
    false, // Watch create events
    false, // Watch change events
    true   // Ignore delete events
  );

  watcher.onDidCreate(async (uri) => {
    // New session file created - parse from beginning
    await parseSessionFile(uri.fsPath, 0);
  });

  watcher.onDidChange(async (uri) => {
    // Existing session file modified - incremental parse
    const lastOffset = await getLastOffset(uri.fsPath);
    await parseSessionFile(uri.fsPath, lastOffset);
  });

  // CRITICAL: Dispose on deactivate
  context.subscriptions.push(watcher);
}
```

### Incremental Parsing with Offset Tracking
```typescript
// Source: Node.js Stream Documentation + Phase 1 parser
import * as fs from 'fs';
import * as readline from 'readline';
import type { ExtensionContext } from 'vscode';

const OFFSET_KEY_PREFIX = 'fileOffset:';

async function getLastOffset(
  context: ExtensionContext,
  filePath: string
): Promise<number> {
  return context.globalState.get<number>(`${OFFSET_KEY_PREFIX}${filePath}`, 0);
}

async function setLastOffset(
  context: ExtensionContext,
  filePath: string,
  offset: number
): Promise<void> {
  await context.globalState.update(`${OFFSET_KEY_PREFIX}${filePath}`, offset);
}

async function parseIncrementally(
  context: ExtensionContext,
  filePath: string
): Promise<TokenUsage[]> {
  const startOffset = await getLastOffset(context, filePath);
  const records: TokenUsage[] = [];

  // Check if offset is valid (file may have been truncated)
  const stats = await fs.promises.stat(filePath);
  const actualStart = startOffset > stats.size ? 0 : startOffset;

  const fileStream = fs.createReadStream(filePath, {
    encoding: 'utf8',
    start: actualStart,
  });

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let bytesRead = actualStart;

  for await (const line of rl) {
    bytesRead += Buffer.byteLength(line, 'utf8') + 1; // +1 for \n

    if (!line.trim()) continue;

    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'assistant') {
        const tokenUsage = parseAssistantMessage(line);
        if (tokenUsage) {
          records.push(tokenUsage);
        }
      }
    } catch (err) {
      // Skip corrupt/incomplete lines (active sessions)
      continue;
    }
  }

  // Save new offset for next incremental read
  await setLastOffset(context, filePath, bytesRead);

  return records;
}
```

### Cross-Platform Path Resolution
```typescript
// Source: Node.js os and path modules documentation
import * as path from 'path';
import * as os from 'os';

// ✅ CORRECT: Works on Windows, macOS, Linux
function getClaudeProjectsDir(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

// ✅ CORRECT: Build file path
function getSessionFilePath(projectName: string, sessionId: string): string {
  const projectsDir = getClaudeProjectsDir();
  return path.join(projectsDir, projectName, `${sessionId}.jsonl`);
}

// ❌ WRONG: Breaks on Windows
function getBrokenPath(): string {
  return os.homedir() + '/.claude/projects'; // Uses / on Windows
}

// ❌ WRONG: Breaks on Windows
function getAnotherBrokenPath(): string {
  return `${os.homedir()}/.claude/projects`; // Uses / on Windows
}
```

### Debounced Event Handling
```typescript
// Source: Common VS Code extension patterns for event debouncing
const recentlyCreated = new Set<string>();

watcher.onDidCreate((uri) => {
  const filePath = uri.fsPath;
  recentlyCreated.add(filePath);

  // Remove from set after 1 second
  setTimeout(() => {
    recentlyCreated.delete(filePath);
  }, 1000);

  parseSessionFile(filePath, 0);
});

watcher.onDidChange((uri) => {
  const filePath = uri.fsPath;

  // Skip if created less than 1 second ago
  if (recentlyCreated.has(filePath)) {
    return;
  }

  const lastOffset = await getLastOffset(filePath);
  parseSessionFile(filePath, lastOffset);
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Polling with `setInterval` | FileSystemWatcher with native OS events | VS Code 1.0+ | More efficient, respects user settings, leverages ParcelWatcher |
| Full file re-parsing on change | Incremental parsing with byte offsets | Best practice since Node.js v0.10 | Massive CPU/memory savings for large session files |
| String path concatenation | `path.join()` for all paths | Node.js best practice since v0.4 | Eliminates Windows path bugs |
| Manual watcher disposal in `deactivate()` | `context.subscriptions.push()` for auto-disposal | VS Code 1.0+ | Prevents memory leaks from forgotten disposal |

**Deprecated/outdated:**
- **fs.watch() direct use in extensions**: VS Code provides FileSystemWatcher abstraction that handles platform quirks; using raw fs.watch() bypasses user settings and platform optimizations
- **Polling with setInterval**: Wastes CPU, batteries, and doesn't respect user's `files.watcherExclude` setting
- **Environment variable parsing (`process.env.HOME`, `process.env.USERPROFILE`)**: `os.homedir()` handles this with proper fallback logic

## Open Questions

1. **Optimal refresh interval for status bar updates**
   - What we know: File watcher fires events within ~1 second (varies by platform)
   - What's unclear: Should status bar update on every event, or debounce for N seconds?
   - Recommendation: Update immediately on change event (user expects real-time), but debounce rapid events (multiple files changing at once) with 500ms delay

2. **Handling deleted files with stale offset cache**
   - What we know: `globalState` stores offsets keyed by file path
   - What's unclear: What if file is deleted and recreated with same path?
   - Recommendation: On `onDidCreate`, reset offset to 0 (overwrite any stale cache)

3. **Discovery of new projects added after activation**
   - What we know: FileSystemWatcher pattern is `**/*.jsonl` - should catch new files
   - What's unclear: Does `**` pattern watch for new subdirectories created AFTER watcher starts?
   - Recommendation: Test and document behavior; if limitation exists, add manual "Refresh" command

4. **Performance with hundreds of projects**
   - What we know: ParcelWatcher is efficient, but watching 100+ projects may have overhead
   - What's unclear: At what scale does recursive watching become a problem?
   - Recommendation: Test with realistic workload (e.g., 50 projects, 200 sessions); trust VS Code's inotify warnings on Linux

## Sources

### Primary (HIGH confidence)
- [VS Code File Watcher Internals Wiki](https://github.com/microsoft/vscode/wiki/File-Watcher-Internals) - Implementation details, ParcelWatcher architecture
- [VS Code File Watcher Issues Wiki](https://github.com/microsoft/vscode/wiki/File-Watcher-Issues) - Known limitations, platform-specific behavior
- [Node.js Stream Documentation](https://nodejs.org/api/stream.html) - createReadStream, readline, backpressure handling
- [Node.js os.homedir() Documentation](https://nodejs.org/api/os.html) - Platform-specific home directory resolution

### Secondary (MEDIUM confidence)
- [VS Code Extension FileSystemWatcher API Search](https://www.tabnine.com/code/javascript/functions/vscode/createFileSystemWatcher) - Code examples from real extensions
- [Cross-Platform Node.js Guide](https://shapeshed.com/writing-cross-platform-node/) - Best practices for path handling
- [Node.js readline + createReadStream pattern](https://dhavalsoni9989.medium.com/working-with-jsonl-in-nodejs-513174a6ca6e) - JSONL streaming approach

### Tertiary (LOW confidence)
- WebSearch results for incremental parsing patterns - General patterns, not authoritative for VS Code
- WebSearch results for memory leak prevention - Confirmed by official VS Code memory leak issues

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All APIs are official VS Code/Node.js built-ins, verified via official docs
- Architecture: HIGH - Patterns verified against VS Code Extension API reference and Node.js documentation
- Pitfalls: MEDIUM-HIGH - Based on VS Code wiki documentation and known issues, cross-verified with GitHub issues

**Research date:** 2026-02-07
**Valid until:** ~30 days (VS Code API is stable, Node.js stream API unchanged since v10)
