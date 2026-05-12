jest.mock("vscode", () => ({}), { virtual: true });

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseIncremental } from "./incrementalParser";

/** Minimal Logger mock matching the Logger class interface */
const makeLogger = () =>
	({
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
		show: jest.fn(),
		dispose: jest.fn(),
	}) as any;

/** Build a valid assistant JSONL line */
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

/** Build a rate limit error JSONL line */
function rateLimitLine(
	message = "daily token limit exceeded",
	timestamp = "2026-03-15T10:30:00.000Z",
): string {
	return JSON.stringify({
		type: "error",
		timestamp,
		error: {
			type: "rate_limit_error",
			message,
		},
	});
}

describe("parseIncremental", () => {
	let tmpFile: string;
	const logger = makeLogger();

	beforeEach(() => {
		tmpFile = path.join(
			os.tmpdir(),
			`incrementalParser-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`,
		);
		jest.clearAllMocks();
	});

	afterEach(() => {
		try {
			fs.unlinkSync(tmpFile);
		} catch {
			// File may not exist if the test uses a non-existent path
		}
	});

	it("reads entire file from offset 0", async () => {
		const lines = [
			assistantLine({ sessionId: "sess-1" }),
			assistantLine({
				sessionId: "sess-2",
				timestamp: "2026-03-15T11:00:00.000Z",
			}),
			assistantLine({
				sessionId: "sess-3",
				timestamp: "2026-03-15T12:00:00.000Z",
			}),
		].join("\n");

		fs.writeFileSync(tmpFile, lines, "utf8");

		const result = await parseIncremental(tmpFile, 0, logger);

		expect(result.records).toHaveLength(3);
		expect(result.records.map((r) => r.sessionId)).toEqual([
			"sess-1",
			"sess-2",
			"sess-3",
		]);
		expect(result.linesSkipped).toBe(0);
		expect(result.rateLimitEvents).toHaveLength(0);
	});

	it("reads only new lines from mid-file offset", async () => {
		const line1 = assistantLine({ sessionId: "sess-1" });
		const line2 = assistantLine({
			sessionId: "sess-2",
			timestamp: "2026-03-15T11:00:00.000Z",
		});
		const content = line1 + "\n" + line2 + "\n";

		fs.writeFileSync(tmpFile, content, "utf8");

		// Offset past the first line (line1 + newline)
		const midOffset = Buffer.byteLength(line1 + "\n", "utf8");

		const result = await parseIncremental(tmpFile, midOffset, logger);

		expect(result.records).toHaveLength(1);
		expect(result.records[0].sessionId).toBe("sess-2");
	});

	it("returns empty when offset equals file size (no new data)", async () => {
		const content = assistantLine() + "\n";
		fs.writeFileSync(tmpFile, content, "utf8");

		const fileSize = fs.statSync(tmpFile).size;
		const result = await parseIncremental(tmpFile, fileSize, logger);

		expect(result.records).toHaveLength(0);
		expect(result.rateLimitEvents).toHaveLength(0);
		expect(result.newOffset).toBe(fileSize);
		expect(result.linesSkipped).toBe(0);
	});

	it("resets to 0 when offset exceeds file size (truncated file)", async () => {
		const lines = [
			assistantLine({ sessionId: "sess-1" }),
			assistantLine({
				sessionId: "sess-2",
				timestamp: "2026-03-15T11:00:00.000Z",
			}),
		].join("\n");

		fs.writeFileSync(tmpFile, lines, "utf8");

		const fileSize = fs.statSync(tmpFile).size;
		// Offset way beyond file size
		const result = await parseIncremental(tmpFile, fileSize + 5000, logger);

		// Should reset to 0 and read the entire file
		expect(result.records).toHaveLength(2);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("appears truncated"),
		);
	});

	it("extracts rate limit error events", async () => {
		const lines = [
			assistantLine({ sessionId: "sess-1" }),
			rateLimitLine("daily token limit exceeded", "2026-03-15T10:35:00.000Z"),
			assistantLine({
				sessionId: "sess-2",
				timestamp: "2026-03-15T11:00:00.000Z",
			}),
		].join("\n");

		fs.writeFileSync(tmpFile, lines, "utf8");

		const result = await parseIncremental(tmpFile, 0, logger);

		expect(result.records).toHaveLength(2);
		expect(result.rateLimitEvents).toHaveLength(1);
		expect(result.rateLimitEvents[0].limitType).toBe("weekly"); // "daily" maps to weekly
		expect(result.rateLimitEvents[0].errorMessage).toBe(
			"daily token limit exceeded",
		);
	});

	it("handles corrupt lines gracefully (increments linesSkipped)", async () => {
		const lines = [
			assistantLine({ sessionId: "sess-1" }),
			"{broken json here",
			'{"type":"assistant","truncated":true',
			assistantLine({
				sessionId: "sess-2",
				timestamp: "2026-03-15T11:00:00.000Z",
			}),
		].join("\n");

		fs.writeFileSync(tmpFile, lines, "utf8");

		const result = await parseIncremental(tmpFile, 0, logger);

		expect(result.records).toHaveLength(2);
		expect(result.linesSkipped).toBe(2);
		expect(logger.warn).toHaveBeenCalledTimes(2);
	});

	it("returns original offset for unreadable file (ENOENT)", async () => {
		const nonExistent = path.join(
			os.tmpdir(),
			"does-not-exist-incremental-12345.jsonl",
		);
		const originalOffset = 42;

		const result = await parseIncremental(nonExistent, originalOffset, logger);

		expect(result.records).toHaveLength(0);
		expect(result.rateLimitEvents).toHaveLength(0);
		expect(result.newOffset).toBe(originalOffset); // Does not advance
		expect(logger.error).toHaveBeenCalled();
	});

	it("sets newOffset to file size after successful parse", async () => {
		const content = assistantLine() + "\n";
		fs.writeFileSync(tmpFile, content, "utf8");

		const expectedSize = fs.statSync(tmpFile).size;
		const result = await parseIncremental(tmpFile, 0, logger);

		expect(result.newOffset).toBe(expectedSize);
	});

	it("skips non-rate-limit error types", async () => {
		const overloadedError = JSON.stringify({
			type: "error",
			timestamp: "2026-03-15T10:30:00.000Z",
			error: {
				type: "overloaded_error",
				message: "Server is temporarily overloaded.",
			},
		});

		const lines = [assistantLine(), overloadedError].join("\n");

		fs.writeFileSync(tmpFile, lines, "utf8");

		const result = await parseIncremental(tmpFile, 0, logger);

		expect(result.records).toHaveLength(1);
		expect(result.rateLimitEvents).toHaveLength(0);
	});

	it("handles file with only whitespace and empty lines", async () => {
		fs.writeFileSync(tmpFile, "\n  \n\t\n  \n", "utf8");

		const result = await parseIncremental(tmpFile, 0, logger);

		expect(result.records).toHaveLength(0);
		expect(result.rateLimitEvents).toHaveLength(0);
		expect(result.linesSkipped).toBe(0);
	});

	it("handles multiple rate limit events of different types", async () => {
		const lines = [
			rateLimitLine("weekly token limit exceeded", "2026-03-15T10:00:00.000Z"),
			rateLimitLine(
				"Rate limit exceeded: too many requests per-minute.",
				"2026-03-15T10:05:00.000Z",
			),
		].join("\n");

		fs.writeFileSync(tmpFile, lines, "utf8");

		const result = await parseIncremental(tmpFile, 0, logger);

		expect(result.records).toHaveLength(0);
		expect(result.rateLimitEvents).toHaveLength(2);
		expect(result.rateLimitEvents[0].limitType).toBe("weekly");
		expect(result.rateLimitEvents[1].limitType).toBe("session");
	});
});
