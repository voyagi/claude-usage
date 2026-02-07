/**
 * Trust indicator badge showing local-only data processing.
 * Displays a lock icon and "Local Only" text with expandable access details.
 */
import { useState } from 'react';

export function TrustIndicator() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ marginBottom: '8px' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: 'none',
          border: 'none',
          color: 'var(--vscode-foreground)',
          cursor: 'pointer',
          padding: '4px 0',
          fontSize: '11px',
          opacity: 0.75,
          width: '100%',
        }}
        aria-expanded={expanded}
      >
        <span role="img" aria-label="Lock">🔒</span>
        <span>Local Only</span>
        <span style={{ marginLeft: 'auto', fontSize: '10px' }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>
      {expanded && (
        <div style={{
          padding: '8px 12px',
          marginTop: '4px',
          fontSize: '11px',
          lineHeight: 1.5,
          backgroundColor: 'var(--vscode-textBlockQuote-background)',
          borderRadius: '4px',
          opacity: 0.85,
        }}>
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>What this extension accesses:</div>
          <div style={{ color: 'var(--vscode-terminal-ansiGreen)' }}>
            ✓ Reads ~/.claude/projects/*.jsonl (session logs)<br/>
            ✓ Reads ~/.claude/.credentials.json (plan detection)<br/>
            ✓ Stores data in VS Code globalState (local)
          </div>
          <div style={{ color: 'var(--vscode-terminal-ansiRed)', marginTop: '6px' }}>
            ✗ No network requests of any kind<br/>
            ✗ No telemetry or analytics<br/>
            ✗ No data sent to any server<br/>
            ✗ No API keys required
          </div>
        </div>
      )}
    </div>
  );
}
