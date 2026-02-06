# Technology Stack

**Project:** claude-usage
**Researched:** 2026-02-07
**Confidence:** HIGH

## Recommended Stack

### Core Framework
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| TypeScript | 5.x+ | Primary language | Best VS Code extension DX. Node.js 22.18+ supports native TS without build step for local dev. Type safety critical for API usage tracking. |
| Node.js | 22.18+ | Runtime | Required for VS Code extensions. v22.18+ adds native TS support. VS Code extension host runs on Node.js. |
| VS Code Extension API | 1.105+ | Extension framework | Target latest stable minus 2-3 months (v1.105 baseline). Provides FileSystemWatcher, status bar, webview APIs. |

**Confidence:** HIGH - Official VS Code documentation and December 2025 VS Code v1.108 release notes confirm native TypeScript support in Node.js 22.18+.

### Build & Bundling
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| esbuild | Latest | Bundler | Official VS Code recommendation. Incredibly fast, handles TS natively, required for web compatibility. Simpler than webpack for extensions. |
| @vscode/vsce | 3.6+ | Packaging/publishing | Official packaging tool. Requires Node.js >=20.18.1. Handles .vsix creation and marketplace publishing. |

**Confidence:** HIGH - VS Code official bundling documentation explicitly recommends esbuild as the standard bundler for 2025/2026.

### File Watching & Parsing
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| VS Code FileSystemWatcher API | Built-in | File monitoring | Native API via `workspace.createFileSystemWatcher()`. October 2023 update added exclude pattern control. Zero dependencies. |
| Node.js built-in streams | Native | JSONL parsing | For simple line-by-line JSONL: `fs.createReadStream()` + `readline.createInterface()`. Zero deps, built-in, sufficient for non-streaming use case. |
| stream-json (optional) | 1.x+ | Advanced streaming | Only if real-time streaming during writes needed. Minimal deps, handles incomplete lines gracefully. DEFER unless proven necessary. |

**Confidence:** HIGH - VS Code FileSystemWatcher is authoritative (official API). MEDIUM for avoiding stream-json (may be needed for real-time monitoring of active sessions).

**Recommendation:** Start with Node.js built-in readline. Session files are written atomically or line-by-line. Built-in approach handles both:
```typescript
import * as readline from 'readline';
import * as fs from 'fs';

const fileStream = fs.createReadStream(sessionFilePath);
const rl = readline.createInterface({ input: fileStream });
for await (const line of rl) {
  const record = JSON.parse(line);
  // process record
}
```

### UI Components

#### Status Bar
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| VS Code Status Bar API | Built-in | Always-on indicator | `vscode.window.createStatusBarItem()`. Native, lightweight, perfect for burn rate display. Zero deps. |

**Confidence:** HIGH - Official VS Code API, confirmed via multiple documentation sources.

#### Sidebar Webview
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| React | 18.x | Webview UI framework | VS Code official recommendation for production extensions. Component model ideal for charts + tables. April 2025 update added programmatic sidebar webview control. |
| Recharts | 2.x | Charting library | Sweet spot: React-native, declarative API, reasonable bundle size (~100-150KB), performance sufficient for usage dashboards. Animation + responsiveness built-in. |
| VS Code Webview View API | Built-in | Sidebar container | `vscode.window.registerWebviewViewProvider()`. Mounts webviews in sidebar vs editor panels. |

**Confidence:** HIGH for React (official VS Code recommendation, 2026 guide confirms). HIGH for Recharts (multiple 2025 comparisons rank it best balance for dashboards).

**Alternatives Considered:**
- **Apache ECharts:** More powerful but heavier bundle (~400KB+). Overkill for usage charts.
- **Chart.js:** Simpler but less React-friendly. Recharts wraps primitives better.
- **D3.js:** Maximum flexibility but steep learning curve. Not worth complexity for standard line/bar/pie charts.
- **Nivo:** Beautiful defaults but larger bundle than Recharts.

**Why Recharts wins:** Declarative React components, baked-in responsiveness/animation, proven in production dashboards, lighter than ECharts/Nivo, easier than D3.

### Testing
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @vscode/test-cli | Latest | Test runner | Official VS Code test CLI. Integrates with Extension Test Runner UI. Uses Mocha under the hood. |
| @vscode/test-electron | 2.5+ | Test harness | Runs tests in VS Code Desktop context. Required for testing extension activation, commands, UI. |
| Mocha | Via test-cli | Test framework | Bundled with @vscode/test-cli. Standard for VS Code extensions. Can be replaced if needed. |

**Confidence:** MEDIUM - Official testing tools exist but documentation notes "limited capabilities" and "no webview testing support". May need manual testing for webview.

**Limitation:** Webview testing not supported by official tools. Plan for manual QA of charts/tables or explore third-party solutions like Playwright if critical.

