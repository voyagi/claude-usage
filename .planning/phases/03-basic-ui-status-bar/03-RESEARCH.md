# Phase 3: Basic UI (Status Bar) - Research

**Researched:** 2026-02-07
**Domain:** VS Code Extension Status Bar UI
**Confidence:** HIGH

## Summary

Phase 3 focuses on building an always-on, responsive status bar UI for displaying Claude usage metrics in VS Code. The core challenge is presenting multi-dimensional data (three rate limits, tokens, cost, burn rate, cooldown timers) in a compact, glanceable format while maintaining performance.

VS Code provides mature status bar APIs with built-in support for alignment, priority ordering, tooltips, icons (codicons), theme colors for warnings/errors, and command binding. The standard approach is to create multiple StatusBarItems when displaying independent pieces of information, use the dispose pattern for cleanup, update items only when data changes (avoid excessive refreshes), and leverage theme colors rather than custom colors for consistency.

The existing project architecture already has the data pipeline in place: SessionWatcher provides callbacks with updated TimeBuckets, UsageStore handles globalState persistence, and extension.ts contains a basic status bar implementation with number formatting. Phase 3 extends this with multiple items, rate limit tracking, dynamic color-coding, compact mode, and quick pick menus.

**Primary recommendation:** Create two StatusBarItems (metrics + cooldown), bind to SessionWatcher's onUpdate callback, use ThemeColor for warning/error backgrounds based on usage thresholds, implement compact mode logic based on window state, and handle clicks with showQuickPick for interim actions before Phase 5's webview.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| VS Code Extension API | 1.96.0+ | Status bar UI, commands, quick picks | Built-in, authoritative, stable API |
| date-fns | 4.1.0 | Time calculations, formatting | Already in project, standard for date operations |
| TypeScript | 5.7.0 | Type safety | Project requirement, catches UI binding errors |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Codicons | (built-in) | Status bar icons | Use $(icon-name) syntax in StatusBarItem.text |
| ThemeColor | (VS Code API) | Semantic colors | For warning/error backgrounds, respects user themes |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Multiple StatusBarItems | Single overloaded item | Single item requires complex text formatting and loses tooltip granularity |
| VS Code QuickPick | Custom webview for interim menu | QuickPick is standard, lightweight, no HTML/CSS needed |
| ThemeColor backgrounds | Custom hex colors | Custom colors break theme consistency, violate UX guidelines |

**Installation:**
```bash
# No new dependencies needed — all built into VS Code API and existing project stack
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── ui/                  # NEW: UI-specific logic
│   ├── statusBar.ts     # StatusBarManager class
│   ├── quickPick.ts     # Quick pick menu logic
│   └── formatting.ts    # Number/time formatting utilities
├── core/                # Existing — rate limit logic
│   └── rateLimits.ts    # NEW: Rate limit calculations
├── extension.ts         # Wire StatusBarManager to SessionWatcher
└── types.ts             # Add RateLimitStatus interfaces
```

### Pattern 1: StatusBarManager Class
**What:** Encapsulate all status bar logic (creation, updates, disposal) in a single class
**When to use:** When managing multiple status bar items with shared state/logic
**Example:**
```typescript
// Source: VS Code Extension Patterns - https://vscode-docs.readthedocs.io/en/stable/extensions/patterns-and-principles/
export class StatusBarManager {
  private metricsItem: vscode.StatusBarItem;
  private cooldownItem: vscode.StatusBarItem;
  private isCompactMode = false;

  constructor(context: vscode.ExtensionContext) {
    // Create two items with distinct priorities
    this.metricsItem = vscode.window.createStatusBarItem(
      'claude-usage.metrics',
      vscode.StatusBarAlignment.Right,
      100
    );
    this.cooldownItem = vscode.window.createStatusBarItem(
      'claude-usage.cooldown',
      vscode.StatusBarAlignment.Right,
      99
    );

    // Register for disposal
    context.subscriptions.push(this.metricsItem, this.cooldownItem);
  }

  update(buckets: TimeBuckets, stats: ParseStats): void {
    // Calculate rate limit statuses
    const limits = calculateRateLimits(buckets);

    // Update metrics item
    this.metricsItem.text = this.formatMetrics(limits);
    this.metricsItem.backgroundColor = this.getBackgroundColor(limits);
    this.metricsItem.tooltip = this.formatTooltip(limits);

    // Update cooldown item
    this.cooldownItem.text = this.formatCooldown(limits);

    // Show items
    this.metricsItem.show();
    this.cooldownItem.show();
  }

  private getBackgroundColor(limits: RateLimitStatus): vscode.ThemeColor | undefined {
    const maxUsage = Math.max(limits.session5h.percent, limits.weekly.percent, limits.weeklySonnet.percent);
    if (maxUsage >= 80) {
      return new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (maxUsage >= 60) {
      return new vscode.ThemeColor('statusBarItem.warningBackground');
    }
    return undefined; // Green (default)
  }

  dispose(): void {
    this.metricsItem.dispose();
    this.cooldownItem.dispose();
  }
}
```

