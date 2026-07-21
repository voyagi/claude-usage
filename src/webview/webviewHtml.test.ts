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

import { readFileSync } from "node:fs";
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
		// The href is a hardcoded string; the real filename is a sibling derived
		// from the webview bundle's outfile. Nothing else ties the two together,
		// so renaming the outfile would leave a dangling href that renders,
		// throws nothing, and keeps every other test green.
		const config = readFileSync(
			path.join(__dirname, "..", "..", "esbuild.config.mjs"),
			"utf8",
		);
		// Capture whatever the outfile IS, rather than matching the value we
		// expect: a pattern with the name baked into its own capture group
		// derives nothing and fails on a correct rename. Anchoring to
		// webviewConfig avoids picking up the extension bundle's outfile.
		//
		// Line comments are stripped first because match() takes the first hit,
		// so a commented-out config block left in the file would be captured in
		// preference to the live one -- verified: with such a block present the
		// unstripped pattern reads the dead value and the test passes while the
		// real href dangles. Block comments would still slip through.
		const code = config.replace(/^\s*\/\/.*$/gm, "");
		const outfile = code.match(
			/webviewConfig\s*=\s*\{[\s\S]*?outfile:\s*"([^"]+)"/,
		)?.[1];
		expect(outfile).toBeTruthy();

		const emittedCss = (outfile as string).replace(/\.js$/, ".css");
		expect(renderHtml()).toContain(`/${emittedCss}"`);
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
