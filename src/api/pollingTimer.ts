/**
 * Adaptive polling timer with auth state machine
 *
 * Three auth states:
 * - healthy: last fetch succeeded. Poll at 120s.
 * - degraded: transient failures within retry budget. Exponential backoff 30s-300s.
 * - dead: auth is permanently broken (refresh token expired). Stop polling.
 *         Resume only when credentials change (via resetAuth()).
 *
 * Polls independently of file watcher events. Adapts interval based on state.
 */

import type { ApiUsageData, AuthState, FetchResult } from "../types.js";
import type { Logger } from "../utils/logger.js";

const INITIAL_INTERVAL_MS = 5_000;
const SUCCESS_INTERVAL_MS = 120_000;
const FAILURE_INTERVAL_MS = 30_000;
const MAX_FAILURE_INTERVAL_MS = 300_000;
const AUTH_DEAD_THRESHOLD = 3;

export class PollingTimer {
	private readonly fetchFn: () => Promise<FetchResult>;
	private readonly onData: (data: ApiUsageData) => void;
	private readonly onError: (reason: string) => void;
	private readonly onAuthStateChange: (state: AuthState) => void;
	private readonly logger: Logger;

	private timer: ReturnType<typeof setTimeout> | null = null;
	private isRunning = false;
	private isTickInFlight = false;
	private pendingForceRefresh = false;
	private consecutiveFailures = 0;
	private consecutiveAuthFailures = 0;
	private _authState: AuthState = "healthy";

	constructor(
		fetchFn: () => Promise<FetchResult>,
		onData: (data: ApiUsageData) => void,
		onError: (reason: string) => void,
		onAuthStateChange: (state: AuthState) => void,
		logger: Logger,
	) {
		this.fetchFn = fetchFn;
		this.onData = onData;
		this.onError = onError;
		this.onAuthStateChange = onAuthStateChange;
		this.logger = logger;
	}

	get authState(): AuthState {
		return this._authState;
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
	 * If a tick is already in-flight, queues the refresh for after completion.
	 * No-op if stopped or in dead auth state.
	 */
	async forceRefresh(): Promise<void> {
		if (!this.isRunning) return;

		// In dead state, forceRefresh is allowed (user explicitly asked)
		if (this._authState === "dead") {
			this.logger.info(
				"Force refresh in dead state -- resetting auth to retry",
			);
			this.resetAuth();
			// resetAuth() may have scheduled a timer -- cancel it since
			// we're about to tick directly below
			if (this.timer) {
				clearTimeout(this.timer);
				this.timer = null;
			}
		}

		if (this.isTickInFlight) {
			this.pendingForceRefresh = true;
			this.logger.info(
				"Fetch in progress, queued force refresh for after completion",
			);
			return;
		}

		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		await this.tick();
	}

	/**
	 * Reset auth state from dead to healthy. Called when credentials
	 * file changes (new token available). Resumes polling if stopped.
	 */
	resetAuth(): void {
		if (this._authState === "dead") {
			this.logger.info("Auth reset -- credentials changed, resuming polling");
		}
		// Fresh token = clean slate for all failure tracking
		this.consecutiveAuthFailures = 0;
		this.consecutiveFailures = 0;
		this.setAuthState("healthy");

		// Resume polling if we were stopped due to dead auth
		if (this.isRunning && !this.timer && !this.isTickInFlight) {
			this.scheduleNext(INITIAL_INTERVAL_MS);
		}
	}

	/**
	 * Dispose of the timer (alias for stop)
	 */
	dispose(): void {
		this.stop();
	}

	private setAuthState(state: AuthState): void {
		if (this._authState === state) return;
		const prev = this._authState;
		this._authState = state;
		this.logger.info(`Auth state: ${prev} -> ${state}`);
		try {
			this.onAuthStateChange(state);
		} catch (err) {
			this.logger.error(
				`onAuthStateChange callback error: ${err instanceof Error ? err.message : err}`,
			);
		}
	}

	private scheduleNext(intervalMs: number): void {
		if (!this.isRunning) return;
		if (this._authState === "dead") return; // Don't schedule when dead
		this.timer = setTimeout(() => this.tick(), intervalMs);
	}

	private async tick(): Promise<void> {
		if (this.isTickInFlight) return;
		this.isTickInFlight = true;
		this.timer = null; // Clear consumed timer handle
		try {
			const result = await this.fetchFn();
			if (!this.isRunning) return; // Extension deactivated during fetch

			if (result.ok) {
				this.consecutiveFailures = 0;
				this.consecutiveAuthFailures = 0;
				this.setAuthState("healthy");
				try {
					this.onData(result.data);
				} catch (err) {
					this.logger.error(
						`Polling onData callback error: ${err instanceof Error ? err.message : err}`,
					);
				}
				this.scheduleNext(SUCCESS_INTERVAL_MS);
			} else {
				this.consecutiveFailures++;
				this.handleFailure(result.error);
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

			// Execute queued force refresh
			if (this.pendingForceRefresh && this.isRunning) {
				this.pendingForceRefresh = false;
				if (this.timer) {
					clearTimeout(this.timer);
					this.timer = null;
				}
				// Use setImmediate to avoid deep recursion
				setTimeout(() => this.tick(), 0);
			}
		}
	}

	private handleFailure(error: string): void {
		const isAuthError =
			error === "auth_dead" ||
			error === "auth_expired" ||
			error === "no_credentials";

		if (isAuthError) {
			this.consecutiveAuthFailures++;
		}

		// Terminal auth failure: enter dead state immediately
		if (error === "auth_dead") {
			this.logger.warn(
				"Auth is permanently broken (refresh token expired). Stopping polling.",
			);
			this.setAuthState("dead");
			try {
				this.onError(error);
			} catch (err) {
				this.logger.error(
					`Polling onError callback error: ${err instanceof Error ? err.message : err}`,
				);
			}
			return; // Don't schedule next tick
		}

		// Repeated auth failures -> dead state (expired token that keeps 401-ing)
		if (isAuthError && this.consecutiveAuthFailures >= AUTH_DEAD_THRESHOLD) {
			this.logger.warn(
				`${this.consecutiveAuthFailures} consecutive auth failures. Auth appears dead.`,
			);
			this.setAuthState("dead");
			try {
				this.onError(error);
			} catch (err) {
				this.logger.error(
					`Polling onError callback error: ${err instanceof Error ? err.message : err}`,
				);
			}
			return; // Don't schedule next tick
		}

		// Transient failure: backoff and retry
		if (isAuthError && this._authState === "healthy") {
			this.setAuthState("degraded");
		}

		const backoff = Math.min(
			FAILURE_INTERVAL_MS * 2 ** (this.consecutiveFailures - 1),
			MAX_FAILURE_INTERVAL_MS,
		);
		this.logger.warn(
			`API fetch failed: ${error} (attempt ${this.consecutiveFailures}), retry in ${Math.round(backoff / 1000)}s`,
		);
		try {
			this.onError(error);
		} catch (err) {
			this.logger.error(
				`Polling onError callback error: ${err instanceof Error ? err.message : err}`,
			);
		}
		this.scheduleNext(backoff);
	}
}
