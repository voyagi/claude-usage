/**
 * WebviewViewProvider for the sidebar dashboard panel.
 * Manages webview lifecycle, HTML generation, CSP, and message passing.
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { format } from 'date-fns';
import { subHours } from 'date-fns';
import type { DashboardData, WebviewMessage, ExtensionMessage, RateLimitData, TrendDataPoint } from './app/types.js';
import type { TimeBuckets, StatusBarData, RateLimitInfo } from '../types.js';

export class DashboardProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'claude-usage.dashboardView';

  private _view?: vscode.WebviewView;
  private _currentData?: DashboardData;
  private _buckets?: TimeBuckets;
  private _statusBarData?: StatusBarData;
  private _planType: string = 'pro';
  private _activePeriod: 'daily' | 'weekly' | 'monthly' = 'daily';

  constructor(private readonly _extensionUri: vscode.Uri) {}

  /**
   * Transform internal TimeBuckets + StatusBarData into webview-safe DashboardData.
   * This is the core data transformation pipeline for the dashboard.
   */
  public static buildDashboardData(
    buckets: TimeBuckets,
    statusBarData: StatusBarData,
    planType: string,
    activePeriod: 'daily' | 'weekly' | 'monthly' = 'daily'
  ): DashboardData {
    const now = new Date();
    const today = format(now, 'yyyy-MM-dd');

    // 1. Token breakdown - get cache tokens from today's daily bucket
    const todayBucket = buckets.daily.get(today);
    const cacheCreationTokens = todayBucket?.cacheCreationTokens ?? 0;
    const cacheReadTokens = todayBucket?.cacheReadTokens ?? 0;

    // 2. Cost data - direct from statusBarData
    const todayCost = statusBarData.todayCost;
    const monthCost = statusBarData.monthCost;
    const totalCost = statusBarData.totalCost;

    // 3. Rate limits - convert each RateLimitInfo to RateLimitData (serialization-safe)
    const convertRateLimit = (info: RateLimitInfo): RateLimitData => ({
      name: info.name,
      currentTokens: info.currentTokens,
      estimatedLimit: info.estimatedLimit,
      percentage: info.percentage,
      resetTime: info.resetTime?.toISOString() ?? null,
      isHit: info.isHit,
    });

    const session5h = convertRateLimit(statusBarData.rateLimits.session5h);
    const weekly = convertRateLimit(statusBarData.rateLimits.weekly);
    const weeklySonnet = convertRateLimit(statusBarData.rateLimits.weeklySonnet);

    // 4. Session timing - compute from session5h resetTime
    let windowStart: string | null = null;
    let windowExpiry: string | null = null;
    let timeRemainingMinutes: number | null = null;

    if (statusBarData.rateLimits.session5h.resetTime) {
      const resetTime = statusBarData.rateLimits.session5h.resetTime;
      windowExpiry = resetTime.toISOString();
      windowStart = new Date(resetTime.getTime() - 5 * 60 * 60 * 1000).toISOString();
      timeRemainingMinutes = Math.max(0, Math.round((resetTime.getTime() - now.getTime()) / 60000));
    }

    // 5. Burn rate
    const tokensPerMinute = statusBarData.burnRate;
    let minutesUntilLimit: number | null = null;
    if (tokensPerMinute > 0 && session5h.estimatedLimit > 0) {
      const remainingTokens = session5h.estimatedLimit - session5h.currentTokens;
      if (remainingTokens > 0) {
        minutesUntilLimit = Math.round(remainingTokens / tokensPerMinute);
      }
    }

    // 6. Trend data - convert appropriate bucket Map to TrendDataPoint[]
    const bucketMap = buckets[activePeriod];
    const trendData: TrendDataPoint[] = Array.from(bucketMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, agg]) => ({
        period,
        inputTokens: agg.inputTokens,
        outputTokens: agg.outputTokens,
        cacheCreationTokens: agg.cacheCreationTokens,
        cacheReadTokens: agg.cacheReadTokens,
        totalCost: agg.totalCost,
      }));

    // 7. Session comparison - CRITICAL for Session tab
    // Current session: Sum output tokens from all sessions active in last 5 hours
    const fiveHoursAgo = subHours(now, 5);
    let currentSessionTokens = 0;
    for (const [sessionId, agg] of buckets.session.entries()) {
      if (agg.lastMessage && agg.lastMessage >= fiveHoursAgo) {
        currentSessionTokens += agg.outputTokens;
      }
    }

    // Average session: Mean of ALL sessions' output tokens (historical)
    let totalOutputAcrossAllSessions = 0;
    for (const agg of buckets.session.values()) {
      totalOutputAcrossAllSessions += agg.outputTokens;
    }
    const sessionCount = buckets.session.size;
    const averageSessionTokens = sessionCount > 0 ? Math.round(totalOutputAcrossAllSessions / sessionCount) : 0;

    // 8. Metadata
    const lastUpdated = statusBarData.lastUpdated.toISOString();
    const filesProcessed = statusBarData.filesProcessed;
    const linesSkipped = statusBarData.linesSkipped;

    return {
      inputTokens: statusBarData.totalInputTokens,
      outputTokens: statusBarData.totalOutputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      todayCost,
      monthCost,
      totalCost,
      session5h,
      weekly,
      weeklySonnet,
      windowStart,
      windowExpiry,
      timeRemainingMinutes,
      tokensPerMinute,
      minutesUntilLimit,
      trendData,
      currentSessionTokens,
      averageSessionTokens,
      sessionCount,
      lastUpdated,
      filesProcessed,
      linesSkipped,
      planType,
    };
  }

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
          // Update period and rebuild data with new trend aggregation
          this._activePeriod = message.period;
          if (this._buckets && this._statusBarData) {
            const data = DashboardProvider.buildDashboardData(
              this._buckets,
              this._statusBarData,
              this._planType,
              this._activePeriod
            );
            this.updateData(data);
          }
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
   * Public method for extension.ts to push buckets + statusBarData.
   * Transforms data via buildDashboardData and caches for visibility refresh.
   */
  public updateBuckets(buckets: TimeBuckets, statusBarData: StatusBarData, planType: string): void {
    this._buckets = buckets;
    this._statusBarData = statusBarData;
    this._planType = planType;

    const data = DashboardProvider.buildDashboardData(buckets, statusBarData, planType, this._activePeriod);
    this.updateData(data);
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