### Code Quality
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| ESLint | 9.x | Linting | Industry standard. @typescript-eslint/parser for TS support. Catches bugs, enforces conventions. |
| @typescript-eslint/parser | 8.x | TS parsing for ESLint | Required for ESLint to understand TypeScript syntax. |
| @typescript-eslint/eslint-plugin | 8.x | TS-specific rules | TypeScript-aware linting rules (e.g., no-explicit-any, naming conventions). |
| Prettier | 3.x | Formatting | Auto-formatting on save. Integrates with ESLint via eslint-config-prettier. |
| eslint-config-prettier | Latest | ESLint-Prettier integration | Disables ESLint formatting rules that conflict with Prettier. Must be last in extends array. |

**Confidence:** HIGH - Standard 2025/2026 setup confirmed across multiple recent guides.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Bundler | esbuild | webpack | esbuild is faster, simpler config, official VS Code recommendation for 2025/2026. webpack is overkill. |
| Bundler | esbuild | rollup | esbuild handles TS natively, faster builds. rollup adds complexity without benefit for extensions. |
| JSONL parsing | Built-in readline | stream-json | readline sufficient for line-by-line parsing. stream-json only needed for streaming partial writes (unlikely). |
| JSONL parsing | Built-in readline | @streamparser/json | Adds dependency for features we don't need. Session files written line-by-line or atomically. |
| Charting | Recharts | Apache ECharts | ECharts 3-4x heavier bundle. Features (WebGL, 3D, maps) unnecessary for usage charts. |
| Charting | Recharts | Chart.js | Less React-friendly. Recharts declarative API cleaner for React webviews. |
| Charting | Recharts | D3.js | D3 too low-level. Recharts provides primitives we need without custom path calculations. |
| UI Framework | React | Svelte | React is official VS Code recommendation. Ecosystem larger, more examples for VS Code webviews. |
| UI Framework | React | Vue | Same as Svelte. React has better VS Code extension ecosystem and examples. |
| Testing | @vscode/test-electron | Jest | VS Code extensions run in Electron context. @vscode/test-electron provides that environment. Jest can't test vscode API. |

## Installation

### Initial Setup
```bash
# Scaffold extension (includes TypeScript, esbuild option)
npx --package yo --package generator-code -- yo code

# When prompted:
# - Extension type: New Extension (TypeScript)
# - Bundler: esbuild
# - Package manager: npm
```

### Core Dependencies
```bash
# VS Code extension APIs (typically included by generator)
npm install vscode

# React for webview UI
npm install react react-dom

# Recharts for charting
npm install recharts
```

### Dev Dependencies
```bash
# Build and bundling
npm install -D esbuild @vscode/vsce

# TypeScript
npm install -D typescript @types/node @types/vscode @types/react @types/react-dom

# Testing
npm install -D @vscode/test-cli @vscode/test-electron mocha @types/mocha

# Code quality
npm install -D eslint prettier
npm install -D @typescript-eslint/parser @typescript-eslint/eslint-plugin
npm install -D eslint-config-prettier eslint-plugin-prettier
```

### Optional (Deferred)
```bash
# Only add if built-in readline proves insufficient for real-time JSONL streaming
npm install stream-json
npm install -D @types/stream-json
```

## Package.json Scripts

Recommended scripts for development workflow:

```json
{
  "scripts": {
    "vscode:prepublish": "npm run package",
    "compile": "npm run check-types && node esbuild.js",
    "watch": "npm-run-all -p watch:*",
    "watch:esbuild": "node esbuild.js --watch",
    "watch:tsc": "tsc --noEmit --watch --project tsconfig.json",
    "package": "npm run check-types && node esbuild.js --production",
    "check-types": "tsc --noEmit",
    "lint": "eslint src --ext ts",
    "test": "vscode-test",
    "format": "prettier --write \"src/**/*.{ts,tsx}\""
  }
}
```

## esbuild Configuration

Create `esbuild.js` in project root:

```javascript
const esbuild = require('esbuild');
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'silent',
    plugins: [
      /* add to the end of plugins array */
      esbuildProblemMatcherPlugin,
    ],
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',
  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log('[watch] build finished');
    });
  },
};

main().catch(e => {
  console.error(e);
  process.exit(1);
});
```

**Note:** Webview React code requires separate esbuild config entry point. Create `esbuild.webview.js` with entry `src/webview/index.tsx` and output to `dist/webview.js`.

## TypeScript Configuration

Use strict mode for type safety. Target ES2020 or later for modern JS features.

```json
{
  "compilerOptions": {
    "module": "Node16",
    "target": "ES2022",
    "lib": ["ES2022"],
    "sourceMap": true,
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "exclude": ["node_modules", ".vscode-test"]
}
```