### Pattern 2: Command + Quick Pick for Interim Actions
**What:** Bind status bar items to commands that show VS Code's native quick pick menu
**When to use:** When you need user interaction but don't want a full webview yet (interim UI)
**Example:**
```typescript
// Source: VS Code quickinput-sample - https://github.com/microsoft/vscode-extension-samples/tree/main/quickinput-sample
export async function showUsageMenu(): Promise<void> {
  const items: vscode.QuickPickItem[] = [
    { label: '$(refresh) Refresh Data', description: 'Reparse JSONL files now' },
    { label: '$(gear) Switch Plan Tier', description: 'Change your Claude plan' },
    { label: '$(graph) View Usage Summary', description: 'Open usage dashboard' },
    { label: '$(trash) Reset Session Tracking', description: 'Clear session window data' },
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Choose an action',
  });

  if (!selected) {
    return;
  }

  // Handle selection
  if (selected.label.includes('Refresh')) {
    await vscode.commands.executeCommand('claude-usage.refresh');
  } else if (selected.label.includes('Switch Plan')) {
    await vscode.commands.executeCommand('claude-usage.switchPlan');
  }
  // ... etc
}
```

### Pattern 3: Spinner Icon During Updates
**What:** Show animated spinner when data is being reparsed
**When to use:** Any long-running operation (>100ms) triggered by user action
**Example:**
```typescript
// Source: VS Code Product Icons - https://code.visualstudio.com/api/references/icons-in-labels
async refreshData(): Promise<void> {
  // Show spinner
  this.metricsItem.text = '$(sync~spin) Refreshing...';
  this.metricsItem.backgroundColor = undefined; // Clear color during refresh

  try {
    await this.watcher.reparse();
    // SessionWatcher callback will update status bar with new data
  } catch (err) {
    this.metricsItem.text = '$(warning) Refresh failed';
    this.metricsItem.tooltip = err.message;
  }
}
```

### Pattern 4: Compact Mode Based on Window State
**What:** Detect narrow windows and abbreviate status bar text
**When to use:** When status bar must adapt to constrained space
**Example:**
```typescript
// Note: VS Code API doesn't expose window dimensions directly
// Workaround: Make compact mode user-configurable via settings
// Alternative: Use heuristic based on text length and monitor for truncation

// Approach 1: User setting (RECOMMENDED)
const config = vscode.workspace.getConfiguration('claude-usage');
const compactMode = config.get<boolean>('compactMode', false);

if (compactMode) {
  this.metricsItem.text = `$(cloud) $${cost.toFixed(0)}`;
} else {
  this.metricsItem.text = `$(cloud) Claude: $${cost.toFixed(2)} | ${formatTokens(tokens)} tok`;
}

// Approach 2: Auto-detect (LOW confidence — no direct API)
// Monitor for user feedback that items are truncated, then suggest enabling compact mode
```

### Anti-Patterns to Avoid
- **Multiple overlapping updates:** Don't update status bar on every token change — SessionWatcher's 500ms debounce already handles this
- **Custom color hex codes:** Use ThemeColor for backgrounds, never `backgroundColor = '#ff0000'` — breaks user themes
- **Excessive tooltip text:** VS Code truncates long tooltips — keep under 20 lines, use formatting for readability
- **Forgetting to show() items:** Creating StatusBarItem doesn't display it — must call `.show()` explicitly
- **Not disposing items:** Always add to `context.subscriptions` — memory leaks are common pitfall

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Number abbreviation (1.2K, 3.4M) | Custom logic with conditionals | Existing `formatTokens()` in extension.ts | Already implemented, tested, handles edge cases |
| Icon display in status bar | HTML/CSS rendering | Codicons `$(icon-name)` syntax | Built-in, theme-aware, no DOM needed |
| Warning/error colors | Custom color picker | `ThemeColor('statusBarItem.warningBackground')` | Semantic, theme-consistent, accessible |
| User action menu | Custom HTML panel | `vscode.window.showQuickPick()` | Native look, keyboard nav, built-in search |
| Time duration formatting | String manipulation | `date-fns` `formatDuration()` or `differenceInMinutes()` | Already a dependency, i18n support |
| Rate limit calculations | Ad-hoc math | Dedicated `calculateRateLimits()` function | Testable, reusable across UI contexts |

