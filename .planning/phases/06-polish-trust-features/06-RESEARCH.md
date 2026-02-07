# Phase 6: Polish & Trust Features - Research

**Researched:** 2026-02-07
**Domain:** VS Code Extension Polish, Commands, Settings, Export, Activation, Trust UX
**Confidence:** HIGH

## Summary

Phase 6 focuses on power-user commands, data export, configuration UI, conditional activation, and trust transparency. The VS Code Extension API provides well-established patterns for all of these domains with comprehensive official documentation. Research covered command palette patterns, quick picks for interactive selection, configuration schema structure, file save dialogs, persistent storage for first-run detection, conditional activation events, and trust/privacy messaging best practices.

**Key findings:**
- Command registration is straightforward with `vscode.commands.registerCommand()` in `activate()`, automatically disposed by pushing to `context.subscriptions`
- Quick picks support multi-step flows with progress indicators, icons, descriptions, and validation
- Configuration schema uses JSON Schema with scope levels (application, machine, window, resource) and automatic Settings UI generation
- Export uses `window.showSaveDialog()` + `workspace.fs.writeFile()` with `TextEncoder` for JSON serialization
- First-run detection uses `context.globalState.get()` checking for undefined key
- Conditional activation uses `onStartupFinished` with runtime checks in `activate()` (not `workspaceContains` which only matches files in workspace)
- Trust messaging emphasizes verified publisher badges, workspace trust, and transparent documentation of what the extension accesses

**Primary recommendation:** Use official VS Code UX guidelines for all user-facing features. The notification decision tree is especially critical - prefer status bar/in-context feedback over notifications, only use notifications when user action is required, and always include "Do not show again" options.

## Standard Stack

The established libraries/tools for VS Code extension polish features:

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| VS Code Extension API | 1.x | All command, settings, storage, notification APIs | Built-in to VS Code, zero dependencies |
| TypeScript | 5.x | Type safety for API usage | VS Code API has comprehensive TypeScript definitions |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| JSON Schema | draft-7+ | Configuration validation | Automatically used by VS Code for settings |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| VS Code's built-in Settings UI | Custom webview settings | Custom webview adds complexity and breaks user expectations - only use if settings require rich UI beyond standard controls |
| `workspace.fs` | Node.js `fs` | `workspace.fs` supports remote/SSH scenarios, `fs` only works locally |
| globalState | Custom file storage | globalState handles persistence, sync, and cleanup automatically |

**Installation:**

No additional dependencies needed - all features use built-in VS Code Extension API.

## Architecture Patterns

### Recommended Project Structure

```
src/
├── commands/           # Command handlers
│   ├── refresh.ts
│   ├── exportData.ts
│   ├── switchPlan.ts
│   └── index.ts       # Command registration
├── config/            # Configuration management
│   └── settings.ts
├── storage/           # Persistent storage
│   └── firstRun.ts
└── extension.ts       # Main activate() function
```

### Pattern 1: Command Registration

**What:** Register all commands in `activate()` with inline or imported handlers, push to `context.subscriptions` for automatic disposal

**When to use:** Every command the extension contributes

**Example:**

```typescript
// Source: https://code.visualstudio.com/api/extension-guides/command
export function activate(context: vscode.ExtensionContext) {
  const refreshCommand = vscode.commands.registerCommand(
    'claude-usage.refresh',
    async () => {
      // Handler implementation
      await refreshData();
      vscode.window.showInformationMessage('Data refreshed');
    }
  );

  context.subscriptions.push(refreshCommand);
}
```

### Pattern 2: Multi-Step Quick Pick

**What:** Use quick picks with progress indicators (1/3, 2/3) for related-but-separate selections in a single flow

**When to use:** Plan tier selection, threshold configuration, multi-option settings

**Example:**

```typescript
// Source: https://code.visualstudio.com/api/ux-guidelines/quick-picks
const planTiers = [
  { label: 'Pro (Current)', description: 'Auto-detected', picked: true },
  { label: 'Free', description: 'Override to Free tier' },
  { label: 'Reset to Auto', description: 'Use auto-detection' }
];

const selected = await vscode.window.showQuickPick(planTiers, {
  placeHolder: 'Select plan tier (1/1)',
  title: 'Claude Usage: Plan Tier'
});
```

