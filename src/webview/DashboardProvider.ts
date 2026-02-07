/**
 * WebviewViewProvider for the sidebar dashboard panel.
 * Manages webview lifecycle, HTML generation, CSP, and message passing.
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { DashboardData, WebviewMessage, ExtensionMessage } from './app/types.js';

export class DashboardProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'claude-usage.dashboardView';

  private _view?: vscode.WebviewView;
  private _currentData?: DashboardData;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  /**
   * Called when the view first becomes visible.
   * Sets up webview options, HTML content, and message handlers.
   */
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void | Thenable<void> {
    this._view = webviewView;

    // Configure webview
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    // Set HTML content
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
      switch (message.type) {
        case 'requestData':
          // Send current data immediately if available
          if (this._currentData) {
            this._postMessage({ type: 'usageData', payload: this._currentData });
          }
          break;

        case 'changePeriod':
          // Store period preference (extension will handle data refresh)
          // For now, we just acknowledge - future plans will implement period switching
          break;
      }
    });

    // Handle visibility changes - refresh data when becoming visible
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible && this._currentData) {
        this._postMessage({ type: 'usageData', payload: this._currentData });
      }
    });

    // Handle disposal
    webviewView.onDidDispose(() => {
      this._view = undefined;
    });
  }

  /**
   * Public method for extension.ts to push data updates to the webview.
   * Data is cached so it can be sent when webview becomes visible.
   */
  public updateData(data: DashboardData): void {
    this._currentData = data;

    // Post to webview if visible
    if (this._view?.visible) {
      this._postMessage({ type: 'usageData', payload: data });
    }
  }

  /**
   * Post a message to the webview (if it exists and is visible).
   */
  private _postMessage(message: ExtensionMessage): void {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  /**
   * Generate the HTML content for the webview.
   * Includes CSP, nonce-protected script loading, and root div for React.
   */
  private _getHtmlForWebview(webview: vscode.Webview): string {
    // Generate nonce for CSP
    const nonce = this._getNonce();

    // Get URIs for bundled assets
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js')
    );

    // CSP configuration
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`, // Allow inline styles for React
      `script-src 'nonce-${nonce}'`, // Only allow scripts with nonce
      `font-src ${webview.cspSource}`, // Allow fonts from extension
      `img-src ${webview.cspSource} data:`, // Allow images from extension and data URIs
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Claude Usage Dashboard</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  /**
   * Generate a cryptographically secure nonce for CSP.
   */
  private _getNonce(): string {
    return crypto.randomBytes(16).toString('base64');
  }
}
