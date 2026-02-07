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
import { aggregateUsage } from './aggregation/timeBuckets.js';
import { UsageStore } from './storage/usageStore.js';
import { SessionWatcher } from './watcher/sessionWatcher.js';
import { StatusBarManager } from './ui/statusBar.js';
import { showUsageMenu, showPlanPicker } from './ui/quickPick.js';
import { buildStatusBarData } from './core/rateLimits.js';
import { formatTokens } from './ui/formatting.js';
import type { PlanType } from './types.js';

const logger = Logger.create('Claude Usage Monitor');

// Module-level reference for SessionWatcher (needed by Clear Data command)
let sessionWatcher: SessionWatcher | null = null;

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext) {
  logger.info('Claude Usage Monitor activating...');

  // Create UsageStore for globalState persistence
  const store = new UsageStore(context);

  // Create StatusBarManager
  const statusBar = new StatusBarManager(context);

  // Helper to read current plan selection
  function getSelectedPlan(): PlanType {
    const config = vscode.workspace.getConfiguration('claude-usage');
    return config.get<PlanType>('planType', 'max5');
  }

  // Create SessionWatcher with onUpdate callback
  sessionWatcher = new SessionWatcher(context, (buckets, stats) => {
    // Transform buckets into StatusBarData and update display
    const data = buildStatusBarData(buckets, stats, getSelectedPlan());
    statusBar.update(data);
    // Persist to globalState
    store.saveUsageData(buckets, stats).catch((err) => {
      logger.error(`Failed to save usage data: ${err.message}`, err instanceof Error ? err : undefined);
    });
  });

  // Start watching for file changes
  sessionWatcher.start();

  // Register showMenu command
  context.subscriptions.push(
    vscode.commands.registerCommand('claude-usage.showMenu', () => showUsageMenu())
  );

  // Register refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('claude-usage.refresh', async () => {
      statusBar.showRefreshing();
      try {
        await performInitialParse(store, statusBar, sessionWatcher!);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Refresh failed: ${message}`, err instanceof Error ? err : undefined);
        statusBar.showError(message);
      }
    })
  );

  // Register switchPlan command
  context.subscriptions.push(
    vscode.commands.registerCommand('claude-usage.switchPlan', async () => {
      const plan = await showPlanPicker();
      if (plan) {
        const config = vscode.workspace.getConfiguration('claude-usage');
        await config.update('planType', plan, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Plan changed to ${plan}. Refreshing...`);
        // Trigger refresh to recalculate rate limits
        await vscode.commands.executeCommand('claude-usage.refresh');
      }
    })
  );

  // Register viewSummary command (placeholder for Phase 5)
  context.subscriptions.push(
    vscode.commands.registerCommand('claude-usage.viewSummary', () => {
      vscode.window.showInformationMessage('Usage summary dashboard coming in Phase 5.');
    })
  );

  // Register resetSession command
  context.subscriptions.push(
    vscode.commands.registerCommand('claude-usage.resetSession', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Reset all session tracking data? This will clear cached data and reparse all JSONL files.',
        'Yes',
        'No'
      );
      if (confirm === 'Yes') {
        await store.clearUsageData();
        if (sessionWatcher) {
          await sessionWatcher.resetState();
        }
        statusBar.showNoData();
        vscode.window.showInformationMessage('Session data cleared. Refreshing...');
        await vscode.commands.executeCommand('claude-usage.refresh');
      }
    })
  );

  // Register clearData command (legacy, kept for backwards compatibility)
  context.subscriptions.push(
    vscode.commands.registerCommand('claude-usage.clearData', async () => {
      await store.clearUsageData();
      if (sessionWatcher) {
        await sessionWatcher.resetState();
      }
      statusBar.showNoData();
      vscode.window.showInformationMessage(
        'Claude Usage: Data cleared. Reload window to reparse JSONL files.'
      );
    })
  );

  // Listen for configuration changes to re-render status bar
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claude-usage')) {
        // Trigger refresh to apply new settings (plan type or compact mode)
        vscode.commands.executeCommand('claude-usage.refresh');
      }
    })
  );

  // Perform initial parse asynchronously (non-blocking)
  performInitialParse(store, statusBar, sessionWatcher).catch((err) => {
    logger.error(`Initial parse failed: ${err.message}`, err instanceof Error ? err : undefined);
    statusBar.showError(err instanceof Error ? err.message : String(err));
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
 * Loads cached data first for instant display, then reparses in background
 */
async function performInitialParse(
  store: UsageStore,
  statusBar: StatusBarManager,
  watcher: SessionWatcher
): Promise<void> {
  // Helper to read current plan selection (inline to avoid module-level dependency)
  function getSelectedPlan(): PlanType {
    const config = vscode.workspace.getConfiguration('claude-usage');
    return config.get<PlanType>('planType', 'max5');
  }

  // Try cached data first for instant status bar update
  const cached = await store.loadUsageData();
  if (cached) {
    logger.info('Loaded cached usage data, showing immediately');
    const data = buildStatusBarData(cached.buckets, cached.stats, getSelectedPlan());
    statusBar.update(data);
  }

  logger.info('Starting full JSONL parse...');

  // Check if projects directory exists
  const projectsDir = getClaudeProjectsDir();
  try {
    await fs.access(projectsDir);
  } catch {
    logger.info('Projects directory not found, no data to display');
    if (!cached) {
      statusBar.showNoData();
    }
    return;
  }

  // Parse all JSONL files
  const parseResult = await parseAllSessions(logger);

  if (parseResult.records.length === 0) {
    logger.info('No usage records found in session files');
    if (!cached) {
      statusBar.showNoData();
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

  const stats = {
    filesProcessed: parseResult.filesProcessed,
    linesSkipped: parseResult.linesSkipped,
  };

  // Save to globalState
  await store.saveUsageData(buckets, stats);

  // Update status bar with fresh data
  const data = buildStatusBarData(buckets, stats, getSelectedPlan());
  statusBar.update(data);

  // Seed watcher with baseline data for incremental updates
  watcher.setInitialBuckets(buckets, stats);

  // Log summary to output channel
  let totalTokens = 0;
  for (const agg of buckets.daily.values()) {
    totalTokens += agg.inputTokens + agg.outputTokens + agg.cacheCreationTokens;
  }
  logger.info(`Parse complete: ${parseResult.filesProcessed} files, ${parseResult.records.length} records`);
  logger.info(`Total cost: $${data.totalCost.toFixed(2)}, Total tokens: ${formatTokens(totalTokens)}`);
}
