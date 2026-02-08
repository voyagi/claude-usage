# Claude Usage Monitor

## What This Is

A VS Code extension that monitors Claude Code API usage in real-time by reading local JSONL session files. Built for trust: zero network calls, zero telemetry, fully transparent code owned by the user. Features an always-on status bar with tokens, cost, burn rate, and rate limit proximity, a React webview dashboard with usage trends and session analysis, and intelligent rate limit tracking that learns from observed 429 events.

## Core Value

Accurate, trustworthy usage visibility -- the user always knows where they stand against their plan limits without trusting third-party code with their data.

## Requirements

### Validated

- Always-on status bar showing input/output tokens, estimated cost, and rate limit proximity -- v1.0
- Sidebar panel with session breakdown, daily/weekly/monthly totals, and trend charts -- v1.0
- Auto-learn rate limits from actual rate-limit events, with manual override -- v1.0
- Reads all projects' JSONL files from ~/.claude/projects/ (account-wide tracking) -- v1.0
- Auto-refreshes as Claude Code runs (file watcher) -- v1.0
- Zero network calls -- all data stays local -- v1.0
- Burn rate calculation and cooldown status display -- v1.0

### Active

(None yet -- next milestone to be defined)

### Out of Scope

- Network requests or telemetry of any kind -- trust is the core differentiator
- Per-project filtering or breakdown -- v1 tracks combined account usage only
- API pay-as-you-go billing integration -- built for subscription plans only
- Mobile or web dashboard -- VS Code extension only
- MCP server management -- stay focused on usage monitoring

## Context

- User is on Claude Max $100/month plan
- v1.0 shipped with 5,378 lines of TypeScript/TSX across 6 phases
- Tech stack: TypeScript, VS Code Extension API, esbuild, React + Recharts (webview)
- Extension reads from ~/.claude/projects/ (JSONL session files) and ~/.claude/.credentials.json (tier detection)
- Rate limits are estimated from token counting + learned from observed 429 events
- 23 unit tests covering tier detection and burn rate calculation
- Extension bundle: 248 KB (Node.js), Webview bundle: 2.0 MB (React + Recharts)

## Constraints

- **Tech stack**: TypeScript, VS Code Extension API, esbuild for bundling, React + Recharts for webview
- **Security**: Zero network calls. No outbound requests. No telemetry. No analytics.
- **Data source**: Local JSONL files only -- no API calls to Anthropic
- **Dependencies**: Minimal -- React, Recharts, date-fns, Zod for validation
- **Platform**: Must work on Windows (user's primary OS), should work cross-platform

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Local JSONL parsing only | Trust -- no API keys or network access needed | Good |
| Always-on status bar | User wants constant visibility, not just alerts | Good |
| Auto-learn + manual override for rate limits | Max plan limits aren't documented; learn from reality but allow correction | Good |
| Account-wide tracking (all projects) | Rate limits are per-account, not per-project | Good |
| esbuild bundler | Fast builds, small output, standard for VS Code extensions | Good |
| Streaming parser with error recovery | Active sessions write incomplete JSON; skip corrupt lines | Good |
| Dual bundling (extension + webview) | Extension needs Node.js CJS, webview needs browser IIFE | Good |
| EMA-smoothed burn rate | More stable predictions than simple average, configurable alpha | Good |
| Output tokens for rate limit tracking | Claude primarily constrains output generation | Good |
| Downward-only limit refinement | When 429 observed, set limit to 95% of observed usage (never increase) | Good |
| Recharts for visualization | Full-featured React charting library, good TypeScript support | Revisit (2.0 MB bundle) |

---

*Last updated: 2026-02-08 after v1.0 milestone*
