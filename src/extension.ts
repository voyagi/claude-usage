/**
 * Claude Usage Monitor extension entry point
 * Wires together JSONL parsing, pricing, aggregation, and persistence
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { aggregateUsage } from "./aggregation/timeBuckets.js";
import { PollingTimer } from "./api/pollingTimer.js";
import { fetchApiUsage } from "./api/usageApi.js";
import { UsageCache } from "./api/usageCache.js";
import { exportUsageData } from "./commands/exportData.js";
import type { BurnRateTracker } from "./core/burnRate.js";
import {
	calculateBurnRateEMA,
	createBurnRateTracker,
} from "./core/burnRate.js";
import { buildStatusBarData } from "./core/rateLimits.js";
import { mapTierStringToPlanType } from "./core/tierDetection.js";
import type { RateLimitEvent } from "./parser/incrementalParser.js";
import { parseAllSessions } from "./parser/jsonlParser.js";
import { refineLimitEstimate } from "./parser/rateLimitDetector.js";
import { getPlanConfig } from "./pricing/plans.js";
import {
	calculateCost,
	loadPricingFromConfig,
} from "./pricing/pricingEngine.js";
import { CredentialsWatcher } from "./storage/credentialsWatcher.js";
import { UsageStore } from "./storage/usageStore.js";
import type {
	ApiUsageData,
	PlanType,
	RefinedLimits,
	TimeBuckets,
} from "./types.js";
import { formatTokens } from "./ui/formatting.js";
import { showPlanPicker, showUsageMenu } from "./ui/quickPick.js";
import { StatusBarManager } from "./ui/statusBar.js";
import { Logger } from "./utils/logger.js";
import { getClaudeProjectsDir } from "./utils/paths.js";
import { SessionWatcher } from "./watcher/sessionWatcher.js";
import { DashboardProvider } from "./webview/DashboardProvider.js";

const logger = Logger.create("Claude Usage Monitor");

// Module-level references
let sessionWatcher: SessionWatcher | null = null;
let dashboardProvider: DashboardProvider | null = null;
let burnRateTracker: BurnRateTracker | null = null;
let detectedTier: PlanType | null = null;
let refinedLimits: RefinedLimits | null = null;
let lastKnownSessionTokens = 0;
let lastKnownWeeklyTokens = 0;
let cachedApiUsage: ApiUsageData | null = null;
let pollingTimer: PollingTimer | null = null;
let usageCache: UsageCache | null = null;
let lastKnownBuckets: TimeBuckets | null = null;
let lastKnownStats: { filesProcessed: number; linesSkipped: number } | null =
	null;
let lastBurnRate = 0;

/**
 * Read current plan selection with auto-detection fallback
 */