**Key insight:** VS Code's status bar API is mature and handles most common patterns. The temptation is to "add features" with custom rendering, but this breaks consistency with other extensions and user themes. Stick to the built-in capabilities.

## Common Pitfalls

### Pitfall 1: Status Bar Item Priority Confusion
**What goes wrong:** Items appear in unexpected order or get pushed off-screen
**Why it happens:** Higher priority numbers place items CLOSER to the center, not farther away. Multiple extensions compete for space.
**How to avoid:** Use priority 100 for primary item, 99 for secondary, 98 for tertiary. This keeps them together and near the right edge. Test with other extensions installed.
**Warning signs:** User reports "I don't see the cooldown timer" — priority too low, pushed off by other extensions

### Pitfall 2: Memory Leaks from Undisposed StatusBarItems
**What goes wrong:** Extension consumes more memory over time, especially during reload/disable cycles
**Why it happens:** VS Code doesn't automatically dispose StatusBarItems. Each activation creates new items that persist until manually disposed.
**How to avoid:** Always add items to `context.subscriptions.push()` — VS Code calls dispose() on deactivation. Use a manager class that implements `dispose()` method.
**Warning signs:** Memory profiling shows increasing StatusBarItem count after multiple activations

### Pitfall 3: Excessive Status Bar Updates Cause UI Lag
**What goes wrong:** Status bar flickers, VS Code becomes sluggish, CPU usage spikes
**Why it happens:** Updating StatusBarItem.text triggers DOM reflow. Doing this on every file save or token count change (potentially hundreds per second) degrades performance.
**How to avoid:** SessionWatcher already debounces file changes (500ms). Don't add additional update triggers. If burn rate is live (tokens/min), throttle updates to 1-2 second intervals.
**Warning signs:** User reports "VS Code freezes when Claude Code is active" — check update frequency

### Pitfall 4: Tooltip Becomes Unreadable with Too Much Data
**What goes wrong:** Tooltip displays all three rate limits, all token counts, burn rate, timers — user can't parse it
**Why it happens:** Developer mindset: "show all the data!" But tooltips are glanceable, not dashboards.
**How to avoid:** Prioritize information hierarchy. Show most critical first (worst rate limit), group related data, use blank lines for separation. Limit to ~10 lines.
**Warning signs:** User feedback: "I can't find the cooldown timer in the tooltip"

### Pitfall 5: Color-Coding Without Foreground Adjustment
**What goes wrong:** Red/yellow backgrounds with default foreground text create unreadable combinations in some themes
**Why it happens:** `statusBarItem.errorBackground` changes background, but foreground might stay same color. Some themes have low contrast.
**How to avoid:** VS Code auto-adjusts foreground for error/warning backgrounds, but verify in both light and dark themes. Don't set custom `foreground` — let VS Code handle it.
**Warning signs:** User reports "I can't read the status bar when it turns yellow"

### Pitfall 6: Assuming Window State API Exposes Width
**What goes wrong:** Code tries to read `window.state.width` to trigger compact mode — property doesn't exist
**Why it happens:** VS Code's `window.onDidChangeWindowState` fires on focus/activity changes, not dimension changes. No direct width API.
**How to avoid:** Use a user setting for compact mode (`claude-usage.compactMode`) instead of auto-detection. Document when users should enable it (narrow windows).
**Warning signs:** Runtime error "property 'width' does not exist on type 'WindowState'"

### Pitfall 7: Status Bar Commands Not Registered
**What goes wrong:** Clicking status bar item does nothing, or shows "command not found" error
**Why it happens:** StatusBarItem.command is set to a string, but no corresponding `vscode.commands.registerCommand()` call exists
**How to avoid:** Always register command handlers before assigning to `.command`. Add registration to `context.subscriptions`. Use command palette to test.
**Warning signs:** Console shows `command 'claude-usage.showMenu' not found`

## Code Examples

Verified patterns from official sources:

