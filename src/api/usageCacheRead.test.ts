/**
 * Tests for what readCache lets through.
 *
 * The cache is the only input path with no validation of its own: the fetch
 * path normalizes as it parses, while this file is JSON.parse'd and cast. It is
 * also written by whichever VS Code window polled last, possibly an older
 * build, and it is a plain file on disk.
 */

jest.mock("vscode", () => ({}), { virtual: true });

const mockReadFile = jest.fn();
jest.mock("node:fs/promises", () => ({
	readFile: mockReadFile,
	mkdir: jest.fn().mockResolvedValue(undefined),
	writeFile: jest.fn().mockResolvedValue(undefined),
	rename: jest.fn().mockResolvedValue(undefined),
}));

import type { Logger } from "../utils/logger";
import { UsageCache } from "./usageCache";

function makeLogger(): Logger {
	return {
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
		show: jest.fn(),
		dispose: jest.fn(),
	} as unknown as Logger;
}

/** A cache file whose windows carry the given reset values. */
function cacheFile(opts: {
	sevenDay?: string | null;
	scoped?: string | null;
}): string {
	return JSON.stringify({
		apiUsage: {
			fiveHour: { utilization: 0.13, resetsAt: null },
			sevenDay: { utilization: 0.03, resetsAt: opts.sevenDay ?? null },
			scopedWeekly: [
				{ label: "Fable", utilization: 0, resetsAt: opts.scoped ?? null },
			],
			rateLimitTier: null,
			extraUsage: null,
			spend: null,
			fetchedAt: "2026-07-24T09:47:31.033Z",
		},
		writtenAt: "2026-07-24T09:47:31.033Z",
	});
}

describe("readCache: resets it cannot read", () => {
	beforeEach(() => {
		mockReadFile.mockReset();
	});

	it("drops an unreadable weekly reset instead of passing it on", async () => {
		// This value would otherwise reach rememberWeeklyAnchor, which promotes it
		// to durable state. A malformed non-empty string is truthy, so it would
		// overwrite a good stored anchor, and the weekly window would then fall
		// back to a calendar week -- counting the previous cycle's usage against a
		// Monday reset. That is the original defect, arriving by a different door.
		mockReadFile.mockResolvedValue(cacheFile({ sevenDay: "not-a-date" }));

		const cache = new UsageCache(makeLogger());
		const data = await cache.readCache();

		expect(data).not.toBeNull();
		expect(data?.apiUsage.sevenDay?.resetsAt).toBeNull();
	});

	it("drops an unreadable scoped reset too", async () => {
		mockReadFile.mockResolvedValue(cacheFile({ scoped: "2026-13-45T99:99Z" }));

		const cache = new UsageCache(makeLogger());
		const data = await cache.readCache();

		expect(data?.apiUsage.scopedWeekly[0]?.resetsAt).toBeNull();
	});

	it("says so, since the cache path otherwise has no diagnostic at all", async () => {
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(cacheFile({ sevenDay: "not-a-date" }));

		await new UsageCache(logger).readCache();

		expect(logger.warn).toHaveBeenCalledTimes(1);
		expect((logger.warn as jest.Mock).mock.calls[0][0]).toContain("not-a-date");
	});

	it("keeps a readable reset exactly as written", async () => {
		// Verbatim, not re-serialized: this string becomes the weekly anchor.
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(
			cacheFile({ sevenDay: "2026-07-31T08:00:00.585182+00:00" }),
		);

		const data = await new UsageCache(logger).readCache();

		expect(data?.apiUsage.sevenDay?.resetsAt).toBe(
			"2026-07-31T08:00:00.585182+00:00",
		);
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it("stays quiet about the nulls a normal payload is full of", async () => {
		// The scoped limit reports null on every poll at zero usage, and fiveHour
		// is null here too. Warning on those would make the signal noise.
		const logger = makeLogger();
		mockReadFile.mockResolvedValue(cacheFile({}));

		await new UsageCache(logger).readCache();

		expect(logger.warn).not.toHaveBeenCalled();
	});
});
