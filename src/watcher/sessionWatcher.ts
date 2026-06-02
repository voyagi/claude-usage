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
	dedupeByMessageId,
	reconcileSeenUsage,
} from "../parser/tokenCounter.js";
import {
	calculateCost,
	loadPricingFromConfig,
} from "../pricing/pricingEngine.js";
import type { ModelPricing, TimeBuckets, TokenUsage } from "../types.js";
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
	/**
	 * Usage already counted per message id this run (seeded from the full parse,
	 * then extended by each incremental read). Makes token counting idempotent per
	 * message id while keeping the largest usage seen: Claude Code re-logs the same
	 * assistant message many times and the reader can re-read bytes the full parse
	 * already counted.
	 */
	private readonly countedById = new Map<string, TokenUsage>();

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

			// Dedupe re-logged duplicates and drop ids already counted this run,
			// so each response is counted exactly once even when the incremental
			// reader re-reads bytes or a write-burst straddles two reads.
			const freshRecords = this.filterFreshRecords(result.records);

			if (freshRecords.length > 0) {
				// Apply pricing to the fresh records
				for (const record of freshRecords) {
					record.cost = calculateCost(record, this.pricing);
				}

				// Aggregate and merge into current buckets
				const newBuckets = aggregateUsage(freshRecords);
				this.currentBuckets = mergeTimeBuckets(this.currentBuckets, newBuckets);
			}

			// Advance the offset even if every record was a duplicate, so those
			// bytes are not re-read next time
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
				`Parsed ${result.records.length} records (${freshRecords.length} counted after dedupe) ` +
					`from ${path.basename(filePath)} (offset ${offset} -> ${result.newOffset})`,
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
	 * Dedupe a batch by message id, then reconcile against usage already counted
	 * this run: new ids count in full, smaller/equal repeats are dropped, and a
	 * later read carrying larger usage contributes only the positive token delta
	 * (so a final write landing in a later read tops up rather than being lost).
	 * Records without a message id are always kept (they cannot be deduped).
	 */
	private filterFreshRecords(records: TokenUsage[]): TokenUsage[] {
		const deduped = dedupeByMessageId(records);
		const fresh: TokenUsage[] = [];
		for (const record of deduped) {
			const counted = reconcileSeenUsage(record, this.countedById);
			if (counted !== null) {
				fresh.push(counted);
			}
		}
		return fresh;
	}

	/**
	 * Set initial buckets and stats after full parse completes
	 * Called by extension.ts to seed the watcher with baseline data
	 * Serialized via processingChain to prevent races with incremental parses
	 */
	setInitialBuckets(
		buckets: TimeBuckets,
		stats: { filesProcessed: number; linesSkipped: number },
		seenRecords: Iterable<TokenUsage> = [],
	): void {
		this.processingChain = this.processingChain.then(() => {
			this.currentBuckets = buckets;
			this.totalLinesSkipped = stats.linesSkipped;
			// Re-seed the dedupe guard with the usage already counted in the full
			// parse, so incremental reads don't re-count it (and can top up if a
			// later read carries larger usage for the same message id).
			this.countedById.clear();
			for (const record of seenRecords) {
				if (record.messageId) {
					this.countedById.set(record.messageId, record);
				}
			}
			logger.info(
				`Initial buckets set: ${stats.filesProcessed} files, ${stats.linesSkipped} lines skipped, ${this.countedById.size} message ids seeded`,
			);
		});
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
		this.countedById.clear();

		logger.info("SessionWatcher state reset");
	}

	/**
	 * Remove offset keys for files that no longer exist on disk
	 */
	async pruneStaleOffsets(): Promise<void> {
		await this.offsetTracker.pruneStaleKeys();
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
