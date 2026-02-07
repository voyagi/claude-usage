# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-06)

**Core value:** Accurate, trustworthy usage visibility — the user always knows where they stand against their plan limits without trusting third-party code with their data.
**Current focus:** Phase 6 - Polish & Trust Features — COMPLETE

## Current Position

Phase: 6 of 6 (Polish & Trust Features) — COMPLETE
Plan: 3 of 3 in current phase (all plans complete)
Status: Phase complete - all roadmap success criteria verified
Last activity: 2026-02-08 — Completed 06-03-PLAN.md (Trust-Focused README)

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 24
- Average duration: 3.8 minutes
- Total execution time: 1.6 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 - Foundation | 4 | 20min | 5.0min |
| 02 - File Watching | 2 | 7min | 3.5min |
| 03 - Basic UI | 3 | 9min | 3.0min |
| 04 - Rate Limiting | 6 | 28min | 4.7min |
| 05 - Webview Dashboard | 6 | 23min | 3.8min |
| 06 - Polish & Trust | 3 | 16min | 5.3min |

**Recent Trend:**
- Last 5 plans: 3min, 4min, 4min, 7min, 5min
- Trend: Consistent ~4-5min pace maintained through completion

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Local JSONL parsing only (trust — no API keys or network access needed)
- Always-on status bar (user wants constant visibility, not just alerts)
- Auto-learn + manual override for rate limits (Max plan limits aren't documented; learn from reality but allow correction)
- Account-wide tracking (rate limits are per-account, not per-project)
- esbuild bundler (fast builds, small output, standard for VS Code extensions)
- Strict TypeScript from Day 1 (01-01): Enabled strict mode for early error detection
- Named exports only (01-01): Explicit dependency tracking across all modules
- Zod for runtime validation (01-01): Ensures JSONL parsing handles schema changes gracefully
- Streaming parser approach (01-02): readline + createReadStream avoids file locks and memory issues
- Skip corrupt lines (01-02): Active sessions write incomplete JSON; parser continues instead of failing
- Cache-aware billable tokens (01-02): Exclude cache reads from rate limit calculations per Claude 4.x behavior
- Configurable pricing (01-03): VS Code settings allow users to update rates without extension updates
- Local timezone for calendar boundaries (01-03): Users think "today" in local time, not UTC
- ISO week standard (01-03): Monday start aligns with international business week conventions
- Cached data first (01-04): Load globalState on activation for instant status bar, then reparse
- globalState for offset persistence (02-01): Tracks per-file byte offsets across VS Code reloads for incremental parsing
- Simple byte counting for offset tracking (02-01): Accept rare incomplete line edge case, mitigated by full reparse on activation
- 500ms debounce for file changes (02-02): Balances responsiveness vs duplicate parsing during rapid JSONL writes
- Callback-based watcher architecture (02-02): SessionWatcher notifies extension via onUpdate callback for separation of concerns
- Conservative token limit estimates (03-01): Pro 45K/500K/500K, Max5 225K/2.5M/2.5M, Max20 900K/10M/10M based on community reports
- Output tokens for rate limits (03-01): Rate limit calculations use output tokens since Claude primarily constrains output generation
- Pure data modules (03-01): rateLimits.ts and formatting.ts have no VS Code dependencies for independent testing
- Dual status bar items (03-02): Separate metrics and cooldown items for independent visibility control
- Command-based decoupling (03-02): Status bar items invoke commands via registry, not direct imports
- ThemeColor backgrounds (03-02): Use VS Code ThemeColor API for adaptive status bar colors (green/yellow/red)
- Command registration pattern (03-03): Register all commands in activate() with inline handlers for closure access to context
- Config change auto-refresh (03-03): Auto-refresh on any claude-usage.* config change to ensure UI consistency
- Legacy clearData kept (03-03): Maintain backwards compatibility for early adopters with keyboard shortcuts
- Urgency scoring for rate limits (04-02): Use percentage * 1/sqrt(hoursUntilReset) to identify most critical limit
- Optional burn rate override (04-02): buildStatusBarData accepts EMA-smoothed burn rate while keeping simple fallback
- Callback-only tier changes (04-03): CredentialsWatcher fires onTierChange only when tier actually changes, not on every file write
- Downward-only limit refinement (04-03): When 429 observed, adjust limit estimate to 95% of observed usage (never increase estimates)
- Default warning thresholds (04-03): Yellow at 60%, red at 95%, with 15-minute burn rate window as sensible defaults
- User override precedence (04-04): Explicit user planType setting takes precedence over auto-detected tier from credentials.json
- Config thresholds at display time (04-04): Warning thresholds read from config on every update() call for live config changes
- Urgency score visibility (04-04): Shown in tooltip alongside each rate limit for power user context
- Composite map key for modelWeekly (04-06): "YYYY-WII:model-name" enables per-model queries without schema changes
- Optional serialized field for backward compat (04-06): SerializedTimeBuckets.modelWeekly uses ? for existing persisted data
- Separate rate limit event callback (04-05): onRateLimitEvent is third optional param to SessionWatcher, not merged into onUpdate
- Effective limit pattern (04-05): refinedLimits?.X ?? plan.X for all three limit types in calculateRateLimits
- Discriminated union messages (05-02): WebviewMessage and ExtensionMessage use type field for type-safe postMessage communication
- ISO string serialization (05-02): DashboardData uses ISO timestamps not Date objects for safe JSON serialization across iframe boundary
- Visibility-aware refresh (05-02): DashboardProvider caches data and sends immediately when webview becomes visible
- CSP with unsafe-inline styles (05-02): Allow React inline styles while nonce-protecting scripts
- Dual bundling strategy (05-01): Separate esbuild configs for extension (Node.js/CJS) and webview (browser/IIFE) with parallel builds
- Automatic JSX transform (05-01): react-jsx eliminates need for React imports in every TSX file
- Sidebar view placement (05-01): Activity bar registration for persistent dashboard visibility alongside other extensions
- acquireVsCodeApi singleton (05-03): Called once at module level, exported for all components (VS Code allows only one call)
- Tab state persistence (05-03): Active tab stored via vscode.setState for session continuity across webview reloads
- Local formatting helpers (05-03): Components define own formatters using Intl APIs - no VS Code dependencies in webview bundle
- Color tokens as CSS variables (05-03): Token type colors in :root for reuse across charts and visualizations
- Progress bar thresholds (05-03): <60% safe, 60-95% warning, ≥95% critical for rate limit color coding
- Inline styles for components (05-04): Component styles use inline styles with CSS variable references for theme awareness
- Custom tooltip with any typing (05-04): Recharts TooltipProps typing used props: any with internal type annotations for payload mapping
- Cost summary as separate card (05-04): Cost displayed in dedicated card below chart for clear visual hierarchy
- Data table collapsed by default (05-04): Expandable table starts collapsed to prioritize visual trend understanding
- Extension-side data aggregation (05-04): Period selection messages extension which handles aggregation and returns appropriate data
- Comparison bar scaling (05-05): Visual comparison bars scale to max(current, average) for clear relative sizing
- Session duration derivation (05-05): Calculated from timeRemaining field (300 - remaining) rather than new DashboardData field
- Separate edge case messaging (05-05): Distinguish "no active session" from "not enough sessions for comparison"
- Session averages from all history (05-06): averageSessionTokens computed as mean of ALL sessions' outputTokens (not just recent)
- Period switching via cached buckets (05-06): DashboardProvider caches TimeBuckets and rebuilds trend data on period change (no extension re-query)
- Cache tokens from daily bucket (05-06): Extract cacheCreationTokens and cacheReadTokens from today's daily bucket for Overview tab
- Status bar opens dashboard (05-06): Both metricsItem and cooldownItem click commands changed to openDashboard (sidebar focus)
- Activation guard silently returns (06-01): Extension inactive if ~/.claude/ missing - no error message to avoid noise for non-Claude users
- Command palette categorization (06-01): All 12 commands use "Claude Usage" category for clear grouping
- Export uses workspace.fs API (06-01): Remote/SSH compatibility via VS Code's virtual filesystem
- Config scope separation (06-01): application for plan/pricing (global), window for UI/display preferences
- Dual-format export (06-01): exportedAt, extensionVersion, dataSource, planType, summary (human), raw (machine)
- Version-based welcome dismissal (06-02): Use welcomeDismissedVersion key instead of boolean for future reset capability if message changes
- Custom pricing detection via config object (06-02): Object.keys(pricing).length > 0 detects any pricing override without key enumeration
- Data source path from utility (06-02): Use getClaudeProjectsDir() for consistency in transparency footer
- Trust-first documentation (06-03): README structure prioritizes permissions tables (what IS and IS NOT accessed) before features
- No emoji in documentation (06-03): Project conventions prohibit emoji in README and code files

### Local Data Sources Discovery (2026-02-07)

Investigated what Claude Code caches locally (relevant to Phases 2-4):

**~/.claude/.credentials.json** — contains `rateLimitTier: "default_claude_max_5x"` and `subscriptionType: "max"`.
→ Can auto-detect plan instead of manual setting. Affects Phase 3-4 design.

**~/.claude/stats-cache.json** — daily message counts, session counts, per-model token breakdowns.
→ Complementary to our JSONL parsing. Could cross-validate or supplement.

**Rate limit structure** (from VS Code "Account & Usage" panel):
- 3 separate limits: Session (5hr), Weekly (7 day), Weekly Sonnet (model-specific)
- Each has its own reset countdown
- Percentages and reset timers are **fetched from API in real-time** — NOT cached locally
→ Phase 4 must estimate proximity from observed tokens, cannot read exact % without network calls.

### Pending Todos

None yet.

### Blockers/Concerns

- Token aggregation accuracy is critical from Phase 1. Must verify against Claude.ai web UI to avoid 5-10x inflation errors seen in other extensions.

**Resolved:**
- ✅ Phase 4 rate limit estimation: Implemented with EMA smoothing, auto tier detection, and configurable thresholds. Phase 4 complete.

## Session Continuity

Last session: 2026-02-08 00:48
Stopped at: Completed 06-03-PLAN.md (Trust-Focused README) — PHASE 6 COMPLETE
Resume file: None
Next: Project complete - ready for testing, packaging, and marketplace submission
