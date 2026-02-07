/**
 * Incremental JSONL parser with byte offset support
 * Reads only new lines from a file starting at a given byte offset
 */

import * as fs from 'fs';
import * as readline from 'readline';
import { parseAssistantMessage } from './schemas.js';
import { parseRateLimitEvent } from './rateLimitDetector.js';
import type { RateLimitEvent } from './rateLimitDetector.js';
import type { Logger } from '../utils/logger.js';
import type { TokenUsage } from '../types.js';

export type { RateLimitEvent } from './rateLimitDetector.js';

/**
 * Result from incremental parsing
 */
export interface IncrementalParseResult {
  records: TokenUsage[];
  rateLimitEvents: RateLimitEvent[];
  newOffset: number;
  linesSkipped: number;
}

/**
 * Parse new lines from a JSONL file starting at a byte offset
 * @param filePath Absolute path to the JSONL file
 * @param startOffset Byte offset to start reading from (0 for beginning)
 * @param logger Logger instance for warnings
 * @returns IncrementalParseResult with new records and updated offset
 */
export async function parseIncremental(
  filePath: string,
  startOffset: number,
  logger: Logger
): Promise<IncrementalParseResult> {
  const records: TokenUsage[] = [];
  const rateLimitEvents: RateLimitEvent[] = [];
  let linesSkipped = 0;

  try {
    // Check file size before attempting to read
    const stats = await fs.promises.stat(filePath);
    const fileSize = stats.size;

    // Handle truncated file case (offset beyond current file size)
    let actualStart = startOffset;
    if (startOffset > fileSize) {
      logger.warn(
        `File ${filePath} appears truncated (offset ${startOffset} > size ${fileSize}). Resetting to 0.`
      );
      actualStart = 0;
    }

    // Handle no-new-data case (offset equals file size)
    if (actualStart === fileSize) {
      logger.info(`No new data in ${filePath} (offset ${actualStart} === size ${fileSize})`);
      return {
        records: [],
        rateLimitEvents: [],
        newOffset: actualStart,
        linesSkipped: 0,
      };
    }

    // Track bytes read starting from the actual start position
    let bytesRead = actualStart;

    // Create read stream starting at the offset
    const fileStream = fs.createReadStream(filePath, {
      encoding: 'utf8',
      start: actualStart,
    });

    // Create readline interface with cross-platform line ending support
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity, // Handles both \r\n and \n
    });

    for await (const line of rl) {
      // Track bytes: line content + newline character
      bytesRead += Buffer.byteLength(line, 'utf8') + 1;

      // Skip empty lines (whitespace-only)
      if (!line.trim()) {
        continue;
      }

      try {
        // Parse JSON - expect errors on truncated lines during active sessions
        const parsed = JSON.parse(line);

        // Check for rate limit error events BEFORE filtering to assistant-only
        if (parsed.type === 'error') {
          const rlEvent = parseRateLimitEvent(line);
          if (rlEvent) {
            rateLimitEvents.push(rlEvent);
          }
          continue; // Error events don't have token usage
        }

        // Only process assistant messages (skip user, system, etc.)
        if (parsed.type !== 'assistant') {
          continue;
        }

        // Validate with Zod schema and extract token usage
        const tokenUsage = parseAssistantMessage(line);

        if (tokenUsage === null) {
          // Missing usage data or validation failed - skip silently
          continue;
        }

        records.push(tokenUsage);
      } catch (parseError) {
        // Corrupt or incomplete line - expected during active sessions
        linesSkipped++;
        const snippet = line.substring(0, 100);
        const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
        logger.warn(
          `Skipped corrupt line in ${filePath} at offset ${bytesRead}: ${errorMsg} | Line: ${snippet}...`
        );
      }
    }

    logger.info(
      `Incremental parse of ${filePath}: ${records.length} new records, ` +
      `${linesSkipped} lines skipped, offset ${startOffset} -> ${bytesRead}`
    );

    return {
      records,
      rateLimitEvents,
      newOffset: bytesRead,
      linesSkipped,
    };
  } catch (fileError) {
    // File is unreadable (EACCES, EBUSY, ENOENT, etc.)
    const errorMsg = fileError instanceof Error ? fileError.message : String(fileError);
    logger.error(
      `Failed to read file ${filePath} from offset ${startOffset}: ${errorMsg}`,
      fileError instanceof Error ? fileError : undefined
    );

    // Return empty result with original offset (don't advance)
    return {
      records: [],
      rateLimitEvents: [],
      newOffset: startOffset,
      linesSkipped,
    };
  }
}
