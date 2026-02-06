# Architecture Patterns

**Domain:** VS Code Extension with File Watching + Webview
**Researched:** 2026-02-07
**Confidence:** HIGH

## Recommended Architecture

The claude-usage extension follows a **layered service architecture** with clear separation between:
- Extension Host (Node.js process for business logic)
- File System Monitoring Layer (watches, parses, aggregates)
- State Management Layer (in-memory cache + persistence)
- UI Layer (status bar item + webview panel)

```
┌─────────────────────────────────────────────────────────────┐
│                    VS Code Main Process                      │
│  ┌──────────────┐        ┌──────────────────────────────┐   │
│  │ Status Bar   │        │   Webview Panel (iframe)     │   │
│  │   Item       │        │   - Chart.js / lightweight   │   │
│  │ (always on)  │        │   - HTML/CSS/JS              │   │
│  └──────────────┘        │   - acquireVsCodeApi()       │   │
│         ↑                └──────────────────────────────┘   │
│         │                         ↑                          │
│         │                         │ postMessage()            │
└─────────┼─────────────────────────┼──────────────────────────┘
          │                         │
          │                         │
┌─────────┼─────────────────────────┼──────────────────────────┐
│         │     Extension Host Process (Node.js)               │
│         │                         │                           │
│  ┌──────┴───────────────────┐    │                           │
│  │   Extension Controller   │    │                           │
│  │  - activate()            │    │                           │
│  │  - deactivate()          │────┘                           │
│  │  - singleton services    │                                │
│  └──────────┬───────────────┘                                │
│             │                                                 │
│  ┌──────────┴────────────────────────────────────────────┐   │
│  │            Service Layer (Singletons)                 │   │
│  │  ┌────────────────┐  ┌──────────────┐  ┌──────────┐  │   │
│  │  │ FileWatcher    │→ │ DataAggregator│→│StateStore│  │   │
│  │  │   Service      │  │   Service     │  │ Service  │  │   │
│  │  └────────────────┘  └──────────────┘  └──────────┘  │   │
│  └───────────────────────────────────────────────────────┘   │
│             │                    │              │             │
│             ↓                    ↓              ↓             │
│  ┌──────────────────────────────────────────────────────┐    │
│  │         Domain Layer (Business Logic)                │    │
│  │  ┌──────────────┐  ┌─────────────┐  ┌────────────┐  │    │
│  │  │ JSONLParser  │  │ Aggregator  │  │RateLimiter │  │    │
│  │  │   (stream)   │  │(time buckets)│  │  Detector  │  │    │
│  │  └──────────────┘  └─────────────┘  └────────────┘  │    │
│  └──────────────────────────────────────────────────────┘    │
│             │                                                 │
│             ↓                                                 │
│  ┌──────────────────────────────────────────────────────┐    │
│  │         File System (Node.js native)                 │    │
│  │    ~/.claude/projects/**/*.jsonl                      │    │
│  └──────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────┘
```

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| **Extension Controller** | Lifecycle management, dependency injection, activation strategy | All singleton services |
| **FileWatcherService** | Monitor `~/.claude/projects/**/*.jsonl`, detect changes, emit events | DataAggregatorService, JSONLParser |
| **JSONLParser** | Stream-parse JSONL files line-by-line, extract token usage events | DataAggregatorService |
| **DataAggregatorService** | Aggregate raw events into time buckets (session, daily, weekly, monthly) | StateStoreService, RateLimiterDetector |
| **RateLimiterDetector** | Detect rate-limit events, learn limits, calculate burn rate & cooldowns | StateStoreService |
| **StateStoreService** | In-memory cache + persistence (globalState), expose reactive updates | StatusBarController, WebviewController |
| **StatusBarController** | Render status bar item, update on state changes | StateStoreService |
| **WebviewController** | Manage webview lifecycle, handle message passing, serialize state | StateStoreService, Webview (iframe) |
| **Webview (iframe)** | Render charts/tables using Chart.js, handle user interactions | WebviewController (via postMessage) |