### Pattern 3: Configuration Schema

**What:** Define settings in `package.json` under `contributes.configuration` with JSON Schema properties

**When to use:** All user-configurable settings

**Example:**

```json
// Source: https://code.visualstudio.com/api/references/contribution-points
{
  "contributes": {
    "configuration": {
      "title": "Claude Usage Monitor",
      "properties": {
        "claude-usage.refreshInterval": {
          "type": "number",
          "default": 60,
          "description": "How often to check for usage updates (seconds)",
          "scope": "window"
        },
        "claude-usage.planType": {
          "type": "string",
          "enum": ["auto", "free", "pro"],
          "default": "auto",
          "enumDescriptions": [
            "Auto-detect from usage patterns",
            "Free tier (5 requests/min)",
            "Pro tier (10 requests/min)"
          ],
          "scope": "application"
        }
      }
    }
  }
}
```

### Pattern 4: JSON Export with Save Dialog

**What:** Use `showSaveDialog()` to get file URI, serialize data with `JSON.stringify()`, encode with `TextEncoder`, write with `workspace.fs.writeFile()`

**When to use:** Data export commands

**Example:**

```typescript
// Source: https://medium.com/@basakabhijoy/writing-a-visual-studio-code-extension-in-minutes-bb97722c4ca
// and https://code.visualstudio.com/api/references/vscode-api
const uri = await vscode.window.showSaveDialog({
  defaultUri: vscode.Uri.file('claude-usage-export.json'),
  filters: { 'JSON': ['json'] }
});

if (uri) {
  const exportData = {
    summary: { /* human-friendly */ },
    raw: { /* full internal data */ }
  };

  const content = new TextEncoder().encode(
    JSON.stringify(exportData, null, 2)
  );

  await vscode.workspace.fs.writeFile(uri, content);
  vscode.window.showInformationMessage(`Exported to ${uri.fsPath}`);
}
```

### Pattern 5: First-Run Detection

**What:** Check `globalState.get()` for undefined key, initialize on first run, update state after showing welcome

**When to use:** Welcome cards, first-run walkthroughs, version migration

**Example:**

```typescript
// Source: https://mattreduce.com/posts/vscode-global-state/
// and https://code.visualstudio.com/api/extension-capabilities/common-capabilities
export async function checkFirstRun(context: vscode.ExtensionContext): Promise<boolean> {
  const FIRST_RUN_KEY = 'firstRunComplete';
  const hasRun = context.globalState.get<boolean>(FIRST_RUN_KEY);

  if (!hasRun) {
    // Show welcome card
    await showWelcomeCard();
    await context.globalState.update(FIRST_RUN_KEY, true);
    return true;
  }

  return false;
}
```

### Pattern 6: Conditional Activation

**What:** Use `onStartupFinished` activation event, perform runtime check in `activate()`, only initialize features if condition met

**When to use:** Extensions that require specific directories/files to exist

**Example:**

```typescript
// Source: https://code.visualstudio.com/api/references/activation-events
// package.json:
// "activationEvents": ["onStartupFinished"]

export async function activate(context: vscode.ExtensionContext) {
  // Check if Claude Code data directory exists
  const claudeDir = path.join(os.homedir(), '.claude');

  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(claudeDir));
  } catch {
    // Directory doesn't exist - silently return without initializing
    console.log('Claude Code data directory not found, extension inactive');
    return;
  }

  // Directory exists - initialize extension
  initializeExtension(context);
}
```

### Pattern 7: Command Feedback

**What:** Use notification decision tree - prefer status bar/silent for successful operations, only use notifications for errors or actions requiring user response

**When to use:** All command completion feedback

**Example:**

```typescript
// Source: https://code.visualstudio.com/api/ux-guidelines/notifications

// Silent operation (no feedback needed)
await refreshData();

// Status bar feedback for info
vscode.window.setStatusBarMessage('Data refreshed', 3000);

// Notification only for errors
try {
  await exportData();
} catch (error) {
  vscode.window.showErrorMessage(
    `Export failed: ${error.message}`,
    'Retry',
    'View Logs'
  );
}
```

