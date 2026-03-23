/**
 * Unit tests for CredentialsWatcher
 *
 * Covers the credential change detection -> resetAuth recovery loop:
 * - handleCredentialsChange fires onTierChange when tier changes
 * - handleCredentialsChange fires onTokenChange when token hash changes
 * - readCredentials handles ENOENT, empty file, malformed JSON
 * - start() reads initial tier and sets up watcher
 * - dispose() cleans up
 *
 * tokenHash detection reads accessToken from raw JSON parse (not from
 * parseCredentialsFile which strips claudeAiOauth).
 */

const mockReadFile = jest.fn();
jest.mock("node:fs/promises", () => ({
	readFile: mockReadFile,
}));

// Track watcher callbacks
let onDidChangeCallback: (() => Promise<void>) | null = null;
let onDidCreateCallback: (() => Promise<void>) | null = null;

jest.mock(
	"vscode",
	() => ({
		workspace: {
			createFileSystemWatcher: jest.fn(() => ({
				onDidChange: jest.fn((cb: () => Promise<void>) => {
					onDidChangeCallback = cb;
				}),
				onDidCreate: jest.fn((cb: () => Promise<void>) => {
					onDidCreateCallback = cb;
				}),
				dispose: jest.fn(),
			})),
		},
		RelativePattern: jest.fn((dir: string, file: string) => ({ dir, file })),
		Uri: {
			file: (p: string) => ({ fsPath: p }),
		},
	}),
	{ virtual: true },
);

// Mock Logger.create to avoid real logger
jest.mock("../utils/logger", () => ({
	Logger: {
		create: jest.fn(() => ({
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			show: jest.fn(),
			dispose: jest.fn(),
		})),
	},
}));

import { CredentialsWatcher } from "./credentialsWatcher";

// ── Helpers ──────────────────────────────────────────────────────────

function makeContext() {
	return {
		subscriptions: { push: jest.fn() },
	} as any;
}

/**
 * Build credentials JSON with top-level fields that parseCredentialsFile extracts,
 * plus nested claudeAiOauth for the token hash logic.
 */
function credentialsJson(
	opts: {
		rateLimitTier?: string;
		subscriptionType?: string;
		accessToken?: string;
	} = {},
) {
	return JSON.stringify({
		rateLimitTier: opts.rateLimitTier ?? "tier4",
		subscriptionType: opts.subscriptionType ?? "max5",
		claudeAiOauth: {
			accessToken: opts.accessToken ?? "test-token",
			refreshToken: "refresh-token",
			expiresAt: Date.now() + 3600_000,
		},
	});
}

// ── start() and initial tier detection ──────────────────────────────

describe("CredentialsWatcher: start", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		onDidChangeCallback = null;
		onDidCreateCallback = null;
	});

	it("returns detected tier on startup from rateLimitTier field", async () => {
		mockReadFile.mockResolvedValue(credentialsJson({ rateLimitTier: "tier4" }));

		const watcher = new CredentialsWatcher(makeContext(), jest.fn(), jest.fn());
		const tier = await watcher.start("pro");

		// tier4 doesn't map to anything via mapTierStringToPlanType,
		// but subscriptionType "max5" does
		expect(tier).toBe("max5");
		watcher.dispose();
	});

	it("returns fallback tier when file does not exist", async () => {
		const err = new Error("ENOENT") as NodeJS.ErrnoException;
		err.code = "ENOENT";
		mockReadFile.mockRejectedValue(err);

		const watcher = new CredentialsWatcher(makeContext(), jest.fn(), jest.fn());
		const tier = await watcher.start("max5");

		expect(tier).toBe("max5");
		watcher.dispose();
	});

	it("returns fallback tier when file is empty", async () => {
		mockReadFile.mockResolvedValue("");

		const watcher = new CredentialsWatcher(makeContext(), jest.fn(), jest.fn());
		const tier = await watcher.start("pro");

		expect(tier).toBe("pro");
		watcher.dispose();
	});

	it("returns fallback tier when file has invalid JSON", async () => {
		mockReadFile.mockResolvedValue("{broken json");

		const watcher = new CredentialsWatcher(makeContext(), jest.fn(), jest.fn());
		const tier = await watcher.start("max5");

		expect(tier).toBe("max5");
		watcher.dispose();
	});

	it("registers file watcher on start", async () => {
		mockReadFile.mockResolvedValue(credentialsJson());
		const vscode = require("vscode");

		const watcher = new CredentialsWatcher(makeContext(), jest.fn(), jest.fn());
		await watcher.start("max5");

		expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalled();
		watcher.dispose();
	});
});

// ── handleCredentialsChange: tier change fires onTierChange ─────────

