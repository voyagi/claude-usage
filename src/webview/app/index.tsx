/**
 * Webview React entry point.
 * Acquires VS Code API and mounts the React app.
 */
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/app.css";

/**
 * VS Code webview API type definition.
 * Must be called exactly once to acquire the API handle.
 */
declare function acquireVsCodeApi(): {
	postMessage: (message: unknown) => void;
	setState: (state: unknown) => void;
	getState: () => unknown;
};

/**
 * Singleton VS Code API handle.
 * Exported for use by components that need to send messages.
 */
export const vscode = acquireVsCodeApi();

// Mount React app to #root element
const rootElement = document.getElementById("root");
if (!rootElement) {
	throw new Error("Root element not found");
}

createRoot(rootElement).render(<App />);