## Data Flow

### 1. Activation Flow (Extension Startup)

```
activate() called
    ↓
Create singleton services
    ↓
StateStoreService.restore() from globalState
    ↓
FileWatcherService.start() → watches ~/.claude/projects/
    ↓
Initial scan: parse existing JSONL files
    ↓
DataAggregatorService.initialize(historicalData)
    ↓
StatusBarController.create() → shows status bar item
    ↓
(Webview created lazily when user clicks)
```

### 2. File Change Flow (Real-time Updates)

```
File system event (change/create) detected by FileWatcherService
    ↓
Read only new lines since last position (incremental parsing)
    ↓
JSONLParser.parseLines() → extract token usage records
    ↓
DataAggregatorService.addEvents(records)
    ↓
Aggregate into time buckets (session, daily, weekly, monthly)
    ↓
RateLimiterDetector.analyze(records) → detect rate-limit events
    ↓
StateStoreService.update(aggregatedData, rateLimits)
    ↓
Emit change event
    ↓
┌────────────────────────┬─────────────────────────────┐
↓                        ↓                             ↓
StatusBarController    WebviewController          StateStoreService
  .updateText()         .postMessage(newData)      .persist()
```

### 3. Webview Communication Flow

```
User clicks status bar item
    ↓
WebviewController.show()
    ↓
Check if webview exists
    │
    ├─ Exists → webview.reveal()
    │
    └─ New → create WebviewPanel
              ↓
          Set webview.html (Chart.js + UI)
              ↓
          const vscodeApi = acquireVsCodeApi()
              ↓
          Listen for webview.onDidReceiveMessage()
              ↓
          StateStoreService.getData() → serialize
              ↓
          webview.postMessage({ type: 'init', data })
              ↓
          Webview receives message → renders charts

User interacts (filters, date range changes)
    ↓
vscodeApi.postMessage({ type: 'filter', params })
    ↓
WebviewController.onDidReceiveMessage()
    ↓
StateStoreService.query(params)
    ↓
webview.postMessage({ type: 'update', data })
    ↓
Webview re-renders charts with filtered data
```

### 4. Deactivation Flow (Extension Shutdown)

```
deactivate() called
    ↓
StateStoreService.persist() → save to globalState
    ↓
FileWatcherService.dispose() → close watchers
    ↓
WebviewController.dispose() → cleanup webview
    ↓
StatusBarController.dispose() → remove status bar item
```

## Patterns to Follow

### Pattern 1: Singleton Service Pattern
**What:** Each major service (FileWatcher, DataAggregator, StateStore, etc.) is a singleton instantiated once during activation and shared across the extension.

**When:** Always for extension-wide services that manage state or resources.

**Why:** VS Code extensions run in a single Extension Host process. Singleton ensures consistent state, avoids duplicate watchers, and simplifies dependency injection.

**Example:**
```typescript
// extension.ts
let fileWatcherService: FileWatcherService;
let stateStoreService: StateStoreService;

export function activate(context: vscode.ExtensionContext) {
  stateStoreService = new StateStoreService(context.globalState);
  fileWatcherService = new FileWatcherService(
    stateStoreService,
    context.subscriptions
  );

  // Services auto-register for disposal
  context.subscriptions.push(fileWatcherService, stateStoreService);
}
```

### Pattern 2: Event-Driven Updates
**What:** Services emit events when data changes; consumers subscribe to react.

**When:** For loose coupling between services and UI components.

**Why:** Decouples data producers from consumers. Enables multiple subscribers (status bar + webview) to react to the same state change without tight coupling.

**Example:**
```typescript
// StateStoreService.ts
export class StateStoreService {
  private _onDidChangeState = new vscode.EventEmitter<UsageData>();
  public readonly onDidChangeState = this._onDidChangeState.event;

  update(data: UsageData) {
    this.cache = data;
    this._onDidChangeState.fire(data);
  }
}

// StatusBarController.ts
stateStore.onDidChangeState((data) => {
  this.statusBarItem.text = `$(pulse) ${data.todayTokens}`;
});
```