### Creating Two Status Bar Items with Priority
```typescript
// Source: VS Code Extension API - https://code.visualstudio.com/api/ux-guidelines/status-bar
export function createStatusBarItems(context: vscode.ExtensionContext) {
  // Primary metrics item (right-aligned, priority 100)
  const metricsItem = vscode.window.createStatusBarItem(
    'claude-usage.metrics', // ID for ordering
    vscode.StatusBarAlignment.Right,
    100
  );
  metricsItem.command = 'claude-usage.showMenu';

  // Cooldown/timer item (right-aligned, priority 99 — appears right of metrics)
  const cooldownItem = vscode.window.createStatusBarItem(
    'claude-usage.cooldown',
    vscode.StatusBarAlignment.Right,
    99
  );
  cooldownItem.command = 'claude-usage.showMenu';

  // Register for automatic disposal
  context.subscriptions.push(metricsItem, cooldownItem);

  return { metricsItem, cooldownItem };
}
```

### Using ThemeColor for Semantic Warning/Error Backgrounds
```typescript
// Source: VS Code Theme Color Reference - https://code.visualstudio.com/api/references/theme-color
function applyColorCoding(item: vscode.StatusBarItem, usagePercent: number): void {
  if (usagePercent >= 80) {
    // Red background for critical (>80%)
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  } else if (usagePercent >= 60) {
    // Yellow background for warning (60-80%)
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    // Green (default) for normal (<60%)
    item.backgroundColor = undefined;
  }
}
```

### Formatting Duration for Cooldown Timer
```typescript
// Source: date-fns documentation - https://date-fns.org/
import { differenceInMinutes, differenceInHours } from 'date-fns';

function formatCooldown(resetTime: Date): string {
  const now = new Date();
  const totalMinutes = differenceInMinutes(resetTime, now);

  if (totalMinutes <= 0) {
    return 'Ready now';
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

// Usage in status bar
cooldownItem.text = `$(clock) ${formatCooldown(sessionResetTime)}`;
```

### Showing Quick Pick Menu with Icons
```typescript
// Source: VS Code quickinput-sample - https://github.com/microsoft/vscode-extension-samples/blob/main/quickinput-sample/src/extension.ts
async function showUsageMenu(): Promise<void> {
  const items: vscode.QuickPickItem[] = [
    {
      label: '$(refresh) Refresh Data',
      description: 'Reparse all JSONL files',
      detail: 'Useful if you notice stale data'
    },
    {
      label: '$(gear) Switch Plan Tier',
      description: 'Change your Claude plan (Pro, Max 5x, Max 20x)',
    },
    {
      label: '$(graph) View Usage Summary',
      description: 'Open detailed usage dashboard',
      detail: 'Shows daily/weekly/monthly breakdowns'
    },
    {
      label: '$(trash) Reset Session Tracking',
      description: 'Clear session window counters',
    },
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Claude Usage Monitor — Choose an action',
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!selected) {
    return; // User cancelled
  }

  // Dispatch based on selection
  if (selected.label.includes('Refresh')) {
    await vscode.commands.executeCommand('claude-usage.refresh');
  } else if (selected.label.includes('Switch Plan')) {
    await vscode.commands.executeCommand('claude-usage.switchPlan');
  } else if (selected.label.includes('View Usage')) {
    await vscode.commands.executeCommand('claude-usage.openDashboard');
  } else if (selected.label.includes('Reset')) {
    await vscode.commands.executeCommand('claude-usage.resetSession');
  }
}
```

### Spinner Icon During Data Refresh
```typescript
// Source: VS Code Icons in Labels - https://code.visualstudio.com/api/references/icons-in-labels
async function refreshData(statusBarItem: vscode.StatusBarItem, watcher: SessionWatcher): Promise<void> {
  // Show spinner with animation
  const originalText = statusBarItem.text;
  const originalBg = statusBarItem.backgroundColor;

  statusBarItem.text = '$(sync~spin) Refreshing...';
  statusBarItem.backgroundColor = undefined; // Clear color during refresh
  statusBarItem.tooltip = 'Reparsing JSONL files...';

  try {
    await watcher.reparse();
    // SessionWatcher callback will restore normal display
  } catch (err) {
    statusBarItem.text = '$(warning) Refresh failed';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    statusBarItem.tooltip = `Failed to refresh: ${err.message}`;

    // Restore after 3 seconds
    setTimeout(() => {
      statusBarItem.text = originalText;
      statusBarItem.backgroundColor = originalBg;
    }, 3000);
  }
}
```

