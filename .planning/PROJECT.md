# Claude Usage Monitor

## What This Is

A VS Code extension that monitors Claude Code API usage in real-time by reading local JSONL session files. Built for trust: zero network calls, zero telemetry, fully transparent code owned by the user. Displays an always-on status bar with tokens, cost, and rate limit proximity, with a detailed sidebar panel showing session breakdowns, trends, and usage charts.

## Core Value

Accurate, trustworthy usage visibility — the user always knows where they stand against their plan limits without trusting third-party code with their data.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Always-on status bar showing input/output tokens, estimated cost, and rate limit proximity
- [ ] Sidebar panel with session breakdown, daily/weekly/monthly totals, and trend charts
- [ ] Auto-learn rate limits from actual rate-limit events, with manual override
- [ ] Reads all projects' JSONL files from ~/.claude/projects/ (account-wide tracking)
- [ ] Auto-refreshes as Claude Code runs (file watcher)
- [ ] Zero network calls — all data stays local
- [ ] Burn rate calculation and cooldown status display

### Out of Scope

- Network requests or telemetry of any kind — trust is the core differentiator
- Per-project filtering or breakdown — v1 tracks combined account usage only
- API plan support — built for Max $100 plan only (no pay-as-you-go billing integration)
- Mobile or web dashboard — VS Code extension only

## Context

- User is on Claude Max $100/month plan
- Rate limits for Max plans are not publicly documented with exact numbers — the extension must learn limits from observed rate-limit events over time
- Claude Code stores session data as JSONL files in `~/.claude/projects/` with one directory per project containing conversation logs
- User sometimes runs multiple Claude Code sessions across projects simultaneously
- Existing marketplace extensions have trust issues: potential data exfiltration, inaccurate numbers, risk of abandonment
- This extension must be dead simple to audit — minimal dependencies, transparent data flow

## Constraints

- **Tech stack**: TypeScript, VS Code Extension API, esbuild for bundling
- **Security**: Zero network calls. No outbound requests. No telemetry. No analytics.
- **Data source**: Local JSONL files only — no API calls to Anthropic
- **Dependencies**: Minimal — only what's strictly necessary for VS Code extension + charting in webview
- **Platform**: Must work on Windows (user's primary OS), should work cross-platform

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Local JSONL parsing only | Trust — no API keys or network access needed | — Pending |
| Always-on status bar | User wants constant visibility, not just alerts | — Pending |
| Auto-learn + manual override for rate limits | Max plan limits aren't documented; learn from reality but allow correction | — Pending |
| Account-wide tracking (all projects) | Rate limits are per-account, not per-project | — Pending |
| esbuild bundler | Fast builds, small output, standard for VS Code extensions | — Pending |

---
*Last updated: 2026-02-06 after initialization*