### Pattern 3: Incremental JSONL Parsing
**What:** Track last read position per file; only parse new lines since last read.

**When:** For efficient monitoring of append-only JSONL files.

**Why:** Avoid re-parsing entire files on every change. Claude Code appends to JSONL files, so only tail is new.

**Example:**
```typescript
// FileWatcherService.ts
private filePositions = new Map<string, number>(); // file path → byte position

async parseNewLines(filePath: string) {
  const lastPosition = this.filePositions.get(filePath) || 0;
  const stream = fs.createReadStream(filePath, { start: lastPosition });

  // Use stream-json or jsonl-parse for efficient streaming
  const parser = new JSONLParser(stream);
  const newRecords = await parser.parse();

  this.filePositions.set(filePath, stream.bytesRead);
  return newRecords;
}
```

### Pattern 4: Webview State Persistence
**What:** Use `getState()/setState()` in webview to persist UI state (filters, zoom level, selected tab) across webview recreation.

**When:** Always for webview panels that can be backgrounded.

**Why:** VS Code destroys webview content when panel moves to background (unless `retainContextWhenHidden: true`, which has high memory cost). State persistence ensures UI state survives destruction/recreation.

**Example:**
```typescript
// In webview HTML
<script>
  const vscode = acquireVsCodeApi();

  // Restore previous state on load
  const previousState = vscode.getState() || { filter: 'all', dateRange: '7d' };

  // Save state on change
  function updateFilter(newFilter) {
    const state = { ...vscode.getState(), filter: newFilter };
    vscode.setState(state);
    // Apply filter...
  }
</script>
```

### Pattern 5: Activation Strategy - onStartupFinished
**What:** Use `onStartupFinished` activation event instead of `*` (activate on all startups).

**When:** For extensions that need to run continuously but aren't tied to specific file types or commands.

**Why:** Avoids slowing down VS Code startup. Extension activates after VS Code initialization completes, ensuring responsive startup experience.

**Example:**
```json
// package.json
{
  "activationEvents": [
    "onStartupFinished"
  ]
}
```

### Pattern 6: Time-Bucketed Aggregation
**What:** Organize usage data into hierarchical time buckets: sessions → daily → weekly → monthly.

**When:** For efficient querying across multiple time ranges.

**Why:** Enables O(1) lookups for "today's usage" or "this week's usage" without re-scanning all events. Pre-aggregated buckets scale better than computing on-demand.

**Example:**
```typescript
interface UsageData {
  sessions: Map<string, SessionData>; // sessionId → data
  daily: Map<string, DailyData>;      // YYYY-MM-DD → data
  weekly: Map<string, WeeklyData>;    // YYYY-Www → data
  monthly: Map<string, MonthlyData>;  // YYYY-MM → data
}

// DataAggregatorService updates all buckets in one pass
addEvent(event: TokenUsageEvent) {
  const date = new Date(event.timestamp);
  const dayKey = formatISO(date, { representation: 'date' });
  const weekKey = formatISO(startOfWeek(date));
  const monthKey = format(date, 'yyyy-MM');

  this.data.daily.get(dayKey).addTokens(event.tokens);
  this.data.weekly.get(weekKey).addTokens(event.tokens);
  this.data.monthly.get(monthKey).addTokens(event.tokens);
}
```

### Pattern 7: Relative Pattern for Out-of-Workspace Watching
**What:** Use `vscode.workspace.createFileSystemWatcher()` with `RelativePattern` and explicit `Uri` to watch files outside workspace.

**When:** For monitoring `~/.claude/projects/` which is outside user's workspace.

**Why:** VS Code's default file watchers are workspace-scoped. Explicit `Uri` + `RelativePattern` enables watching arbitrary paths.

