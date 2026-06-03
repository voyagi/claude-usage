import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseSessionFile } from "./jsonlParser";

const logger = {
	info() {},
	warn() {},
	error() {},
} as unknown as Parameters<typeof parseSessionFile>[1];

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
		const good = JSON.stringify({
			type: "assistant",
			timestamp: "2026-06-01T12:00:00.000Z",
			sessionId: "s1",
			message: {
				id: "msg_1",
				model: "claude-opus-4-8",
				usage: { input_tokens: 5, output_tokens: 5 },
			},
		});
		// has a usage block but is missing the required top-level sessionId -> drift
		const driftHasUsage = JSON.stringify({
			type: "assistant",
			timestamp: "2026-06-01T12:00:00.000Z",
			message: {
				id: "msg_2",
				model: "claude-opus-4-8",
				usage: { input_tokens: 5, output_tokens: 5 },
			},
		});
		// legitimate assistant turn with no usage -> NOT a drift signal
		const noUsage = JSON.stringify({
			type: "assistant",
			timestamp: "2026-06-01T12:00:00.000Z",
			sessionId: "s1",
			message: { id: "msg_3", model: "claude-opus-4-8" },
		});

		const file = tmpFile([good, driftHasUsage, noUsage]);
		try {
			const r = await parseSessionFile(file, logger);
			expect(r.records).toHaveLength(1); // only the good line
			expect(r.schemaFailures).toBe(1); // only the has-usage-bad-schema line
		} finally {
			fs.unlinkSync(file);
		}
	});

	it("reports zero schema failures for clean input", async () => {
		const good = JSON.stringify({
			type: "assistant",
			timestamp: "2026-06-01T12:00:00.000Z",
			sessionId: "s1",
			message: {
				id: "msg_1",
				model: "claude-opus-4-8",
				usage: { input_tokens: 5, output_tokens: 5 },
			},
		});
		const file = tmpFile([good, good]);
		try {
			const r = await parseSessionFile(file, logger);
			expect(r.schemaFailures).toBe(0);
		} finally {
			fs.unlinkSync(file);
		}
	});
});
