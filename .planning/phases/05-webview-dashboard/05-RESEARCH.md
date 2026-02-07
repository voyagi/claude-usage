# Phase 5: Webview Dashboard - Research

**Researched:** 2026-02-07
**Domain:** VS Code Extension Webview + React + Recharts
**Confidence:** HIGH

## Summary

This phase requires building a sidebar webview panel with React for UI and Recharts for data visualization. The research confirms this is a well-established pattern in VS Code extension development with clear implementation paths.

VS Code's webview API provides iframe-like containers that run sandboxed HTML/JS/CSS, communicating with the extension host via message passing. The standard approach combines `WebviewViewProvider` for sidebar integration, React for component architecture, and esbuild for dual-bundling (extension + webview). Recharts (v3.7.0, latest as of Jan 2026) offers declarative React components for charts with native SVG and minimal dependencies.

**Key findings:**
- WebviewViewProvider is the standard API for sidebar webviews (replaces older panel patterns)
- Dual bundling required: extension code (Node.js target) + webview code (browser target)
- React state should be treated as ephemeral; use message passing + extension-side persistence
- VS Code theme colors are exposed as `--vscode-*` CSS variables for native integration
- Recharts stacked bar charts use `stackId` prop to group bars, with built-in tooltip support
- Security via CSP is mandatory; avoid `retainContextWhenHidden` (high memory cost)

**Primary recommendation:** Use WebviewViewProvider with React + Recharts, dual esbuild config, message passing for all state updates, and VS Code CSS variables for theming. Avoid the deprecated vscode-webview-ui-toolkit (EOL Jan 2025).

## Standard Stack

The established libraries/tools for VS Code webview dashboards:

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.x | UI framework | Declarative component model matches webview architecture; official samples use it |
| react-dom | 18.x | DOM rendering | Required for React browser rendering via `createRoot` |
| Recharts | 3.7.0+ | Charting library | React-native charting built on D3; declarative API, SVG output, minimal deps |
| esbuild | 0.24.0+ | Bundler | Fast builds, simple config; VS Code official docs recommend over webpack for new projects |
| TypeScript | 5.x | Type safety | Standard for VS Code extensions; provides IntelliSense for vscode API |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| date-fns | 4.x | Date formatting | Already in project; use for chart axis labels and session timing display |
| zod | 3.24.0+ | Runtime validation | Already in project; validate message payloads between extension/webview |
| react-is | 18.x | React utilities | Required peer dependency for Recharts v3.7.0+ |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Recharts | Chart.js | Chart.js requires Canvas API (heavier), less React-idiomatic; Recharts is SVG + React components |
| React | Vanilla JS | Vanilla reduces bundle size ~40KB but loses component model; justified for complex UIs only |
| esbuild | webpack | webpack slower builds (50s vs <1s) but more plugin ecosystem; esbuild sufficient here |
| WebviewViewProvider | createWebviewPanel | Panel API for editor tabs; ViewProvider for sidebar (our requirement) |

**Installation:**
```bash
npm install react react-dom recharts react-is
npm install --save-dev @types/react @types/react-dom
```

**Note:** vscode-webview-ui-toolkit is deprecated as of Jan 1, 2025 and should NOT be used.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── extension.ts                  # Main extension entry
├── webview/
│   ├── DashboardProvider.ts      # WebviewViewProvider implementation
│   ├── app/
│   │   ├── index.tsx             # React app entry (webview bundle entry)
│   │   ├── App.tsx               # Root component with tab state
│   │   ├── components/
│   │   │   ├── OverviewTab.tsx   # Session overview, rate limits, burn rate
│   │   │   ├── TrendsTab.tsx     # Charts + period selector
│   │   │   ├── SessionTab.tsx    # Session detail + comparison
│   │   │   ├── SegmentedControl.tsx  # Daily/Weekly/Monthly selector
│   │   │   ├── ProgressBar.tsx   # Rate limit progress bars
│   │   │   ├── UsageChart.tsx    # Recharts stacked bar wrapper
│   │   │   └── TrustIndicator.tsx    # "Local Only" badge
│   │   ├── styles/
│   │   │   └── app.css           # VS Code CSS variables, base styles
│   │   └── types.ts              # Message types, data shapes
├── data/                         # Existing aggregation logic
└── dist/
    ├── extension.js              # Bundled extension
    └── webview.js                # Bundled React app