**Example:**
```typescript
const claudeProjectsPath = path.join(os.homedir(), '.claude', 'projects');
const pattern = new vscode.RelativePattern(
  vscode.Uri.file(claudeProjectsPath),
  '**/*.jsonl'
);

const watcher = vscode.workspace.createFileSystemWatcher(pattern);
watcher.onDidChange(uri => this.handleFileChange(uri.fsPath));
watcher.onDidCreate(uri => this.handleFileCreate(uri.fsPath));
```

**Important Note:** Deletions are not tracked for paths outside workspace folders. This is acceptable for claude-usage since JSONL files are append-only and rarely deleted.

## Anti-Patterns to Avoid

### Anti-Pattern 1: retainContextWhenHidden for Webview
**What:** Setting `retainContextWhenHidden: true` to keep webview alive when backgrounded.

**Why bad:** High memory cost. Webview's DOM and JavaScript context remain in memory even when not visible. For data-heavy charts, this can consume significant resources.

**Instead:** Use `getState()/setState()` pattern to persist UI state. On webview recreation, restore filters/settings and re-render charts from StateStore data. Memory footprint stays low; latency is negligible (< 100ms to re-render charts).

**Exception:** If webview has complex, computation-heavy state (e.g., running simulations, heavy animations), `retainContextWhenHidden` may be justified. Not applicable for claude-usage.

### Anti-Pattern 2: Recursive Watcher Without Limits
**What:** Using `**/*` glob pattern to watch entire home directory or deeply nested structures.

**Why bad:** Chokidar and VS Code watchers will recursively watch everything within scope. Watching `~/.claude/**/*` may include cache directories, temp files, and non-JSONL files, wasting system resources.

**Instead:** Be specific: `~/.claude/projects/**/*.jsonl`. Constrain pattern to exactly what's needed.

**Detection:** Monitor CPU usage during development. If `watcher` process shows high CPU, pattern is too broad.

### Anti-Pattern 3: Re-parsing Entire JSONL Files on Every Change
**What:** Reading entire file from start and parsing all lines on file change events.

**Why bad:** JSONL files grow over time. Re-parsing 10MB file on every append is wasteful. Performance degrades linearly with file size.

**Instead:** Track byte position per file. On change, seek to last position and parse only new lines. See Pattern 3.

**Detection:** Slow status bar updates after file changes indicate full re-parsing.

### Anti-Pattern 4: Synchronous File I/O in Extension Host
**What:** Using `fs.readFileSync()` or blocking operations in event handlers.

**Why bad:** Extension Host is single-threaded. Synchronous I/O blocks entire extension, causing UI freezes and unresponsive status bar.

**Instead:** Always use async file operations (`fs.promises.readFile()`, streams). Leverage Node.js event loop for concurrency.

**Example:**
```typescript
// BAD
watcher.onDidChange(uri => {
  const content = fs.readFileSync(uri.fsPath, 'utf-8'); // BLOCKS
  this.parse(content);
});

// GOOD
watcher.onDidChange(async (uri) => {
  const content = await fs.promises.readFile(uri.fsPath, 'utf-8');
  this.parse(content);
});
```

### Anti-Pattern 5: Polling Instead of Event-Driven Watching
**What:** Using `setInterval()` to periodically check for file changes.

**Why bad:** Wastes CPU cycles. Introduces latency (poll interval vs. instant notification). Less responsive than native file system events.

**Instead:** Use `vscode.workspace.createFileSystemWatcher()` or Node's `fs.watch()`. Both leverage OS-level file system events (inotify on Linux, FSEvents on macOS, ReadDirectoryChangesW on Windows).

**Exception:** If VS Code file watcher doesn't reliably detect changes (rare, usually config issue), consider chokidar as fallback, NOT polling.

### Anti-Pattern 6: Global State Without Versioning
**What:** Persisting complex objects to `globalState` without schema version field.

**Why bad:** Extension updates may change data structure. Reading old state format causes crashes or corruption.

**Instead:** Include `_version` field in persisted state. On restore, check version and migrate if needed.

