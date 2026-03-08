/**
 * SessionWatcher monitors JSONL files for changes and triggers incremental parsing
 * Handles debouncing, file creation/change events, and merges updates into live aggregated data
 */

import * as path from "node:path";
import * as vscode from "vscode";
import {
	aggregateUsage,
	mergeTimeBuckets,
} from "../aggregation/timeBuckets.js";
import type { RateLimitEvent } from "../parser/incrementalParser.js";
import { parseIncremental } from "../parser/incrementalParser.js";
import {
	calculateCost,
	loadPricingFromConfig,
} from "../pricing/pricingEngine.js";
import type { ModelPricing, TimeBuckets } from "../types.js";
import { Logger } from "../utils/logger.js";
import { getClaudeProjectsDir } from "../utils/paths.js";
import { OffsetTracker } from "./offsetTracker.js";

const logger = Logger.create("SessionWatcher");

/**
 * SessionWatcher watches JSONL files in ~/.claude/projects for file changes
 * Performs incremental parsing, merges results, and notifies via callback
 */
export class SessionWatcher {
	private readonly context: vscode.ExtensionContext;
	private readonly onUpdate: (
		buckets: TimeBuckets,
		stats: { filesProcessed: number; linesSkipped: number },
	) => void;
	private readonly onRateLimitEvent?: (event: RateLimitEvent) => void;
	private watcher: vscode.FileSystemWatcher | null = null;
	private readonly offsetTracker: OffsetTracker;
	private readonly recentlyCreated = new Set<string>();
	private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
	private processingChain: Promise<void> = Promise.resolve();
	private currentBuckets: TimeBuckets = {
		session: new Map(),
		daily: new Map(),
		weekly: new Map(),
		monthly: new Map(),
		modelWeekly: new Map(),
		hourly: new Map(),
	};
	private readonly processedFiles = new Set<string>();
	private totalLinesSkipped = 0;
	private pricing: Record<string, ModelPricing> = {};

	constructor(
		context: vscode.ExtensionContext,
		onUpdate: (
			buckets: TimeBuckets,
			stats: { filesProcessed: number; linesSkipped: number },
		) => void,
		onRateLimitEvent?: (event: RateLimitEvent) => void,
	) {
		this.context = context;
		this.onUpdate = onUpdate;
		this.onRateLimitEvent = onRateLimitEvent;
		this.offsetTracker = new OffsetTracker(context);
	}

	/**
	 * Start watching for file changes
	 */
	start(): void {
		// Load pricing once at startup
		this.pricing = loadPricingFromConfig();

		const projectsDir = getClaudeProjectsDir();
		const pattern = new vscode.RelativePattern(projectsDir, "**/*.jsonl");

		// Create watcher (watch creates and changes, ignore deletes)
		this.watcher = vscode.workspace.createFileSystemWatcher(
			pattern,
			false,
			false,
			true,
		);

		// Handle file creation
		const createDisposable = this.watcher.onDidCreate((uri) => {
			const filePath = uri.fsPath;
			logger.info(`File created: ${path.basename(filePath)}`);

			// Track as recently created to avoid duplicate processing
			this.recentlyCreated.add(filePath);
			setTimeout(() => {
				this.recentlyCreated.delete(filePath);
			}, 1000);

			// Parse from beginning (offset 0)
			this.handleFileChange(filePath, 0);
		});

		// Handle file changes
		const changeDisposable = this.watcher.onDidChange((uri) => {
			const filePath = uri.fsPath;

			// Skip if we just handled this file via onCreate
			if (this.recentlyCreated.has(filePath)) {
				logger.info(
					`Skipping change event for recently created file: ${path.basename(filePath)}`,
				);
				return;
			}

			// Debounce: clear existing timer and set new one
			const existingTimer = this.debounceTimers.get(filePath);
			if (existingTimer) {
				clearTimeout(existingTimer);
			}

			const timer = setTimeout(() => {
				this.debounceTimers.delete(filePath);
				this.handleFileChange(filePath);
			}, 500);

			this.debounceTimers.set(filePath, timer);
		});

		// Push disposables to context for automatic cleanup
		this.context.subscriptions.push(this.watcher);
		this.context.subscriptions.push(createDisposable);
		this.context.subscriptions.push(changeDisposable);

		logger.info(`SessionWatcher started, watching ${projectsDir}`);
	}

