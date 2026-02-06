# Project Research Summary

**Project:** claude-usage
**Domain:** VS Code extension for local file monitoring and data visualization
**Researched:** 2026-02-07
**Confidence:** HIGH

## Executive Summary

Claude Code usage monitoring is a mature domain with clear patterns. Extensions in this space read local JSONL files from `~/.claude/projects/`, parse token usage data, and present it through a status bar and webview dashboard. The recommended approach is a layered architecture with TypeScript + esbuild, leveraging VS Code's native FileSystemWatcher API and React + Recharts for visualization. Trust is the key differentiator in this crowded market - users are anxious about AI usage data and want fully local, transparent tools with no external network calls.

The critical technical challenge is handling actively-written JSONL files without race conditions or parser crashes. This requires robust line-by-line parsing with graceful error handling, incremental reads tracking file positions, and debounced file watching. Other major risks include memory leaks from undisposed watchers (extensions have crashed with 20GB+ RAM consumption), incorrect token aggregation logic (confusing cache tokens with billable tokens leads to 5-10x inflated counts), and slow activation times that make VS Code startup unresponsive.

The architecture follows a proven singleton service pattern with event-driven updates: FileWatcher monitors directories, JSONLParser streams JSONL incrementally, DataAggregator organizes usage into time buckets (session/daily/weekly/monthly), StateStore manages in-memory cache with persistence, and UI controllers (status bar + webview) subscribe to state changes. This separation enables testing in isolation and scales well from 1 to 100+ projects.

## Key Findings

### Recommended Stack

Modern VS Code extension development centers on TypeScript with native runtime support (Node.js 22.18+) and esbuild for bundling. The stack prioritizes zero dependencies for core features, native VS Code APIs for all UI (status bar, webview, file watching), and minimal external libraries only where necessary (React + Recharts for webview visualization).

**Core technologies:**
- **TypeScript 5.x + Node.js 22.18+**: Primary language with native TS support, eliminates build step for local dev, provides type safety critical for accurate usage tracking
- **esbuild**: Official VS Code bundler recommendation for 2025/2026, incredibly fast, handles TS natively, required for web compatibility
- **VS Code FileSystemWatcher API**: Built-in file monitoring via `workspace.createFileSystemWatcher()`, zero dependencies, leverages OS-level events (inotify/FSEvents/ReadDirectoryChangesW)
- **Node.js built-in readline**: Stream-based JSONL parsing using `fs.createReadStream()` + `readline.createInterface()`, sufficient for line-by-line parsing without external dependencies
- **React 18.x**: Official VS Code recommendation for webview UI, component model ideal for charts + tables, mature ecosystem with extensive examples
- **Recharts 2.x**: React-native charting library, declarative API, reasonable bundle size (~100-150KB), sweet spot between power and complexity for usage dashboards

**Version pinning strategy:** Use caret (^) for tooling (esbuild, ESLint, Prettier) to allow minor updates, but lock major versions for runtime deps (React, Recharts) to avoid breaking changes.

**Deferred dependencies:** stream-json library (only needed if built-in readline proves insufficient for real-time streaming partial writes, unlikely based on research).

### Expected Features

Usage monitoring extensions have clear table stakes that users expect, with meaningful opportunities for differentiation through trust, historical views, and proactive rate limit management.