function getSelectedPlan(): PlanType {
	const config = vscode.workspace.getConfiguration("claude-usage");
	const userSetting = config.get<PlanType>("planType", "max5");

	const inspected = config.inspect("planType");
	const hasUserOverride =
		inspected?.globalValue !== undefined ||
		inspected?.workspaceValue !== undefined;

	if (hasUserOverride) {
		return userSetting;
	}

	return detectedTier ?? userSetting;
}

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext) {
	// Activation guard: silently return if ~/.claude/ doesn't exist
	const claudeDir = path.join(os.homedir(), ".claude");
	try {
		await fs.access(claudeDir);
	} catch {
		logger.info(
			"Claude Code data directory not found (~/.claude/), extension inactive",
		);
		return;
	}

	logger.info("Claude Usage Monitor activating...");

	// Create UsageStore for globalState persistence
	const store = new UsageStore(context);

	// Create StatusBarManager
	const statusBar = new StatusBarManager(context);

	// Create and register DashboardProvider
	dashboardProvider = new DashboardProvider(context.extensionUri, context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			DashboardProvider.viewType,
			dashboardProvider,
		),
	);

	// Helper to read burn rate window from config
	function getBurnRateWindow(): number {
		const config = vscode.workspace.getConfiguration("claude-usage");
		return config.get<number>("burnRate.windowMinutes", 15);
	}

	// Load refined limits from globalState
	function loadRefinedLimits(): RefinedLimits | null {
		return context.globalState.get<RefinedLimits>("refinedLimits") ?? null;
	}

	// Save refined limits to globalState
	async function saveRefinedLimits(limits: RefinedLimits): Promise<void> {
		await context.globalState.update("refinedLimits", limits);
	}

	// Load persisted refined limits
	refinedLimits = loadRefinedLimits();
	if (refinedLimits) {
		logger.info(
			`Loaded refined limits from globalState (last updated: ${refinedLimits.lastUpdated})`,
		);
	}

	// Handle rate limit events from SessionWatcher
	function handleRateLimitEvent(event: RateLimitEvent): void {
		const plan = getPlanConfig(getSelectedPlan());

		if (event.limitType === "session" && lastKnownSessionTokens > 0) {
			const currentLimit =
				refinedLimits?.sessionTokenLimit ?? plan.sessionTokenLimit ?? 0;
			const refined = refineLimitEstimate(currentLimit, lastKnownSessionTokens);
			if (refined < currentLimit) {
				refinedLimits = {
					...refinedLimits,
					sessionTokenLimit: refined,
					lastUpdated: new Date().toISOString(),
				} as RefinedLimits;
				logger.info(
					`Refined session limit: ${currentLimit} -> ${refined} (observed: ${lastKnownSessionTokens})`,
				);
			}
		} else if (event.limitType === "weekly" && lastKnownWeeklyTokens > 0) {
			const currentLimit =
				refinedLimits?.weeklyTokenLimit ?? plan.weeklyTokenLimit ?? 0;
			const refined = refineLimitEstimate(currentLimit, lastKnownWeeklyTokens);
			if (refined < currentLimit) {
				refinedLimits = {
					...refinedLimits,
					weeklyTokenLimit: refined,
					lastUpdated: new Date().toISOString(),
				} as RefinedLimits;
				logger.info(
					`Refined weekly limit: ${currentLimit} -> ${refined} (observed: ${lastKnownWeeklyTokens})`,
				);
			}
		}

		// Persist and refresh
		if (refinedLimits) {
			saveRefinedLimits(refinedLimits).catch((err) => {
				logger.error(`Failed to save refined limits: ${err}`);
			});
			vscode.commands.executeCommand("claude-usage.refresh");
		}
	}

	// Initialize burn rate tracker
	burnRateTracker = createBurnRateTracker();

	// Create credentials watcher for auto tier detection + token change signals
	const credentialsWatcher = new CredentialsWatcher(
		context,
		(newTier) => {
			logger.info(`Tier changed to ${newTier}, refreshing...`);
			detectedTier = newTier;
			vscode.commands.executeCommand("claude-usage.refresh");
		},
		() => {
			// Token changed -- signal PollingTimer to recover from dead auth
			if (pollingTimer) {
				logger.info("Token change detected, resetting polling timer auth");
				pollingTimer.resetAuth();
			}
		},
	);

	// Create SessionWatcher with onUpdate callback and rate limit event handler
	// API fetching is now handled by the PollingTimer, not triggered by file changes
	sessionWatcher = new SessionWatcher(
		context,
		(buckets, stats) => {
			// Store for refreshStatusBar() to use when API data arrives
			lastKnownBuckets = buckets;
			lastKnownStats = stats;

			// Calculate EMA burn rate (only here, not in refreshStatusBar)
			const burnResult = calculateBurnRateEMA(
				buckets,
				burnRateTracker!,
				getBurnRateWindow(),
			);
			burnRateTracker = burnResult.tracker;
			lastBurnRate = burnResult.rate;

			// Transform buckets into StatusBarData and update display
			const data = buildStatusBarData(
				buckets,
				stats,
				getSelectedPlan(),
				lastBurnRate,
				refinedLimits,
				cachedApiUsage,
			);
			statusBar.update(data);

			// Update dashboard with new data
			if (dashboardProvider) {
				dashboardProvider.updateBuckets(buckets, data, getSelectedPlan());
			}

			// Track current token levels for rate limit refinement
			lastKnownSessionTokens = data.rateLimits.session5h.currentTokens;
			lastKnownWeeklyTokens = data.rateLimits.weekly.currentTokens;

			// Persist to globalState
			store.saveUsageData(buckets, stats).catch((err) => {
				logger.error(
					`Failed to save usage data: ${err.message}`,
					err instanceof Error ? err : undefined,
				);
			});
		},
		handleRateLimitEvent,
	);

	// Start credentials watcher (async, non-blocking)
	credentialsWatcher
		.start(getSelectedPlan())
		.then((tier) => {
			if (tier !== getSelectedPlan()) {
				detectedTier = tier;
				logger.info(`Auto-detected plan tier: ${tier}`);
				vscode.commands.executeCommand("claude-usage.refresh");
			}
		})
		.catch((err) => {
			logger.warn(`Credentials detection failed: ${err.message}`);
		});

	// --- Shared cache + adaptive polling (API-first architecture) ---

	// Helper: refresh status bar from latest API + JSONL data
	// Uses lastBurnRate instead of recalculating EMA (only SessionWatcher should recalculate)
	function refreshStatusBar(): void {
		if (!lastKnownBuckets || !lastKnownStats) return;
		const data = buildStatusBarData(
			lastKnownBuckets,
			lastKnownStats,
			getSelectedPlan(),
			lastBurnRate,
			refinedLimits,
			cachedApiUsage,
		);
		statusBar.update(data);
		if (dashboardProvider) {
			dashboardProvider.updateBuckets(
				lastKnownBuckets,
				data,
				getSelectedPlan(),
			);
		}
	}

	// Create shared cache for multi-window consistency
	usageCache = new UsageCache(logger);

	// Load existing cache for instant startup display
	const existingCache = await usageCache.readCache();
	if (existingCache) {
		cachedApiUsage = existingCache.apiUsage;
		logger.info(
			`Loaded cached API data (written ${new Date(existingCache.writtenAt).toISOString()})`,
		);
	}

	// Create polling timer: fetches API independently of file changes
	pollingTimer = new PollingTimer(
		() => fetchApiUsage(logger),
		(apiData) => {
			cachedApiUsage = apiData;

			// Auto-detect tier from API response
			if (apiData.rateLimitTier) {
				const mapped = mapTierStringToPlanType(apiData.rateLimitTier);
				if (mapped && mapped !== detectedTier) {
					detectedTier = mapped;
					logger.info(`Auto-detected tier from API: ${mapped}`);
				}
			}

			// Write to shared cache for other windows
			usageCache
				?.writeCache({
					apiUsage: apiData,
					rateLimitTier: apiData.rateLimitTier,
					writtenAt: new Date().toISOString(),
					writtenBy: String(process.pid),
				})
				.catch((err) => {
					logger.warn(`Failed to write usage cache: ${err}`);
				});

			// Refresh status bar with fresh API data
			refreshStatusBar();
		},
		(reason) => {
			// On error: refresh to update staleness indicator
			logger.warn(`API poll error: ${reason}`);
			refreshStatusBar();
		},
		(authState) => {
			// Auth state changed: update status bar display
			statusBar.setAuthState(authState);
			refreshStatusBar();
		},
		logger,
	);
	context.subscriptions.push({ dispose: () => pollingTimer?.dispose() });

	// Watch cache file for changes from other VS Code windows
	const cacheWatcher = usageCache.startWatching((cacheData) => {
		// Skip our own writes
		if (cacheData.writtenBy === String(process.pid)) return;

		cachedApiUsage = cacheData.apiUsage;
		logger.info("Updated API data from shared cache (other window wrote)");
		refreshStatusBar();
	});
	context.subscriptions.push(cacheWatcher);

	// Register showMenu command
	context.subscriptions.push(
		vscode.commands.registerCommand("claude-usage.showMenu", () =>
			showUsageMenu(),
		),
	);

	// Register openDashboard command
	context.subscriptions.push(
		vscode.commands.registerCommand("claude-usage.openDashboard", () => {
			vscode.commands.executeCommand("claude-usage.dashboardView.focus");
		}),
	);

	// Register refresh command
	context.subscriptions.push(
		vscode.commands.registerCommand("claude-usage.refresh", async () => {
			statusBar.showRefreshing();
			try {
				// Force immediate API refresh + JSONL reparse
				const refreshPromise = pollingTimer?.forceRefresh();
				await performInitialParse(store, statusBar, sessionWatcher!);
				await refreshPromise;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				logger.error(
					`Refresh failed: ${message}`,
					err instanceof Error ? err : undefined,
				);
				statusBar.showError(message);
			}
		}),
	);

	// Register switchPlan command
	context.subscriptions.push(
		vscode.commands.registerCommand("claude-usage.switchPlan", async () => {
			const plan = await showPlanPicker();
			if (plan) {
				const config = vscode.workspace.getConfiguration("claude-usage");
				await config.update(
					"planType",
					plan,
					vscode.ConfigurationTarget.Global,
				);
				vscode.window.showInformationMessage(
					`Plan changed to ${plan}. Refreshing...`,
				);
				// Trigger refresh to recalculate rate limits
				await vscode.commands.executeCommand("claude-usage.refresh");
			}
		}),
	);

	// Register viewSummary command (opens dashboard)
	context.subscriptions.push(
		vscode.commands.registerCommand("claude-usage.viewSummary", () => {
			vscode.commands.executeCommand("claude-usage.openDashboard");
		}),
	);

	// Register resetSession command
	context.subscriptions.push(
		vscode.commands.registerCommand("claude-usage.resetSession", async () => {
			const confirm = await vscode.window.showWarningMessage(
				"Reset all session tracking data? This will clear cached data and reparse all JSONL files.",
				"Yes",
				"No",
			);
			if (confirm === "Yes") {
				await store.clearUsageData();
				// Clear refined limits
				refinedLimits = null;
				await context.globalState.update("refinedLimits", undefined);
				lastKnownSessionTokens = 0;
				lastKnownWeeklyTokens = 0;
				if (sessionWatcher) {
					await sessionWatcher.resetState();
				}
				statusBar.showNoData();
				vscode.window.showInformationMessage(
					"Session data cleared. Refreshing...",
				);
				await vscode.commands.executeCommand("claude-usage.refresh");
			}
		}),
	);

	// Register exportData command
	context.subscriptions.push(
		vscode.commands.registerCommand("claude-usage.exportData", async () => {
			await exportUsageData(store, getSelectedPlan());
		}),
	);

	// Register toggleStatusBar command
	context.subscriptions.push(
		vscode.commands.registerCommand("claude-usage.toggleStatusBar", () => {
			statusBar.toggle();
			vscode.window.setStatusBarMessage(
				"Claude Usage: Status bar toggled",
				3000,
			);
		}),
	);

	// Register showDataSource command
	context.subscriptions.push(
		vscode.commands.registerCommand("claude-usage.showDataSource", () => {
			const dir = getClaudeProjectsDir();
			vscode.window.showInformationMessage(
				`Claude Usage reads data from: ${dir}`,
			);
		}),
	);

	// Register resetRateLimits command
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"claude-usage.resetRateLimits",
			async () => {
				refinedLimits = null;
				await context.globalState.update("refinedLimits", undefined);
				vscode.window.setStatusBarMessage(
					"Claude Usage: Rate limit estimates reset",
					3000,
				);
				await vscode.commands.executeCommand("claude-usage.refresh");
			},
		),
	);

	// Register openSettings command
	context.subscriptions.push(
		vscode.commands.registerCommand("claude-usage.openSettings", () => {
			vscode.commands.executeCommand(
				"workbench.action.openSettings",
				"claude-usage",
			);
		}),
	);

	// Register clearData command (legacy, kept for backwards compatibility)
	context.subscriptions.push(
		vscode.commands.registerCommand("claude-usage.clearData", async () => {
			await store.clearUsageData();
			// Clear refined limits
			refinedLimits = null;
			await context.globalState.update("refinedLimits", undefined);
			lastKnownSessionTokens = 0;
			lastKnownWeeklyTokens = 0;
			if (sessionWatcher) {
				await sessionWatcher.resetState();
			}
			statusBar.showNoData();
			vscode.window.showInformationMessage(
				"Claude Usage: Data cleared. Reload window to reparse JSONL files.",
			);
		}),
	);

	// Listen for configuration changes to re-render status bar
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("claude-usage")) {
				// Trigger refresh to apply new settings (plan type or compact mode)
				vscode.commands.executeCommand("claude-usage.refresh");
			}
		}),
	);

	// Perform initial parse, then start watcher and polling timer
	// (order matters: setInitialBuckets must run before watcher, and
	// lastKnownBuckets must be set before polling timer so refreshStatusBar works)
	performInitialParse(store, statusBar, sessionWatcher)
		.then(async () => {
			await sessionWatcher!.pruneStaleOffsets();
			sessionWatcher!.start();
			pollingTimer?.start();
		})
		.catch((err) => {
			logger.error(
				`Initial parse failed: ${err.message}`,
				err instanceof Error ? err : undefined,
			);
			statusBar.showError(err instanceof Error ? err.message : String(err));
			// Start watcher and polling timer even on parse failure
			sessionWatcher!.start();
			pollingTimer?.start();
		});

	logger.info("Claude Usage Monitor activated");
}

