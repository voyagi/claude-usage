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
	it("links the bundled stylesheet", () => {
		const html = renderHtml();
		expect(html).toContain('rel="stylesheet"');
		expect(html).toContain("webview.css");
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
