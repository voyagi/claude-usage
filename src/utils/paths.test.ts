/**
 * Tests for session file discovery.
 *
 * Claude Code writes transcripts at several nesting levels and keeps adding
 * new ones. The old implementation matched two hardcoded layouts, so workflow
 * subagent transcripts and archived sessions were never read at all. These
 * tests pin the tree-walking behaviour that replaced it.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { findAllSessionFiles } from "./paths.js";

let root: string;

/** Create a file (and its parent directories) under the temp projects root */
async function touch(relativePath: string): Promise<string> {
	const full = path.join(root, relativePath);
	await fs.mkdir(path.dirname(full), { recursive: true });
	await fs.writeFile(full, "");
	return full;
}

/** Discovered paths, relative to the temp root, with forward slashes */
async function discover(): Promise<string[]> {
	const files = await findAllSessionFiles(root);
	return files
		.map((f) => path.relative(root, f).split(path.sep).join("/"))
		.sort();
}

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "claude-usage-paths-"));
});

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

describe("findAllSessionFiles", () => {
	it("finds top-level session files", async () => {
		await touch("proj-a/session-1.jsonl");
		await touch("proj-b/session-2.jsonl");

		expect(await discover()).toEqual([
			"proj-a/session-1.jsonl",
			"proj-b/session-2.jsonl",
		]);
	});

	it("finds every nesting level Claude Code writes", async () => {
		await touch("proj/live.jsonl");
		await touch("proj/archived/old.jsonl");
		await touch("proj/session-id/agent-abc.jsonl");
		await touch("proj/session-id/subagents/agent-def.jsonl");
		await touch("proj/session-id/subagents/workflows/wf_123/agent-ghi.jsonl");

		expect(await discover()).toEqual([
			"proj/archived/old.jsonl",
			"proj/live.jsonl",
			"proj/session-id/agent-abc.jsonl",
			"proj/session-id/subagents/agent-def.jsonl",
			"proj/session-id/subagents/workflows/wf_123/agent-ghi.jsonl",
		]);
	});

	it("includes workflow transcripts (regression: previously unreachable)", async () => {
		await touch("proj/sess/subagents/workflows/wf_abc/agent-1.jsonl");
		await touch("proj/sess/subagents/workflows/wf_abc/agent-2.jsonl");

		const found = await discover();
		expect(found).toHaveLength(2);
		expect(found.every((f) => f.includes("workflows/wf_abc"))).toBe(true);
	});

	it("includes archived sessions (regression: previously unreachable)", async () => {
		await touch("proj/archived/a.jsonl");
		await touch("proj/archived/b.jsonl");

		expect(await discover()).toEqual([
			"proj/archived/a.jsonl",
			"proj/archived/b.jsonl",
		]);
	});

	it("excludes archived sessions when asked to", async () => {
		await touch("proj/live.jsonl");
		await touch("proj/archived/old.jsonl");
		await touch("proj/sess/subagents/agent-1.jsonl");

		const files = await findAllSessionFiles(root, { includeArchived: false });
		const relative = files
			.map((f) => path.relative(root, f).split(path.sep).join("/"))
			.sort();

		expect(relative).toEqual([
			"proj/live.jsonl",
			"proj/sess/subagents/agent-1.jsonl",
		]);
	});

	it("ignores non-jsonl files", async () => {
		await touch("proj/sess/agent-1.jsonl");
		await touch("proj/sess/agent-1.meta.json");
		await touch("proj/notes.md");

		expect(await discover()).toEqual(["proj/sess/agent-1.jsonl"]);
	});

	it("skips the memory directory", async () => {
		await touch("proj/live.jsonl");
		await touch("proj/memory/notes.jsonl");

		expect(await discover()).toEqual(["proj/live.jsonl"]);
	});

	it("returns an empty array when the projects directory is missing", async () => {
		const error = jest.spyOn(console, "error").mockImplementation(() => {});
		try {
			const missing = path.join(root, "does-not-exist");
			expect(await findAllSessionFiles(missing)).toEqual([]);
		} finally {
			error.mockRestore();
		}
	});

	it("returns an empty array for an empty projects directory", async () => {
		expect(await discover()).toEqual([]);
	});

	it("survives a readdir failure instead of throwing", async () => {
		// fs.access succeeds on a plain file, so passing one gets past the
		// existence check and fails inside readdir: the walk must swallow that
		// and return, not propagate ENOTDIR to the caller.
		const file = await touch("not-a-directory.jsonl");
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		try {
			expect(await findAllSessionFiles(file)).toEqual([]);
			expect(warn).toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});

	it("does not follow symlinked directories", async () => {
		await touch("proj/live.jsonl");
		await touch("outside/secret.jsonl");

		try {
			await fs.symlink(
				path.join(root, "outside"),
				path.join(root, "proj", "linked"),
				"junction",
			);
		} catch {
			// Symlink creation can be unavailable; the walk itself is what matters
			return;
		}

		const found = await discover();
		expect(found).toContain("proj/live.jsonl");
		expect(found.some((f) => f.includes("linked"))).toBe(false);
	});
});
