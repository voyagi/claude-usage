/**
 * Streaming JSONL parser for Claude Code session files
 * Reads files line-by-line without locks, handles corruption gracefully
 */

import * as fs from "node:fs";
import * as readline from "node:readline";
import type { FileParseResult, TokenUsage } from "../types.js";
import type { Logger } from "../utils/logger.js";
import { findAllSessionFiles } from "../utils/paths.js";
import { parseAssistantMessage } from "./schemas.js";

/**
 * Parse a single JSONL session file with error recovery
 * @param filePath Absolute path to the JSONL file
 * @param logger Logger instance for warnings
 * @returns FileParseResult with records and parse statistics
 */
export async function parseSessionFile(
	filePath: string,
	logger: Logger,
): Promise<FileParseResult> {
	const records: TokenUsage[] = [];
	const errors: string[] = [];
	let linesSkipped = 0;

	try {
		// Create read stream without exclusive locks - allows concurrent writes
		const fileStream = fs.createReadStream(filePath, { encoding: "utf8" });

		// Create readline interface with cross-platform line ending support
		const rl = readline.createInterface({
			input: fileStream,
			crlfDelay: Infinity, // Handles both \r\n and \n
		});

		for await (const line of rl) {
			// Skip empty lines (whitespace-only)
			if (!line.trim()) {
				continue;
			}

			try {
				// Parse JSON - expect errors on truncated lines during active sessions
				const parsed = JSON.parse(line);

				// Only process assistant messages (skip user, system, etc.)
				if (parsed.type !== "assistant") {
					continue;
				}

				// Validate with Zod schema and extract token usage
				const tokenUsage = parseAssistantMessage(line);

				if (tokenUsage === null) {
					// Missing usage data or validation failed - skip silently
					// This is normal for some message types
					continue;
				}

				records.push(tokenUsage);
			} catch (parseError) {
				// Truncated or corrupt line - expected during active sessions
				linesSkipped++;
				const snippet = line.substring(0, 100);
				const errorMsg =
					parseError instanceof Error ? parseError.message : String(parseError);
				logger.warn(
					`Skipped corrupt line in ${filePath}: ${errorMsg} | Line: ${snippet}...`,
				);
			}
		}

		return {
			filePath,
			records,
			linesSkipped,
			errors,
		};
	} catch (fileError) {
		// File is unreadable (EACCES, EBUSY, etc.)
		const errorMsg =
			fileError instanceof Error ? fileError.message : String(fileError);
		errors.push(`Failed to read file ${filePath}: ${errorMsg}`);
		logger.error(
			`Failed to read file ${filePath}`,
			fileError instanceof Error ? fileError : undefined,
		);

		return {
			filePath,
			records: [],
			linesSkipped,
			errors,
		};
	}
}

/**
 * Parse all JSONL session files across all Claude projects
 * @param logger Logger instance for warnings and errors
 * @returns Aggregated parse results with sorted records
 */
export async function parseAllSessions(logger: Logger): Promise<{
	records: TokenUsage[];
	filesProcessed: number;
	linesSkipped: number;
	errors: string[];
}> {
	const allRecords: TokenUsage[] = [];
	const allErrors: string[] = [];
	let totalLinesSkipped = 0;
	let filesProcessed = 0;

	// Discover all JSONL files (including subagents)
	const sessionFiles = await findAllSessionFiles(
		require("node:path").join(
			require("node:os").homedir(),
			".claude",
			"projects",
		),
	);

	logger.info(`Found ${sessionFiles.length} session files to process`);

	// Parse files in parallel batches of 10
	const BATCH_SIZE = 10;
	for (let i = 0; i < sessionFiles.length; i += BATCH_SIZE) {
		const batch = sessionFiles.slice(i, i + BATCH_SIZE);
		const results = await Promise.all(
			batch.map((filePath) => parseSessionFile(filePath, logger)),
		);

		for (const result of results) {
			allRecords.push(...result.records);
			totalLinesSkipped += result.linesSkipped;
			allErrors.push(...result.errors);

			if (result.errors.length === 0) {
				filesProcessed++;
			}
		}
	}

	// Sort all records by timestamp ascending (oldest first)
	allRecords.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

	logger.info(
		`Parsing complete: ${filesProcessed}/${sessionFiles.length} files processed, ` +
			`${allRecords.length} records extracted, ${totalLinesSkipped} lines skipped`,
	);

	return {
		records: allRecords,
		filesProcessed,
		linesSkipped: totalLinesSkipped,
		errors: allErrors,
	};
}
