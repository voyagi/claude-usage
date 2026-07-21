/**
 * First-run welcome card explaining what the extension reads and who it talks to.
 * Dismissible and persists across sessions via globalState.
 */
import { vscode } from "../index";

interface WelcomeCardProps {
	onDismiss: () => void;
}

export function WelcomeCard({ onDismiss }: WelcomeCardProps) {
	const handleDismiss = () => {
		vscode.postMessage({ type: "dismissWelcome" });
		onDismiss();
	};

	return (
		<div
			style={{
				padding: "12px 16px",
				marginBottom: "12px",
				borderRadius: "4px",
				backgroundColor: "var(--vscode-textBlockQuote-background)",
				border: "1px solid var(--vscode-textBlockQuote-border)",
			}}
		>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "flex-start",
				}}
			>
				<h3 style={{ margin: "0 0 8px 0", fontSize: "13px", fontWeight: 600 }}>
					Welcome to Claude Usage Monitor
				</h3>
				<button
					onClick={handleDismiss}
					style={{
						background: "none",
						border: "none",
						color: "var(--vscode-foreground)",
						cursor: "pointer",
						padding: "0 4px",
						fontSize: "14px",
						opacity: 0.7,
					}}
					aria-label="Dismiss welcome card"
				>
					×
				</button>
			</div>
			<p
				style={{
					margin: "0 0 8px 0",
					fontSize: "12px",
					opacity: 0.85,
					lineHeight: 1.4,
				}}
			>
				This extension monitors your Claude Code usage by reading local session
				files. The only service it ever talks to is <strong>Anthropic</strong>,
				signed in as you, to read your exact limit percentages and to refresh
				that login when it expires. Nothing goes anywhere else.
			</p>
			<ul
				style={{
					margin: 0,
					paddingLeft: "18px",
					fontSize: "11px",
					opacity: 0.75,
					lineHeight: 1.5,
				}}
			>
				<li>Reads: ~/.claude/projects/ (JSONL session files)</li>
				<li>Reads: ~/.claude/.credentials.json (your Claude Code login)</li>
				<li>Calls: api.anthropic.com, for your own usage percentages</li>
				<li>Calls: platform.claude.com, only to refresh an expired login</li>
				<li>No telemetry, no analytics, no third parties</li>
			</ul>
		</div>
	);
}
