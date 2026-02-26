/**
 * Export usage data to JSON with summary and raw data
 */

import * as vscode from "vscode";
import { serializeTimeBuckets } from "../aggregation/timeBuckets.js";
import type { UsageStore } from "../storage/usageStore.js";
import { getClaudeProjectsDir } from "../utils/paths.js";

/**
 * Export usage data to JSON file via save dialog
 * Produces dual-format export: human-readable summary + raw time buckets
 */
export async function exportUsageData(
	store: UsageStore,
	planType: string,
): Promise<void> {
	const loaded = await store.loadUsageData();
	if (!loaded) {
		vscode.window.showInformationMessage(
			"Claude Usage: No usage data to export.",
		);
		return;
	}

	const { buckets, stats } = loaded;

	// Build summary (human-friendly)
	let totalInput = 0;
	let totalOutput = 0;
	let totalCacheCreation = 0;
	let totalCacheRead = 0;
	let totalCost = 0;

	for (const agg of buckets.daily.values()) {
		totalInput += agg.inputTokens;
		totalOutput += agg.outputTokens;
		totalCacheCreation += agg.cacheCreationTokens;
		totalCacheRead += agg.cacheReadTokens;
		totalCost += agg.totalCost;
	}

	const exportData = {
		exportedAt: new Date().toISOString(),
		extensionVersion: "0.1.0",
		dataSource: getClaudeProjectsDir(),
		planType,
		summary: {
			totalInputTokens: totalInput,
			totalOutputTokens: totalOutput,
			totalCacheCreationTokens: totalCacheCreation,
			totalCacheReadTokens: totalCacheRead,
			totalCost: Math.round(totalCost * 100) / 100,
			filesProcessed: stats.filesProcessed,
			linesSkipped: stats.linesSkipped,
			sessionCount: buckets.session.size,
			dailyBucketCount: buckets.daily.size,
		},
		raw: serializeTimeBuckets(buckets),
	};

	// Show save dialog
	const uri = await vscode.window.showSaveDialog({
		defaultUri: vscode.Uri.file(
			`claude-usage-export-${new Date().toISOString().slice(0, 10)}.json`,
		),
		filters: { JSON: ["json"] },
	});

	if (!uri) {
		return; // User cancelled
	}

	// Write file using VS Code workspace API for remote/SSH compatibility
	const content = new TextEncoder().encode(JSON.stringify(exportData, null, 2));
	await vscode.workspace.fs.writeFile(uri, content);
	vscode.window.setStatusBarMessage(
		`Claude Usage: Exported to ${uri.fsPath}`,
		5000,
	);
}
