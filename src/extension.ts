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
import { format } from 'date-fns';

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
 * Perform initial JSONL parse and populate status bar
 */
async function performInitialParse(
  store: UsageStore,
  statusBarItem: vscode.StatusBarItem
): Promise<void> {
  logger.info('Starting full JSONL parse...');

  // Check if projects directory exists
  const projectsDir = getClaudeProjectsDir();
  try {
    await fs.access(projectsDir);
  } catch {
    logger.info('Projects directory not found, no data to display');
    statusBarItem.text = '$(cloud) Claude Usage: No data';
    statusBarItem.tooltip = 'Claude projects directory not found.\nPath: ' + projectsDir;
    return;
  }

  // Parse all JSONL files
  const parseResult = await parseAllSessions(logger);

  if (parseResult.records.length === 0) {
    logger.info('No usage records found in session files');
    statusBarItem.text = '$(cloud) Claude Usage: No data';
    statusBarItem.tooltip = 'No usage records found in JSONL files';
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

  // Get summary statistics
  const summary = getTimeBucketSummary(buckets);

  // Calculate daily and monthly costs from buckets
  const today = format(new Date(), 'yyyy-MM-dd');
  const thisMonth = format(new Date(), 'yyyy-MM');
  const todayData = buckets.daily.get(today);
  const monthData = buckets.monthly.get(thisMonth);

  // Format large numbers with K/M suffixes
  const formatTokens = (tokens: number): string => {
    if (tokens >= 1_000_000) {
      return (tokens / 1_000_000).toFixed(1) + 'M';
    } else if (tokens >= 1_000) {
      return (tokens / 1_000).toFixed(0) + 'K';
    }
    return tokens.toString();
  };

  // Calculate total tokens (billable: input + output + cache creation)
  let totalTokens = 0;
  for (const agg of buckets.daily.values()) {
    totalTokens += agg.inputTokens + agg.outputTokens + agg.cacheCreationTokens;
  }

  // Update status bar with summary
  statusBarItem.text = `$(cloud) Claude: $${summary.totalCost.toFixed(2)} | ${formatTokens(totalTokens)} tok`;

  // Calculate token totals for tooltip
  const todayTokens = todayData
    ? todayData.inputTokens + todayData.outputTokens + todayData.cacheCreationTokens
    : 0;
  const monthTokens = monthData
    ? monthData.inputTokens + monthData.outputTokens + monthData.cacheCreationTokens
    : 0;

  const tooltipLines = [
    'Claude Usage Monitor',
    '',
    `Today: $${(todayData?.totalCost ?? 0).toFixed(2)} (${formatTokens(todayTokens)} tokens)`,
    `This month: $${(monthData?.totalCost ?? 0).toFixed(2)} (${formatTokens(monthTokens)} tokens)`,
    '',
    `Sessions parsed: ${summary.totalSessions}`,
    `Files processed: ${parseResult.filesProcessed} (${parseResult.linesSkipped} lines skipped)`,
    `Last updated: ${new Date().toLocaleString()}`,
  ];
  statusBarItem.tooltip = tooltipLines.join('\n');

  // Log summary to output channel
  logger.info(`Parse complete: ${parseResult.filesProcessed} files, ${parseResult.records.length} records`);
  logger.info(`Total cost: $${summary.totalCost.toFixed(2)}, Total tokens: ${formatTokens(totalTokens)}`);
  logger.info(`Sessions: ${summary.totalSessions}, Days active: ${summary.totalDays}`);
}
