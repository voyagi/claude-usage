/**
 * ProjectsTab — per-project usage breakdown with a sortable table.
 * Surfaces the `project` aggregation bucket (token/cost by project folder).
 */
import { type CSSProperties, useState } from "react";
import type { DashboardData, ProjectUsage } from "../types";

export interface ProjectsTabProps {
	data: DashboardData | null;
}

function formatNumber(value: number): string {
	return value.toLocaleString();
}

function formatCurrency(value: number): string {
	return `$${value.toFixed(2)}`;
}

type SortKey =
	| "project"
	| "messageCount"
	| "inputTokens"
	| "outputTokens"
	| "totalTokens"
	| "totalCost";

function rowTotal(p: ProjectUsage): number {
	return (
		p.inputTokens + p.outputTokens + p.cacheCreationTokens + p.cacheReadTokens
	);
}

export function ProjectsTab({ data }: ProjectsTabProps) {
	const [sortKey, setSortKey] = useState<SortKey>("totalCost");
	const [sortAsc, setSortAsc] = useState(false);

	if (!data) {
		return null;
	}

	const projects = data.projects ?? [];

	const sorted = [...projects].sort((a, b) => {
		let cmp: number;
		if (sortKey === "project") {
			cmp = a.project.localeCompare(b.project);
		} else if (sortKey === "totalTokens") {
			cmp = rowTotal(a) - rowTotal(b);
		} else {
			cmp = a[sortKey] - b[sortKey];
		}
		return sortAsc ? cmp : -cmp;
	});

	const handleSort = (key: SortKey) => {
		if (key === sortKey) {
			setSortAsc(!sortAsc);
		} else {
			setSortKey(key);
			setSortAsc(false); // new column defaults to descending
		}
	};

	const grandCost = projects.reduce((s, p) => s + p.totalCost, 0);
	const grandMsgs = projects.reduce((s, p) => s + p.messageCount, 0);
	const grandTokens = projects.reduce((s, p) => s + rowTotal(p), 0);

	const headerBase: CSSProperties = {
		padding: "8px",
		fontWeight: 600,
		cursor: "pointer",
		userSelect: "none",
	};
	const arrow = (key: SortKey) =>
		sortKey === key ? (sortAsc ? " ▲" : " ▼") : "";

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
			<h2
				style={{
					margin: 0,
					fontSize: "calc(var(--vscode-font-size) * 1.2)",
					fontWeight: 600,
				}}
			>
				Usage by Project
			</h2>

			{projects.length === 0 ? (
				<div
					style={{
						color: "var(--vscode-descriptionForeground)",
						padding: "16px",
						textAlign: "center",
					}}
				>
					No project data yet. Usage is grouped by the project folder each
					session ran in.
				</div>
			) : (
				<div
					style={{
						background: "var(--vscode-editor-background)",
						border: "1px solid var(--vscode-panel-border)",
						borderRadius: "6px",
						overflow: "hidden",
						padding: "0 16px 16px",
					}}
				>
					<table
						style={{
							width: "100%",
							borderCollapse: "collapse",
							fontSize: "calc(var(--vscode-font-size) * 0.9)",
						}}
					>
						<thead>
							<tr
								style={{ borderBottom: "1px solid var(--vscode-panel-border)" }}
							>
								<th
									style={{ ...headerBase, textAlign: "left" }}
									onClick={() => handleSort("project")}
								>
									Project{arrow("project")}
								</th>
								<th
									style={{ ...headerBase, textAlign: "right" }}
									onClick={() => handleSort("messageCount")}
								>
									Msgs{arrow("messageCount")}
								</th>
								<th
									style={{ ...headerBase, textAlign: "right" }}
									onClick={() => handleSort("inputTokens")}
								>
									Input{arrow("inputTokens")}
								</th>
								<th
									style={{ ...headerBase, textAlign: "right" }}
									onClick={() => handleSort("outputTokens")}
								>
									Output{arrow("outputTokens")}
								</th>
								<th
									style={{ ...headerBase, textAlign: "right" }}
									onClick={() => handleSort("totalTokens")}
								>
									Total{arrow("totalTokens")}
								</th>
								<th
									style={{ ...headerBase, textAlign: "right" }}
									onClick={() => handleSort("totalCost")}
								>
									Cost{arrow("totalCost")}
								</th>
							</tr>
						</thead>
						<tbody>
							{sorted.map((p, index) => (
								<tr
									key={p.project}
									style={{
										background:
											index % 2 === 0
												? "transparent"
												: "var(--vscode-list-hoverBackground)",
										borderBottom:
											index < sorted.length - 1
												? "1px solid var(--vscode-panel-border)"
												: "none",
									}}
								>
									<td style={{ padding: "8px", wordBreak: "break-all" }}>
										{p.project}
									</td>
									<td style={{ padding: "8px", textAlign: "right" }}>
										{p.messageCount}
									</td>
									<td style={{ padding: "8px", textAlign: "right" }}>
										{formatNumber(p.inputTokens)}
									</td>
									<td style={{ padding: "8px", textAlign: "right" }}>
										{formatNumber(p.outputTokens)}
									</td>
									<td
										style={{
											padding: "8px",
											textAlign: "right",
											fontWeight: 600,
										}}
									>
										{formatNumber(rowTotal(p))}
									</td>
									<td
										style={{
											padding: "8px",
											textAlign: "right",
											fontWeight: 600,
										}}
									>
										{formatCurrency(p.totalCost)}
									</td>
								</tr>
							))}
							<tr
								style={{
									borderTop: "2px solid var(--vscode-panel-border)",
									fontWeight: 700,
								}}
							>
								<td style={{ padding: "8px" }}>Total ({projects.length})</td>
								<td style={{ padding: "8px", textAlign: "right" }}>
									{grandMsgs}
								</td>
								<td style={{ padding: "8px", textAlign: "right" }} />
								<td style={{ padding: "8px", textAlign: "right" }} />
								<td style={{ padding: "8px", textAlign: "right" }}>
									{formatNumber(grandTokens)}
								</td>
								<td style={{ padding: "8px", textAlign: "right" }}>
									{formatCurrency(grandCost)}
								</td>
							</tr>
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
