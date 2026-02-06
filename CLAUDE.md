# Claude Usage Monitor

VS Code extension for local-only Claude Code usage monitoring.
Reads JSONL session files from ~/.claude/projects/ — zero network calls.

## Tech Stack
- TypeScript, VS Code Extension API, esbuild, React + Recharts (webview)

## Project Status
- Managed via GSD workflow — run `/gsd:progress` to see current state
- All planning artifacts in `.planning/`

## Working Directory
MSYS bash on Windows defaults to /home/ instead of the workspace.
Before any relative-path bash command, run: `cd /c/Users/Eagi/claude-usage`

## Key Constraints
- Zero network calls — all data stays local, no telemetry
- Must handle JSONL files being actively written by Claude Code
- Cross-platform (Windows primary, macOS/Linux supported)
- Minimal dependencies — trust is the core differentiator
