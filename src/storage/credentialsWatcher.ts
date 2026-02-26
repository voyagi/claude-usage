/**
 * Credentials Watcher
 *
 * Watches ~/.claude/.credentials.json for tier changes
 * Auto-detects plan tier on startup and notifies when credentials change
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
	detectTierFromCredentials,
	parseCredentialsFile,
} from "../core/tierDetection.js";
import type { PlanType } from "../types.js";
import { Logger } from "../utils/logger.js";

/**
 * Watches credentials file for tier changes
 */
export class CredentialsWatcher {
	private readonly context: vscode.ExtensionContext;
	private readonly onTierChange: (tier: PlanType) => void;
	private readonly logger: Logger;
	private readonly credentialsPath: string;
	private lastKnownTier: PlanType | null = null;
	private watcher: vscode.FileSystemWatcher | null = null;

	constructor(
		context: vscode.ExtensionContext,
		onTierChange: (tier: PlanType) => void,
	) {
		this.context = context;
		this.onTierChange = onTierChange;
		this.logger = Logger.create("Claude Usage - Credentials Watcher");
		this.credentialsPath = path.join(
			os.homedir(),
			".claude",
			".credentials.json",
		);
	}

	/**
	 * Start watching credentials file
	 *
	 * @param fallbackTier Tier to use if detection fails
	 * @returns Detected tier (or fallback if file missing/invalid)
	 */
	async start(fallbackTier: PlanType): Promise<PlanType> {
		// Read credentials once on startup
		const detectedTier = await this.readAndDetectTier(fallbackTier);
		this.lastKnownTier = detectedTier;

		// Set up file watcher
		const credDir = path.dirname(this.credentialsPath);
		const credFile = path.basename(this.credentialsPath);

		try {
			this.watcher = vscode.workspace.createFileSystemWatcher(
				new vscode.RelativePattern(credDir, credFile),
			);

			// Watch for changes to existing file
			this.watcher.onDidChange(async () => {
				await this.handleCredentialsChange(fallbackTier);
			});

			// Watch for file creation (if it didn't exist initially)
			this.watcher.onDidCreate(async () => {
				await this.handleCredentialsChange(fallbackTier);
			});

			// Register watcher for disposal
			this.context.subscriptions.push(this.watcher);

			this.logger.info(`Credentials watcher started (tier: ${detectedTier})`);
		} catch (error) {
			this.logger.warn(`Failed to set up credentials watcher: ${error}`);
		}

		return detectedTier;
	}

	/**
	 * Handle credentials file change event
	 */
	private async handleCredentialsChange(fallbackTier: PlanType): Promise<void> {
		const newTier = await this.readAndDetectTier(fallbackTier);

		// Only fire callback if tier actually changed
		if (newTier !== this.lastKnownTier) {
			this.logger.info(`Tier changed: ${this.lastKnownTier} → ${newTier}`);
			this.lastKnownTier = newTier;
			this.onTierChange(newTier);
		}
	}

	/**
	 * Read credentials file and detect tier
	 *
	 * @param fallback Tier to use if detection fails
	 * @returns Detected tier (or fallback)
	 */
	private async readAndDetectTier(fallback: PlanType): Promise<PlanType> {
		try {
			const content = await fs.readFile(this.credentialsPath, "utf-8");

			if (!content || content.trim() === "") {
				// Empty file - use fallback, no warning
				return fallback;
			}

			const credentials = parseCredentialsFile(content);
			if (!credentials) {
				this.logger.warn(
					"Credentials file is malformed JSON, using fallback tier",
				);
				return fallback;
			}

			const tier = detectTierFromCredentials(credentials, fallback);
			return tier;
		} catch (error: any) {
			// File doesn't exist - normal for fresh installs, no log
			if (error.code === "ENOENT") {
				return fallback;
			}

			// Other errors - log warning
			this.logger.warn(`Failed to read credentials file: ${error.message}`);
			return fallback;
		}
	}

	/**
	 * Dispose of watcher resources
	 */
	dispose(): void {
		// Watcher is auto-disposed via context.subscriptions
		if (this.watcher) {
			this.watcher = null;
		}
	}
}
