/**
 * Persistent storage for aggregated usage data using VS Code globalState
 */

import * as vscode from 'vscode';
import {
  TimeBuckets,
  PersistedState,
} from '../types.js';
import {
  serializeTimeBuckets,
  deserializeTimeBuckets,
} from '../aggregation/timeBuckets.js';
import { Logger } from '../utils/logger.js';

const logger = Logger.create('UsageStore');

/**
 * UsageStore wraps VS Code globalState for typed persistence
 * Handles serialization/deserialization of TimeBuckets (Map to array conversion)
 * Supports schema versioning for future migrations
 */
export class UsageStore {
  private readonly context: vscode.ExtensionContext;
  private readonly storageKey = 'claudeUsage';

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * Save aggregated usage data to globalState
   * @param buckets TimeBuckets to persist
   * @param stats Parse statistics (files processed, lines skipped)
   */
  async saveUsageData(
    buckets: TimeBuckets,
    stats: { filesProcessed: number; linesSkipped: number }
  ): Promise<void> {
    const state: PersistedState = {
      version: 1,
      lastParseTimestamp: new Date().toISOString(),
      totalFilesProcessed: stats.filesProcessed,
      totalLinesSkipped: stats.linesSkipped,
      timeBuckets: serializeTimeBuckets(buckets),
    };

    await this.context.globalState.update(this.storageKey, state);
    logger.info(
      `Saved usage data: ${stats.filesProcessed} files, ${stats.linesSkipped} lines skipped`
    );
  }

  /**
   * Load aggregated usage data from globalState
   * @returns Deserialized data or null if no data exists or version mismatch
   */
  async loadUsageData(): Promise<{
    buckets: TimeBuckets;
    stats: { filesProcessed: number; linesSkipped: number };
  } | null> {
    const state = this.context.globalState.get<PersistedState>(this.storageKey);

    if (!state) {
      logger.info('No persisted usage data found (first run)');
      return null;
    }

    // Version check - force reparse on schema changes
    if (state.version !== 1) {
      logger.warn(
        `Persisted state version mismatch (expected 1, got ${state.version}). Forcing reparse.`
      );
      return null;
    }

    try {
      const buckets = deserializeTimeBuckets(state.timeBuckets);
      logger.info(
        `Loaded usage data from ${state.lastParseTimestamp}: ${state.totalFilesProcessed} files`
      );

      return {
        buckets,
        stats: {
          filesProcessed: state.totalFilesProcessed,
          linesSkipped: state.totalLinesSkipped,
        },
      };
    } catch (error) {
      logger.error(
        'Failed to deserialize persisted state',
        error instanceof Error ? error : undefined
      );
      return null;
    }
  }

  /**
   * Clear all persisted usage data
   * Forces full reparse on next activation
   */
  async clearUsageData(): Promise<void> {
    await this.context.globalState.update(this.storageKey, undefined);
    logger.info('Usage data cleared');
  }

  /**
   * Get timestamp of last parse without full deserialization
   * @returns ISO timestamp or null if no data
   */
  getLastParseTimestamp(): string | null {
    const state = this.context.globalState.get<PersistedState>(this.storageKey);
    return state?.lastParseTimestamp ?? null;
  }
}