**Example:**
```typescript
interface PersistedState {
  _version: number;
  data: UsageData;
}

restore() {
  const raw = this.globalState.get<PersistedState>('usageData');
  if (!raw) return this.defaultState();

  if (raw._version < 2) {
    return this.migrateV1toV2(raw);
  }
  return raw.data;
}
```

### Anti-Pattern 7: Tight Coupling Between Webview and Extension Logic
**What:** Implementing business logic (aggregation, filtering, calculations) inside webview JavaScript.

**Why bad:** Duplicates logic between Extension Host and webview. Harder to test. If webview is destroyed, calculations are lost.

**Instead:** Keep webview as thin presentation layer. All business logic lives in Extension Host services. Webview receives pre-computed data and only handles rendering.

**Example:**
```typescript
// BAD: Business logic in webview
<script>
  function calculateBurnRate(events) { /* complex logic */ }
  const rate = calculateBurnRate(rawEvents);
</script>

// GOOD: Business logic in Extension Host
// RateLimiterDetector.ts
calculateBurnRate(events: TokenEvent[]): number { /* logic */ }

// WebviewController sends pre-computed result
webview.postMessage({
  type: 'update',
  burnRate: this.rateLimiter.calculateBurnRate(events)
});
```

## Build Order & Dependency Graph

Recommended implementation order to minimize rework:

### Phase 1: Foundation (No UI dependencies)
1. **JSONLParser** - Stream-based JSONL parsing with line-by-line extraction
2. **Domain Models** - TypeScript interfaces for UsageData, TokenEvent, RateLimitEvent
3. **DataAggregatorService** - Time-bucketed aggregation (sessions, daily, weekly, monthly)
4. **StateStoreService** - In-memory cache + persistence (globalState)

**Why this order:** Domain models inform service interfaces. Aggregator depends on models but not on file watching or UI. StateStore is pure data management, testable in isolation.

### Phase 2: File Watching (Depends on Phase 1)
5. **FileWatcherService** - Watch `~/.claude/projects/**/*.jsonl`, detect changes
6. Integration: FileWatcher → JSONLParser → DataAggregator → StateStore

**Why this order:** File watching needs somewhere to send parsed data (DataAggregator). Can test with static JSONL files before adding real-time watching.

### Phase 3: Basic UI (Depends on Phase 2)
7. **StatusBarController** - Create status bar item, subscribe to StateStore changes
8. **Extension Controller** - Wire up activation, instantiate services

**Why this order:** Status bar is simplest UI component. No message passing, no lifecycle complexity. Proves data flow works before tackling webview.

### Phase 4: Advanced Features (Depends on Phase 3)
9. **RateLimiterDetector** - Detect rate-limit events, learn limits, calculate burn rate
10. Integration: RateLimiter → StateStore → StatusBar (show cooldown warnings)

**Why this order:** Rate limiting is enhancement, not core functionality. Can ship without it. Depends on stable data pipeline from previous phases.

### Phase 5: Webview (Depends on Phase 1-4)
11. **WebviewController** - Create webview panel, handle message passing, lifecycle
12. **Webview HTML/CSS/JS** - Chart.js integration, tables, filters, UI
13. Integration: Webview ↔ WebviewController ↔ StateStore

**Why this order:** Webview is most complex UI component. Needs stable backend (Phase 1-3) and data pipeline (Phase 2). Implementing last minimizes debugging complexity.

### Dependency Graph

```
┌──────────────┐
│Domain Models │ (no dependencies)
└──────┬───────┘
       │
   ┌───▼──────────────────┐
   │ JSONLParser          │
   └───┬──────────────────┘
       │
   ┌───▼──────────────────┐     ┌──────────────────┐
   │ DataAggregatorService│◄────│StateStoreService │
   └───┬──────────────────┘     └────────┬─────────┘
       │                                  │
   ┌───▼──────────────────┐              │
   │ FileWatcherService   │              │
   └───┬──────────────────┘              │
       │                                  │
   ┌───▼──────────────────┐     ┌────────▼─────────┐
   │RateLimiterDetector   │◄────│StatusBarControl  │
   └──────────────────────┘     └──────────────────┘
                                         │
                                ┌────────▼─────────┐
                                │WebviewController │
                                └────────┬─────────┘
                                         │
                                ┌────────▼─────────┐
                                │  Webview (UI)    │
                                └──────────────────┘
```

