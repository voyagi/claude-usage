/**
 * Claude Usage Monitor extension entry point
 * Wires together JSONL parsing, pricing, aggregation, and persistence
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { Logger } from './utils/logger.js';
import { getClaudeProjectsDir } from './utils/paths.js';
import { parseAllSessions } from './parser/jsonlParser.js';
import { loadPricingFromConfig, calculateCost } from './pricing/pricingEngine.js';
import { aggregateUsage, getTimeBucketSummary } from './aggregation/timeBuckets.js';
import { UsageStore } from './storage/usageStore.js';
import { getPlanConfig } from './pricing/plans.js';
import { format } from 'date-fns';
import type { TimeBuckets, PlanType } from './types.js';

const logger = Logger.create('Claude Usage Monitor');

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext) {
  logger.info('Claude Usage Monitor activating...');

  // Create UsageStore for globalState persistence
  const store = new UsageStore(context);

  // Create status bar item
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.text = '$(loading~spin) Claude Usage: Loading...';
  statusBarItem.tooltip = 'Claude Usage Monitor is parsing session files...';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Register Clear Data command
  const clearDataCommand = vscode.commands.registerCommand(
    'claude-usage.clearData',
    async () => {
      await store.clearUsageData();
      statusBarItem.text = 'Claude Usage: No data';
      statusBarItem.tooltip = 'All usage data cleared. Reload window to reparse.';
      vscode.window.showInformationMessage(
        'Claude Usage: Data cleared. Reload window to reparse JSONL files.'
      );
    }
  );
  context.subscriptions.push(clearDataCommand);

  // Perform initial parse asynchronously (non-blocking)
  performInitialParse(store, statusBarItem).catch((err) => {
    logger.error(`Initial parse failed: ${err.message}`, err instanceof Error ? err : undefined);
    statusBarItem.text = '$(warning) Claude Usage: Error';
    statusBarItem.tooltip = `Parse failed: ${err.message}`;
  });

  logger.info('Claude Usage Monitor activated');
}

/**
 * Deactivation cleanup
 */
export function deactivate() {
  logger.info('Claude Usage Monitor deactivated');
}

/**
 * Format large numbers with K/M suffixes for display
 */
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return (tokens / 1_000_000).toFixed(1) + 'M';
  } else if (tokens >= 1_000) {
    return (tokens / 1_000).toFixed(0) + 'K';
  }
  return tokens.toString();
}

/**
 * Read the user's plan selection from VS Code settings
 */
function getSelectedPlan(): { type: PlanType; displayName: string; monthlyPrice: number } {
  const config = vscode.workspace.getConfiguration('claude-usage');
  const planType = config.get<PlanType>('planType', 'max5');
  return getPlanConfig(planType);
}

/**
 * Update status bar with aggregated usage data
 */
function updateStatusBar(
  statusBarItem: vscode.StatusBarItem,
  buckets: TimeBuckets,
  parseStats: { filesProcessed: number; linesSkipped: number }
): void {
  const summary = getTimeBucketSummary(buckets);
  const plan = getSelectedPlan();

  const today = format(new Date(), 'yyyy-MM-dd');
  const thisMonth = format(new Date(), 'yyyy-MM');
  const todayData = buckets.daily.get(today);
  const monthData = buckets.monthly.get(thisMonth);

  // Total tokens across all days
  let totalTokens = 0;
  for (const agg of buckets.daily.values()) {
    totalTokens += agg.inputTokens + agg.outputTokens + agg.cacheCreationTokens;
  }

  statusBarItem.text = `$(cloud) Claude: $${summary.totalCost.toFixed(2)} | ${formatTokens(totalTokens)} tok`;

  const todayTokens = todayData
    ? todayData.inputTokens + todayData.outputTokens + todayData.cacheCreationTokens
    : 0;
  const monthTokens = monthData
    ? monthData.inputTokens + monthData.outputTokens + monthData.cacheCreationTokens
    : 0;

  const tooltipLines = [
    'Claude Usage Monitor',
    `Plan: ${plan.displayName}`,
    '',
    `Today: $${(todayData?.totalCost ?? 0).toFixed(2)} (${formatTokens(todayTokens)} tokens)`,
    `This month: $${(monthData?.totalCost ?? 0).toFixed(2)} (${formatTokens(monthTokens)} tokens)`,
    '',
    `Sessions parsed: ${summary.totalSessions}`,
    `Files processed: ${parseStats.filesProcessed} (${parseStats.linesSkipped} lines skipped)`,
    `Last updated: ${new Date().toLocaleString()}`,
  ];
  statusBarItem.tooltip = tooltipLines.join('\n');
}

/**
 * Perform initial JSONL parse and populate status bar
 * Loads cached data first for instant display, then reparses in background
 */
async function performInitialParse(
  store: UsageStore,
  statusBarItem: vscode.StatusBarItem
): Promise<void> {
  // Try cached data first for instant status bar update
  const cached = await store.loadUsageData();
  if (cached) {
    logger.info('Loaded cached usage data, showing immediately');
    updateStatusBar(statusBarItem, cached.buckets, cached.stats);
  }

  logger.info('Starting full JSONL parse...');

  // Check if projects directory exists
  const projectsDir = getClaudeProjectsDir();
  try {
    await fs.access(projectsDir);
  } catch {
    logger.info('Projects directory not found, no data to display');
    if (!cached) {
      statusBarItem.text = '$(cloud) Claude Usage: No data';
      statusBarItem.tooltip = 'Claude projects directory not found.\nPath: ' + projectsDir;
    }
    return;
  }

  // Parse all JSONL files
  const parseResult = await parseAllSessions(logger);

  if (parseResult.records.length === 0) {
    logger.info('No usage records found in session files');
    if (!cached) {
      statusBarItem.text = '$(cloud) Claude Usage: No data';
      statusBarItem.tooltip = 'No usage records found in JSONL files';
    }
    return;
  }

  // Load pricing configuration
  const pricing = loadPricingFromConfig();

  // Apply cost calculation to each record
  for (const record of parseResult.records) {
    record.cost = calculateCost(record, pricing);
  }

  // Aggregate into time buckets
  const buckets = aggregateUsage(parseResult.records);

  // Save to globalState
  await store.saveUsageData(buckets, {
    filesProcessed: parseResult.filesProcessed,
    linesSkipped: parseResult.linesSkipped,
  });

  // Update status bar with fresh data
  updateStatusBar(statusBarItem, buckets, {
    filesProcessed: parseResult.filesProcessed,
    linesSkipped: parseResult.linesSkipped,
  });

  // Log summary to output channel
  const summary = getTimeBucketSummary(buckets);
  let totalTokens = 0;
  for (const agg of buckets.daily.values()) {
    totalTokens += agg.inputTokens + agg.outputTokens + agg.cacheCreationTokens;
  }
  logger.info(`Parse complete: ${parseResult.filesProcessed} files, ${parseResult.records.length} records`);
  logger.info(`Total cost: $${summary.totalCost.toFixed(2)}, Total tokens: ${formatTokens(totalTokens)}`);
  logger.info(`Sessions: ${summary.totalSessions}, Days active: ${summary.totalDays}`);
}