/**
 * Deactivation cleanup
 */
export function deactivate() {
	pollingTimer?.dispose();
	pollingTimer = null;
	usageCache = null;
	sessionWatcher?.dispose();
	sessionWatcher = null;
	dashboardProvider = null;
	burnRateTracker = null;
	lastBurnRate = 0;
	lastKnownBuckets = null;
	lastKnownStats = null;
	logger.info("Claude Usage Monitor deactivated");
}

/**
 * Perform initial JSONL parse and populate status bar
 * Loads cached data first for instant display, then reparses in background
 */
async function performInitialParse(
	store: UsageStore,
	statusBar: StatusBarManager,
	watcher: SessionWatcher,
): Promise<void> {
	// Helper to read burn rate window from config
	function getBurnRateWindow(): number {
		const config = vscode.workspace.getConfiguration("claude-usage");
		return config.get<number>("burnRate.windowMinutes", 15);
	}

	// Try cached JSONL data first for instant status bar update
	// (API data comes from the PollingTimer independently)
	const cached = await store.loadUsageData();
	if (cached) {
		logger.info("Loaded cached usage data, showing immediately");
		lastKnownBuckets = cached.buckets;
		lastKnownStats = cached.stats;
		const burnResult = calculateBurnRateEMA(
			cached.buckets,
			burnRateTracker!,
			getBurnRateWindow(),
		);
		burnRateTracker = burnResult.tracker;
		lastBurnRate = burnResult.rate;
		const data = buildStatusBarData(
			cached.buckets,
			cached.stats,
			getSelectedPlan(),
			lastBurnRate,
			refinedLimits,
			cachedApiUsage,
		);
		statusBar.update(data);
		if (dashboardProvider) {
			dashboardProvider.updateBuckets(cached.buckets, data, getSelectedPlan());
		}
	}

	logger.info("Starting full JSONL parse...");

	// Check if projects directory exists
	const projectsDir = getClaudeProjectsDir();
	try {
		await fs.access(projectsDir);
	} catch {
		logger.info("Projects directory not found, no data to display");
		if (!cached) {
			statusBar.showNoData();
		}
		return;
	}

	// Parse all JSONL files
	const parseResult = await parseAllSessions(logger);

	if (parseResult.records.length === 0) {
		logger.info("No usage records found in session files");
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

	// Store for refreshStatusBar() to use
	lastKnownBuckets = buckets;
	lastKnownStats = stats;

	// Calculate EMA burn rate for fresh data
	const burnResult = calculateBurnRateEMA(
		buckets,
		burnRateTracker!,
		getBurnRateWindow(),
	);
	burnRateTracker = burnResult.tracker;
	lastBurnRate = burnResult.rate;

	// Update status bar with fresh data (uses cachedApiUsage kept fresh by PollingTimer)
	const data = buildStatusBarData(
		buckets,
		stats,
		getSelectedPlan(),
		lastBurnRate,
		refinedLimits,
		cachedApiUsage,
	);
	statusBar.update(data);

	// Update dashboard with fresh data
	if (dashboardProvider) {
		dashboardProvider.updateBuckets(buckets, data, getSelectedPlan());
	}

	// Seed watcher with baseline data for incremental updates
	watcher.setInitialBuckets(buckets, stats);

	// Log summary to output channel
	let totalTokens = 0;
	for (const agg of buckets.daily.values()) {
		totalTokens += agg.inputTokens + agg.outputTokens + agg.cacheCreationTokens;
	}
	logger.info(
		`Parse complete: ${parseResult.filesProcessed} files, ${parseResult.records.length} records`,
	);
	logger.info(
		`Total cost: $${data.totalCost.toFixed(2)}, Total tokens: ${formatTokens(totalTokens)}`,
	);
}