**Key insight:** Bottom-up implementation (models → services → UI) enables incremental testing and reduces integration risk.

## Scalability Considerations

| Concern | At 1 Project | At 10 Projects | At 100 Projects |
|---------|--------------|----------------|-----------------|
| **File watching** | Single watcher, low overhead | Single watcher, 10 files, negligible CPU | Single watcher, 100 files, monitor CPU; consider exclude patterns |
| **Memory usage** | < 10MB for in-memory cache | < 50MB (10 projects × ~1MB data each) | < 500MB; consider LRU eviction for old data |
| **Parsing performance** | Instant (< 10ms per file change) | Concurrent parsing OK if < 5 files change simultaneously | Throttle/debounce: batch changes within 100ms window |
| **Status bar updates** | Real-time (< 50ms latency) | Real-time | Debounce updates (e.g., max 1 update per 200ms) |
| **Webview rendering** | Instant (Chart.js handles < 1000 points easily) | Instant | Consider data sampling or pagination (e.g., show last 30 days, paginate rest) |
| **Persistence** | globalState < 1KB | globalState < 100KB | globalState < 1MB; consider external file storage if exceeds VS Code limits |

**Critical thresholds:**
- **100+ projects:** May need to implement lazy loading (only parse/watch active workspace projects)
- **1MB+ globalState:** VS Code has no hard limit, but large state slows activation. Migrate to file-based storage (globalStorageUri)
- **10+ file changes/second:** Indicates aggressive file writes. Implement debouncing to batch updates.

## Platform-Specific Considerations

### Windows (Primary Target)

**File paths:** Use `path.join()` and `os.homedir()` for cross-platform compatibility. Windows uses backslashes, but Node.js APIs handle conversion.

**File watching:** Windows uses `ReadDirectoryChangesW` under the hood. Known issues:
- Watching network drives or OneDrive-synced folders may have delays
- Symbolic links require special handling

**Recommendation:** Test on Windows with real `~/.claude/projects/` directory. Verify watcher detects changes within 100ms.

### macOS & Linux (Secondary Targets)

**File watching:** macOS uses FSEvents (efficient), Linux uses inotify (efficient but has watch limit).

**Linux-specific concern:** Default inotify watch limit is 8192. If users have many projects, may hit limit. Document workaround: increase `fs.inotify.max_user_watches`.

**Recommendation:** Test on macOS/Linux if available. If not, rely on VS Code's cross-platform `FileSystemWatcher` abstraction (handles OS differences).

## Security Considerations

**Local-only, no network:** Extension never makes network requests. All data stays on local machine. No API keys, no telemetry.

