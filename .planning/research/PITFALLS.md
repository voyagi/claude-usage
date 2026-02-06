# Domain Pitfalls: VS Code Extension for Claude Code JSONL Monitoring

**Domain:** VS Code Extension + JSONL File Parsing + File Watching
**Researched:** 2026-02-07
**Confidence:** MEDIUM-HIGH

## Critical Pitfalls

Mistakes that cause rewrites, data corruption, or major user-facing issues.

### Pitfall 1: Reading Actively-Written JSONL Files (Race Condition)

**What goes wrong:** Extension reads a JSONL file while Claude Code is writing to it mid-line. Your parser hits an incomplete JSON object, crashes, reports wrong token counts, or corrupts state.

**Why it happens:** JSONL files grow by appending new lines. No file lock prevents reads during writes. Node.js `fs.readFile()` doesn't coordinate with another process's `fs.appendFile()`.

**Consequences:**
- JSON.parse() throws on incomplete line: `"Unexpected end of JSON input"`
- Token counts become inaccurate (missing the last message)
- File watcher triggers mid-write, causing multiple parsing attempts
- User sees flickering/wrong numbers in status bar

**Prevention:**
- Read line-by-line and wrap each `JSON.parse()` in try-catch. Skip unparseable lines (likely incomplete).
- Detect incomplete writes: if last line doesn't end with `\n`, ignore it (partial write).
- Add 50-100ms debounce on file watcher events before parsing (let write finish).
- When parsing fails on last line specifically, retry after delay (don't fail entire file).

**Detection:**
- Parse errors only on last line of file (not earlier lines)
- Intermittent failures that resolve on retry
- Token counts that jump backwards then forwards

**Phase impact:** Core MVP (Phase 1). Must handle this from day one.

---

### Pitfall 2: Activating Extension on Startup (Performance Killer)

**What goes wrong:** Extension activates at VS Code startup, scans all `.claude` directories, parses hundreds of JSONL files, blocks extension host for 5+ seconds. Users complain about slow startup. VS Code warns your extension is a performance problem.

**Why it happens:** `package.json` activation event is `*` or `onStartupFinished`. Research shows if extension takes >500ms to activate, it's a performance issue. A cold activation scanning large JSONL files can take seconds.

**Consequences:**
- VS Code startup slows down noticeably
- Extension host blocks, freezing other extensions temporarily
- Users uninstall your extension due to performance complaints
- VS Code marketplace flags extension as poorly performing

**Prevention:**
- Use lazy activation events: `onCommand`, `onView`, `onFileSystem`, NOT `*` or `onStartupFinished`.
- Only activate when user opens Command Palette command OR when `.claude` directory is detected.
- Defer initial scan: activate fast (register commands only), scan JSONL files on first status bar click.
- If you must scan on startup, do it incrementally in chunks with `setImmediate()` to yield to event loop.
- Bundle and minify your extension with webpack/esbuild (unbundled extensions load slowly).

**Detection:**
- Run `Developer: Startup Performance` in VS Code Command Palette
- Activation time >500ms = red flag
- User reports of slow startup after installing extension

**Phase impact:** Phase 1 (MVP architecture). Wrong activation event bakes in performance problems from day one.

---

### Pitfall 3: Memory Leaks from File Watcher Accumulation

**What goes wrong:** Extension creates file watchers but never disposes them. Each new session creates a new watcher. After 50+ Claude Code sessions, extension has hundreds of active watchers, consuming hundreds of MBs of RAM. Extension host crashes with heap out of memory.

**Why it happens:** `vscode.workspace.createFileSystemWatcher()` returns a `Disposable` that must be explicitly disposed. Extensions often create watchers but forget to call `.dispose()` when sessions end or when extension deactivates.

**Consequences:**
- Linear RAM growth: ~227 KB heap + ~400 MB process RAM per leaked session (per VS Code memory leak patterns)
- 20 sessions = 8 GB RAM; 50 sessions = 20 GB RAM
- Extension host crashes with "JavaScript heap out of memory"
- System slowdown, VS Code becomes unresponsive

**Prevention:**
- Store all watcher `Disposable` objects in an array or `vscode.Disposable` collection.
- Call `.dispose()` on all watchers when extension deactivates (in `deactivate()` function).
- Use `context.subscriptions.push(watcher)` to auto-dispose watchers when extension deactivates.
- Limit number of active watchers: watch only CURRENT session file, not all historical sessions.
- For historical sessions, poll on-demand when user requests data (don't maintain active watchers).

**Detection:**
- VS Code extension host process grows unbounded over hours/days
- Heap snapshots show accumulating watcher instances
- Extension becomes slower over time without restart
- VS Code crashes after heavy Claude Code usage

**Phase impact:** Phase 1. Easy to introduce, hard to detect until production. Design disposal strategy from start.

---

### Pitfall 4: Webview XSS via Unsafe JSONL Content

**What goes wrong:** JSONL files contain user messages or code snippets with `<script>` tags. Extension displays this in webview without sanitization. Attacker includes malicious JS in Claude Code session messages. Webview executes arbitrary code, reads local files via webview API, exfiltrates data.

**Why it happens:** JSONL message content is user-controlled (anything user types in Claude Code gets logged). Developers assume JSONL is "safe" since it's local, but content is untrusted. Webviews without Content Security Policy (CSP) execute inline scripts.

**Consequences:**
- XSS attacks executing arbitrary JavaScript in webview context
- Access to webview postMessage API, potentially command injection
- Data exfiltration (reading other session files, sending to remote server)
- Reputation damage if security issue is publicized

**Prevention:**
- ALWAYS set strict Content Security Policy (CSP) in webview HTML: `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-{random}'; style-src 'unsafe-inline';">`
- Never use `innerHTML` or raw HTML insertion. Use `textContent` for user-generated content.
- Extract all inline scripts/styles to external files loaded via CSP nonce.
- Sanitize all JSONL message content before displaying: escape `<`, `>`, `&`, `"`, `'`.
- Use webview-ui-toolkit or safe rendering libraries that escape by default.
- Set `localResourceRoots` to restrict webview file access.

**Detection:**
- Webview console shows CSP violations (good! CSP is working)
- Security audit tools flag missing CSP
- Penetration testing with malicious session content

**Phase impact:** Phase 2 (webview UI). Must be designed correctly from first webview implementation. Retrofitting CSP is painful.

---

### Pitfall 5: Incorrect Token Aggregation (Caching Confusion)

**What goes wrong:** Claude Code's JSONL usage objects include `cache_creation_input_tokens` and `cache_read_input_tokens`. Extension naively sums all tokens including both. Reports massively inflated usage. User panics thinking they've burned through their quota.

**Why it happens:** Developers unfamiliar with prompt caching assume all `*_tokens` fields should be summed. Research shows caching fields are separate from billable tokens. Cached reads DON'T count toward rate limits the same way new inputs do.

**Consequences:**
- Reported token counts 5-10x higher than actual usage
- User loses trust in extension accuracy (explicit user requirement: "must be accurate")
- User makes wrong decisions about usage based on bad data
- Extension reviews complain about "completely wrong numbers"

**Prevention:**
- VERIFY Claude API pricing model: which tokens are billable, which aren't.
- Separate cache metrics from billable usage in UI (show both, label clearly).
- Test against Claude.ai web UI billing dashboard to verify your calculations match.
- Read Anthropic's official rate limits documentation (cache behavior is documented).
- For rate limit prediction: count `input_tokens` + `output_tokens`, NOT cached tokens.

**Detection:**
- Your totals don't match Claude.ai web UI billing page
- Token counts seem impossibly high for amount of work done
- User reports "this can't be right"

**Phase impact:** Phase 1 (core counting logic). Wrong from start = permanent accuracy problems.

---

## Moderate Pitfalls

Mistakes that cause delays, bugs, or technical debt.

### Pitfall 6: Windows Path Handling (Backslashes, Spaces, Symlinks)

**What goes wrong:** `.claude` directory paths contain spaces or backslashes. File watcher glob patterns fail. Symlinks (if user set up custom Claude directory) aren't followed. Extension can't find JSONL files.

**Why it happens:** Windows uses backslashes. VS Code's workspace paths are normalized to forward slashes. File watcher glob patterns break with inconsistent path separators. Symlinks require explicit opt-in with `files.watcherInclude`.

**Prevention:**
- Use `path.normalize()` and `vscode.Uri.fsPath` for all paths.
- Normalize all paths to forward slashes for glob patterns: `path.replace(/\\/g, '/')`.
- Test on Windows with paths containing spaces (e.g., `C:\Users\John Doe\.claude`).
- Check `files.watcherInclude` if user might use symlinks (unlikely but possible).
- Don't hardcode path separators; use `path.join()` everywhere.

**Detection:**
- Extension works on Mac/Linux but fails on Windows
- "File not found" errors for paths with spaces
- Works in test environment but not in real user setup

**Phase impact:** Phase 1. Windows is primary platform per project context. Test on Windows from day one.

---

### Pitfall 7: UTF-8 BOM Breaking JSON Parsing

**What goes wrong:** Some text editors save JSONL files with UTF-8 BOM (byte order mark: `\uFEFF`). Node.js `fs.readFileSync(path, 'utf8')` includes BOM in string. First line: `"\uFEFF{"type":"queue-operation"...}"`. `JSON.parse()` fails with "Unexpected token" error.

**Why it happens:** Windows editors (Notepad, some IDEs) add BOM to UTF-8 files. Node.js doesn't strip BOM by default when reading with 'utf8' encoding. Claude Code itself unlikely to write BOM, but if user manually edits or tools touch the files, BOM can appear.

**Prevention:**
- Strip BOM after reading: `content.replace(/^\uFEFF/, '')`
- Or use `encoding: 'utf-8-bom'` with third-party library that auto-strips (e.g., `iconv-lite`)
- Handle parse errors gracefully (don't crash extension on one bad line)

**Detection:**
- JSON.parse() fails only on first line with "Unexpected token" error
- Reading file in hex editor shows `EF BB BF` bytes at start
- Error message shows mysterious whitespace before JSON

**Phase impact:** Phase 1. Rare but if it happens, extension appears completely broken for that user.

---

### Pitfall 8: File Watcher Platform Differences (ENOSPC on Linux, not Windows)

**What goes wrong:** Extension works on Windows. User on Linux gets "ENOSPC: System limit for number of file watchers reached" error. Extension silently fails to watch new sessions.

**Why it happens:** Linux has OS-level limits on number of inotify watchers (default ~8192). Windows doesn't have this limit. If extension creates many watchers (one per JSONL file), Linux users hit limit fast.

**Consequences:**
- Extension works for developer (on Windows) but not for users (on Linux/Mac)
- Silent failure: no error shown to user, just stops updating
- Requires user to manually increase OS limit (bad UX)

**Prevention:**
- Watch DIRECTORIES, not individual files: one watcher for `~/.claude/projects` directory.
- Filter for `.jsonl` files in `onDidChange` handler, don't create per-file watchers.
- Show error to user if watcher creation fails (don't silently fail).
- Document Linux inotify limit issue in README with fix instructions.
- Use `files.watcherExclude` to exclude large folders (like `node_modules`).

**Detection:**
- Works on Windows, breaks on Linux
- Error log contains "ENOSPC"
- User reports "stopped updating after 10 sessions"

**Phase impact:** Phase 1-2. Windows primary but Linux users exist. Test cross-platform early.

---

### Pitfall 9: Status Bar Update Frequency (Performance Impact)

**What goes wrong:** Extension updates status bar on every file change event. Large JSONL files trigger hundreds of change events during Claude Code session. Status bar flickers. Extension host CPU spikes. UI lags.

**Why it happens:** File watchers fire on every file write. Claude Code appends to JSONL every few seconds during active session. Developer updates status bar immediately on each event. VS Code docs warn: "Limit the number of items added" to status bar.

**Prevention:**
- Debounce status bar updates: wait 200-500ms after last change event before updating.
- Update status bar max once per second (use `setTimeout` to batch updates).
- Only update if values actually changed (cache previous values, compare before updating).
- Don't show loading spinner constantly; show static icon with tooltip showing last update time.

**Detection:**
- Status bar flickers rapidly during active Claude Code sessions
- CPU usage spikes when Claude Code is running
- VS Code UI feels laggy during active sessions

**Phase impact:** Phase 1. Status bar is core UI. Design for performance from start.

---

### Pitfall 10: Subagent Session File Discovery

**What goes wrong:** Extension scans for `*.jsonl` files in `~/.claude/projects/*`. Misses subagent sessions stored in `{sessionId}/subagents/agent-*.jsonl` subdirectories. Token counts are dramatically under-reported for projects using agent teams.

**Why it happens:** Subagent sessions are stored in nested directories. Simple glob pattern `**/*.jsonl` might work, but directory structure isn't documented. Developer doesn't test with agent team sessions.

**Consequences:**
- Token counts missing 30-50% of actual usage (agent teams use many subagents)
- User using agent teams heavily gets completely wrong data
- Extension reviews: "numbers don't match reality"

**Prevention:**
- Recursively scan subdirectories: use glob pattern `**/*.jsonl` (double-star).
- Examine actual `.claude` directory structure on real system (not just documentation).
- Test with agent team sessions (create test session with subagents).
- Parse directory structure: session dirs contain optional `subagents/` subdirectory.

**Detection:**
- Token counts lower than expected
- Works for simple sessions, wrong for agent team sessions
- Manual inspection shows missing subagent files

**Phase impact:** Phase 1-2. Core counting logic. If wrong from start, all heavy users get bad data.

---

## Minor Pitfalls

Mistakes that cause annoyance but are fixable.

### Pitfall 11: JSONL Line-by-Line Parser Inefficiency

**What goes wrong:** Extension reads entire JSONL file with `fs.readFileSync()`, splits on `\n`, parses each line. For large files (500+ KB), this is slow and memory-intensive.

**Why it happens:** Simplest implementation. Works for small files. Doesn't scale to large sessions (20+ messages with extended thinking = 500 KB+ files).

**Prevention:**
- Use streaming parser: `fs.createReadStream()` with `readline` module.
- Only parse NEW lines since last read (track file offset, seek to end, read delta).
- For historical sessions: parse on-demand, not proactively. Cache results.

**Detection:**
- Extension lags when opening VS Code with many historical sessions
- Slow activation time warnings from VS Code
- High memory usage even when idle

**Phase impact:** Phase 2 (optimization). Can start simple, optimize later based on real usage patterns.

---

### Pitfall 12: History.jsonl Format Assumptions

**What goes wrong:** Extension assumes `~/.claude/history.jsonl` has same format as session JSONL files. It doesn't. Parsing logic crashes. Or extension ignores history file entirely, missing global usage data.

**Why it happens:** Research shows session files have different schema than history file. Developer only tests with session files, doesn't check history file structure.

**Prevention:**
- Examine BOTH `history.jsonl` AND session `.jsonl` files before coding parser.
- Handle multiple schemas (detect by `type` field, route to appropriate parser).
- Test with actual history file from real Claude Code usage.

**Detection:**
- Parse errors when reading history.jsonl
- Extension works but ignores history data
- Token counts incomplete (missing historical sessions)

**Phase impact:** Phase 2 (history feature). Low priority for MVP but critical for full accuracy.

---

### Pitfall 13: Rate Limit Detection Assumptions

**What goes wrong:** Extension tries to detect rate limits by scanning JSONL for error messages. Assumes rate limit errors appear as message objects with `type: "error"`. They might not. Or they appear in different format. Rate limit warnings missing or inaccurate.

**Why it happens:** Anthropic API rate limit errors have specific format (`429`, `rate_limit_error`, `retry-after` header). But how does Claude Code log these to JSONL? Unclear without reverse engineering.

**Consequences:**
- Rate limit warnings don't trigger when they should
- User hits rate limits without warning
- Or false positives: warns about rate limits that didn't happen

**Prevention:**
- Research Claude Code's actual JSONL logging for rate limit responses (examine real session files).
- Check for multiple indicators: `429`, `rate_limit_error`, `overloaded_error`, `retry-after`.
- Look in both message content AND separate error event types.
- Start with LOW CONFIDENCE feature: label as "experimental" or "estimated" rate limit detection.
- Consider: rate limits might NOT be logged to JSONL at all (API client handles silently).

**Detection:**
- Feature doesn't work at all (never triggers)
- False positives (triggers when no rate limit occurred)
- User reports: "hit rate limit but extension didn't warn me"

**Phase impact:** Phase 2-3. Nice-to-have feature, not critical for MVP. Can iterate based on real data.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|----------------|------------|
| **Phase 1: Core Parser** | Race conditions reading active files (Pitfall 1) | Implement robust try-catch, last-line detection, debouncing from day one |
| **Phase 1: File Watching** | Memory leaks from undisposed watchers (Pitfall 3) | Use `context.subscriptions` for auto-disposal |
| **Phase 1: Token Counting** | Wrong token aggregation logic (Pitfall 5) | Verify against Claude.ai web UI, separate cached vs billable tokens |
| **Phase 1: Activation** | `*` activation event causes slow startup (Pitfall 2) | Use lazy activation (`onCommand` or `onView`) |
| **Phase 1: Windows Support** | Path separator issues (Pitfall 6) | Test on Windows with paths containing spaces from day one |
| **Phase 2: Webview UI** | Missing CSP allows XSS (Pitfall 4) | Design with strict CSP from first webview implementation |
| **Phase 2: Subagent Support** | Missing subagent sessions (Pitfall 10) | Recursively scan subdirectories, test with agent teams |
| **Phase 2: Status Bar** | Too-frequent updates cause lag (Pitfall 9) | Debounce updates (200-500ms), batch changes |
| **Phase 3: Rate Limits** | Rate limit detection doesn't work (Pitfall 13) | Mark as experimental, iterate based on real data |

---

## Claude Code JSONL Format Research

Based on examination of actual Claude Code session files (as of version 2.1.34):

### File Structure

**Location:**
- Session files: `~/.claude/projects/{project-slug}/{session-uuid}.jsonl`
- Subagent files: `~/.claude/projects/{project-slug}/{session-uuid}/subagents/agent-{id}.jsonl`
- History: `~/.claude/history.jsonl`

### JSONL Line Types

Each line is a JSON object with a `type` field. Common types:

- `queue-operation`: Session queued/dequeued
- `file-history-snapshot`: File state tracking
- `progress`: Hook execution, tool progress
- `user`: User messages (includes opened files, pasted content)
- `assistant`: Claude's responses

### Token Data Location

Tokens are in `message.usage` object within `type: "assistant"` lines:

```json
{
  "type": "assistant",
  "message": {
    "model": "claude-opus-4-6",
    "usage": {
      "input_tokens": 3,
      "cache_creation_input_tokens": 17837,
      "cache_read_input_tokens": 14761,
      "output_tokens": 12,
      "service_tier": "standard",
      "cache_creation": {
        "ephemeral_5m_input_tokens": 0,
        "ephemeral_1h_input_tokens": 17837
      }
    }
  }
}
```

### Key Fields for Usage Tracking

- `input_tokens`: Billable input tokens (not cached)
- `output_tokens`: Billable output tokens
- `cache_creation_input_tokens`: Tokens used to create cache (billable once)
- `cache_read_input_tokens`: Tokens read from cache (cheaper rate)
- `service_tier`: Tier used ("standard", etc.)

### Important Notes

- **NOT stable**: JSONL format is internal implementation detail, can change between Claude Code versions
- **No official schema**: Not documented publicly
- **Version field present**: `"version": "2.1.34"` in each line (use to detect format changes?)
- **Partial writes happen**: Last line may be incomplete during active sessions
- **Model field present**: `"model": "claude-opus-4-6"` (useful for per-model tracking)

### Rate Limit Logging (LOW CONFIDENCE)

**Unknown:** How Claude Code logs rate limit errors to JSONL. Possibilities:

1. Separate error event with `type: "error"`
2. In assistant message with error status
3. Not logged to JSONL at all (handled silently by API client)
4. In `progress` events with hook failures

**Recommendation:** Treat rate limit detection as experimental Phase 3 feature. Implement best-effort heuristics, mark as "estimated" in UI, iterate based on real user data and Claude Code reverse engineering.

---

## Sources

**VS Code Extension Performance:**
- [Performance Issues - VS Code Wiki](https://github.com/microsoft/vscode/wiki/performance-issues)
- [Fixing VS Code Extension Performance Issues](https://www.nicoespeon.com/en/2019/11/fix-vscode-extension-performance-issue/)
- [Extension Host - VS Code API](https://code.visualstudio.com/api/advanced-topics/extension-host)

**File Watcher Issues:**
- [File Watcher Issues - VS Code Wiki](https://github.com/microsoft/vscode/wiki/File-Watcher-Issues)
- [ENOSPC Error Issue #151947](https://github.com/microsoft/vscode/issues/151947)

**JSONL Parsing:**
- [JSONL vs JSON - When to Use JSON Lines](https://superjson.ai/blog/2025-09-07-jsonl-vs-json-data-processing/)
- [JSONL Parser Guide](https://jsonltools.com/jsonl-parser)
- [JSON Lines Format](https://jsonlines.org/)

**Webview Security:**
- [Webview API - VS Code](https://code.visualstudio.com/api/extension-guides/webview)
- [Escaping Misconfigured VSCode Extensions](https://blog.trailofbits.com/2023/02/21/vscode-extension-escape-vulnerability/)
- [Webview CSP Issues #79248](https://github.com/microsoft/vscode/issues/79248)

**Status Bar:**
- [Status Bar Guidelines - VS Code API](https://code.visualstudio.com/api/ux-guidelines/status-bar)

**Memory Leaks:**
- [Memory Leak in Closed Sessions #16508](https://github.com/anthropics/claude-code/issues/16508)
- [Extension Memory Leak #19223](https://github.com/anthropics/claude-code/issues/19223)

**UTF-8 BOM Issues:**
- [fs.readFileSync BOM Issue #20649](https://github.com/nodejs/node/issues/20649)
- [How to Handle UTF-8 BOM in Node.js](https://dev.to/omardulaimi/how-to-properly-handle-utf-8-bom-files-in-nodejs-1nmj)

**Rate Limits:**
- [Claude API Rate Limits Documentation](https://platform.claude.com/docs/en/api/rate-limits)
- [How to Fix Claude API 429 Error](https://www.aifreeapi.com/en/posts/claude-api-429-error-fix)
- [Anthropic API Errors Documentation](https://docs.anthropic.com/en/api/errors)

**Race Conditions:**
- [Understanding Race Conditions in Node.js](https://medium.com/@ak.akki907/understanding-and-avoiding-race-conditions-in-node-js-applications-fb80ba79d793)
- [Thread-Safe File Writing in Python](https://superfastpython.com/thread-safe-write-to-file-in-python/)