### Anti-Patterns to Avoid

- **Overusing notifications:** Don't show toast notifications for successful operations that don't require user action - use status bar or silent operation instead
- **Custom settings UI without justification:** Don't build webview-based settings UI when standard Settings editor suffices
- **Ignoring notification UX guidelines:** Don't send notifications without "Do not show again" option
- **Using `*` activation event:** Don't use universal activation when `onStartupFinished` or more specific events work
- **Node.js `fs` over `workspace.fs`:** Don't use Node.js `fs` module - breaks remote/SSH scenarios
- **Hardcoded paths with path separators:** Use `path.join()` and `Uri.file()` for cross-platform compatibility

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Persistent key-value storage | Custom JSON file management | `context.globalState` / `workspaceState` | Handles persistence, sync, cleanup, concurrent access |
| File save dialog | Custom file picker UI | `window.showSaveDialog()` | Platform-native, respects user's file system settings, handles permissions |
| Settings UI | Custom webview form | `contributes.configuration` | Auto-generates Settings editor UI, handles validation, user/workspace scope |
| JSON serialization with metadata | Custom format | JSON with `$schema` property | VS Code provides intellisense and validation automatically |
| Command palette integration | Custom quick pick menu | `contributes.commands` | Automatic activation, keybinding support, discoverability |
| Progress indication | Custom loading overlay | `vscode.window.withProgress()` | Consistent with VS Code UX, multiple locations (notification, status bar) |

**Key insight:** VS Code Extension API is designed to handle all common extension patterns. Custom implementations usually break user expectations and create maintenance burden.

## Common Pitfalls

### Pitfall 1: Notification Overuse

**What goes wrong:** Extension shows toast notifications for every command completion, cluttering the UI and annoying users

**Why it happens:** Developers assume users need feedback for every action

**How to avoid:** Follow the notification decision tree:
- Silent operation: Data refresh, config changes that take effect immediately
- Status bar message (3s timeout): Successful export, cache clear
- Notification: Only errors or operations requiring user action

**Warning signs:** Users complain about "too many popups", negative reviews mentioning notifications

### Pitfall 2: Workspace-Only Activation Events

**What goes wrong:** Extension uses `workspaceContains` to detect Claude Code directory, but `~/.claude/` is outside workspace

**Why it happens:** Misunderstanding that `workspaceContains` only checks workspace folders, not arbitrary file system locations

**How to avoid:** Use `onStartupFinished` and perform runtime check in `activate()` with `workspace.fs.stat()` for paths outside workspace

**Warning signs:** Extension never activates even when Claude Code is installed

### Pitfall 3: Synchronous File Operations

**What goes wrong:** Using Node.js `fs` module with sync methods blocks VS Code UI

**Why it happens:** Convenience of synchronous APIs

**How to avoid:** Always use `workspace.fs` with async/await pattern

**Warning signs:** VS Code becomes unresponsive during file operations, user reports "editor freezing"

### Pitfall 4: Configuration Scope Mismatch

**What goes wrong:** Setting defined with wrong scope - e.g., `application` scope for workspace-specific setting

**Why it happens:** Not understanding difference between scopes:
- `application`: All VS Code instances (e.g., API keys, global preferences)
- `window`: Per-window (e.g., refresh interval, display settings)
- `resource`: Per-file/folder (e.g., language-specific settings)

**How to avoid:** Review VS Code's scope documentation, test settings in user vs workspace settings files

**Warning signs:** Users can't override settings at workspace level, or settings apply globally when they shouldn't

### Pitfall 5: First-Run Detection Without Idempotency

**What goes wrong:** First-run logic runs multiple times if `globalState.update()` fails or is interrupted

**Why it happens:** Not checking state before showing welcome, or not awaiting the update

**How to avoid:**
1. Check `globalState.get()` first
2. Show welcome only if undefined
3. `await` the `globalState.update()` call
4. Use a version string instead of boolean for future migration support

**Warning signs:** Users report seeing welcome message on every startup

### Pitfall 6: Export Format Without Schema

