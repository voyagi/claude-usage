# Phase 1: Foundation & Core Parsing - Context

**Gathered:** 2026-02-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Parse JSONL session files from ~/.claude/projects/ and calculate accurate token usage. Produce aggregated data (session, daily, weekly, monthly). No UI in this phase — data layer only. File watching and real-time updates are Phase 2.

</domain>

<decisions>
## Implementation Decisions

### State Persistence
- Keep all usage history forever — never discard old data automatically
- Full reparse from JSONL files on every VS Code startup (no snapshot/cache)
- Guarantees state always matches source files exactly — no stale data risk
- Provide a "Clear Usage Data" command (command palette) to reset extension state; JSONL files on disk are untouched
- Show a loading indicator in status bar during initial parse; display data only after parsing completes (no partial/jumping numbers)

### Error Tolerance
- Corrupt/truncated JSONL lines (expected during active Claude Code sessions): skip the line, log to output channel, continue parsing
- Unknown message types: Claude's discretion — balance accuracy vs completeness
- Unreadable files (permissions, locks): Claude's discretion — pick approach that works best cross-platform
- User-facing error visibility: degrade gracefully with a subtle indicator (e.g., warning in status bar tooltip) when data is known to be incomplete; never show raw parse errors in the UI

### Claude's Discretion
- Token counting strategy (billable vs cached, what counts toward limits)
- Time bucket boundaries (what defines a "session", rolling vs calendar windows)
- Unknown JSONL message type handling (ignore vs best-effort extraction)
- File access retry strategy for locked/unreadable files
- Internal data model and architecture

</decisions>

<specifics>
## Specific Ideas

- Accuracy is the #1 priority — numbers must match what Claude.ai web UI shows, or trust is lost
- The JSONL files are actively written by Claude Code — parser must never interfere with or lock files
- Loading state is preferable to inaccurate partial data

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation-core-parsing*
*Context gathered: 2026-02-07*