## ESLint Configuration

Create `.eslintrc.json`:

```json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": 2022,
    "sourceType": "module"
  },
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier"
  ],
  "rules": {
    "@typescript-eslint/naming-convention": [
      "warn",
      {
        "selector": "import",
        "format": ["camelCase", "PascalCase"]
      }
    ],
    "curly": "warn",
    "eqeqeq": "warn",
    "no-throw-literal": "warn",
    "semi": "warn"
  }
}
```

**Note:** `prettier` must be last in `extends` to override conflicting rules.

## Prettier Configuration

Create `.prettierrc`:

```json
{
  "singleQuote": true,
  "trailingComma": "es5",
  "tabWidth": 2,
  "semi": true,
  "printWidth": 100
}
```

## VS Code Settings for Development

Create `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "files.autoSave": "onFocusChange",
  "typescript.tsdk": "node_modules/typescript/lib"
}
```

## Architecture Notes

### Zero Network Dependencies
- All data read from local filesystem (`~/.claude/projects/`)
- No API calls, no telemetry, no external requests
- FileSystemWatcher monitors directory for new/changed session files
- Pure client-side calculation of usage, burn rate, rate limits

### Extension Activation
```json
// package.json
{
  "activationEvents": [
    "onStartupFinished"
  ]
}
```

Activate on startup to begin monitoring immediately. Status bar always visible.

### File Structure
```
claude-usage/
├── src/
│   ├── extension.ts              # Entry point, activation
│   ├── fileWatcher.ts            # FileSystemWatcher logic
│   ├── parser.ts                 # JSONL parsing
│   ├── usageTracker.ts           # Usage calculation, burn rate
│   ├── statusBar.ts              # Status bar item management
│   ├── webview/
│   │   ├── WebviewProvider.ts    # Webview provider
│   │   ├── index.tsx             # React entry point
│   │   ├── App.tsx               # Main webview component
│   │   └── components/           # Chart, table components
│   └── test/
├── dist/                          # esbuild output
├── .vscode/
│   ├── launch.json                # Debug config
│   ├── tasks.json                 # Build tasks
│   └── settings.json              # Workspace settings
├── esbuild.js                     # Extension build config
├── esbuild.webview.js             # Webview build config
├── tsconfig.json
├── .eslintrc.json
├── .prettierrc
└── package.json
```

## Version Pinning Strategy

- **TypeScript:** Use `^5.0.0` (caret) for minor updates, stay on v5 major
- **Node.js:** Require `>=22.18.0` (native TS support)
- **React:** Use `^18.0.0` (stable, long-term support)
- **Recharts:** Use `^2.0.0` (latest stable)
- **esbuild:** Use `^0.x.x` (fast-moving, caret allows patches)
- **@vscode/vsce:** Use `^3.6.0` (official tool, track updates)
- **ESLint/Prettier:** Use `^` for all (non-breaking updates welcome)

**Rationale:** Allow patch/minor updates for tooling (esbuild, linters) but lock major versions for runtime deps (React, Recharts) to avoid breaking changes.

## Sources

**VS Code Official Documentation:**
- [Your First Extension](https://code.visualstudio.com/api/get-started/your-first-extension)
- [Bundling Extensions](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)
- [Webview API](https://code.visualstudio.com/api/extension-guides/webview)
- [Testing Extensions](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)

**Community Guides (2025/2026):**
- [Building VS Code Extensions in 2026: The Complete Guide](https://abdulkadersafi.com/blog/building-vs-code-extensions-in-2026-the-complete-modern-guide)
- [Best React chart libraries (2025 update)](https://blog.logrocket.com/best-react-chart-libraries-2025/)
- [8 Best React Chart Libraries for Visualizing Data in 2025](https://embeddable.com/blog/react-chart-libraries)

**GitHub/npm:**
- [microsoft/vscode-vsce](https://github.com/microsoft/vscode-vsce)
- [@vscode/test-electron on npm](https://www.npmjs.com/package/@vscode/test-electron)
- [stream-json on npm](https://www.npmjs.com/package/stream-json)
- [Recharts on Bundlephobia](https://bundlephobia.com/package/recharts)

**Release Notes:**
- [VS Code December 2025 (v1.108)](https://code.visualstudio.com/updates/v1_108) - Native TypeScript support
- [VS Code October 2023 (v1.84)](https://code.visualstudio.com/updates/v1_84) - FileSystemWatcher exclude patterns

**Ecosystem Surveys:**
- [ESLint + Prettier + TypeScript Setup (2025)](https://dev.to/marina_eremina/how-to-set-up-eslint-and-prettier-for-react-app-in-vscode-2025-2341)
- [Recharts Performance Guide](https://recharts.github.io/en-US/guide/performance/)
