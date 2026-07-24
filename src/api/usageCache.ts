/**
 * Shared usage cache for multi-window consistency
 *
 * Writes API results to ~/.claude/cache/usage-api.json so all VS Code windows
 * show the same data. Uses atomic writes (temp + rename) to prevent corruption.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import type {
	ApiRateLimitWindow,
	StalenessLevel,
	UsageCacheData,
} from "../types.js";
import type { Logger } from "../utils/logger.js";
import { parseResetsAt } from "./usageApi.js";

const CACHE_DIR = path.join(os.homedir(), ".claude", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "usage-api.json");
const CACHE_TMP = path.join(CACHE_DIR, "usage-api.json.tmp");

export class UsageCache {
	private readonly logger: Logger;

	constructor(logger: Logger) {
		this.logger = logger;
	}

	/** Full path to the cache file (for file watchers) */
	get filePath(): string {
		return CACHE_FILE;
	}

	/**
	 * Read the shared cache file
	 * Returns null if file doesn't exist, is empty, or has invalid JSON
	 */
	async readCache(): Promise<UsageCacheData | null> {
		try {
			const raw = await fs.readFile(CACHE_FILE, "utf8");
			const parsed = JSON.parse(raw);
			if (!parsed.apiUsage || !parsed.writtenAt) {
				return null;
			}
			// Restore Date object from ISO string
			// Return null if fetchedAt is missing/invalid -- don't lie about freshness
			if (typeof parsed.apiUsage.fetchedAt === "string") {
				const d = new Date(parsed.apiUsage.fetchedAt);
				if (Number.isNaN(d.getTime())) {
					this.logger.warn("Cache has invalid fetchedAt, discarding");
					return null;
				}
				parsed.apiUsage.fetchedAt = d;
			} else if (typeof parsed.apiUsage.fetchedAt === "number") {
				// Handle legacy format where fetchedAt was stored as Unix timestamp
				const d = new Date(parsed.apiUsage.fetchedAt);
				if (Number.isNaN(d.getTime())) {
					this.logger.warn("Cache has invalid numeric fetchedAt, discarding");
					return null;
				}
				parsed.apiUsage.fetchedAt = d;
			} else {
				this.logger.warn("Cache missing fetchedAt, discarding");
				return null;
			}
			// The cache is the one input path with no validation of its own. The
			// fetch path normalizes `resets_at` as it parses, but this file is
			// JSON.parse'd and cast, and it is written by whichever window polled
			// last -- possibly an older build, and it is a plain file on disk. An
			// unreadable reset reaching `rememberWeeklyAnchor` from here is worse
			// than one reaching a bar: it overwrites a good anchor in durable
			// state, and the weekly window then falls back to a calendar week,
			// counting the previous cycle's usage against a Monday reset. That is
			// the defect this whole change set exists to remove, arriving by a
			// different door and recovering only at the next successful poll.
			this.normalizeResets(parsed.apiUsage);

			return parsed as UsageCacheData;
		} catch (error) {
			if (
				error instanceof Error &&
				"code" in error &&
				(error as NodeJS.ErrnoException).code === "ENOENT"
			) {
				// File doesn't exist yet, that's fine
				return null;
			}
			this.logger.warn(
				`Could not read usage cache: ${error instanceof Error ? error.message : error}`,
			);
			return null;
		}
	}

	/**
	 * Drop any reset the rest of the code could not read, in place.
	 *
	 * Mutation rather than a rebuild is deliberate: the object was just produced
	 * by `JSON.parse` and is owned by this method until it is returned, and
	 * rebuilding it would mean restating a shape that grows server-side. This
	 * also gives the cache path the diagnostic the fetch path already has, which
	 * it otherwise lacks entirely.
	 */
	private normalizeResets(apiUsage: {
		fiveHour?: ApiRateLimitWindow | null;
		sevenDay?: ApiRateLimitWindow | null;
		scopedWeekly?: ApiRateLimitWindow[];
	}): void {
		const windows = [
			apiUsage.fiveHour,
			apiUsage.sevenDay,
			...(Array.isArray(apiUsage.scopedWeekly) ? apiUsage.scopedWeekly : []),
		];
		for (const window of windows) {
			if (!window) continue;
			window.resetsAt = parseResetsAt(window.resetsAt, this.logger);
		}
	}

	/**
	 * Write API data to the shared cache file (atomic: temp + rename)
	 */
	async writeCache(data: UsageCacheData): Promise<void> {
		try {
			await fs.mkdir(CACHE_DIR, { recursive: true });
			const json = JSON.stringify(data, null, "\t");
			await fs.writeFile(CACHE_TMP, json, "utf8");
			await fs.rename(CACHE_TMP, CACHE_FILE);
		} catch (error) {
			// On Windows, rename can fail with EPERM if target is locked. Retry once.
			if (
				error instanceof Error &&
				"code" in error &&
				(error as NodeJS.ErrnoException).code === "EPERM"
			) {
				await new Promise((r) => setTimeout(r, 100));
				try {
					await fs.rename(CACHE_TMP, CACHE_FILE);
					return;
				} catch {
					// Fall through to error log
				}
			}
			this.logger.warn(
				`Could not write usage cache: ${error instanceof Error ? error.message : error}`,
			);
		}
	}

	/**
	 * Start watching the cache file for changes from other windows
	 * Returns a disposable for cleanup
	 */
	startWatching(onChange: (data: UsageCacheData) => void): vscode.Disposable {
		let debounceTimer: NodeJS.Timeout | undefined;

		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(vscode.Uri.file(CACHE_DIR), "usage-api.json"),
			false, // don't ignore creates
			false, // don't ignore changes
			true, // ignore deletes
		);

		const handler = () => {
			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(async () => {
				const data = await this.readCache();
				if (data) {
					onChange(data);
				}
			}, 200);
		};

		const createSub = watcher.onDidCreate(handler);
		const changeSub = watcher.onDidChange(handler);

		return {
			dispose: () => {
				if (debounceTimer) clearTimeout(debounceTimer);
				createSub.dispose();
				changeSub.dispose();
				watcher.dispose();
			},
		};
	}
}

/**
 * Compute staleness level from a fetchedAt timestamp
 */
export function getStaleness(fetchedAt: Date | null): StalenessLevel {
	// No API data at all: distinct state so UI can show "not connected"
	if (!fetchedAt) return "unavailable";
	const ageMs = Date.now() - fetchedAt.getTime();
	// Guard against backward clock jumps (negative age reads as "fresh")
	if (ageMs < 0) return "stale";
	// Rate limits are 5h/7d windows -- data changes slowly.
	// Only warn when data is truly old enough to be misleading.
	if (ageMs < 30 * 60_000) return "fresh"; // <30m: perfectly fine
	if (ageMs < 60 * 60_000) return "normal"; // 30-60m: still good
	if (ageMs < 120 * 60_000) return "dim"; // 1-2h: slightly old
	if (ageMs < 240 * 60_000) return "stale"; // 2-4h: getting old
	return "critical"; // 4h+: data may be wrong
}
