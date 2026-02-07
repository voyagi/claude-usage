# Roadmap: Claude Usage Monitor

## Overview

Build a VS Code extension that monitors Claude Code API usage in real-time by reading local JSONL files. The journey starts with parsing and data aggregation infrastructure, adds file watching for real-time updates, delivers a minimal status bar UI for immediate value, enhances with rate limiting intelligence, expands to a rich webview dashboard, and polishes with trust features that differentiate from marketplace competitors. Every phase delivers verifiable user capabilities, building from foundation to full-featured monitor.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation & Core Parsing** - Domain models, JSONL parser, data aggregation, state store
- [ ] **Phase 2: File Watching & Integration** - Real-time file monitoring, cross-platform path handling, data pipeline integration
- [ ] **Phase 3: Basic UI (Status Bar)** - Always-on status bar showing tokens, cost, usage percentage with color coding
- [ ] **Phase 4: Rate Limiting & Burn Rate** - 5-hour session window tracking, burn rate calculation, proximity warnings
- [ ] **Phase 5: Webview Dashboard** - Detailed sidebar panel with charts, tables, historical views, session breakdown
- [ ] **Phase 6: Polish & Trust Features** - Privacy indicators, command palette, export, configuration UI, trust differentiators

## Phase Details

### Phase 1: Foundation & Core Parsing
**Goal**: Extension can accurately parse JSONL files and calculate token usage
**Depends on**: Nothing (first phase)
**Requirements**: DP-04, DP-06, TP-04, CX-03
**Success Criteria** (what must be TRUE):
  1. Extension correctly parses JSONL session files from Claude Code 2.1.34+ format
  2. Extension accurately calculates billable vs cached token usage (verified against Claude.ai web UI)
  3. Extension aggregates usage into time buckets (session, daily, weekly, monthly) with correct totals
  4. Extension handles incomplete JSONL writes without crashing (graceful error handling)
  5. Extension persists state across VS Code restarts using globalState
**Plans**: 4 plans

Plans:
- [x] 01-01-PLAN.md — Scaffold VS Code extension project, domain types, Zod schemas, utility modules
- [x] 01-02-PLAN.md — Streaming JSONL parser with error recovery, token extraction
- [x] 01-03-PLAN.md — Configurable pricing engine, plan selection, time bucket aggregation
- [x] 01-04-PLAN.md — UsageStore persistence, extension entry point wiring, integration verification

### Phase 2: File Watching & Integration
**Goal**: Extension monitors all Claude Code projects and updates usage in real-time
**Depends on**: Phase 1
**Requirements**: DP-01, DP-02, DP-03, DP-05
**Success Criteria** (what must be TRUE):
  1. Extension discovers and watches JSONL files across all projects in ~/.claude/projects/
  2. Extension detects new Claude Code activity within 30-60 seconds
  3. Extension handles file changes on Windows, macOS, and Linux correctly
  4. Extension reads files incrementally without re-parsing entire history on each change
  5. Extension properly disposes watchers when extension deactivates (no memory leaks)
**Plans**: 2 plans

Plans:
- [ ] 02-01-PLAN.md -- OffsetTracker + incremental JSONL parser with byte offset support
- [ ] 02-02-PLAN.md -- SessionWatcher with debounced file watching + extension lifecycle wiring

### Phase 3: Basic UI (Status Bar)
**Goal**: User sees their Claude usage at a glance in the status bar
**Depends on**: Phase 2
**Requirements**: SB-01, SB-02, SB-03, SB-04, SB-05, TP-01
**Success Criteria** (what must be TRUE):
  1. User sees always-on status bar showing input/output tokens, cost, and usage percentage
  2. Status bar color changes based on usage (green < 60%, yellow 60-80%, red > 80%)
  3. Status bar shows burn rate (tokens/min) when actively using Claude
  4. Status bar displays cooldown timer counting down to session window expiry
  5. Status bar adapts to narrow widths with compact mode
  6. Extension activates lazily and doesn't slow VS Code startup
**Plans**: TBD

Plans:
- [ ] TBD

### Phase 4: Rate Limiting & Burn Rate
**Goal**: User knows when they'll hit rate limits and can plan usage accordingly
**Depends on**: Phase 3
**Requirements**: RL-01, RL-02, RL-03, RL-04, RL-05, RL-06
**Success Criteria** (what must be TRUE):
  1. Extension tracks 5-hour rolling window with accurate session start and expiry
  2. Extension calculates burn rate and predicts time until rate limit
  3. Extension warns user at configurable thresholds (75%, 80%, 90%)
  4. User can manually override rate limit settings if auto-detection is inaccurate
  5. Extension tracks weekly usage limits and shows proximity
  6. Extension learns actual rate limits from observed rate-limit events over time
**Plans**: TBD

Plans:
- [ ] TBD

### Phase 5: Webview Dashboard
**Goal**: User can view detailed usage breakdown, historical trends, and session analysis
**Depends on**: Phase 4
**Requirements**: SP-01, SP-02, SP-03, SP-04, SP-05, SP-06, TP-02
**Success Criteria** (what must be TRUE):
  1. Clicking status bar opens sidebar panel with detailed breakdown
  2. User sees token breakdown separated by type (input, output, cache_creation, cache_read)
  3. User sees session timing (window start, expiry, time remaining)
  4. User views trend charts showing usage over time (bar/line charts)
  5. User can switch between daily, weekly, and monthly aggregation views
  6. User sees how current session compares to their average
  7. Panel displays "Local Only" trust indicator
**Plans**: TBD

Plans:
- [ ] TBD

### Phase 6: Polish & Trust Features
**Goal**: Extension demonstrates trustworthiness and provides power-user features
**Depends on**: Phase 5
**Requirements**: CX-01, CX-02, CX-04, CX-05, TP-03
**Success Criteria** (what must be TRUE):
  1. User can access key functions via command palette (refresh, plan selection, export)
  2. User can export usage data to JSON for custom analysis
  3. Settings UI shows data source path for transparency
  4. User can configure refresh interval, warning thresholds, and pricing overrides
  5. Extension only activates when Claude Code data directory exists
  6. Documentation clearly states "zero network calls, fully local"
**Plans**: TBD

Plans:
- [ ] TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Core Parsing | 4/4 | Complete | 2026-02-07 |
| 2. File Watching & Integration | 0/2 | Planned | - |
| 3. Basic UI (Status Bar) | 0/TBD | Not started | - |
| 4. Rate Limiting & Burn Rate | 0/TBD | Not started | - |
| 5. Webview Dashboard | 0/TBD | Not started | - |
| 6. Polish & Trust Features | 0/TBD | Not started | - |
