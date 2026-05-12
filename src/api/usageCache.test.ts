/**
 * Unit tests for usageCache.ts
 *
 * Tests getStaleness (pure function) and UsageCache.readCache (with mocked fs).
 */

jest.mock(
	"vscode",
	() => ({
		workspace: { createFileSystemWatcher: jest.fn() },
		Uri: { file: jest.fn() },
	}),
	{ virtual: true },
);

const mockReadFile = jest.fn();
jest.mock("node:fs/promises", () => ({
	readFile: mockReadFile,
	mkdir: jest.fn().mockResolvedValue(undefined),
	writeFile: jest.fn().mockResolvedValue(undefined),
	rename: jest.fn().mockResolvedValue(undefined),
}));

import type { Logger } from "../utils/logger";
import { UsageCache, getStaleness } from "./usageCache";

// ── Helpers ────────────────────────────────────────────────────────────

function makeLogger(): Logger {
	return {
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
		show: jest.fn(),
		dispose: jest.fn(),
	} as unknown as Logger;
}

// ── getStaleness ───────────────────────────────────────────────────────

describe("getStaleness", () => {
	beforeEach(() => {
		jest.useFakeTimers();
		jest.setSystemTime(new Date("2026-05-06T14:00:00Z"));
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('returns "unavailable" when fetchedAt is null', () => {
		expect(getStaleness(null)).toBe("unavailable");
	});

	it('returns "fresh" for just now', () => {
		expect(getStaleness(new Date())).toBe("fresh");
	});

	it('returns "fresh" for 15 minutes ago', () => {
		const fifteenMinAgo = new Date(Date.now() - 15 * 60_000);
		expect(getStaleness(fifteenMinAgo)).toBe("fresh");
	});

	it('returns "fresh" at exactly 29 minutes (boundary)', () => {
		const twentyNineMin = new Date(Date.now() - 29 * 60_000);
		expect(getStaleness(twentyNineMin)).toBe("fresh");
	});

	it('returns "normal" for 45 minutes ago', () => {
		const fortyFiveMin = new Date(Date.now() - 45 * 60_000);
		expect(getStaleness(fortyFiveMin)).toBe("normal");
	});

	it('returns "normal" at exactly 30 minutes (boundary)', () => {
		const thirtyMin = new Date(Date.now() - 30 * 60_000);
		expect(getStaleness(thirtyMin)).toBe("normal");
	});

	it('returns "dim" for 90 minutes ago', () => {
		const ninetyMin = new Date(Date.now() - 90 * 60_000);
		expect(getStaleness(ninetyMin)).toBe("dim");
	});

	it('returns "stale" for 3 hours ago', () => {
		const threeHours = new Date(Date.now() - 180 * 60_000);
		expect(getStaleness(threeHours)).toBe("stale");
	});

	it('returns "critical" for 5 hours ago', () => {
		const fiveHours = new Date(Date.now() - 300 * 60_000);
		expect(getStaleness(fiveHours)).toBe("critical");
	});

	it('returns "critical" at exactly 4 hours (boundary)', () => {
		const fourHours = new Date(Date.now() - 240 * 60_000);
		expect(getStaleness(fourHours)).toBe("critical");
	});

	it('returns "stale" for future date (backward clock jump)', () => {
		const future = new Date(Date.now() + 60_000);
		expect(getStaleness(future)).toBe("stale");
	});
});

// ── UsageCache.readCache ───────────────────────────────────────────────

describe("UsageCache.readCache", () => {
	let cache: UsageCache;
	let logger: Logger;

	beforeEach(() => {
		jest.clearAllMocks();
		logger = makeLogger();
		cache = new UsageCache(logger);
	});

	it("returns null when file does not exist (ENOENT)", async () => {
		const err = new Error("ENOENT") as NodeJS.ErrnoException;
		err.code = "ENOENT";
		mockReadFile.mockRejectedValue(err);

		const result = await cache.readCache();
		expect(result).toBeNull();
		// Should not log a warning for expected missing file
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it("returns null for invalid JSON", async () => {
		mockReadFile.mockResolvedValue("<html>not json</html>");

		const result = await cache.readCache();
		expect(result).toBeNull();
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("Could not read usage cache"),
		);
	});

	it("returns null when apiUsage is missing", async () => {
		mockReadFile.mockResolvedValue(
			JSON.stringify({ writtenAt: "2026-05-06T14:00:00Z" }),
		);

		const result = await cache.readCache();
		expect(result).toBeNull();
	});

	it("returns null when writtenAt is missing", async () => {
		mockReadFile.mockResolvedValue(
			JSON.stringify({
				apiUsage: { fetchedAt: "2026-05-06T14:00:00Z" },
			}),
		);

		const result = await cache.readCache();
		expect(result).toBeNull();
	});

	it("returns null when fetchedAt is missing from apiUsage", async () => {
		mockReadFile.mockResolvedValue(
			JSON.stringify({
				apiUsage: { fiveHour: null },
				writtenAt: "2026-05-06T14:00:00Z",
			}),
		);

		const result = await cache.readCache();
		expect(result).toBeNull();
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("missing fetchedAt"),
		);
	});

	it("restores Date from ISO string fetchedAt", async () => {
		const isoStr = "2026-05-06T13:00:00.000Z";
		mockReadFile.mockResolvedValue(
			JSON.stringify({
				apiUsage: {
					fetchedAt: isoStr,
					fiveHour: null,
					sevenDay: null,
					sevenDaySonnet: null,
					sevenDayOpus: null,
					rateLimitTier: null,
					extraUsage: null,
				},
				rateLimitTier: null,
				writtenAt: "2026-05-06T14:00:00Z",
				writtenBy: "12345",
			}),
		);

		const result = await cache.readCache();
		expect(result).not.toBeNull();
		expect(result!.apiUsage.fetchedAt).toBeInstanceOf(Date);
		expect(result!.apiUsage.fetchedAt.toISOString()).toBe(isoStr);
	});

	it("restores Date from numeric timestamp fetchedAt", async () => {
		const ts = new Date("2026-05-06T13:00:00Z").getTime();
		mockReadFile.mockResolvedValue(
			JSON.stringify({
				apiUsage: {
					fetchedAt: ts,
					fiveHour: null,
					sevenDay: null,
					sevenDaySonnet: null,
					sevenDayOpus: null,
					rateLimitTier: null,
					extraUsage: null,
				},
				rateLimitTier: null,
				writtenAt: "2026-05-06T14:00:00Z",
				writtenBy: "12345",
			}),
		);

		const result = await cache.readCache();
		expect(result).not.toBeNull();
		expect(result!.apiUsage.fetchedAt).toBeInstanceOf(Date);
		expect(result!.apiUsage.fetchedAt.getTime()).toBe(ts);
	});

	it("returns null for invalid fetchedAt string", async () => {
		mockReadFile.mockResolvedValue(
			JSON.stringify({
				apiUsage: {
					fetchedAt: "not-a-date",
					fiveHour: null,
				},
				writtenAt: "2026-05-06T14:00:00Z",
			}),
		);

		const result = await cache.readCache();
		expect(result).toBeNull();
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("invalid fetchedAt"),
		);
	});

	it("returns null for non-string non-number fetchedAt", async () => {
		mockReadFile.mockResolvedValue(
			JSON.stringify({
				apiUsage: {
					fetchedAt: true,
					fiveHour: null,
				},
				writtenAt: "2026-05-06T14:00:00Z",
			}),
		);

		const result = await cache.readCache();
		expect(result).toBeNull();
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("missing fetchedAt"),
		);
	});

	it("logs warning for non-ENOENT read errors", async () => {
		const err = new Error("EACCES") as NodeJS.ErrnoException;
		err.code = "EACCES";
		mockReadFile.mockRejectedValue(err);

		const result = await cache.readCache();
		expect(result).toBeNull();
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("Could not read usage cache"),
		);
	});
});
