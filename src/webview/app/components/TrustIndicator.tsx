/**
 * Trust indicator badge summarising what the extension touches.
 *
 * Keep this honest and in step with the code: usage percentages come from
 * Anthropic's own usage endpoint (see src/api/usageApi.ts), so this must not
 * claim the extension makes no network requests.
 */
import { useState } from "react";

export function TrustIndicator() {
	const [expanded, setExpanded] = useState(false);

	return (
		<div style={{ marginBottom: "8px" }}>
			<button
				onClick={() => setExpanded(!expanded)}
				style={{
					display: "flex",
					alignItems: "center",
					gap: "6px",
					background: "none",
					border: "none",
					color: "var(--vscode-foreground)",
					cursor: "pointer",
					padding: "4px 0",
					fontSize: "11px",
					opacity: 0.75,
					width: "100%",
				}}
				aria-expanded={expanded}
			>
				<span role="img" aria-label="Lock">
					🔒
				</span>
				<span>Your data, Anthropic only</span>
				<span style={{ marginLeft: "auto", fontSize: "10px" }}>
					{expanded ? "▲" : "▼"}
				</span>
			</button>
			{expanded && (
				<div
					style={{
						padding: "8px 12px",
						marginTop: "4px",
						fontSize: "11px",
						lineHeight: 1.5,
						backgroundColor: "var(--vscode-textBlockQuote-background)",
						borderRadius: "4px",
						opacity: 0.85,
					}}
				>
					<div style={{ fontWeight: 600, marginBottom: "4px" }}>
						What this extension accesses:
					</div>
					<div style={{ color: "var(--vscode-terminal-ansiGreen)" }}>
						✓ Reads ~/.claude/projects/*.jsonl (session logs)
						<br />✓ Reads ~/.claude/.credentials.json (your Claude Code login)
						<br />✓ Stores data in VS Code globalState (local)
						<br />✓ Asks api.anthropic.com for your own usage percentages,
						signed in as you
					</div>
					<div
						style={{
							color: "var(--vscode-terminal-ansiRed)",
							marginTop: "6px",
						}}
					>
						✗ No telemetry or analytics
						<br />✗ Nothing sent anywhere except Anthropic
						<br />✗ No third parties, ever
						<br />✗ No separate API key needed
					</div>
				</div>
			)}
		</div>
	);
}
