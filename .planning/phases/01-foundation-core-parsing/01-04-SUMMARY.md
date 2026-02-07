# Plan 01-04 Summary: UsageStore & Extension Wiring

## What was built
- **src/storage/usageStore.ts**: globalState persistence layer wrapping `vscode.ExtensionContext.globalState` with typed save/load/clear operations. Version field (v1) enables future schema migrations. Serializes TimeBuckets Maps to arrays for JSON storage.
- **src/extension.ts**: Full pipeline entry point wiring parser → pricing → aggregation → persistence. Non-blocking async parse on activation. Status bar with loading spinner, cost/token display, and multi-line tooltip (today/month breakdown).
- **.vscode/launch.json + tasks.json**: Extension Development Host debug configuration for F5 launch.

## Key decisions
- `activate()` returns immediately; parsing runs async (VS Code requirement)
- Status bar shows `$(cloud) Claude: $X.XX | Xtok` with K/M token abbreviations
- Tooltip shows today and this-month breakdowns using daily bucket lookups
- Clear Data command resets globalState and status bar
- Graceful degradation: missing data directory shows "No data" instead of error

## Verification results
- Human-verified in Extension Development Host:
  - Status bar: "$243.70 | 20.3M tok" ✓
  - Tooltip: Today $65.57, This month $225.32, 55 sessions, 144 files ✓
  - Output channel: 144/144 files, 4518 records, 0 lines skipped ✓
- `npm run build` passes cleanly
- No errors in Debug Console

## Deviations
- Added `.vscode/launch.json` and `tasks.json` (not in original plan but required for F5 verification)
- MSYS bash PATH issue: Node.js not in MSYS PATH, used PowerShell workaround for npm commands

## Commits
- `aab03d8` — feat(01-04): add UsageStore globalState persistence
- `18f63f7` — feat(01-04): wire extension entry point with full pipeline
- `1d78382` — chore: add VS Code launch config for extension debugging
