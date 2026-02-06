# Feature Landscape: Claude Code Usage Monitor Extensions

**Domain:** VS Code extensions for Claude Code usage monitoring
**Researched:** 2026-02-07
**Confidence:** HIGH

## Table Stakes

Features users expect. Missing = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Status bar display | Every extension has it; first place users look for quick info | Low | Format varies: percentage, cost, time remaining, or tokens. Clickable for details. |
| Real-time token tracking | Core purpose; users need to know consumption as it happens | Medium | Input, output, cache creation, cache read tokens must be tracked separately |
| Cost calculation | Users care about money; tokens alone aren't meaningful | Low | Must support all pricing tiers (Pro $20, Max5 $50, Max20 $200) with model-specific rates |
| 5-hour session window | Claude Code's rate limit structure; users expect accurate session tracking | Medium | Rolling window, not fixed intervals. Must detect first message timestamp and calculate expiry |
| Local data reading | All extensions read `~/.claude/projects/*.jsonl`; standard approach | Low | Cross-platform paths (Windows uses `%USERPROFILE%\.claude\projects\`) |
| Zero external calls | Privacy expectation; usage monitors shouldn't phone home | Low | Users explicitly value "no data sent to external services" in reviews |
| Automatic refresh | Stale data is useless; users expect live updates | Low | Typical: 30-60 second intervals, some as low as 1 second |
| Multi-plan support | Users on different tiers need accurate limits | Low | Pro (~44k tokens/window), Max5 (~88k), Max20 (~220k), Custom |
| Color-coded warnings | Visual urgency signals prevent surprise lockouts | Low | Green < 60-75%, Yellow 60-80%, Red > 80-90% |

## Differentiators

Features that set products apart. Not expected, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Burn rate prediction | "When will I hit the limit?" Users want to plan work sessions | Medium | Tokens/min calculation with time-to-limit forecasting. ccusage CLI does this well. |
| Detailed popup/panel | Status bar is cramped; clicking should reveal comprehensive breakdown | Low | Token categories, session timing, burn rate, model distribution, cost details |
| Historical data views | "How much did I spend this week/month?" Context for spending patterns | Medium | 7-day tables, monthly aggregates, daily sparklines. ccusage provides rich historical views. |
| Account-wide aggregation | Claude limits are account-level, not project-level. Multi-project visibility critical. | Medium | Most extensions are project-scoped; ccusage --instances flag does this |
| Weekly limit tracking | Added Aug 2025; dual-layer limit system (5hr + weekly). Only ~2% hit it but critical for heavy users. | High | Requires tracking active hours (not wall-clock time), distinguishing compute vs idle |
| Rate limit proximity warnings | Proactive alerts before lockout prevent workflow disruption | Low | Notifications at 75%, 80%, 90% thresholds. suzuki0430 extension mentions this. |
| Model-specific breakdown | Which model consumed tokens? Opus vs Sonnet vs Haiku have different costs/limits | Medium | Pie charts, bulleted lists, or tables showing per-model usage. ccusage --breakdown flag. |
| Cooldown/reset timer | "How long until my session resets?" Reduces anxiety and enables planning | Low | Display time remaining in current window. bartosz-warzocha shows "Reset: 03:45:12" |
| Export to JSON | Power users want raw data for custom analysis | Low | ccusage supports --json flag; valuable for automation/reporting |
| Configurable refresh intervals | Performance vs freshness tradeoff; users have different needs | Low | Range: 1-60 seconds typical. Lower = more file I/O. |
| Command palette integration | Quick access to plan switching, manual refresh, view toggle | Low | VS Code best practice; better UX than settings.json editing |
| Cache token visibility | Cache tokens don't count toward limits but do affect cost. Transparency matters. | Low | Distinguish cache_read (cheap, not rate-limited) from cache_creation (expensive, rate-limited) |
| Session timing display | When did current window start? When does it expire? | Low | Reduces guesswork; enables strategic pause timing |
| Multiple time aggregations | Daily, monthly, session-based views serve different questions | Medium | ccusage has daily/monthly/session/blocks commands; comprehensive reporting |
| Live monitoring dashboard | Real-time interactive view refreshing every second | Medium | ccusage blocks command with live mode; terminal-based but powerful |
| Compact mode for narrow spaces | Status bar width is limited; responsive formatting | Low | Truncate labels, use abbreviations, hide less critical data |

## Anti-Features

Features to explicitly NOT build. Common mistakes in this domain.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Network API calls to Anthropic | Privacy violation; users expect local-only operation. kimchikingdom extension is macOS-only because it uses Keychain OAuth (bad pattern). | Read local JSONL files only. All data already available locally. |
| Telemetry / analytics | Extensions monitoring AI usage should not themselves send usage data. Trust erosion. | Zero telemetry. Make it explicit in docs/README. |
| Authentication requirements | Claude Code already authenticated; extension shouldn't require separate login | Leverage existing local data; no auth needed |
| Real-time file watching with zero delay | File I/O overhead for negligible benefit. yahyashareef notes "1-5 second delay on some systems" | 30-60 second refresh is sufficient; balance freshness vs performance |
| Per-session tracking UI | Claude aggregates globally across sessions; showing per-session misleads users about limits | Show aggregated account-wide usage; match Claude's actual limit behavior |
| Hardcoded pricing | Models/pricing change; Opus pricing has already changed during development of these extensions | Configurable pricing tables; make updates easy without code changes |
| Assuming stable JSONL format | suzuki0430 had to fix "support for new Claude Code data format (post June 3, 2025)" | Version detection; support legacy + current formats gracefully |
| Weekly limit ignored | Aug 2025 change added weekly caps; ignoring creates false confidence | Track both 5-hour and weekly limits; show closest constraint |
| Sidebar-only UI | Status bar is first-class real estate; forcing sidebar navigation reduces utility | Always-visible status bar item; sidebar for optional deep dives |
| Exact token counting | Claude's server-side counting may differ from local estimation | Show "estimated" or "approximate"; don't promise exact values |
| Feature bloat | Some extensions try to launch Claude, manage sessions, configure MCP servers | Focus: usage monitoring only. Do one thing exceptionally well. |

## Feature Dependencies

```
Foundation Layer (Required First):
├─ Local JSONL parsing
├─ Cross-platform path resolution
└─ Multi-format version detection (legacy + current)

Core Features (Build Second):
├─ Token aggregation → Cost calculation
├─ Session window detection → Time remaining / reset timer
└─ 5-hour window tracking → Percentage calculation

Enhancement Features (Build Third):
├─ Burn rate → Time-to-limit prediction → Proximity warnings
├─ Historical data → Daily/weekly/monthly views → Export
├─ Model detection → Per-model breakdown → Cost attribution
└─ Account-wide aggregation → Multi-project visibility

Polish Features (Build Last):
├─ Color-coded status → Progressive disclosure (status bar → popup → panel)
├─ Command palette → Quick actions
└─ Configurable settings → Threshold customization
```

## MVP Recommendation

For MVP (greenfield project), prioritize:

1. **Status bar with essential metrics** - Time remaining, percentage used, cost. Color-coded.
2. **Accurate 5-hour session tracking** - Rolling window, first message detection, expiry calculation.
3. **Real-time token tracking** - All four types (input, output, cache_creation, cache_read).
4. **Cost calculation** - Pro/Max5/Max20 pricing tiers with model-specific rates.
5. **Detailed popup on click** - Token breakdown, session timing, burn rate.
6. **Account-wide aggregation** - Track across all projects; match Claude's actual behavior.
7. **Trust differentiator** - Zero network calls, fully local, transparent in docs/code.

Defer to post-MVP:

- **Historical views (7/30 day)** - Nice to have; not critical for preventing lockouts (core value prop)
- **Weekly limit tracking** - Only ~2% hit it; can add once 5-hour tracking solid
- **Export to JSON** - Power user feature; small audience
- **Live dashboard mode** - Cool but not essential; status bar covers most needs
- **Model-specific breakdown** - Interesting but not actionable for most users
- **Command palette integration** - UX polish; can add settings.json first

## Unique Opportunity: Trust as Differentiator

The project context states "Trust is the core differentiator." This is a REAL opportunity:

**Current landscape:**
- kimchikingdom.claude-code-usage-monitor: macOS-only, uses Keychain OAuth, calls Anthropic API (low trust)
- Wilendar.claude-token-monitor: Requires npm package installation, launches Claude from VS Code (complexity)
- Others: Local-only but don't emphasize it; "zero external calls" buried in READMEs

**Opportunity:**
1. **Transparent codebase** - Open source with clear, readable code. Comment liberally. Invite audit.
2. **No dependencies for core features** - Minimize attack surface. No network libraries.
3. **Privacy-first messaging** - Lead with "fully local, zero network calls" in marketplace description
4. **Trust indicators** - Display "local only" badge in UI; show data source path in settings
5. **No permission escalation** - Request minimal VS Code permissions; explain each in docs

**Why this matters:**
- AI usage data is sensitive (reveals project details, work patterns, costs)
- Users already anxious about Claude limits; don't want monitoring tool adding risk
- Multiple Reddit/HN threads about "extension security" and "data exposure in VSCode extensions"
- Market gap: no current extension leads with security/privacy as primary value prop

## Feature Gaps in Current Ecosystem

What's missing from ALL existing extensions:

1. **Burndown charts** - Visual time-series of token consumption. ccusage has tables but no charts.
2. **Budget alerts** - "Warn me if I'll exceed $X this month." Cost-based, not just token-based.
3. **Project-level budgeting** - "Allocate 30% of tokens to project A, 70% to project B."
4. **Rate limit auto-learning** - Detect actual limits from usage patterns vs requiring manual plan selection.
5. **Cooldown optimization** - "You have 12 minutes left; consider pausing to preserve for later."
6. **Multi-account support** - Developers with multiple Claude accounts (work vs personal).
7. **Inline code editor warnings** - Show token estimate BEFORE sending prompt (proactive).
8. **Session comparison** - "This session used 3x more than your average."
9. **Model recommendation** - "Haiku would handle this; save Opus tokens."
10. **Workspace-aware tracking** - Different VS Code workspaces may be different projects.

User context mentions: "auto-learn rate limits with manual override" - this is unique. Nobody does auto-learning.

## Sources

### Extension Marketplace Pages (HIGH confidence)
- [Usage Monitor - Claude Code (kimchikingdom)](https://marketplace.visualstudio.com/items?itemName=kimchikingdom.claude-code-usage-monitor)
- [Claude Token Monitor (Wilendar)](https://marketplace.visualstudio.com/items?itemName=Wilendar.claude-usage-monitor)
- [Claude Code Usage Tracker (YahyaShareef)](https://marketplace.visualstudio.com/items?itemName=YahyaShareef.claude-code-usage-tracker)
- [Claude Code Status Bar Monitor (bartosz-warzocha)](https://marketplace.visualstudio.com/items?itemName=bartosz-warzocha.claude-statusbar)
- [Claude Code Usage Monitor (suzuki0430)](https://marketplace.visualstudio.com/items?itemName=suzuki0430.ccusage-vscode)

### GitHub Repositories (HIGH confidence)
- [ryoppippi/ccusage - CLI tool](https://github.com/ryoppippi/ccusage)
- [suzuki0430/ccusage-vscode-extension](https://github.com/suzuki0430/ccusage-vscode-extension)
- [yahyashareef48/claude-usage-monitor](https://github.com/yahyashareef48/claude-usage-monitor)

### Official Documentation (HIGH confidence)
- [Claude Code Monitoring Documentation](https://code.claude.com/docs/en/monitoring-usage)
- [Claude Code Usage Analytics](https://support.claude.com/en/articles/12157520-claude-code-usage-analytics)

### Rate Limits & Architecture (MEDIUM-HIGH confidence)
- [Claude Code Limits Guide - TrueFoundry](https://www.truefoundry.com/blog/claude-code-limits-explained)
- [Claude Code Limits - ClaudeLog](https://claudelog.com/claude-code-limits/)
- [Everything We Know About Claude Code Limits - Portkey](https://portkey.ai/blog/claude-code-limits/)
- [Claude Code Weekly Limit vs 5-Hour Lockout - Usagebar](https://usagebar.com/blog/claude-code-weekly-limit-vs-5-hour-lockout)
- [Claude Token Counting Docs](https://platform.claude.com/docs/en/build-with-claude/token-counting)
- [Claude Rate Limits Docs](https://platform.claude.com/docs/en/api/rate-limits)

### Community & Problems (MEDIUM confidence)
- [Prevent Unexpected Claude Code Costs - DEV.to](https://dev.to/suzuki0430/prevent-unexpected-claude-code-costs-with-this-vscodecursor-extension-nlb)
- [Track Claude Token Usage in Real Time - Medium](https://yahya-shareef.medium.com/how-to-track-claude-token-usage-in-real-time-with-a-vs-code-extension-a596b40712c2)
- [Claude devs complain about surprise usage limits - The Register](https://www.theregister.com/2026/01/05/claude_devs_usage_limits/)

### VS Code Extension Security (MEDIUM confidence)
- [VS Code Extension Security](https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security)
- [Protect Your Secrets in VSCode Extensions - arXiv](https://arxiv.org/html/2412.00707v2)
- [Building a Privacy-First Coding Activity Tracker - DEV.to](https://dev.to/ernivani/building-a-privacy-first-coding-activity-tracker-for-vs-code-15g)