**Must have (table stakes):**
- **Status bar display** — Every extension has it; first place users look for quick info (percentage, cost, time remaining, or tokens). Must be clickable for details.
- **Real-time token tracking** — Core purpose; track all four token types separately (input, output, cache_creation, cache_read)
- **Cost calculation** — Users care about money; support all pricing tiers (Pro $20, Max5 $50, Max20 $200) with model-specific rates
- **5-hour session window tracking** — Claude Code's rolling rate limit window; must detect first message timestamp and calculate accurate expiry
- **Local data reading** — Standard approach: read `~/.claude/projects/*.jsonl`, cross-platform paths (Windows uses `%USERPROFILE%\.claude\projects\`)
- **Zero external calls** — Privacy expectation; users explicitly value "no data sent to external services"
- **Automatic refresh** — Stale data is useless; typical 30-60 second intervals with file watching for instant updates
- **Multi-plan support** — Accurate limits for Pro (~44k tokens/window), Max5 (~88k), Max20 (~220k)
- **Color-coded warnings** — Visual urgency (Green < 60-75%, Yellow 60-80%, Red > 80-90%)

**Should have (competitive differentiators):**
- **Burn rate prediction** — "When will I hit the limit?" Tokens/min calculation with time-to-limit forecasting
- **Detailed popup/panel** — Status bar is cramped; clicking reveals comprehensive breakdown (token categories, session timing, burn rate, model distribution)
- **Historical data views** — 7-day tables, monthly aggregates, daily sparklines provide context for spending patterns
- **Account-wide aggregation** — Claude limits are account-level, not project-level; track across all projects to match actual behavior
- **Rate limit proximity warnings** — Proactive notifications at 75%, 80%, 90% thresholds prevent workflow disruption
- **Cooldown/reset timer** — "How long until my session resets?" Reduces anxiety, enables planning
- **Trust as primary differentiator** — Transparent codebase, no dependencies for core features, privacy-first messaging, "local only" badge in UI

**Defer (v2+):**
- **Weekly limit tracking** — Added Aug 2025 but only ~2% of users hit it; can add once 5-hour tracking solid
- **Model-specific breakdown** — Interesting but not actionable for most users
- **Export to JSON** — Power user feature with small audience
- **Live dashboard mode** — Cool but status bar covers most needs
- **Command palette integration** — UX polish; can start with settings.json

**Unique opportunity:** No current extension leads with security/privacy as primary value prop. Market gap for transparent, auditable, zero-network extension targeting users anxious about AI usage data exposure.

### Architecture Approach

Layered service architecture with clear separation between Extension Host (Node.js business logic), File System Monitoring Layer (watches, parses, aggregates), State Management Layer (in-memory cache + persistence), and UI Layer (status bar + webview). All services are singletons instantiated once during activation, communicating through event-driven updates to decouple data producers from UI consumers.

**Major components:**
1. **Extension Controller** — Lifecycle management, dependency injection, activation strategy; wires up singleton services
2. **FileWatcherService** — Monitors `~/.claude/projects/**/*.jsonl` using VS Code FileSystemWatcher, detects changes, emits events; uses incremental parsing (track byte positions per file, parse only new lines)
3. **JSONLParser** — Stream-parses JSONL line-by-line using Node.js built-in readline, extracts token usage events, handles incomplete writes gracefully (try-catch per line, ignore unparseable last line if no trailing newline)
4. **DataAggregatorService** — Aggregates raw events into hierarchical time buckets (sessions → daily → weekly → monthly) for O(1) time-range queries
5. **RateLimiterDetector** — Detects rate-limit events from JSONL, learns actual limits, calculates burn rate and cooldown timers
6. **StateStoreService** — In-memory cache + persistence to globalState, exposes reactive EventEmitter for state changes, version-tagged schema for migration safety
7. **StatusBarController** — Creates status bar item, subscribes to StateStore changes, debounces updates (200-500ms) to prevent flicker
8. **WebviewController** — Manages webview panel lifecycle, handles bidirectional message passing (postMessage), serializes state, uses getState/setState pattern for UI persistence across destruction/recreation
9. **Webview (iframe)** — Thin presentation layer using React + Recharts, receives pre-computed data, handles only rendering and user interactions

**Critical patterns:**
- **Singleton services** with auto-disposal via `context.subscriptions.push()`
- **Event-driven updates** using VS Code EventEmitter for loose coupling
- **Incremental JSONL parsing** tracking file positions to avoid re-parsing entire files
- **Webview state persistence** using getState/setState to survive destruction when backgrounded
- **Lazy activation** (`onStartupFinished` not `*`) to avoid slowing VS Code startup
- **Time-bucketed aggregation** for efficient multi-range queries

**Build order:** Domain models → Parser → Aggregator → StateStore → FileWatcher → StatusBar → RateLimiter → Webview. This bottom-up approach enables incremental testing and minimizes integration risk.

### Critical Pitfalls

Research identified five critical pitfalls that cause rewrites, data corruption, or major user-facing issues. All must be addressed from Phase 1.

1. **Reading actively-written JSONL files (race condition)** — Parser reads file while Claude Code is writing mid-line, crashes on incomplete JSON. Prevention: line-by-line parsing with try-catch, detect incomplete last line (no trailing \n), debounce 50-100ms on file events.

2. **Wrong activation event (performance killer)** — Using `*` or `onStartupFinished` causes extension to scan all JSONL files on VS Code startup, blocks extension host for 5+ seconds. Prevention: use lazy activation (`onCommand` or `onView`), defer initial scan to first user interaction.

3. **Memory leaks from undisposed watchers** — Creating file watchers without calling `.dispose()` leads to linear RAM growth (227 KB heap + 400 MB process per leaked session). 20 sessions = 8GB; 50 sessions = 20GB, crashes extension host. Prevention: use `context.subscriptions.push(watcher)` for auto-disposal, limit active watchers to current session.

4. **Webview XSS via unsafe JSONL content** — User messages in JSONL can contain `<script>` tags; displaying without sanitization allows arbitrary code execution in webview context. Prevention: strict Content Security Policy (CSP) with nonce-based scripts, never use innerHTML for user content, escape all JSONL message content.

5. **Incorrect token aggregation (caching confusion)** — Naively summing all `*_tokens` fields including `cache_creation_input_tokens` and `cache_read_input_tokens` inflates usage 5-10x. Prevention: verify against Claude.ai web UI billing, separate cache metrics from billable usage, test calculation accuracy from day one.

**Phase 1 warnings:** Pitfalls 1-3 and 5 all stem from core architecture decisions. Getting activation, file watching, parsing, and token aggregation wrong from the start creates permanent accuracy and performance problems.

**Moderate pitfalls to watch:**
- **Windows path handling** (backslashes, spaces, symlinks) — Test on Windows from day one
- **Platform differences** (ENOSPC on Linux inotify limits) — Watch directories not individual files
- **Status bar update frequency** — Debounce to max 1 update per 200-500ms
- **Subagent session discovery** — Recursively scan subdirectories with `**/*.jsonl` glob

## Implications for Roadmap

Based on research, this project is well-suited to a bottom-up build order prioritizing foundation before UI. The architecture has clear component boundaries with minimal interdependencies, enabling incremental development with isolated testing at each layer.

### Phase 1: Foundation & Core Parsing
**Rationale:** Domain models, JSONL parsing, and data aggregation are pure business logic with no UI or file watching dependencies. Can be developed and tested in complete isolation with static test files. Getting token counting logic correct from the start is critical (Pitfall 5 shows wrong aggregation is hard to fix later).

**Delivers:**
- TypeScript domain models (UsageData, TokenEvent, RateLimitEvent interfaces)
- JSONLParser with streaming line-by-line reading, graceful error handling for incomplete writes
- DataAggregatorService with time-bucketed aggregation (sessions, daily, weekly, monthly)
- StateStoreService with in-memory cache, globalState persistence, version-tagged schema

**Addresses features:**
- Real-time token tracking (all four token types)
- Cost calculation (multi-plan support)
- Multi-plan support (Pro/Max5/Max20 limits)

**Avoids pitfalls:**
- Pitfall 5 (incorrect token aggregation) — Verify against Claude.ai web UI from start
- Pitfall 1 (race conditions) — Design parser with try-catch per line, incomplete write detection

**Research flags:** SKIP research-phase. Well-documented JSONL parsing patterns, clear aggregation logic, standard state management.

---

### Phase 2: File Watching & Integration
**Rationale:** FileWatcher depends on Parser and Aggregator having stable interfaces (Phase 1). This phase connects the data pipeline but still no UI. Integration can be tested by monitoring real `~/.claude/projects/` directory with manual verification before adding UI complexity.

**Delivers:**
- FileWatcherService using VS Code native `workspace.createFileSystemWatcher()`
- Integration: FileWatcher → JSONLParser → DataAggregator → StateStore
- Incremental parsing (track byte positions per file, read only new lines)
- Proper disposal management (context.subscriptions)
- Windows path handling (path.normalize, testing with spaces)

**Addresses features:**
- Local data reading (cross-platform paths)
- Automatic refresh (file watching for instant updates)
- Account-wide aggregation (watch all projects, not just current)

**Uses stack:**
- VS Code FileSystemWatcher API
- Node.js built-in readline
- Cross-platform path handling (path.join, os.homedir)

**Avoids pitfalls:**
- Pitfall 3 (memory leaks) — Use context.subscriptions.push() for auto-disposal
- Pitfall 6 (Windows paths) — Test on Windows with paths containing spaces
- Pitfall 8 (Linux inotify limits) — Watch directories not individual files
- Pitfall 10 (subagent sessions) — Use recursive **/*.jsonl glob

**Research flags:** SKIP research-phase. VS Code file watching is well-documented, standard patterns exist.

---

### Phase 3: Basic UI (Status Bar)
**Rationale:** Status bar is simplest UI component (no message passing, no lifecycle complexity). Proves data flow works end-to-end before tackling webview. Can ship a minimal viable product after this phase with just status bar.

**Delivers:**
- StatusBarController creating status bar item
- Subscription to StateStore changes with event-driven updates
- Debounced updates (200-500ms) to prevent flicker
- Color-coded display (green/yellow/red based on percentage)
- Extension Controller wiring up activation and service instantiation
- Lazy activation strategy (onStartupFinished)

**Addresses features:**
- Status bar display (table stakes)
- Color-coded warnings (visual urgency)
- Zero external calls (fully local, no network dependencies)

**Implements architecture:**
- StatusBarController component
- Extension Controller with singleton service pattern
- Event-driven updates (StateStore.onDidChangeState)

**Avoids pitfalls:**
- Pitfall 2 (activation performance) — Use onStartupFinished not *, defer initial scan
- Pitfall 9 (status bar update frequency) — Debounce to max 1 update per 200-500ms

**Research flags:** SKIP research-phase. Status bar API is straightforward, well-documented.

**MVP CHECKPOINT:** After Phase 3, extension is shippable as minimal status-bar-only monitor. Can gather user feedback before investing in webview complexity.

---

### Phase 4: Rate Limiting & Burn Rate
**Rationale:** Enhancement features that depend on stable data pipeline (Phases 1-3). Rate limiting adds value but isn't required for basic usage tracking. Can ship without it and add incrementally.

**Delivers:**
- RateLimiterDetector analyzing token events
- Burn rate calculation (tokens/min with time-to-limit forecasting)
- 5-hour session window detection (rolling window, first message timestamp, expiry)
- Cooldown/reset timer calculation
- Integration: RateLimiter → StateStore → StatusBar (show warnings)
- Rate limit proximity warnings (75%, 80%, 90% thresholds)

**Addresses features:**
- 5-hour session window tracking (table stakes)
- Burn rate prediction (differentiator)
- Cooldown/reset timer (differentiator)
- Rate limit proximity warnings (differentiator)

**Implements architecture:**
- RateLimiterDetector component

**Avoids pitfalls:**
- Pitfall 13 (rate limit detection assumptions) — Mark as experimental initially, iterate based on real JSONL data

**Research flags:** NEEDS research-phase. Claude Code JSONL format for rate limit events is undocumented. May need reverse engineering or user testing to identify error event format. Research shows uncertainty: might be `type: "error"`, might be in assistant messages, might not be logged at all.

---

### Phase 5: Webview Dashboard
**Rationale:** Most complex UI component with bidirectional message passing, lifecycle management, CSP security, and React integration. Implementing last minimizes debugging complexity since backend (Phases 1-4) is stable and proven.

**Delivers:**
- WebviewController managing panel lifecycle
- Webview HTML with React + Recharts integration
- Message passing (postMessage) between extension and webview
- State persistence (getState/setState) for filters across destruction/recreation
- Charts (line/bar for usage over time, pie for model distribution)
- Tables (token breakdown, session history)
- Filters (date range, project, model)
- Strict Content Security Policy (CSP) with nonce-based scripts

**Addresses features:**
- Detailed popup/panel (differentiator)
- Historical data views (differentiator)
- Model-specific breakdown (deferred feature, can include or postpone)

**Uses stack:**
- React 18.x (webview UI framework)
- Recharts 2.x (charting library)
- VS Code Webview View API

**Implements architecture:**
- WebviewController component
- Webview (iframe) presentation layer
- Message passing integration

**Avoids pitfalls:**
- Pitfall 4 (webview XSS) — Strict CSP from first implementation, escape all user content, never use innerHTML
- Anti-pattern: retainContextWhenHidden — Use getState/setState instead for memory efficiency

**Research flags:** SKIP research-phase. React + Recharts in VS Code webview is well-documented with extensive examples (official VS Code guide + community tutorials).

---

### Phase 6: Polish & Trust Features
**Rationale:** Final phase adds trust differentiators and UX improvements identified in research. These are enhancements that increase user confidence and usability but aren't required for core functionality.

**Delivers:**
- Privacy documentation ("fully local, zero network calls" in README and marketplace description)
- "Local only" badge in status bar tooltip or webview
- Data source path display in settings (transparency about what files are read)
- Command palette integration (quick access to plan switching, manual refresh)
- Configurable refresh intervals in settings
- Export to JSON functionality
- Comprehensive error messages (what failed, why, what to try next)

**Addresses features:**
- Trust as differentiator (unique opportunity)
- Command palette integration (deferred)
- Configurable refresh intervals (deferred)
- Export to JSON (deferred)

**Research flags:** SKIP research-phase. These are polish features with standard implementation patterns.

---

### Phase Ordering Rationale

**Bottom-up approach enables:**
- **Isolated testing:** Each phase builds on stable, tested components from previous phases
- **Incremental shipping:** Can ship after Phase 3 (status bar only) or Phase 4 (add rate limiting) without waiting for full webview
- **Risk reduction:** Most complex/uncertain features (webview, rate limit detection) come last when foundation is proven
- **Parallel work:** Phases 1-2 are pure backend, enabling later parallelization (e.g., Phase 4 and 5 could overlap if team grows)

**Dependency-driven sequencing:**
- Phases 1-2 have no UI dependencies → can work in isolation
- Phase 3 needs Phases 1-2 complete (data pipeline)
- Phase 4 enhances Phase 3 but doesn't block Phase 5
- Phase 5 needs all backend stable (Phases 1-4) but is largely independent UI work
- Phase 6 is pure polish, no blockers

**Pitfall avoidance built into phase structure:**
- Phase 1 addresses Pitfalls 1, 5 (parsing, token counting) before any other work
- Phase 2 addresses Pitfalls 3, 6, 8, 10 (file watching, cross-platform) before UI
- Phase 3 addresses Pitfalls 2, 9 (activation, status bar updates) in simplest UI context
- Phase 5 addresses Pitfall 4 (webview XSS) when security patterns are well-understood

### Research Flags

**Phases needing deeper research:**
- **Phase 4 (Rate Limiting):** Claude Code JSONL format for rate limit error events is undocumented. Research shows uncertainty about whether errors appear as `type: "error"`, in assistant messages, or aren't logged at all. May need `/gsd:research-phase` to reverse-engineer actual JSONL logging or design fallback heuristics.

**Phases with standard patterns (skip research-phase):**
- **Phase 1:** JSONL parsing, state management, aggregation are well-documented patterns
- **Phase 2:** VS Code file watching has official docs, extensive examples
- **Phase 3:** Status bar API is straightforward
- **Phase 5:** React + Recharts in webview has official VS Code guide + mature community examples
- **Phase 6:** Standard polish features, no novel patterns

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | **HIGH** | Official VS Code documentation confirms esbuild recommendation, React for webview, native TypeScript support in Node 22.18+. Multiple 2025/2026 guides align. |
| Features | **HIGH** | Five mature extensions exist with clear feature patterns. Marketplace reviews show consistent user expectations. ccusage CLI demonstrates proven burn rate + historical views. |
| Architecture | **HIGH** | Official VS Code extension guides cover singleton pattern, webview message passing, file watching. Community examples (Cline, Augment) show production-tested layered architectures. |
| Pitfalls | **MEDIUM-HIGH** | Pitfalls 1-6 sourced from official VS Code wiki, GitHub issues, production bug reports. Pitfalls 7-13 based on Node.js documentation and extension post-mortems. Pitfall 13 (rate limit detection) is LOW confidence due to undocumented JSONL format. |

**Overall confidence:** **HIGH**

VS Code extension development is a mature domain with comprehensive official documentation. The specific niche (Claude Code usage monitoring) has multiple existing implementations providing validated feature sets and architectural patterns. Primary uncertainty is Claude Code JSONL format (internal implementation detail, undocumented) but research includes actual JSONL examination from Claude Code 2.1.34 showing usage object structure.

### Gaps to Address

**Claude Code JSONL format stability:**
- Format is internal implementation detail, not officially documented
- Research examined version 2.1.34 files; format may change between versions
- Each line includes `"version": "2.1.34"` field — can use for format detection
- **Mitigation:** Version detection logic, graceful handling of unknown line types, design parser to skip unparseable lines rather than crash

**Rate limit event logging:**
- Unknown how (or if) Claude Code logs rate limit errors to JSONL
- Research shows API returns 429 with rate_limit_error and retry-after header, but JSONL logging format unclear
- **Mitigation:** Mark rate limit detection as "experimental" feature, implement best-effort heuristics, iterate based on user feedback and real session files

**Weekly limit tracking:**
- Added August 2025, only ~2% of users hit it
- Requires tracking active hours (compute time) vs wall-clock time
- Distinguishing compute vs idle sessions not documented in JSONL
- **Mitigation:** Defer to Phase 6 or v2, focus on 5-hour session limits (affects 100% of users)

**Webview testing:**
- Official VS Code testing tools don't support webview testing (documented limitation)
- Manual QA required for chart rendering, filters, UI interactions
- **Mitigation:** Plan for manual testing phase, consider Playwright if automated testing becomes critical

## Sources

### Primary (HIGH confidence)
- **VS Code Official Documentation:**
  - [Your First Extension](https://code.visualstudio.com/api/get-started/your-first-extension)
  - [Bundling Extensions](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)
  - [Webview API](https://code.visualstudio.com/api/extension-guides/webview)
  - [Testing Extensions](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
  - [Status Bar UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/status-bar)
  - [Activation Events Reference](https://code.visualstudio.com/api/references/activation-events)
  - [Common Capabilities](https://code.visualstudio.com/api/extension-capabilities/common-capabilities)

- **Extension Marketplace (existing solutions analysis):**
  - [Usage Monitor - Claude Code (kimchikingdom)](https://marketplace.visualstudio.com/items?itemName=kimchikingdom.claude-code-usage-monitor)
  - [Claude Token Monitor (Wilendar)](https://marketplace.visualstudio.com/items?itemName=Wilendar.claude-usage-monitor)
  - [Claude Code Usage Tracker (YahyaShareef)](https://marketplace.visualstudio.com/items?itemName=YahyaShareef.claude-code-usage-tracker)
  - [Claude Code Status Bar Monitor (bartosz-warzocha)](https://marketplace.visualstudio.com/items?itemName=bartosz-warzocha.claude-statusbar)
  - [Claude Code Usage Monitor (suzuki0430)](https://marketplace.visualstudio.com/items?itemName=suzuki0430.ccusage-vscode)

- **GitHub Repositories:**
  - [ryoppippi/ccusage - CLI tool](https://github.com/ryoppippi/ccusage) — demonstrates burn rate, historical views, weekly limits
  - [microsoft/vscode-vsce](https://github.com/microsoft/vscode-vsce) — official packaging tool
  - [Chokidar file watching](https://github.com/paulmillr/chokidar) — alternative to VS Code FileSystemWatcher

### Secondary (MEDIUM confidence)
- **Community Guides (2025/2026):**
  - [Building VS Code Extensions in 2026: The Complete Guide](https://abdulkadersafi.com/blog/building-vs-code-extensions-in-2026-the-complete-modern-guide) — esbuild recommendation, activation patterns
  - [Best React chart libraries (2025 update)](https://blog.logrocket.com/best-react-chart-libraries-2025/) — Recharts comparison
  - [Rebuilding state management: How we made our VS Code extension 2× faster](https://www.augmentcode.com/blog/rebuilding-state-management) — real-world optimization case study

- **Claude Code Limits & Architecture:**
  - [Claude Code Limits Guide - TrueFoundry](https://www.truefoundry.com/blog/claude-code-limits-explained) — 5-hour session windows, weekly limits
  - [Everything We Know About Claude Code Limits - Portkey](https://portkey.ai/blog/claude-code-limits/) — rate limit structure
  - [Claude Code Weekly Limit vs 5-Hour Lockout - Usagebar](https://usagebar.com/blog/claude-code-weekly-limit-vs-5-hour-lockout) — dual-layer system

- **VS Code Performance & Pitfalls:**
  - [Performance Issues - VS Code Wiki](https://github.com/microsoft/vscode/wiki/performance-issues) — activation timing
  - [File Watcher Issues - VS Code Wiki](https://github.com/microsoft/vscode/wiki/File-Watcher-Issues) — platform differences
  - [Escaping Misconfigured VSCode Extensions](https://blog.trailofbits.com/2023/02/21/vscode-extension-escape-vulnerability/) — webview security

### Tertiary (LOW confidence, needs validation)
- JSONL format reverse engineering based on Claude Code 2.1.34 session files (internal format, subject to change)
- Rate limit detection heuristics (JSONL logging format undocumented)
- Weekly limit tracking implementation details (active hours vs wall-clock time not documented)

---

*Research completed: 2026-02-07*
*Ready for roadmap: YES*
