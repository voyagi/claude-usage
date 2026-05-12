# Verified Accuracy Mode — Design Plan

**Status:** Planned (not yet scheduled)
**Origin:** Reddit scan of ClawdMeter (2026-05-12) + Rate Limits API discovery
**Prerequisite:** Per-message impact view (implemented)

## Problem

The extension estimates usage from local JSONL token counts. The actual
server-side utilization may differ due to:

- Tokens Claude Code consumes internally (system prompts, tool definitions)
- Rounding differences between local estimation and server-side counting
- Timing windows (5hr rolling window start/end edge cases)

ClawdMeter demonstrated that Anthropic exposes authoritative utilization
data via the `anthropic-ratelimit-unified-5h-utilization` response header.

## New Data Source: Rate Limits API (April 2026)

Anthropic shipped a read-only Admin API on April 25, 2026:
- Endpoint: Rate Limits API (platform.claude.com/docs/en/api/rate-limits)
- Returns same data as Console Limits page, in JSON
- Requires Admin API key (separate from OAuth)
- Read-only, no side effects

This is cleaner than ClawdMeter's approach of making a dummy messages
call just to read response headers.

## Design

### Principle: Trust-First

The extension's core differentiator is "zero network calls, fully local."
Verified accuracy mode must be:

1. **Off by default** — Zero behavior change for existing users
2. **Explicit opt-in** — User must configure an API key and enable the setting
3. **Clearly labeled** — UI must distinguish "Estimated" from "Verified" data
4. **Graceful degradation** — If API is unavailable, fall back to JSONL silently

### Settings

```json
{
  "claude-usage.verifiedAccuracy.enabled": false,
  "claude-usage.verifiedAccuracy.apiKey": ""
}
```

The API key setting should use VS Code's secret storage API (not plaintext
in settings.json) to avoid accidental exposure.

### Data Flow

```
Existing: JSONL files → parse → aggregate → estimate %
New:      Rate Limits API → fetch → authoritative %

Display: Show both when available
  Status bar: "78%" (uses best available source)
  Dashboard:  "Estimated: 78% | Verified: 76%" (when both available)
```

### Polling Strategy

- Reuse existing PollingTimer architecture
- Separate polling interval for Rate Limits API (every 60s when active)
- Respect 429s with exponential backoff
- Stop polling when VS Code is not focused (save quota)

### UI Changes

**Status bar:** No change when disabled. When enabled, show a small
checkmark icon next to the percentage to indicate verified data.

**Dashboard Overview tab:** Add "Data Source" indicator:
- "Local Only" (current, when disabled)
- "Local + Verified" (when enabled and API responding)
- "Local Only (API unavailable)" (when enabled but API down)

**Dashboard rate limit cards:** Show both values when available:
```
Session (5hr): 76%  [Verified]
Weekly:        23%  [Estimated — API key required for verified]
```

### Trust Messaging

Update README and Trust indicator:
- "By default, this extension makes zero network calls"
- "Optional: Enable Verified Accuracy Mode for server-confirmed usage data"
- "Your API key is stored in VS Code's secure credential storage"

### Files to Change

| File | Change |
|------|--------|
| `package.json` | New settings: `verifiedAccuracy.enabled`, `verifiedAccuracy.apiKey` |
| `src/api/rateLimitsApi.ts` | New file: Rate Limits API client |
| `src/api/pollingTimer.ts` | Add second timer for rate limits polling |
| `src/extension.ts` | Wire up rate limits polling when enabled |
| `src/ui/statusBar.ts` | Verified indicator icon |
| `src/webview/DashboardProvider.ts` | Pass verified vs estimated flag |
| `src/webview/app/types.ts` | Add `isVerified` to RateLimitData |
| `src/webview/app/components/OverviewTab.tsx` | Verified/estimated labels |
| `src/webview/app/components/TrustIndicator.tsx` | "Local + Verified" state |
| `README.md` | Document the feature |

### Estimated Effort

Medium (10-30 min per file, 6-8 files). Could be a single milestone
with 2-3 phases:
1. API client + polling + settings
2. UI integration (status bar + dashboard)
3. Trust messaging + docs

### Risks

- **API key management**: Must use SecretStorage, not plaintext config
- **Rate limiting**: Admin API may have its own rate limits
- **Key rotation**: Need to handle expired/revoked keys gracefully
- **Scope creep**: Don't add write operations or usage management features