	/**
	 * Handle a file change event (debounced, serialized via processingChain)
	 */
	private handleFileChange(filePath: string, forceOffset?: number): void {
		this.processingChain = this.processingChain.then(() =>
			this.doHandleFileChange(filePath, forceOffset),
		);
	}

	/**
	 * Process a single file change (called sequentially via processingChain)
	 */
	private async doHandleFileChange(
		filePath: string,
		forceOffset?: number,
	): Promise<void> {
		try {
			// Get offset: use forceOffset if provided, else get from tracker
			const offset =
				forceOffset !== undefined
					? forceOffset
					: this.offsetTracker.getOffset(filePath);

			logger.info(
				`Processing file change: ${path.basename(filePath)} from offset ${offset}`,
			);

			// Parse incrementally from offset
			const result = await parseIncremental(filePath, offset, logger);

			// Notify rate limit events if callback provided
			if (this.onRateLimitEvent && result.rateLimitEvents.length > 0) {
				for (const event of result.rateLimitEvents) {
					this.onRateLimitEvent(event);
				}
			}

			// Early return if no new data (rate limit events already notified above)
			if (result.records.length === 0 && result.linesSkipped === 0) {
				logger.info(`No new data in ${path.basename(filePath)}`);
				return;
			}

			// Apply pricing to new records
			for (const record of result.records) {
				record.cost = calculateCost(record, this.pricing);
			}

			// Aggregate new records into time buckets
			const newBuckets = aggregateUsage(result.records);

			// Merge into current buckets
			this.currentBuckets = mergeTimeBuckets(this.currentBuckets, newBuckets);

			// Update offset tracker
			await this.offsetTracker.setOffset(filePath, result.newOffset);

			// Update stats
			this.processedFiles.add(filePath);
			this.totalLinesSkipped += result.linesSkipped;

			// Notify via callback
			this.onUpdate(this.currentBuckets, {
				filesProcessed: this.processedFiles.size,
				linesSkipped: this.totalLinesSkipped,
			});

			logger.info(
				`Parsed ${result.records.length} new records from ${path.basename(filePath)} ` +
					`(offset ${offset} -> ${result.newOffset})`,
			);
		} catch (error) {
			// Never throw from event handler - log and continue
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error(
				`Error handling file change for ${path.basename(filePath)}: ${errorMsg}`,
				error instanceof Error ? error : undefined,
			);
		}
	}

	/**
	 * Set initial buckets and stats after full parse completes
	 * Called by extension.ts to seed the watcher with baseline data
	 */
	setInitialBuckets(
		buckets: TimeBuckets,
		stats: { filesProcessed: number; linesSkipped: number },
	): void {
		this.currentBuckets = buckets;
		this.totalLinesSkipped = stats.linesSkipped;

		// Track files as processed (we don't have individual file paths from full parse,
		// so we'll just use the count directly)
		// The processedFiles set will grow as incremental updates happen
		logger.info(
			`Initial buckets set: ${stats.filesProcessed} files, ${stats.linesSkipped} lines skipped`,
		);
	}

	/**
	 * Reset watcher state (called by Clear Data command)
	 */
	async resetState(): Promise<void> {
		await this.offsetTracker.clearAllOffsets();

		this.currentBuckets = {
			session: new Map(),
			daily: new Map(),
			weekly: new Map(),
			monthly: new Map(),
			modelWeekly: new Map(),
			hourly: new Map(),
		};

		this.processedFiles.clear();
		this.totalLinesSkipped = 0;

		logger.info("SessionWatcher state reset");
	}

	/**
	 * Dispose of watcher resources
	 * Watcher itself is auto-disposed via context.subscriptions
	 */
	dispose(): void {
		// Clear all debounce timers
		for (const timer of this.debounceTimers.values()) {
			clearTimeout(timer);
		}
		this.debounceTimers.clear();
		this.recentlyCreated.clear();

		logger.info("SessionWatcher disposed");
	}
}
