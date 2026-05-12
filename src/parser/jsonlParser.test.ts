jest.mock("vscode", () => ({}), { virtual: true });
jest.mock("../utils/paths.js", () => ({
	findAllSessionFiles: jest.fn().mockResolvedValue([]),
	getClaudeProjectsDir: jest.fn().mockReturnValue("/tmp/test-claude"),
}));

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseSessionFile } from "./jsonlParser";

/** Minimal Logger mock matching the Logger class interface */
const makeLogger = () =>
	({
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
		show: jest.fn(),
		dispose: jest.fn(),
	}) as any;

/** Helper to build a valid assistant JSONL line */
function assistantLine(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		type: "assistant",
		timestamp: "2026-03-15T10:30:00.000Z",
		sessionId: "sess-1",
		message: {
			model: "claude-sonnet-4-5",
			usage: {
				input_tokens: 1000,
				output_tokens: 500,
				cache_creation_input_tokens: 100,
				cache_read_input_tokens: 50,
			},
		},
		...overrides,
	});
}

describe("parseSessionFile", () => {
	let tmpFile: string;
	const logger = makeLogger();

	beforeEach(() => {
		tmpFile = path.join(
			os.tmpdir(),
			`jsonlParser-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`,
		);
		// Reset mocks between tests
		jest.clearAllMocks();
	});

	afterEach(() => {
		try {
			fs.unlinkSync(tmpFile);
		} catch {
			// File may not exist if the test creates a non-existent path
		}
	});

	it("extracts records from valid assistant messages", async () => {
		const lines = [
			assistantLine({ sessionId: "sess-1" }),
			assistantLine({
				sessionId: "sess-2",
				timestamp: "2026-03-15T11:00:00.000Z",
			}),
		].join("\n");

		fs.writeFileSync(tmpFile, lines, "utf8");

		const result = await parseSessionFile(tmpFile, logger);

		expect(result.records).toHaveLength(2);
		expect(result.linesSkipped).toBe(0);
		expect(result.errors).toHaveLength(0);
		expect(result.filePath).toBe(tmpFile);

		expect(result.records[0].sessionId).toBe("sess-1");
		expect(result.records[0].inputTokens).toBe(1000);
		expect(result.records[0].outputTokens).toBe(500);
		expect(result.records[0].cacheCreationTokens).toBe(100);
		expect(result.records[0].cacheReadTokens).toBe(50);
		expect(result.records[0].model).toBe("claude-sonnet-4-5");
		expect(result.records[0].timestamp).toEqual(
			new Date("2026-03-15T10:30:00.000Z"),
		);
	});

	it("skips non-assistant types (user, system)", async () => {
		const lines = [
			JSON.stringify({
				type: "user",
				timestamp: "2026-03-15T10:00:00.000Z",
				sessionId: "sess-1",
				message: { text: "hello" },
			}),
			JSON.stringify({
				type: "system",
				timestamp: "2026-03-15T10:01:00.000Z",
				sessionId: "sess-1",
				message: { text: "init" },
			}),
			assistantLine(),
		].join("\n");

		fs.writeFileSync(tmpFile, lines, "utf8");

		const result = await parseSessionFile(tmpFile, logger);

		expect(result.records).toHaveLength(1);
		expect(result.linesSkipped).toBe(0);
	});

	it("skips empty and whitespace-only lines", async () => {
		const lines = [
			"",
			"   ",
			assistantLine(),
			"",
			"\t",
			assistantLine({
				timestamp: "2026-03-15T11:00:00.000Z",
				sessionId: "sess-2",
			}),
			"",
		].join("\n");

		fs.writeFileSync(tmpFile, lines, "utf8");

		const result = await parseSessionFile(tmpFile, logger);

		expect(result.records).toHaveLength(2);
		expect(result.linesSkipped).toBe(0);
	});

	it("handles truncated/corrupt JSON lines (increments linesSkipped)", async () => {
		const lines = [
			'{"type":"assistant","timestamp":"2026-03-15T10:30:00.000Z"', // truncated
			"{not valid json at all",
			assistantLine(),
		].join("\n");

		fs.writeFileSync(tmpFile, lines, "utf8");

		const result = await parseSessionFile(tmpFile, logger);

		expect(result.records).toHaveLength(1);
		expect(result.linesSkipped).toBe(2);
		expect(logger.warn).toHaveBeenCalledTimes(2);
	});

	it("skips assistant messages with missing usage data", async () => {
		const noUsageLine = JSON.stringify({
			type: "assistant",
			timestamp: "2026-03-15T10:30:00.000Z",
			sessionId: "sess-1",
			message: {
				model: "claude-sonnet-4-5",
				// no usage field
			},
		});

		const lines = [noUsageLine, assistantLine()].join("\n");

		fs.writeFileSync(tmpFile, lines, "utf8");

		const result = await parseSessionFile(tmpFile, logger);

		// First line has no usage, so parseAssistantMessage returns null
		expect(result.records).toHaveLength(1);
		expect(result.linesSkipped).toBe(0); // Not counted as "skipped" since JSON parsed fine
	});

	it("handles unreadable file (ENOENT) gracefully", async () => {
		const nonExistent = path.join(os.tmpdir(), "does-not-exist-12345.jsonl");

		const result = await parseSessionFile(nonExistent, logger);

		expect(result.records).toHaveLength(0);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("Failed to read file");
		expect(logger.error).toHaveBeenCalled();
	});

	it("handles mixed valid and invalid lines correctly", async () => {
		const lines = [
			assistantLine({ sessionId: "sess-1" }),
			"totally broken json {{{{",
			JSON.stringify({
				type: "user",
				timestamp: "2026-03-15T10:05:00.000Z",
				sessionId: "sess-1",
			}),
			assistantLine({
				sessionId: "sess-2",
				timestamp: "2026-03-15T11:00:00.000Z",
			}),
			"", // empty line
			'{"type":"assistant","truncated":true', // corrupt
			assistantLine({
				sessionId: "sess-3",
				timestamp: "2026-03-15T12:00:00.000Z",
			}),
		].join("\n");

		fs.writeFileSync(tmpFile, lines, "utf8");

		const result = await parseSessionFile(tmpFile, logger);

		expect(result.records).toHaveLength(3);
		expect(result.records.map((r) => r.sessionId)).toEqual([
			"sess-1",
			"sess-2",
			"sess-3",
		]);
		expect(result.linesSkipped).toBe(2); // two corrupt JSON lines
		expect(result.errors).toHaveLength(0); // file-level errors only
	});

	it("extracts cache creation ephemeral fields when present", async () => {
		const lineWithCache = JSON.stringify({
			type: "assistant",
			timestamp: "2026-03-15T10:30:00.000Z",
			sessionId: "sess-cache",
			message: {
				model: "claude-sonnet-4-5",
				usage: {
					input_tokens: 2000,
					output_tokens: 800,
					cache_creation_input_tokens: 200,
					cache_read_input_tokens: 100,
					cache_creation: {
						ephemeral_5m_input_tokens: 50,
						ephemeral_1h_input_tokens: 25,
					},
				},
			},
		});

		fs.writeFileSync(tmpFile, lineWithCache, "utf8");

		const result = await parseSessionFile(tmpFile, logger);

		expect(result.records).toHaveLength(1);
		expect(result.records[0].cacheCreation5m).toBe(50);
		expect(result.records[0].cacheCreation1h).toBe(25);
	});

	it("returns zero cost (calculated later by pricing module)", async () => {
		fs.writeFileSync(tmpFile, assistantLine(), "utf8");

		const result = await parseSessionFile(tmpFile, logger);

		expect(result.records).toHaveLength(1);
		expect(result.records[0].cost).toBe(0);
	});

	it("handles an empty file with no lines", async () => {
		fs.writeFileSync(tmpFile, "", "utf8");

		const result = await parseSessionFile(tmpFile, logger);

		expect(result.records).toHaveLength(0);
		expect(result.linesSkipped).toBe(0);
		expect(result.errors).toHaveLength(0);
	});
});