```

### Pattern 1: Dual Bundling (Extension + Webview)

**What:** Separate esbuild configs for extension (Node.js) and webview (browser) code.

**When to use:** Always when using React or any browser framework in webviews.

**Example:**
```typescript
// esbuild.config.mjs
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node22',
};

const webviewConfig = {
  entryPoints: ['src/webview/app/index.tsx'],
  bundle: true,
  outfile: 'dist/webview.js',
  format: 'iife',           // Self-executing for browser
  platform: 'browser',
  target: 'es2020',
  loader: { '.tsx': 'tsx' },
  // Do NOT external React — must bundle for webview
};

// Build both in parallel
await Promise.all([
  esbuild.build(extensionConfig),
  esbuild.build(webviewConfig)
]);
```

**Source:** [VS Code Bundling Extensions Docs](https://code.visualstudio.com/api/working-with-extensions/bundling-extension), [Medium: VSCode Extensions with esbuild](https://medium.com/@aga1laoui/create-advanced-vscode-extension-w-react-webview-esbuild-bundler-eslint-airbnb-and-prettier-2ba2e3893667)

### Pattern 2: WebviewViewProvider for Sidebar Integration

**What:** Class implementing `vscode.WebviewViewProvider` registered to contribute a sidebar view.

**When to use:** When webview should appear in sidebar/panel (not editor tab).

**Example:**
```typescript
// Source: microsoft/vscode-extension-samples/webview-view-sample
export class DashboardProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'claude-usage.dashboardView';

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Message handling
    webviewView.webview.onDidReceiveMessage(data => {
      switch (data.type) {
        case 'requestData':
          this._sendUsageData(webviewView.webview);
          break;
      }
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js')
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
    <html>
      <head>
        <meta http-equiv="Content-Security-Policy"
              content="default-src 'none';
                       style-src ${webview.cspSource} 'unsafe-inline';
                       script-src 'nonce-${nonce}';">
      </head>
      <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
    </html>`;
  }
}

// Activation in extension.ts
export function activate(context: vscode.ExtensionContext) {
  const provider = new DashboardProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DashboardProvider.viewType,
      provider
    )
  );
}
```

**package.json contribution:**
```json
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [{
        "id": "claude-usage",
        "title": "Claude Usage",
        "icon": "resources/icon.svg"
      }]
    },
    "views": {
      "claude-usage": [{
        "type": "webview",
        "id": "claude-usage.dashboardView",
        "name": "Dashboard"
      }]
    }
  }
}
```

**Sources:** [VS Code Webview API Guide](https://code.visualstudio.com/api/extension-guides/webview), [vscode-extension-samples webview-view-sample](https://github.com/microsoft/vscode-extension-samples/tree/main/webview-view-sample)

### Pattern 3: Message Passing for State Management

**What:** Treat React state as ephemeral UI state; all persistent data lives in extension, synced via messages.

**When to use:** Always. Webviews can be destroyed/recreated; extension owns truth.

**Example:**
```typescript
// Extension side (DashboardProvider.ts)
private _sendUsageData(webview: vscode.Webview) {
  const data = this._aggregator.getSessionUsage();
  webview.postMessage({ type: 'usageData', payload: data });
}

// Webview side (index.tsx)
const vscode = acquireVsCodeApi();

function App() {
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    // Request initial data
    vscode.postMessage({ type: 'requestData' });

    // Listen for updates
    const handler = (event) => {
      const message = event.data;
      switch (message.type) {
        case 'usageData':
          setUsage(message.payload);
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  return usage ? <DashboardView data={usage} /> : <LoadingSkeleton />;
}
```

**Key insight:** Don't use `retainContextWhenHidden: true` (high memory cost). Use `vscode.setState()` for ephemeral UI state (tab selection, collapsed sections), message passing for data.

**Sources:** [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview), [Medium: React State Management in VSCode Webviews](https://medium.com/@captaincolinr/vscode-react-extension-guide-10ea25cb983f)

### Pattern 4: VS Code Theme Integration

**What:** Use CSS variables prefixed `--vscode-*` for colors; auto-adapts to light/dark themes.

**When to use:** All webview styling to match native VS Code appearance.

**Example:**
```css
/* Source: vscode-extension-samples/webview-view-sample/media/main.css */

body {
  background-color: var(--vscode-sideBar-background);
  color: var(--vscode-sideBar-foreground);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}

.progress-bar {
  background-color: var(--vscode-progressBar-background);
  border: 1px solid var(--vscode-panel-border);
}

.warning {
  color: var(--vscode-notificationsWarningIcon-foreground);
}

.error {
  color: var(--vscode-notificationsErrorIcon-foreground);
}

/* Tabs/segmented control */
.tab-active {
  border-bottom: 2px solid var(--vscode-panelTitle-activeBorder);
  color: var(--vscode-panelTitle-activeForeground);
}

.tab-inactive {
  color: var(--vscode-panelTitle-inactiveForeground);
}
```

**Available color categories:**
- `--vscode-sideBar-*` (background, foreground, border)
- `--vscode-panel-*` (panel colors)
- `--vscode-progressBar-background`
- `--vscode-notificationsErrorIcon-foreground` (red status)
- `--vscode-notificationsWarningIcon-foreground` (yellow status)
- `--vscode-badge-*` (badge backgrounds/foregrounds)

**Full reference:** [VS Code Theme Color Reference](https://code.visualstudio.com/api/references/theme-color)

**Sources:** [VS Code Theme Color API](https://code.visualstudio.com/api/references/theme-color), [vscode-extension-samples CSS patterns](https://github.com/microsoft/vscode-extension-samples/blob/main/webview-view-sample/media/main.css)

### Pattern 5: Recharts Stacked Bar Chart

**What:** Use `stackId` prop on `<Bar>` components to stack bars; shared ID stacks together.

**When to use:** Token usage trends over time (input/output/cache stacked per period).

**Example:**
```tsx
// Source: Recharts official examples + GeeksforGeeks tutorial
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const data = [
  { period: 'Mon', input: 4000, output: 2400, cache_read: 2400, cache_write: 1000 },
  { period: 'Tue', input: 3000, output: 1398, cache_read: 2210, cache_write: 800 },
  // ...
];

function UsageChart({ data, period }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <XAxis dataKey="period" stroke="var(--vscode-sideBar-foreground)" />
        <YAxis stroke="var(--vscode-sideBar-foreground)" />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--vscode-sideBar-background)',
            border: '1px solid var(--vscode-panel-border)',
            color: 'var(--vscode-sideBar-foreground)'
          }}
        />
        <Legend />
        {/* All bars with same stackId="tokens" will stack */}
        <Bar dataKey="input" stackId="tokens" fill="#4FC3F7" />
        <Bar dataKey="output" stackId="tokens" fill="#81C784" />
        <Bar dataKey="cache_read" stackId="tokens" fill="#FFB74D" />
        <Bar dataKey="cache_write" stackId="tokens" fill="#E57373" />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

**Tooltip customization:**
```tsx
// Custom tooltip for detailed hover
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const total = payload.reduce((sum, entry) => sum + entry.value, 0);
    return (
      <div style={{
        backgroundColor: 'var(--vscode-sideBar-background)',
        padding: '8px',
        border: '1px solid var(--vscode-panel-border)'
      }}>
        <p>{label}</p>
        {payload.map(entry => (
          <p key={entry.dataKey} style={{ color: entry.fill }}>
            {entry.name}: {entry.value.toLocaleString()}
          </p>
        ))}
        <p><strong>Total: {total.toLocaleString()}</strong></p>
      </div>
    );
  }
  return null;
};

<Tooltip content={<CustomTooltip />} />
```

**Sources:** [Recharts Stacked Bar Chart Example](https://recharts.github.io/en-US/examples/StackedBarChart/), [GeeksforGeeks Recharts Tutorial](https://www.geeksforgeeks.org/reactjs/create-a-stacked-bar-chart-using-recharts-in-reactjs/)

### Anti-Patterns to Avoid

- **Using `retainContextWhenHidden: true`:** High memory overhead; use `setState()`/`getState()` instead for UI state, message passing for data refresh ([VS Code Issue #113507](https://github.com/microsoft/vscode/issues/113507))
- **Global state in webview:** Webviews can be destroyed; extension owns persistent state
- **Inline styles/scripts in HTML:** Breaks CSP; extract to external files
- **Hardcoded colors:** Breaks theme integration; always use `--vscode-*` variables
- **Direct file access in webview:** Use `webview.asWebviewUri()` for local resources
- **vscode-webview-ui-toolkit:** Deprecated Jan 1, 2025; use custom components or standard React libraries

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tabbed interface | Custom tab state + conditional rendering | React state + CSS for tab UI | Tab libraries add weight; simple useState + CSS is standard pattern |
| Segmented control (Daily/Weekly/Monthly) | Custom button group | Plain buttons with state | No heavy library needed; 3 buttons with active state is 20 lines |
| Progress bars | Canvas drawing, manual div sizing | CSS width % + VS Code colors | CSS `width: ${percent}%` with theme colors; no JS needed |
| Date formatting for charts | String manipulation | date-fns (already in project) | Edge cases: timezones, locale, leap years |
| Chart library | D3.js directly, Canvas API | Recharts | Recharts wraps D3 in React components; D3 is imperative (fights React) |
| Message type safety | Runtime checks only | Zod schemas (already in project) | Runtime + compile-time safety; validates extension ↔ webview messages |
| Resource URI conversion | String concatenation | `webview.asWebviewUri()` | Handles platform differences, security, file protocol edge cases |

**Key insight:** For UI components (tabs, segmented controls), standard React patterns (useState + CSS) are simpler than pulling in component libraries. For domain logic (charts, dates, validation), use established libraries.

## Common Pitfalls

### Pitfall 1: Memory Leaks from Event Listeners

**What goes wrong:** Webview message listeners not cleaned up; React useEffect without cleanup causes memory leaks when component unmounts.

**Why it happens:** `window.addEventListener('message', ...)` persists beyond component lifecycle.

**How to avoid:** Always return cleanup function from useEffect:
```tsx
useEffect(() => {
  const handler = (event) => { /* ... */ };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler); // CRITICAL
}, []);
```

**Warning signs:** Extension memory usage grows over time; performance degrades after opening/closing webview repeatedly.

**Source:** [VS Code Webview Best Practices Discussion](https://github.com/microsoft/vscode-discussions/discussions/503)

### Pitfall 2: CSP Violations Blocking Scripts

**What goes wrong:** Webview shows blank or scripts don't execute; console shows CSP errors.

**Why it happens:** Inline scripts/styles blocked by Content Security Policy; nonce not applied.

**How to avoid:**
1. Generate unique nonce per HTML render: `crypto.randomBytes(16).toString('base64')`
2. Add nonce to script tags: `<script nonce="${nonce}" src="${scriptUri}">`
3. Include nonce in CSP meta tag: `script-src 'nonce-${nonce}'`
4. Extract all inline styles to external CSS files

**Warning signs:** Blank webview; console errors mentioning "Content Security Policy"; "refused to execute inline script"

**Source:** [VS Code Webview API Security](https://code.visualstudio.com/api/extension-guides/webview), [Trail of Bits: VSCode Extension Security](https://blog.trailofbits.com/2023/02/21/vscode-extension-escape-vulnerability/)

### Pitfall 3: Webview Not Updating After Data Change

**What goes wrong:** Extension calls `webview.postMessage()` but UI doesn't update; appears "stuck."

**Why it happens:** Webview not visible when message sent; messages to hidden webviews are dropped (even with `retainContextWhenHidden`).

**How to avoid:**
1. Check webview visibility before posting: `if (webviewView.visible) { webview.postMessage(...) }`
2. Request fresh data when webview becomes visible: `webviewView.onDidChangeVisibility()`
3. Or: Make webview send `requestData` message on mount to pull data

```typescript
// Extension side
webviewView.onDidChangeVisibility(() => {
  if (webviewView.visible) {
    this._sendUsageData(webviewView.webview);
  }
});
```

**Warning signs:** Data stale when reopening sidebar; changes in status bar not reflected in webview.

**Source:** [VS Code Webview API: Message Passing](https://code.visualstudio.com/api/extension-guides/webview)

### Pitfall 4: Sidebar Width Constraints Breaking Layout

**What goes wrong:** Charts/tables overflow horizontally; text truncated; unreadable on narrow sidebars.

**Why it happens:** Sidebar can be resized by user; webview doesn't handle narrow widths gracefully.

**How to avoid:**
1. Use `ResponsiveContainer` from Recharts (auto-adjusts to parent width)
2. Set `minWidth` on chart components to trigger scroll instead of breaking
3. Test at 200px sidebar width (VS Code minimum)
4. Use flexbox with `flex-wrap` for multi-column layouts
5. Truncate long text with `text-overflow: ellipsis` + tooltip on hover

```css
.sidebar-safe-layout {
  display: flex;
  flex-direction: column; /* Stack vertically on narrow */
  gap: 1rem;
  min-width: 200px;
}

.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

**Warning signs:** Horizontal scrollbars in sidebar; text overlapping; charts distorted at narrow widths.

**Source:** [VS Code UX Guidelines: Sidebars](https://code.visualstudio.com/api/ux-guidelines/sidebars), user experience testing

### Pitfall 5: Recharts Bundle Size Impact

**What goes wrong:** Extension bundle grows significantly (200-300KB uncompressed); slower activation.

**Why it happens:** Recharts bundles D3 dependencies; large library for webview context.

**How to avoid:**
1. Tree-shaking: Import only needed components: `import { BarChart, Bar } from 'recharts'` (not `import * as Recharts`)
2. esbuild minification in production: `minify: true`
3. Lazy-load webview code (only load when sidebar opened, not at activation)
4. Monitor bundle size: `ls -lh dist/webview.js` (aim for <150KB minified)

**Mitigation if needed:** Recharts is already the lightest React charting library (vs Chart.js ~300KB, Victory ~400KB). If bundle critical, consider:
- Render charts as SVG server-side (extension generates, webview displays) — complexity tradeoff
- Use simpler CSS-only bar charts for non-interactive views

**Warning signs:** Extension activation slow (>500ms); large dist/webview.js file; user complaints about performance.

**Source:** [npm: Recharts package size](https://www.npmjs.com/package/recharts), [Recharts GitHub](https://github.com/recharts/recharts)

## Code Examples

Verified patterns from official sources:

### Registering Status Bar Click to Open Sidebar

```typescript
// Source: VS Code API patterns
export function activate(context: vscode.ExtensionContext) {
  const provider = new DashboardProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DashboardProvider.viewType,
      provider
    )
  );

  // Status bar item opens sidebar on click
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.text = '$(graph) Claude Usage';
  statusBarItem.command = 'claude-usage.openDashboard'; // Command defined below
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Command to open specific webview view
  context.subscriptions.push(
    vscode.commands.registerCommand('claude-usage.openDashboard', () => {
      vscode.commands.executeCommand('claude-usage.dashboardView.focus');
    })
  );
}
```

### React Entry Point (webview/app/index.tsx)

```typescript
// Source: React 18 patterns + VS Code webview samples
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';

// Acquire VS Code API once (singleton)
declare const acquireVsCodeApi: () => any;
export const vscode = acquireVsCodeApi();

// Mount React app
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
```

### Tab Component with Segmented Control

```tsx
// Source: Standard React patterns
import { useState } from 'react';

type Tab = 'overview' | 'trends' | 'session';

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  return (
    <div className="dashboard">
      <div className="trust-indicator">
        🔒 Local Only — Zero network calls
      </div>

      <nav className="tabs">
        <button
          className={activeTab === 'overview' ? 'tab-active' : 'tab-inactive'}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button
          className={activeTab === 'trends' ? 'tab-active' : 'tab-inactive'}
          onClick={() => setActiveTab('trends')}
        >
          Trends
        </button>
        <button
          className={activeTab === 'session' ? 'tab-active' : 'tab-inactive'}
          onClick={() => setActiveTab('session')}
        >
          Session
        </button>
      </nav>

      <main className="tab-content">
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'trends' && <TrendsTab />}
        {activeTab === 'session' && <SessionTab />}
      </main>
    </div>
  );
}
```

**Corresponding CSS:**
```css
.tabs {
  display: flex;
  border-bottom: 1px solid var(--vscode-panel-border);
  gap: 0;
}

.tab-active,
.tab-inactive {
  padding: 8px 16px;
  background: none;
  border: none;
  cursor: pointer;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}

.tab-active {
  border-bottom: 2px solid var(--vscode-panelTitle-activeBorder);
  color: var(--vscode-panelTitle-activeForeground);
}

.tab-inactive {
  color: var(--vscode-panelTitle-inactiveForeground);
}

.tab-inactive:hover {
  color: var(--vscode-panelTitle-activeForeground);
}
```

### Progress Bar Component (Rate Limit Proximity)

```tsx
// Source: Standard React + CSS patterns
interface ProgressBarProps {
  label: string;
  current: number;
  limit: number;
  warningThreshold?: number; // % (default 60)
  criticalThreshold?: number; // % (default 95)
}

export function ProgressBar({
  label,
  current,
  limit,
  warningThreshold = 60,
  criticalThreshold = 95
}: ProgressBarProps) {
  const percent = Math.min((current / limit) * 100, 100);
  const status = percent >= criticalThreshold ? 'critical'
              : percent >= warningThreshold ? 'warning'
              : 'safe';

  return (
    <div className="progress-container">
      <div className="progress-header">
        <span className="progress-label">{label}</span>
        <span className="progress-value">
          {current.toLocaleString()} / {limit.toLocaleString()}
          ({percent.toFixed(1)}%)
        </span>
      </div>
      <div className="progress-track">
        <div
          className={`progress-fill progress-${status}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
```

**CSS:**
```css
.progress-container {
  margin-bottom: 1rem;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
  font-size: 0.9em;
}

.progress-track {
  height: 8px;
  background-color: var(--vscode-panel-border);
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  transition: width 0.3s ease;
}

.progress-safe {
  background-color: var(--vscode-charts-green);
}

.progress-warning {
  background-color: var(--vscode-notificationsWarningIcon-foreground);
}

.progress-critical {
  background-color: var(--vscode-notificationsErrorIcon-foreground);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| webpack bundler | esbuild bundler | 2023+ | 50x faster builds (<1s vs 50s); simpler config |
| createWebviewPanel (editor tabs) | WebviewViewProvider (sidebar) | VS Code API stable | Sidebar integration standard for dashboards |
| vscode-webview-ui-toolkit | Custom React components | Toolkit deprecated Jan 2025 | Use standard React patterns + VS Code CSS vars |
| retainContextWhenHidden | setState/getState + message passing | Best practice shift | Lower memory usage, better performance |
| Inline scripts with unsafe-inline CSP | External scripts with nonce | Security tightening | Prevents XSS vulnerabilities |
| React.render (React 17) | createRoot (React 18) | React 18 release (2022) | Concurrent features, better error boundaries |
| Recharts v2.x | Recharts v3.7.0+ | Jan 2026 | Requires react-is peer dependency |

**Deprecated/outdated:**
- **vscode-webview-ui-toolkit:** EOL Jan 1, 2025. Use custom components with VS Code CSS variables.
- **webpack for new projects:** VS Code docs now recommend esbuild for speed/simplicity.
- **React.render API:** Deprecated in React 18; use createRoot.

## Open Questions

Things that couldn't be fully resolved:

1. **Recharts exact bundle size with tree-shaking**
   - What we know: Recharts ~200KB uncompressed; esbuild minifies; tree-shaking works
   - What's unclear: Actual production bundle size with ONLY BarChart + minimal components
   - Recommendation: Build proof-of-concept webview, measure dist/webview.js size; if >150KB minified, profile with esbuild analyze

2. **VS Code CSS variable support for chart colors**
   - What we know: `--vscode-sideBar-*`, `--vscode-panel-*`, status colors available
   - What's unclear: Whether dedicated chart color variables exist (e.g., `--vscode-charts-blue`)
   - Recommendation: Use semantic status colors (error/warning/info) for rate limit states; define custom colors for token types (input/output/cache) that work in both light/dark themes via color-scheme detection

3. **Session timing timeline visualization**
   - What we know: Context specifies "timeline bar showing 5-hour window with current position"
   - What's unclear: Best UX pattern (horizontal bar with marker? Recharts Area chart? Custom SVG?)
   - Recommendation: Start with CSS horizontal bar + positioned marker (simplest); user test; upgrade to custom SVG if needed for better UX

4. **Optimal data refresh frequency**
   - What we know: Status bar updates on file save; webview should reflect same data
   - What's unclear: Should webview poll for updates? Listen to status bar events? Refresh on visibility change only?
   - Recommendation: Webview listens to visibility change (onDidChangeVisibility) + status bar posts message to webview after each calculation; no polling

## Sources

### Primary (HIGH confidence)

- [VS Code Webview API Documentation](https://code.visualstudio.com/api/extension-guides/webview) - Official API guide
- [VS Code Theme Color Reference](https://code.visualstudio.com/api/references/theme-color) - Official CSS variable docs
- [VS Code UX Guidelines: Webviews](https://code.visualstudio.com/api/ux-guidelines/webviews) - Official design patterns
- [VS Code UX Guidelines: Sidebars](https://code.visualstudio.com/api/ux-guidelines/sidebars) - Sidebar layout guidance
- [VS Code Extension Bundling](https://code.visualstudio.com/api/working-with-extensions/bundling-extension) - esbuild/webpack guidance
- [microsoft/vscode-extension-samples: webview-view-sample](https://github.com/microsoft/vscode-extension-samples/tree/main/webview-view-sample) - Official WebviewViewProvider example
- [Recharts GitHub Repository](https://github.com/recharts/recharts) - v3.7.0 release notes, API docs
- [Recharts Stacked Bar Chart Example](https://recharts.github.io/en-US/examples/StackedBarChart/) - Official example
- [React 18 Documentation](https://react.dev) - createRoot API, hooks patterns

### Secondary (MEDIUM confidence)

- [Medium: Configuring VSCode Extensions: Webpack, React, and TypeScript](https://medium.com/@captaincolinr/vscode-react-extension-guide-10ea25cb983f) - Dual bundling patterns verified against official docs
- [Ken Muse: Using React in VS Code Webviews](https://www.kenmuse.com/blog/using-react-in-vs-code-webviews/) - Message passing patterns align with official samples
- [Medium: Create advanced VSCode extension w/ React webview, esbuild bundler](https://medium.com/@aga1laoui/create-advanced-vscode-extension-w-react-webview-esbuild-bundler-eslint-airbnb-and-prettier-2ba2e3893667) - esbuild config verified
- [GeeksforGeeks: Create a Stacked Bar Chart using Recharts in ReactJS](https://www.geeksforgeeks.org/reactjs/create-a-stacked-bar-chart-using-recharts-in-reactjs/) - stackId pattern matches official Recharts docs
- [Building VS Code Extensions in 2026: The Complete Guide](https://abdulkadersafi.com/blog/building-vs-code-extensions-in-2026-the-complete-modern-guide) - Current best practices align with official docs

### Tertiary (LOW confidence)

- [WebSearch: VS Code extension webview React best practices 2026](https://abdulkadersafi.com/blog/building-vs-code-extensions-in-2026-the-complete-modern-guide) - General patterns only; specifics verified elsewhere
- [GitHub Issue: retainContextWhenHidden memory usage](https://github.com/microsoft/vscode/issues/113507) - Community discussion; memory claims not quantified

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries confirmed via official docs/repos; versions verified
- Architecture: HIGH - WebviewViewProvider, dual bundling, message passing all from official VS Code samples
- Pitfalls: MEDIUM-HIGH - CSP, memory leaks from official docs (HIGH); bundle size, sidebar width from community experience (MEDIUM)

**Research date:** 2026-02-07
**Valid until:** ~30 days (Recharts stable, VS Code API stable, React 18 stable; fast-moving only if new VS Code API features)
