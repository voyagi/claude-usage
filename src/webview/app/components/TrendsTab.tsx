/**
 * TrendsTab component for displaying token usage trends over time.
 * Shows stacked bar chart, period selector, cost summary, and expandable data table.
 */
import { useCallback, useEffect, useState } from "react";
import { vscode } from "../index";
import type { DashboardData, MessageDetail, TrendDataPoint } from "../types";
import { SegmentedControl } from "./SegmentedControl";
import { UsageChart } from "./UsageChart";

export interface TrendsTabProps {
	data: DashboardData | null;
}

/**
 * Format number with commas for readability.
 */
function formatNumber(value: number): string {
	return value.toLocaleString();
}

/**
 * Format currency with 2 decimal places.
 */
function formatCurrency(value: number): string {
	return `$${value.toFixed(2)}`;
}

export function TrendsTab({ data }: TrendsTabProps) {
	const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("daily");
	const [showDetails, setShowDetails] = useState(false);
	const [drilldownPeriod, setDrilldownPeriod] = useState<string | null>(null);
	const [drilldownMessages, setDrilldownMessages] = useState<MessageDetail[]>(
		[],
	);

	// Restore persisted period selection from VS Code state
	useEffect(() => {
		const state = vscode.getState() as { trendsPeriod?: string } | undefined;
		if (state?.trendsPeriod) {
			setPeriod(state.trendsPeriod as "daily" | "weekly" | "monthly");
		}
	}, []);

	// Listen for message detail responses from extension
	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const message = event.data;
			if (message.type === "messageDetailData") {
				setDrilldownMessages(message.payload.messages);
				setDrilldownPeriod(message.payload.period);
			}
		};
		window.addEventListener("message", handler);
		return () => window.removeEventListener("message", handler);
	}, []);

	const handleDrilldown = useCallback(
		(targetPeriod: string) => {
			vscode.postMessage({
				type: "requestMessageDetail",
				period: targetPeriod,
				periodType: period,
			});
		},
		[period],
	);

	if (!data) {
		return null;
	}

	const handlePeriodChange = (newPeriod: string) => {
		const periodValue = newPeriod as "daily" | "weekly" | "monthly";
		setPeriod(periodValue);

		// Persist period selection
		const state = vscode.getState() as { trendsPeriod?: string } | undefined;
		vscode.setState({ ...state, trendsPeriod: periodValue });

		// Request updated data from extension
		vscode.postMessage({ type: "changePeriod", period: periodValue });
	};

	// Calculate cost summary from trend data
	const totalCost = data.trendData.reduce(
		(sum, point) => sum + point.totalCost,
		0,
	);
	const avgCost =
		data.trendData.length > 0 ? totalCost / data.trendData.length : 0;

	// Calculate total tokens for data table
	const calculateRowTotal = (point: TrendDataPoint): number => {
		return (
			point.inputTokens +
			point.outputTokens +
			point.cacheCreationTokens +
			point.cacheReadTokens
		);
	};

	const grandTotalTokens = data.trendData.reduce(
		(sum, point) => sum + calculateRowTotal(point),
		0,
	);

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
			{/* Period selector and header */}
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
				}}
			>
				<h2
					style={{
						margin: 0,
						fontSize: "calc(var(--vscode-font-size) * 1.2)",
						fontWeight: 600,
					}}
				>
					Usage Trends
				</h2>
				<SegmentedControl
					options={[
						{ value: "daily", label: "Daily" },
						{ value: "weekly", label: "Weekly" },
						{ value: "monthly", label: "Monthly" },
					]}
					selected={period}
					onChange={handlePeriodChange}
				/>
			</div>

			{/* Stacked bar chart */}
			<div
				style={{
					background: "var(--vscode-editor-background)",
					border: "1px solid var(--vscode-panel-border)",
					borderRadius: "6px",
					padding: "16px",
				}}
			>
				<UsageChart data={data.trendData} />
			</div>

			{/* Cost summary card */}
			<div
				style={{
					background: "var(--vscode-editor-background)",
					border: "1px solid var(--vscode-panel-border)",
					borderRadius: "6px",
					padding: "12px 16px",
					display: "flex",
					justifyContent: "space-around",
					alignItems: "center",
				}}
			>
				<div style={{ textAlign: "center" }}>
					<div
						style={{
							fontSize: "calc(var(--vscode-font-size) * 0.85)",
							color: "var(--vscode-descriptionForeground)",
						}}
					>
						Total Cost
					</div>
					<div
						style={{
							fontSize: "calc(var(--vscode-font-size) * 1.4)",
							fontWeight: 600,
							marginTop: "4px",
						}}
					>
						{formatCurrency(totalCost)}
					</div>
				</div>
				<div
					style={{
						width: "1px",
						height: "40px",
						background: "var(--vscode-panel-border)",
					}}
				/>
				<div style={{ textAlign: "center" }}>
					<div
						style={{
							fontSize: "calc(var(--vscode-font-size) * 0.85)",
							color: "var(--vscode-descriptionForeground)",
						}}
					>
						Average per{" "}
						{period === "daily"
							? "Day"
							: period === "weekly"
								? "Week"
								: "Month"}
					</div>
					<div
						style={{
							fontSize: "calc(var(--vscode-font-size) * 1.4)",
							fontWeight: 600,
							marginTop: "4px",
						}}
					>
						{formatCurrency(avgCost)}
					</div>
				</div>
			</div>

			{/* Expandable data table */}
			<div
				style={{
					background: "var(--vscode-editor-background)",
					border: "1px solid var(--vscode-panel-border)",
					borderRadius: "6px",
					overflow: "hidden",
				}}
			>
				<button
					onClick={() => setShowDetails(!showDetails)}
					style={{
						width: "100%",
						padding: "12px 16px",
						border: "none",
						background: "transparent",
						color: "var(--vscode-foreground)",
						fontFamily: "var(--vscode-font-family)",
						fontSize: "calc(var(--vscode-font-size) * 1.05)",
						fontWeight: 600,
						textAlign: "left",
						cursor: "pointer",
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
					}}
				>
					<span>{showDetails ? "Hide Details" : "Show Details"}</span>
					<span style={{ fontSize: "calc(var(--vscode-font-size) * 1.2)" }}>
						{showDetails ? "▼" : "▶"}
					</span>
				</button>

				{showDetails && !drilldownPeriod && (
					<div style={{ padding: "0 16px 16px" }}>
						<table
							style={{
								width: "100%",
								borderCollapse: "collapse",
								fontSize: "calc(var(--vscode-font-size) * 0.9)",
							}}
						>
							<thead>
								<tr
									style={{
										borderBottom: "1px solid var(--vscode-panel-border)",
									}}
								>
									<th
										style={{
											padding: "8px",
											textAlign: "left",
											fontWeight: 600,
										}}
									>
										Period
									</th>
									<th
										style={{
											padding: "8px",
											textAlign: "right",
											fontWeight: 600,
										}}
									>
										Msgs
									</th>
									<th
										style={{
											padding: "8px",
											textAlign: "right",
											fontWeight: 600,
										}}
									>
										Input
									</th>
									<th
										style={{
											padding: "8px",
											textAlign: "right",
											fontWeight: 600,
										}}
									>
										Output
									</th>
									<th
										style={{
											padding: "8px",
											textAlign: "right",
											fontWeight: 600,
										}}
									>
										Total
									</th>
									<th
										style={{
											padding: "8px",
											textAlign: "right",
											fontWeight: 600,
										}}
									>
										Cost
									</th>
									<th
										style={{
											padding: "8px",
											textAlign: "right",
											fontWeight: 600,
										}}
									>
										Avg/Msg
									</th>
								</tr>
							</thead>
							<tbody>
								{data.trendData.map((point, index) => (
									<tr
										key={point.period}
										onClick={() => handleDrilldown(point.period)}
										style={{
											background:
												index % 2 === 0
													? "transparent"
													: "var(--vscode-list-hoverBackground)",
											borderBottom:
												index < data.trendData.length - 1
													? "1px solid var(--vscode-panel-border)"
													: "none",
											cursor: "pointer",
										}}
										title={`Click to see ${point.messageCount} individual messages`}
									>
										<td style={{ padding: "8px" }}>{point.period}</td>
										<td style={{ padding: "8px", textAlign: "right" }}>
											{point.messageCount}
										</td>
										<td style={{ padding: "8px", textAlign: "right" }}>
											{formatNumber(point.inputTokens)}
										</td>
										<td style={{ padding: "8px", textAlign: "right" }}>
											{formatNumber(point.outputTokens)}
										</td>
										<td
											style={{
												padding: "8px",
												textAlign: "right",
												fontWeight: 600,
											}}
										>
											{formatNumber(calculateRowTotal(point))}
										</td>
										<td
											style={{
												padding: "8px",
												textAlign: "right",
												fontWeight: 600,
											}}
										>
											{formatCurrency(point.totalCost)}
										</td>
										<td
											style={{
												padding: "8px",
												textAlign: "right",
												color: "var(--vscode-descriptionForeground)",
											}}
										>
											{point.messageCount > 0
												? formatCurrency(point.totalCost / point.messageCount)
												: "-"}
										</td>
									</tr>
								))}
								<tr
									style={{
										borderTop: "2px solid var(--vscode-panel-border)",
										fontWeight: 700,
									}}
								>
									<td style={{ padding: "8px" }}>Total</td>
									<td style={{ padding: "8px", textAlign: "right" }}>
										{data.trendData.reduce((sum, p) => sum + p.messageCount, 0)}
									</td>
									<td style={{ padding: "8px", textAlign: "right" }}>
										{formatNumber(
											data.trendData.reduce((sum, p) => sum + p.inputTokens, 0),
										)}
									</td>
									<td style={{ padding: "8px", textAlign: "right" }}>
										{formatNumber(
											data.trendData.reduce(
												(sum, p) => sum + p.outputTokens,
												0,
											),
										)}
									</td>
									<td style={{ padding: "8px", textAlign: "right" }}>
										{formatNumber(grandTotalTokens)}
									</td>
									<td style={{ padding: "8px", textAlign: "right" }}>
										{formatCurrency(totalCost)}
									</td>
									<td style={{ padding: "8px", textAlign: "right" }}>
										{data.trendData.reduce((s, p) => s + p.messageCount, 0) > 0
											? formatCurrency(
													totalCost /
														data.trendData.reduce(
															(s, p) => s + p.messageCount,
															0,
														),
												)
											: "-"}
									</td>
								</tr>
							</tbody>
						</table>
					</div>
				)}

				{/* Message detail drill-down panel */}
				{showDetails && drilldownPeriod && (
					<div style={{ padding: "0 16px 16px" }}>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "8px",
								marginBottom: "12px",
							}}
						>
							<button
								onClick={() => {
									setDrilldownPeriod(null);
									setDrilldownMessages([]);
								}}
								style={{
									padding: "4px 10px",
									border: "1px solid var(--vscode-panel-border)",
									borderRadius: "4px",
									background: "var(--vscode-button-secondaryBackground)",
									color: "var(--vscode-button-secondaryForeground)",
									fontFamily: "var(--vscode-font-family)",
									fontSize: "calc(var(--vscode-font-size) * 0.9)",
									cursor: "pointer",
								}}
							>
								Back
							</button>
							<span style={{ fontWeight: 600 }}>
								{drilldownPeriod} ({drilldownMessages.length} messages)
							</span>
						</div>
						<table
							style={{
								width: "100%",
								borderCollapse: "collapse",
								fontSize: "calc(var(--vscode-font-size) * 0.85)",
							}}
						>
							<thead>
								<tr
									style={{
										borderBottom: "1px solid var(--vscode-panel-border)",
									}}
								>
									<th
										style={{
											padding: "6px 8px",
											textAlign: "left",
											fontWeight: 600,
										}}
									>
										Time
									</th>
									<th
										style={{
											padding: "6px 8px",
											textAlign: "left",
											fontWeight: 600,
										}}
									>
										Model
									</th>
									<th
										style={{
											padding: "6px 8px",
											textAlign: "right",
											fontWeight: 600,
										}}
									>
										In
									</th>
									<th
										style={{
											padding: "6px 8px",
											textAlign: "right",
											fontWeight: 600,
										}}
									>
										Out
									</th>
									<th
										style={{
											padding: "6px 8px",
											textAlign: "right",
											fontWeight: 600,
										}}
									>
										Cost
									</th>
								</tr>
							</thead>
							<tbody>
								{drilldownMessages.map((msg, index) => {
									const time = new Date(msg.timestamp);
									const timeStr = time.toLocaleTimeString([], {
										hour: "2-digit",
										minute: "2-digit",
										second: "2-digit",
									});
									const modelShort = msg.model
										.replace("claude-", "")
										.replace(/-\d{8}$/, "");
									return (
										<tr
											key={`${msg.timestamp}-${index}`}
											style={{
												background:
													index % 2 === 0
														? "transparent"
														: "var(--vscode-list-hoverBackground)",
												borderBottom:
													index < drilldownMessages.length - 1
														? "1px solid var(--vscode-panel-border)"
														: "none",
											}}
										>
											<td style={{ padding: "6px 8px" }}>{timeStr}</td>
											<td
												style={{
													padding: "6px 8px",
													color: "var(--vscode-descriptionForeground)",
												}}
											>
												{modelShort}
											</td>
											<td style={{ padding: "6px 8px", textAlign: "right" }}>
												{formatNumber(msg.inputTokens)}
											</td>
											<td style={{ padding: "6px 8px", textAlign: "right" }}>
												{formatNumber(msg.outputTokens)}
											</td>
											<td
												style={{
													padding: "6px 8px",
													textAlign: "right",
													fontWeight: 600,
												}}
											>
												{formatCurrency(msg.cost)}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</div>
	);
}
