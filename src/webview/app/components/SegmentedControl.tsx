/**
 * SegmentedControl component for period selection.
 * Renders a button group where one option is selected at a time.
 */

export interface SegmentedControlProps {
	options: { value: string; label: string }[];
	selected: string;
	onChange: (value: string) => void;
}

export function SegmentedControl({
	options,
	selected,
	onChange,
}: SegmentedControlProps) {
	return (
		<div
			style={{
				display: "inline-flex",
				border: "1px solid var(--vscode-panel-border)",
				borderRadius: "4px",
				overflow: "hidden",
			}}
		>
			{options.map((option) => (
				<button
					key={option.value}
					onClick={() => onChange(option.value)}
					style={{
						padding: "4px 12px",
						border: "none",
						cursor: "pointer",
						fontFamily: "var(--vscode-font-family)",
						fontSize: "calc(var(--vscode-font-size) * 0.9)",
						background:
							selected === option.value
								? "var(--vscode-button-background)"
								: "transparent",
						color:
							selected === option.value
								? "var(--vscode-button-foreground)"
								: "var(--vscode-foreground)",
					}}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}
