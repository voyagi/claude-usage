/**
 * Adaptive polling timer for API usage fetching
 *
 * Polls independently of file watcher events. Adapts interval:
 * - 5s initial (fast first display)
 * - 120s on success (steady state)
 * - 30s-300s on failure (exponential backoff)
 */

import type { ApiUsageData } from "../types.js";
import type { Logger } from "../utils/logger.js";

const INITIAL_INTERVAL_MS = 5_000;
const SUCCESS_INTERVAL_MS = 120_000;
const FAILURE_INTERVAL_MS = 30_000;
const MAX_FAILURE_INTERVAL_MS = 300_000;

export class PollingTimer {
	private readonly fetchFn: () => Promise<ApiUsageData | null>;
	private readonly onData: (data: ApiUsageData) => void;
	private readonly onError: () => void;
	private readonly logger: Logger;

	private timer: ReturnType<typeof setTimeout> | null = null;
	private isRunning = false;
	private isTickInFlight = false;
	private consecutiveFailures = 0;

	constructor(
		fetchFn: () => Promise<ApiUsageData | null>,
		onData: (data: ApiUsageData) => void,
		onError: () => void,
		logger: Logger,
	) {
		this.fetchFn = fetchFn;
		this.onData = onData;
		this.onError = onError;
		this.logger = logger;
	}

	/**
	 * Start the polling timer. First tick fires after INITIAL_INTERVAL_MS.
	 * Idempotent: calling start() while running does nothing.
	 */
	start(): void {
		if (this.isRunning) return;
		this.isRunning = true;
		this.scheduleNext(INITIAL_INTERVAL_MS);
		this.logger.info(
			`Polling timer started (first fetch in ${INITIAL_INTERVAL_MS / 1000}s)`,
		);
	}

	/**
	 * Stop the polling timer. Can be restarted with start().
	 */
	stop(): void {
		this.isRunning = false;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	/**
	 * Force an immediate fetch, resetting the timer schedule.
	 * Used for on-click refresh and cache-stale scenarios.
	 * No-op if stopped or if a tick is already in-flight.
	 */
	async forceRefresh(): Promise<void> {
		if (!this.isRunning || this.isTickInFlight) return;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		await this.tick();
	}

	/**
	 * Dispose of the timer (alias for stop)
	 */
	dispose(): void {
		this.stop();
	}

	private scheduleNext(intervalMs: number): void {
		if (!this.isRunning) return;
		this.timer = setTimeout(() => this.tick(), intervalMs);
	}

	private async tick(): Promise<void> {
		if (this.isTickInFlight) return;
		this.isTickInFlight = true;
		try {
			const data = await this.fetchFn();
			if (!this.isRunning) return; // Extension deactivated during fetch

			if (data) {
				this.consecutiveFailures = 0;
				try {
					this.onData(data);
				} catch (err) {
					this.logger.error(
						`Polling onData callback error: ${err instanceof Error ? err.message : err}`,
					);
				}
				this.scheduleNext(SUCCESS_INTERVAL_MS);
			} else {
				this.consecutiveFailures++;
				const backoff = Math.min(
					FAILURE_INTERVAL_MS * 2 ** (this.consecutiveFailures - 1),
					MAX_FAILURE_INTERVAL_MS,
				);
				this.logger.warn(
					`API fetch failed (attempt ${this.consecutiveFailures}), retry in ${Math.round(backoff / 1000)}s`,
				);
				try {
					this.onError();
				} catch (err) {
					this.logger.error(
						`Polling onError callback error: ${err instanceof Error ? err.message : err}`,
					);
				}
				this.scheduleNext(backoff);
			}
		} catch (err) {
			// Never let an exception kill the timer loop
			this.logger.error(
				`Polling tick unexpected error: ${err instanceof Error ? err.message : err}`,
			);
			if (this.isRunning) {
				this.scheduleNext(FAILURE_INTERVAL_MS);
			}
		} finally {
			this.isTickInFlight = false;
		}
	}
}