describe("CredentialsWatcher: tier change detection", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		onDidChangeCallback = null;
		onDidCreateCallback = null;
	});

	it("fires onTierChange when subscriptionType changes", async () => {
		const onTierChange = jest.fn();
		// Initial: subscriptionType max5
		mockReadFile.mockResolvedValueOnce(
			credentialsJson({ subscriptionType: "max5" }),
		);

		const watcher = new CredentialsWatcher(
			makeContext(),
			onTierChange,
			jest.fn(),
		);
		await watcher.start("max5");

		// Change to pro
		mockReadFile.mockResolvedValueOnce(
			credentialsJson({ subscriptionType: "pro" }),
		);
		expect(onDidChangeCallback).not.toBeNull();
		await onDidChangeCallback!();

		expect(onTierChange).toHaveBeenCalledTimes(1);
		expect(onTierChange).toHaveBeenCalledWith("pro");
		watcher.dispose();
	});

	it("does NOT fire onTierChange when tier is unchanged", async () => {
		const onTierChange = jest.fn();
		mockReadFile.mockResolvedValue(
			credentialsJson({ subscriptionType: "max5" }),
		);

		const watcher = new CredentialsWatcher(
			makeContext(),
			onTierChange,
			jest.fn(),
		);
		await watcher.start("max5");

		await onDidChangeCallback!();

		expect(onTierChange).not.toHaveBeenCalled();
		watcher.dispose();
	});

	it("fires onTierChange on file creation with different tier", async () => {
		const onTierChange = jest.fn();
		// Initial: no file
		const err = new Error("ENOENT") as NodeJS.ErrnoException;
		err.code = "ENOENT";
		mockReadFile.mockRejectedValueOnce(err);

		const watcher = new CredentialsWatcher(
			makeContext(),
			onTierChange,
			jest.fn(),
		);
		// Fallback tier is "pro"
		await watcher.start("pro");

		// File created with max5
		mockReadFile.mockResolvedValueOnce(
			credentialsJson({ subscriptionType: "max5" }),
		);
		expect(onDidCreateCallback).not.toBeNull();
		await onDidCreateCallback!();

		expect(onTierChange).toHaveBeenCalledWith("max5");
		watcher.dispose();
	});
});

// ── handleCredentialsChange: token change ───────────────────────────

describe("CredentialsWatcher: token change detection", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		onDidChangeCallback = null;
		onDidCreateCallback = null;
	});

	it("fires onTokenChange when access token changes", async () => {
		const onTokenChange = jest.fn();
		mockReadFile.mockResolvedValueOnce(
			credentialsJson({ accessToken: "token-A" }),
		);

		const watcher = new CredentialsWatcher(
			makeContext(),
			jest.fn(),
			onTokenChange,
		);
		await watcher.start("max5");

		mockReadFile.mockResolvedValueOnce(
			credentialsJson({ accessToken: "token-B" }),
		);
		await onDidChangeCallback!();

		expect(onTokenChange).toHaveBeenCalledTimes(1);
		watcher.dispose();
	});

	it("does NOT fire onTokenChange when token is unchanged", async () => {
		const onTokenChange = jest.fn();
		mockReadFile.mockResolvedValue(
			credentialsJson({ accessToken: "same-token" }),
		);

		const watcher = new CredentialsWatcher(
			makeContext(),
			jest.fn(),
			onTokenChange,
		);
		await watcher.start("max5");

		await onDidChangeCallback!();

		expect(onTokenChange).not.toHaveBeenCalled();
		watcher.dispose();
	});

	it("fires onTokenChange on file creation (new credentials)", async () => {
		const onTokenChange = jest.fn();
		const err = new Error("ENOENT") as NodeJS.ErrnoException;
		err.code = "ENOENT";
		mockReadFile.mockRejectedValueOnce(err);

		const watcher = new CredentialsWatcher(
			makeContext(),
			jest.fn(),
			onTokenChange,
		);
		await watcher.start("max5");

		mockReadFile.mockResolvedValueOnce(
			credentialsJson({ accessToken: "new-token" }),
		);
		await onDidCreateCallback!();

		expect(onTokenChange).toHaveBeenCalledTimes(1);
		watcher.dispose();
	});
});

// ── readCredentials: error handling ─────────────────────────────────

describe("CredentialsWatcher: readCredentials error handling", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		onDidChangeCallback = null;
		onDidCreateCallback = null;
	});

	it("handles permission error gracefully", async () => {
		const err = new Error("permission denied") as NodeJS.ErrnoException;
		err.code = "EACCES";
		mockReadFile.mockRejectedValue(err);

		const watcher = new CredentialsWatcher(makeContext(), jest.fn(), jest.fn());
		const tier = await watcher.start("max5");
		expect(tier).toBe("max5");
		watcher.dispose();
	});

	it("handles whitespace-only file", async () => {
		mockReadFile.mockResolvedValue("   \n  ");

		const watcher = new CredentialsWatcher(makeContext(), jest.fn(), jest.fn());
		const tier = await watcher.start("pro");
		expect(tier).toBe("pro");
		watcher.dispose();
	});

	it("handles file read error during change event gracefully", async () => {
		mockReadFile.mockResolvedValueOnce(credentialsJson());

		const watcher = new CredentialsWatcher(makeContext(), jest.fn(), jest.fn());
		await watcher.start("max5");

		// Simulate read error during change event
		mockReadFile.mockRejectedValueOnce(new Error("disk error"));
		// Should not throw
		await onDidChangeCallback!();
		watcher.dispose();
	});
});

// ── dispose ─────────────────────────────────────────────────────────

describe("CredentialsWatcher: dispose", () => {
	it("nullifies watcher reference and is safe to call twice", async () => {
		mockReadFile.mockResolvedValue(credentialsJson());

		const watcher = new CredentialsWatcher(makeContext(), jest.fn(), jest.fn());
		await watcher.start("max5");

		watcher.dispose();
		watcher.dispose(); // double-dispose should be safe
	});
});
