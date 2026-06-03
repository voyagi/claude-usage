import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findAllSessionFiles, getClaudeProjectsDir } from "../utils/paths.js";
import { parseAllSessions, parseSessionFile } from "./jsonlParser";

// Mock file discovery so parseAllSessions reads our temp fixtures, not the
// real ~/.claude/projects directory.
jest.mock("../utils/paths.js", () => ({
	__esModule: true,
	getClaudeProjectsDir: jest.fn(),
	findAllSessionFiles: jest.fn(),
}));

const logger = {
	info() {},
	warn() {},
	error() {},
} as unknown as Parameters<typeof parseSessionFile>[1];

// Assistant turn with a usage block that parses cleanly -> 1 record, 0 failures.
const GOOD = JSON.stringify({
	type: "assistant",
	timestamp: "2026-06-01T12:00:00.000Z",
	sessionId: "s1",
	message: {
		id: "msg_1",
		model: "claude-opus-4-8",
		usage: { input_tokens: 5, output_tokens: 5 },
	},
});
// Has a usage block but is missing the required top-level sessionId -> drift.
const DRIFT = JSON.stringify({
	type: "assistant",
	timestamp: "2026-06-01T12:00:00.000Z",
	message: {
		id: "msg_2",
		model: "claude-opus-4-8",
		usage: { input_tokens: 5, output_tokens: 5 },
	},
});
// Legitimate assistant turn with no usage (tool-only) -> NOT a drift signal.
const NO_USAGE = JSON.stringify({
	type: "assistant",
	timestamp: "2026-06-01T12:00:00.000Z",
	sessionId: "s1",
	message: { id: "msg_3", model: "claude-opus-4-8" },
});

function tmpFile(lines: string[]): string {
	const p = path.join(
		os.tmpdir(),
		`cu-jsonl-test-${Math.random().toString(36).slice(2)}.jsonl`,
	);
	fs.writeFileSync(p, lines.join("\n"));
	return p;
}

describe("parseSessionFile schema-failure counting (format-drift signal)", () => {
	it("counts assistant lines that have a usage block but fail the schema", async () => {
		const file = tmpFile([GOOD, DRIFT, NO_USAGE]);
		try {
			const r = await parseSessionFile(file, logger);
			expect(r.records).toHaveLength(1); // only the good line
			expect(r.schemaFailures).toBe(1); // only the has-usage-bad-schema line
		} finally {
			fs.unlinkSync(file);
		}
	});

	it("reports zero schema failures for clean input", async () => {
		const file = tmpFile([GOOD, GOOD]);
		try {
			const r = await parseSessionFile(file, logger);
			expect(r.schemaFailures).toBe(0);
		} finally {
			fs.unlinkSync(file);
		}
	});
});

describe("parseAllSessions schema-failure aggregation", () => {
	it("sums schemaFailures across every parsed file", async () => {
		const f1 = tmpFile([GOOD, DRIFT]); // 1 record, 1 failure
		const f2 = tmpFile([DRIFT]); // 0 records, 1 failure
		jest.mocked(getClaudeProjectsDir).mockReturnValue(os.tmpdir());
		jest.mocked(findAllSessionFiles).mockResolvedValue([f1, f2]);
		try {
			const r = await parseAllSessions(logger);
			// Proves the per-file totalSchemaFailures accumulation is wired up —
			// a per-file test alone would not catch a dropped/misnamed sum.
			expect(r.schemaFailures).toBe(2);
			expect(r.records).toHaveLength(1); // only the single good line survives
		} finally {
			fs.unlinkSync(f1);
			fs.unlinkSync(f2);
		}
	});
});
