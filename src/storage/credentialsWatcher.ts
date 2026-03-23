/**
 * Credentials Watcher
 *
 * Watches ~/.claude/.credentials.json for tier and token changes.
 * Auto-detects plan tier on startup and notifies when credentials change.
 * Signals PollingTimer when tokens change so it can recover from dead auth.
 */

import * as crypto from "node:crypto";
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
 * Watches credentials file for tier and token changes
 */
export class CredentialsWatcher {
	private readonly context: vscode.ExtensionContext;
	private readonly onTierChange: (tier: PlanType) => void;
	private readonly onTokenChange: () => void;
	private readonly logger: Logger;
	private readonly credentialsPath: string;
	private lastKnownTier: PlanType | null = null;
	private lastKnownTokenHash: string | null = null;
	private watcher: vscode.FileSystemWatcher | null = null;

	constructor(
		context: vscode.ExtensionContext,
		onTierChange: (tier: PlanType) => void,
		onTokenChange: () => void,
	) {
		this.context = context;
		this.onTierChange = onTierChange;
		this.onTokenChange = onTokenChange;
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
		const { tier, tokenHash } = await this.readCredentials(fallbackTier);
		this.lastKnownTier = tier;
		this.lastKnownTokenHash = tokenHash;

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

			this.logger.info(`Credentials watcher started (tier: ${tier})`);
		} catch (error) {
			this.logger.warn(`Failed to set up credentials watcher: ${error}`);
		}

		return tier;
	}

	/**
	 * Handle credentials file change event
	 */
	private async handleCredentialsChange(fallbackTier: PlanType): Promise<void> {
		const { tier, tokenHash } = await this.readCredentials(fallbackTier);

		// Fire tier change callback if tier changed
		if (tier !== this.lastKnownTier) {
			this.logger.info(`Tier changed: ${this.lastKnownTier} → ${tier}`);
			this.lastKnownTier = tier;
			this.onTierChange(tier);
		}

		// Fire token change callback if access token changed
		// This signals the PollingTimer to reset from dead auth state
		if (tokenHash && tokenHash !== this.lastKnownTokenHash) {
			this.logger.info("Access token changed, signaling polling timer");
			this.lastKnownTokenHash = tokenHash;
			this.onTokenChange();
		}
	}

	/**
	 * Read credentials file and extract tier + token hash
	 */
	private async readCredentials(
		fallback: PlanType,
	): Promise<{ tier: PlanType; tokenHash: string | null }> {
		try {
			const content = await fs.readFile(this.credentialsPath, "utf-8");

			if (!content || content.trim() === "") {
				return { tier: fallback, tokenHash: null };
			}

			const credentials = parseCredentialsFile(content);
			if (!credentials) {
				this.logger.warn(
					"Credentials file is malformed JSON, using fallback tier",
				);
				return { tier: fallback, tokenHash: null };
			}

			const tier = detectTierFromCredentials(credentials, fallback);

			// Hash the access token to detect changes without storing it
			const accessToken = (credentials as any)?.claudeAiOauth?.accessToken;
			const tokenHash = accessToken
				? crypto
						.createHash("sha256")
						.update(accessToken)
						.digest("hex")
						.slice(0, 16)
				: null;

			return { tier, tokenHash };
		} catch (error: any) {
			if (error.code === "ENOENT") {
				return { tier: fallback, tokenHash: null };
			}
			this.logger.warn(`Failed to read credentials file: ${error.message}`);
			return { tier: fallback, tokenHash: null };
		}
	}

	/**
	 * Dispose of watcher resources
	 */
	dispose(): void {
		if (this.watcher) {
			this.watcher = null;
		}
	}
}
