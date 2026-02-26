import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

// Extension bundle (Node.js)
const extensionConfig = {
	entryPoints: ["src/extension.ts"],
	bundle: true,
	outfile: "dist/extension.js",
	external: ["vscode"],
	format: "cjs",
	platform: "node",
	target: "node22",
	sourcemap: !production,
	minify: production,
	logLevel: "info",
};

// Webview bundle (browser)
const webviewConfig = {
	entryPoints: ["src/webview/app/index.tsx"],
	bundle: true,
	outfile: "dist/webview.js",
	format: "iife",
	platform: "browser",
	target: "es2020",
	loader: { ".tsx": "tsx", ".ts": "ts", ".css": "css" },
	sourcemap: !production,
	minify: production,
	logLevel: "info",
};

async function main() {
	if (watch) {
		const extensionCtx = await esbuild.context(extensionConfig);
		const webviewCtx = await esbuild.context(webviewConfig);

		await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);

		console.log("Watching extension and webview for changes...");
	} else {
		await Promise.all([
			esbuild.build(extensionConfig),
			esbuild.build(webviewConfig),
		]);

		console.log("Built extension and webview bundles");
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
