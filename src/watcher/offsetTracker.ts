/**
 * Byte offset tracker for incremental JSONL parsing
 * Persists per-file read positions across VS Code reloads using globalState
 */

import type * as vscode from "vscode";
import { Logger } from "../utils/logger.js";

const logger = Logger.create("OffsetTracker");

/**
 * Tracks byte offsets for each session file to enable incremental parsing
 * Uses VS Code globalState for persistence across extension reloads
 */
export class OffsetTracker {
	private readonly context: vscode.ExtensionContext;
	private readonly keyPrefix = "fileOffset:";

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
	}

	/**
	 * Get the stored byte offset for a file
	 * @param filePath Absolute path to the session file
	 * @returns Byte offset or 0 if no offset is stored
	 */
	getOffset(filePath: string): number {
		const key = this.keyPrefix + filePath;
		const offset = this.context.globalState.get<number>(key, 0);
		logger.info(`Retrieved offset for ${filePath}: ${offset}`);
		return offset;
	}

	/**
	 * Store a new byte offset for a file
	 * @param filePath Absolute path to the session file
	 * @param offset New byte offset to persist
	 */
	async setOffset(filePath: string, offset: number): Promise<void> {
		const key = this.keyPrefix + filePath;
		await this.context.globalState.update(key, offset);
		logger.info(`Stored offset for ${filePath}: ${offset}`);
	}

	/**
	 * Reset the offset for a file to 0 (removes stored offset)
	 * @param filePath Absolute path to the session file
	 */
	async resetOffset(filePath: string): Promise<void> {
		const key = this.keyPrefix + filePath;
		await this.context.globalState.update(key, undefined);
		logger.info(`Reset offset for ${filePath}`);
	}

	/**
	 * Clear all stored file offsets
	 * Used by Clear Data command to reset tracking state
	 */
	async clearAllOffsets(): Promise<void> {
		const keys = this.context.globalState.keys();
		const offsetKeys = keys.filter((key) => key.startsWith(this.keyPrefix));

		for (const key of offsetKeys) {
			await this.context.globalState.update(key, undefined);
		}

		logger.info(`Cleared ${offsetKeys.length} file offsets`);
	}

	/**
	 * Get all file paths that have stored offsets
	 * @returns Array of absolute file paths being tracked
	 */
	getAllTrackedFiles(): string[] {
		const keys = this.context.globalState.keys();
		const offsetKeys = keys.filter((key) => key.startsWith(this.keyPrefix));
		const filePaths = offsetKeys.map((key) =>
			key.substring(this.keyPrefix.length),
		);

		logger.info(`Found ${filePaths.length} tracked files`);
		return filePaths;
	}
}