### Smart Number Abbreviation (Already Implemented)
```typescript
// Source: Existing project code - src/extension.ts lines 93-100
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return (tokens / 1_000_000).toFixed(1) + 'M';
  } else if (tokens >= 1_000) {
    return (tokens / 1_000).toFixed(0) + 'K';
  }
  return tokens.toString();
}

// Examples:
// formatTokens(500) => "500"
// formatTokens(1200) => "1K"
// formatTokens(3400000) => "3.4M"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom HTML status bar rendering | Native StatusBarItem API | VS Code 1.0 (2015) | Simplified, theme-consistent, accessible |
| Single status bar item with all info | Multiple items with distinct purposes | Best practice since 1.40 (2019) | Better organization, independent tooltips |
| Hardcoded colors | ThemeColor semantic colors | Introduced 1.45 (2020) | Theme compatibility, accessibility |
| onStartup activation | onStartupFinished activation | Introduced 1.74 (2023) | Non-blocking startup, better performance |
| Global `window.setStatusBarMessage()` | Persistent StatusBarItems | Deprecated 1.30 (2018) | More control, no auto-hide |

**Deprecated/outdated:**
- `window.setStatusBarMessage()`: Temporary message API, replaced by persistent StatusBarItems with explicit show/hide
- Activation on `*` event: Now discouraged in favor of `onStartupFinished` for non-critical features
- Custom color strings: Use ThemeColor instead for theme compatibility

## Open Questions

Things that couldn't be fully resolved:

1. **Compact mode auto-detection**
   - What we know: VS Code doesn't expose window dimensions in extension API
   - What's unclear: Whether future API will support this, or if user setting is permanent solution
   - Recommendation: Implement user setting first (`claude-usage.compactMode: boolean`), monitor VS Code API updates for dimension events

2. **Burn rate calculation frequency**
   - What we know: Updating every 500ms (SessionWatcher debounce) is safe
   - What's unclear: Optimal update interval for live burn rate (tokens/min) — 1s? 2s? 5s?
   - Recommendation: Start with 2-second throttle, make configurable, gather user feedback

3. **Multi-limit color logic**
   - What we know: Three rate limits (session 5h, weekly, weekly-sonnet) with potentially different percentages
   - What's unclear: Should background color reflect worst-case limit, or primary limit (session 5h)?
   - Recommendation: Use worst-case (most restrictive) for background color, show all three in tooltip

4. **Cooldown timer display when multiple limits active**
   - What we know: Each rate limit has its own reset time
   - What's unclear: Show soonest reset, or most critical limit's reset?
   - Recommendation: Show soonest reset in status bar, all three in tooltip

5. **Rate limit data source for Phase 3**
   - What we know: ~/.claude/.credentials.json has plan tier, stats-cache.json has counts, but NOT rate limit percentages
   - What's unclear: Phase 3 must estimate proximity from observed tokens (exact % requires API in Phase 4)
   - Recommendation: Calculate usage percentage from known plan limits and observed token counts, mark as "estimated" in tooltip

## Sources

### Primary (HIGH confidence)
- VS Code Status Bar UX Guidelines - https://code.visualstudio.com/api/ux-guidelines/status-bar
- VS Code Activation Events - https://code.visualstudio.com/api/references/activation-events
- VS Code Theme Color Reference - https://code.visualstudio.com/api/references/theme-color
- VS Code Icons in Labels - https://code.visualstudio.com/api/references/icons-in-labels
- VS Code Extension Patterns - https://vscode-docs.readthedocs.io/en/stable/extensions/patterns-and-principles/

### Secondary (MEDIUM confidence)
- VS Code quickinput-sample - https://github.com/microsoft/vscode-extension-samples/tree/main/quickinput-sample
- Memory leak fix in status bar - https://github.com/microsoft/vscode/pull/282246
- date-fns documentation - https://date-fns.org/

### Tertiary (LOW confidence)
- Compact mode: No official API found, user setting approach is recommended workaround
- Burn rate throttling: No official guidance, 2-second interval is community consensus from web search

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - VS Code Extension API is authoritative, well-documented, stable
- Architecture: HIGH - Patterns verified from official samples, existing project architecture fits
- Pitfalls: HIGH - Sourced from VS Code issues, official warnings, and project code review
- Compact mode: LOW - No direct API for window width detection, user setting is workaround
- Burn rate frequency: MEDIUM - Safe range identified, optimal value needs experimentation

**Research date:** 2026-02-07
**Valid until:** 2026-03-07 (30 days — VS Code Extension API is stable, infrequent breaking changes)