**File access:** Extension only reads `~/.claude/projects/**/*.jsonl` (user's own data). No write access needed. No risk of data corruption.

**Webview security:** Use VS Code's CSP (Content Security Policy) for webview:
```typescript
webview.options = {
  enableScripts: true,
  localResourceRoots: [vscode.Uri.file(extensionPath)]
};

// In HTML
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-{nonce}'; style-src 'nonce-{nonce}'; img-src vscode-resource: https:;">
```

Prevents XSS attacks via user-generated content (if extension later allows custom notes/annotations).

## Testing Strategy

**Unit tests (Phase 1-4):**
- JSONLParser: Test with sample JSONL files
- DataAggregator: Test time-bucketing logic with mock events
- StateStore: Test persistence/restore with mock globalState
- RateLimiter: Test detection logic with known rate-limit events

**Integration tests (Phase 2-5):**
- FileWatcher + Parser + Aggregator: Create temp JSONL files, append lines, verify events
- StatusBar + StateStore: Mock state changes, verify UI updates
- Webview + Controller: Mock message passing, verify serialization

**Manual testing:**
- Run extension in VS Code Extension Development Host
- Watch real `~/.claude/projects/` directory
- Trigger Claude Code conversations, verify real-time updates
- Test webview panel: open, close, background, foreground (verify state persistence)

## Performance Benchmarks (Target)

| Operation | Target Latency | Notes |
|-----------|---------------|-------|
| File change detection | < 100ms | From file write to watcher event |
| JSONL parsing (incremental) | < 10ms | For typical 10-50 new lines |
| Aggregation update | < 5ms | Update time buckets |
| Status bar update | < 50ms | From state change to UI render |
| Webview initialization | < 500ms | From panel creation to first render |
| Webview message round-trip | < 50ms | Extension → Webview → Extension |

**How to measure:** Use `console.time()` / `console.timeEnd()` during development. VS Code has built-in performance profiler (Help → Toggle Developer Tools → Performance tab).

## Sources

**Official VS Code Documentation:**
- [Webview API Guide](https://code.visualstudio.com/api/extension-guides/webview) (HIGH confidence)
- [Status Bar UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/status-bar) (HIGH confidence)
- [Activation Events Reference](https://code.visualstudio.com/api/references/activation-events) (HIGH confidence)
- [Common Capabilities](https://code.visualstudio.com/api/extension-capabilities/common-capabilities) (HIGH confidence)
- [VS Code API - workspace.createFileSystemWatcher](https://vscode-api.js.org/modules/vscode.workspace.html) (HIGH confidence)

**Community Resources & Best Practices:**
- [Building VS Code Extensions in 2026: The Complete Guide](https://abdulkadersafi.com/blog/building-vs-code-extensions-in-2026-the-complete-modern-guide) (MEDIUM confidence - recent community guide)
- [Enhancing communication using VS Code Messenger](https://www.typefox.io/blog/vs-code-messenger/) (MEDIUM confidence - library for complex message passing)
- [Rebuilding state management: How we made our VS Code extension 2× faster](https://www.augmentcode.com/blog/rebuilding-state-management) (MEDIUM confidence - real-world optimization case study)

**File System Watching:**
- [How to Watch File Changes in Node.js (2026)](https://oneuptime.com/blog/post/2026-01-22-nodejs-watch-file-changes/view) (MEDIUM confidence)
- [Chokidar GitHub](https://github.com/paulmillr/chokidar) (HIGH confidence - de facto standard for Node.js file watching)
- [VS Code File Watcher Internals](https://github.com/microsoft/vscode/wiki/File-Watcher-Internals) (HIGH confidence - official VS Code architecture docs)

**JSONL Parsing:**
- [stream-json npm](https://www.npmjs.com/package/stream-json) (HIGH confidence - mature, widely-used library)
- [jsonl-parse GitHub](https://github.com/moshetanzer/jsonl-parse) (MEDIUM confidence - TypeScript-first JSONL parser)
- [JSONL Parser Guide](https://jsonltools.com/jsonl-parser) (LOW confidence - educational resource)

**Webview Charting:**
- [Chart.js Marketplace Extension](https://marketplace.visualstudio.com/items?itemName=XuangeAha.chartjs) (MEDIUM confidence - demonstrates Chart.js in VS Code)
- [Vscode Webview UI Toolkit (deprecated 2025-01-01)](https://code.visualstudio.com/blogs/2021/10/11/webview-ui-toolkit) (MEDIUM confidence - note deprecation date)

**Architectural Patterns:**
- [Cline Extension Architecture Overview](https://deepwiki.com/cline/cline/1.3-architecture-overview) (MEDIUM confidence - example of well-architected VS Code extension)
- [A singleton pattern for simple state management](https://gist.github.com/sjgale/8b169849dc7f9339062d630d5a9955e2) (LOW confidence - community example)
