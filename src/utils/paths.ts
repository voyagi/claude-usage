/**
 * Cross-platform path utilities for Claude projects directory
 */

import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Get the Claude projects directory path
 * @returns Absolute path to ~/.claude/projects
 */
export function getClaudeProjectsDir(): string {
	return path.join(os.homedir(), ".claude", "projects");
}

/**
 * Directory names never worth descending into.
 *
 * `memory` is a curated notes directory (a junction on Windows) that holds no
 * transcripts; the others are ordinary noise that should never appear here but
 * would be expensive to walk if they did.
 */
const SKIP_DIRECTORIES = new Set(["memory", "node_modules", ".git"]);

/**
 * Deepest nesting we expect, measured from the projects directory:
 *
 *   projects/<project>/<session>/subagents/workflows/<wf_id>/*.jsonl
 *
 * which is depth 5. The cap is headroom against an unexpectedly deep tree, not
 * a layout assumption -- new nesting levels are picked up automatically.
 */
const MAX_DEPTH = 8;

/** Options for {@link findAllSessionFiles} */
export interface SessionFileDiscoveryOptions {
	/**
	 * Include `<project>/archived/` sessions. These are whole sessions Claude
	 * Code moved aside, and they dominate the tree (~77% of transcript bytes on
	 * a heavy user), so excluding them trades historical trend data for a much
	 * faster and lighter parse. Defaults to true.
	 */
	includeArchived?: boolean;
}

/**
 * Recursively find all JSONL session files under the Claude projects directory.
 *
 * Claude Code writes transcripts at several nesting levels and adds new ones
 * over time: top-level sessions, `archived/` sessions, per-session subagent
 * transcripts, and (since workflows shipped) one directory per workflow run
 * under `subagents/workflows/<wf_id>/`. Walking the tree rather than matching a
 * fixed set of layouts means a new level starts counting the day it appears
 * instead of silently going unread.
 *
 * Symlinks and Windows junctions are never followed: they can point outside the
 * tree or form a cycle.
 *
 * @param projectsDir Path to the Claude projects directory
 * @param options Discovery options
 * @returns Array of absolute paths to .jsonl files
 */
export async function findAllSessionFiles(
	projectsDir: string,
	options: SessionFileDiscoveryOptions = {},
): Promise<string[]> {
	const includeArchived = options.includeArchived !== false;
	const sessionFiles: string[] = [];

	async function walk(dir: string, depth: number): Promise<void> {
		if (depth > MAX_DEPTH) {
			return;
		}

		let entries: Dirent[];
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch (error) {
			// Unreadable directory (permissions, deleted mid-walk): skip it, but
			// never let one bad directory abort discovery of the rest.
			console.warn(`Warning: Could not read directory ${dir}:`, error);
			return;
		}

		const subdirectories: string[] = [];
		for (const entry of entries) {
			// isSymbolicLink() covers Windows junctions too (both are reparse
			// points), so this is what stops a memory/ junction from being walked.
			if (entry.isSymbolicLink()) {
				continue;
			}

			const entryPath = path.join(dir, entry.name);

			if (entry.isFile()) {
				if (entry.name.endsWith(".jsonl")) {
					sessionFiles.push(entryPath);
				}
			} else if (entry.isDirectory() && !SKIP_DIRECTORIES.has(entry.name)) {
				if (!includeArchived && entry.name === "archived") {
					continue;
				}
				subdirectories.push(entryPath);
			}
		}

		for (const subdirectory of subdirectories) {
			await walk(subdirectory, depth + 1);
		}
	}

	try {
		await fs.access(projectsDir);
	} catch (error) {
		console.error(
			`Error: Could not read projects directory ${projectsDir}:`,
			error,
		);
		return [];
	}

	await walk(projectsDir, 0);
	return sessionFiles;
}
