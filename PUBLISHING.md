# Publishing to VS Code Marketplace

## Prerequisites

1. **Azure DevOps account** -- create at https://dev.azure.com
2. **Personal Access Token (PAT)** with "Marketplace (Manage)" scope:
   - Go to https://dev.azure.com → User Settings → Personal Access Tokens
   - Create new token, set Organization to "All accessible organizations"
   - Select scope: Marketplace > Manage
   - Copy the token (shown only once)
3. **Publisher created** -- either:
   - Web: https://marketplace.visualstudio.com/manage → Create Publisher (use `voyagi`)
   - CLI: `npx vsce create-publisher voyagi`

## Build and Package

```bash
npm run build
npx vsce package
```

Produces `claude-usage-monitor-1.0.0.vsix` (~418 KB).

## Publish

```bash
npx vsce login voyagi       # paste your PAT when prompted
npx vsce publish             # publishes current version
```

## Version Bumps

```bash
npx vsce publish patch       # 1.0.0 -> 1.0.1
npx vsce publish minor       # 1.0.0 -> 1.1.0
npx vsce publish major       # 1.0.0 -> 2.0.0
```

This auto-bumps package.json, packages, and publishes in one step.

## Install Locally (Without Publishing)

```bash
code --install-extension claude-usage-monitor-1.0.0.vsix
```

Or in VS Code: `Ctrl+Shift+P` > "Extensions: Install from VSIX..."

## Unpublish

```bash
npx vsce unpublish voyagi.claude-usage-monitor
```