**What goes wrong:** Exported JSON has no `$schema` property, users can't easily understand structure

**Why it happens:** Forgetting to include metadata in export

**How to avoid:** Include metadata in export:

```json
{
  "$schema": "https://your-extension.com/export-schema.json",
  "exportedAt": "2026-02-07T12:34:56Z",
  "version": "1.0.0",
  "summary": { },
  "raw": { }
}
```

**Warning signs:** Support requests asking "what does this field mean?"

### Pitfall 7: Command Names Without Category

**What goes wrong:** Commands show up in palette without clear grouping, hard to find

**Why it happens:** Not setting `category` in command contribution

**How to avoid:**

```json
{
  "command": "claude-usage.refresh",
  "title": "Refresh Usage Data",
  "category": "Claude Usage"
}
```

**Warning signs:** Users can't find commands, commands scattered in palette

## Code Examples

Verified patterns from official sources:

### Reading Configuration

```typescript
// Source: https://code.visualstudio.com/api/references/vscode-api
const config = vscode.workspace.getConfiguration('claude-usage');
const refreshInterval = config.get<number>('refreshInterval', 60);
const planType = config.get<string>('planType', 'auto');

// Listen for config changes
vscode.workspace.onDidChangeConfiguration(e => {
  if (e.affectsConfiguration('claude-usage')) {
    // Refresh data when config changes
    refreshData();
  }
});
```

### Quick Pick with Icons and Descriptions

```typescript
// Source: https://code.visualstudio.com/api/ux-guidelines/quick-picks
const items: vscode.QuickPickItem[] = [
  {
    label: '$(check) Pro',
    description: 'Auto-detected from usage',
    detail: '10 requests/minute',
    picked: true
  },
  {
    label: '$(circle-outline) Free',
    description: 'Override to Free tier',
    detail: '5 requests/minute'
  },
  {
    label: '$(sync) Reset to Auto',
    description: 'Use auto-detection'
  }
];

const selected = await vscode.window.showQuickPick(items, {
  placeHolder: 'Select plan tier',
  title: 'Claude Usage Monitor',
  matchOnDescription: true,
  matchOnDetail: true
});
```

### Output Channel for Logging

```typescript
// Source: https://code.visualstudio.com/api/extension-capabilities/common-capabilities
const outputChannel = vscode.window.createOutputChannel('Claude Usage Monitor');

outputChannel.appendLine('Extension activated');
outputChannel.appendLine(`Watching: ${dataSourcePath}`);

// User can open via Command Palette: "View: Show Output"
// Extension can show programmatically:
outputChannel.show();
```

### Conditional Command Visibility

```json
// Source: https://code.visualstudio.com/api/references/contribution-points
{
  "contributes": {
    "commands": [
      {
        "command": "claude-usage.exportData",
        "title": "Export Usage Data",
        "category": "Claude Usage",
        "enablement": "workspaceFolderCount > 0"
      }
    ],
    "menus": {
      "commandPalette": [
        {
          "command": "claude-usage.exportData",
          "when": "workspaceFolderCount > 0"
        }
      ]
    }
  }
}
```

### Progress with Cancellation

