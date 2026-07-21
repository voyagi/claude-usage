/**
 * Tests for the webview HTML shell.
 *
 * The stylesheet link is the one that matters: esbuild's "css" loader emits
 * dist/webview.css as a sibling of the JS bundle rather than injecting it, so
 * `import "./styles/app.css"` alone builds and packages a file that never
 * loads. That failure is invisible -- the dashboard still renders, just with
 * every className resolving to nothing -- so it needs a test rather than a
 * glance.
 */

jest.mock(
	"vscode",
	() => ({
		Uri: {
			joinPath: (base: { path: string }, ...parts: string[]) => ({
				path: `${base.path}/${parts.join("/")}`,
			}),
		},
	}),
	{ virtual: true },
);

import { existsSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { DashboardProvider } from "./DashboardProvider.js";

/** Minimal webview stand-in: asWebviewUri just marks what was asked for. */
const webview = {
	cspSource: "vscode-webview://test",
	asWebviewUri: (uri: { path: string }) => `webview-uri:${uri.path}`,
};

function renderHtml(): string {
	const provider = Object.create(DashboardProvider.prototype, {
		_extensionUri: { value: { path: "/ext" }, writable: true },
	});
	return (
		provider as unknown as {
			_getHtmlForWebview: (w: unknown) => string;
		}
	)._getHtmlForWebview(webview);
}

const repoRoot = path.join(__dirname, "..", "..");

/**
 * The stylesheet path esbuild actually emits, derived from the build config
 * rather than restated here, so the href and the artifact checks below are both
 * pinned to the real output instead of to each other.
 *
 * Capture whatever the outfile IS rather than matching the value we expect: a
 * pattern with the name baked into its own capture group derives nothing and
 * fails on a correct rename. Anchoring to webviewConfig avoids picking up the
 * extension bundle's outfile. Line comments are stripped first because match()
 * takes the first hit, so a commented-out config block would be read in
 * preference to the live one -- verified: with such a block present the
 * unstripped pattern reads the dead value while the real href dangles. Block
 * comments would still slip through, which is why the artifact check exists.
 */
function emittedStylesheetPath(): string {
	const config = readFileSync(
		path.join(repoRoot, "esbuild.config.mjs"),
		"utf8",
	);
	const code = config.replace(/^\s*\/\/.*$/gm, "");
	const outfile = code.match(
		/webviewConfig\s*=\s*\{[\s\S]*?outfile:\s*"([^"]+)"/,
	)?.[1];
	expect(outfile).toBeTruthy();
	return (outfile as string).replace(/\.js$/, ".css");
}

describe("webview HTML shell", () => {
	it("links the bundled stylesheet through asWebviewUri", () => {
		const html = renderHtml();
		expect(html).toContain('rel="stylesheet"');
		// Assert the full href, not just the filename. A raw vscode.Uri also
		// stringifies to something containing "webview.css", but as a file: URI
		// the webview refuses to load it -- the same silently-unstyled failure
		// this test exists to catch. Only the asWebviewUri form is loadable.
		expect(html).toContain('href="webview-uri:/ext/dist/webview.css"');
	});

	it("links the stylesheet name esbuild actually emits", () => {
		expect(renderHtml()).toContain(`/${emittedStylesheetPath()}"`);
	});

	it("emits the stylesheet it links", () => {
		// The href can name exactly the right file and still dangle if nothing
		// produces it. Deleting the `import "./styles/app.css"` from index.tsx
		// stops the file being emitted, leaves every other assertion here green,
		// and reproduces the original bug exactly: link present, no stylesheet,
		// dashboard unstyled. Only checking the artifact catches that.
		//
		// `pretest` builds first, so dist/ is current when this runs. Note
		// esbuild does not clean dist/, so a stale file can mask this locally --
		// it bites in the packaged VSIX, built from a fresh checkout.
		// Resolve through the config-derived path rather than hardcoding "dist",
		// so moving the outfile to another directory does not fail here for the
		// wrong reason.
		const emitted = path.join(repoRoot, emittedStylesheetPath());
		expect(existsSync(emitted)).toBe(true);
		expect(statSync(emitted).size).toBeGreaterThan(0);
	});

	it("loads the script bundle", () => {
		expect(renderHtml()).toContain("webview.js");
	});

	it("gives the script a nonce matching the CSP", () => {
		const html = renderHtml();
		const cspNonce = html.match(/script-src 'nonce-([^']+)'/)?.[1];
		const tagNonce = html.match(/<script nonce="([^"]+)"/)?.[1];
		expect(cspNonce).toBeTruthy();
		expect(tagNonce).toBe(cspNonce);
	});

	it("allows stylesheets from the extension in the CSP", () => {
		// A linked stylesheet is useless if style-src forbids it
		expect(renderHtml()).toContain(`style-src ${webview.cspSource}`);
	});

	it("uses a fresh nonce per render", () => {
		expect(renderHtml()).not.toBe(renderHtml());
	});
});
