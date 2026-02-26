/**
 * Cross-platform path utilities for Claude projects directory
 */

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
 * Recursively find all JSONL session files in the Claude projects directory
 * Includes both top-level session files and subagent session files
 *
 * @param projectsDir Path to the Claude projects directory
 * @returns Array of absolute paths to .jsonl files
 */
export async function findAllSessionFiles(
	projectsDir: string,
): Promise<string[]> {
	const sessionFiles: string[] = [];

	try {
		const projects = await fs.readdir(projectsDir, { withFileTypes: true });

		for (const project of projects) {
			if (!project.isDirectory()) {
				continue;
			}

			const projectPath = path.join(projectsDir, project.name);

			try {
				// Find top-level session files in project directory
				const projectEntries = await fs.readdir(projectPath, {
					withFileTypes: true,
				});

				for (const entry of projectEntries) {
					const entryPath = path.join(projectPath, entry.name);

					if (entry.isFile() && entry.name.endsWith(".jsonl")) {
						// Top-level session file
						sessionFiles.push(entryPath);
					} else if (entry.isDirectory()) {
						// Could be a session directory with subagents
						try {
							const subagentsPath = path.join(entryPath, "subagents");
							const subagentsExists = await fs
								.access(subagentsPath)
								.then(() => true)
								.catch(() => false);

							if (subagentsExists) {
								const subagentFiles = await fs.readdir(subagentsPath, {
									withFileTypes: true,
								});
								for (const subagentFile of subagentFiles) {
									if (
										subagentFile.isFile() &&
										subagentFile.name.endsWith(".jsonl")
									) {
										sessionFiles.push(
											path.join(subagentsPath, subagentFile.name),
										);
									}
								}
							}
						} catch (error) {
							// Skip unreadable subdirectories
							console.warn(
								`Warning: Could not read directory ${entryPath}:`,
								error,
							);
						}
					}
				}
			} catch (error) {
				// Skip unreadable project directories
				console.warn(
					`Warning: Could not read project directory ${projectPath}:`,
					error,
				);
			}
		}
	} catch (error) {
		// Projects directory doesn't exist or is unreadable
		console.error(
			`Error: Could not read projects directory ${projectsDir}:`,
			error,
		);
		return [];
	}

	return sessionFiles;
}