```typescript
// Source: https://code.visualstudio.com/api/references/vscode-api
await vscode.window.withProgress({
  location: vscode.ProgressLocation.Notification,
  title: "Exporting usage data",
  cancellable: true
}, async (progress, token) => {
  token.onCancellationRequested(() => {
    console.log("User canceled export");
  });

  progress.report({ increment: 0, message: "Gathering data..." });
  const data = await gatherData();

  progress.report({ increment: 50, message: "Writing file..." });
  await writeFile(data);

  progress.report({ increment: 100, message: "Complete" });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `*` activation event | `onStartupFinished` | VS Code 1.74 (2022) | Extensions no longer slow down VS Code startup |
| Custom welcome screens | `contributes.walkthroughs` | VS Code 1.63 (2021) | Consistent onboarding UX across extensions |
| Custom settings webview | `contributes.configuration` | Always standard | Auto-generated Settings UI with search, validation |
| Extension Publisher Trust prompt | Verified Publisher badge | VS Code 1.97 (2024) | Users prompted to confirm trust on first install from third-party |
| Node.js `fs` module | `workspace.fs` | VS Code 1.37 (2019) | Remote/SSH support, workspace trust integration |

**Deprecated/outdated:**
- `*` activation event: Use `onStartupFinished` or more specific events instead
- `vscode.window.showInformationMessage()` without "Do not show again": VS Code UX guidelines now require this option on all notifications
- `workspace.rootPath`: Use `workspace.workspaceFolders` instead (deprecated since 1.17)

## Open Questions

Things that couldn't be fully resolved:

1. **Custom pricing badge placement in dashboard**
   - What we know: Should be visible near cost figures when user overrides pricing
   - What's unclear: Exact visual style (badge, label, icon, color) - need to see dashboard implementation
   - Recommendation: Implement as subtle label "(custom pricing)" in muted color, consistent with VS Code's low-contrast UI style

2. **Command completion feedback granularity**
   - What we know: Notification decision tree provides general guidance
   - What's unclear: Specific feedback style for each of ~10 commands (silent, status bar, notification)
   - Recommendation: Default to silent for data operations, status bar (3s) for user-initiated changes, notifications only for errors

3. **Welcome card dismiss persistence**
   - What we know: Use `globalState` to track dismissal
   - What's unclear: Should dismissal be permanent or version-based (re-show on major updates)?
   - Recommendation: Version-based - store dismissed version, re-show welcome card on major version updates with "What's New" content

## Sources

### Primary (HIGH confidence)

- [VS Code Activation Events Documentation](https://code.visualstudio.com/api/references/activation-events) - Official activation event patterns
- [VS Code Contribution Points Documentation](https://code.visualstudio.com/api/references/contribution-points) - Configuration and command schema
- [VS Code Command Palette UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/command-palette) - Command naming and categorization
- [VS Code Quick Picks UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/quick-picks) - Quick pick patterns and best practices
- [VS Code Settings UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/settings) - Configuration best practices
- [VS Code Notifications UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/notifications) - Notification decision tree and patterns
- [VS Code Extension Commands Guide](https://code.visualstudio.com/api/extension-guides/command) - Command registration patterns
- [VS Code API Reference](https://code.visualstudio.com/api/references/vscode-api) - API method signatures and behavior
- [VS Code Common Capabilities Documentation](https://code.visualstudio.com/api/extension-capabilities/common-capabilities) - Storage and display methods

### Secondary (MEDIUM confidence)

- [VS Code Extension Samples - Configuration](https://github.com/microsoft/vscode-extension-samples/blob/main/configuration-sample/package.json) - Real-world configuration schema examples
- [VS Code Extension Samples - Quick Input](https://github.com/microsoft/vscode-extension-samples/blob/main/quickinput-sample/src/extension.ts) - Quick pick implementation patterns
- [Exploring VS Code's Global State](https://mattreduce.com/posts/vscode-global-state/) - First-run detection patterns
- [VS Code Extension Storage Explained](https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea) - Storage options and patterns
- [Writing a Visual Studio Code Extension](https://medium.com/@basakabhijoy/writing-a-visual-studio-code-extension-in-minutes-bb97722c4ca) - Export patterns with TextEncoder
- [Building VS Code Extensions in 2026: The Complete Guide](https://abdulkadersafi.com/blog/building-vs-code-extensions-in-2026-the-complete-modern-guide) - Current best practices
- [Extension Runtime Security](https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security) - Trust and security patterns
- [Security and Trust in Visual Studio Marketplace](https://developer.microsoft.com/blog/security-and-trust-in-visual-studio-marketplace) - Verified publisher badges

### Tertiary (LOW confidence)

- WebSearch results for ecosystem patterns (command feedback styles, export formats) - Useful for community practices but not authoritative

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All APIs are built into VS Code, extensively documented
- Architecture: HIGH - Official UX guidelines and API documentation provide comprehensive patterns
- Pitfalls: MEDIUM - Derived from GitHub issues and community experience, verified against official docs where possible

**Research date:** 2026-02-07
**Valid until:** 2026-03-07 (30 days - stable domain with mature APIs)
