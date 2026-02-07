/**
 * StatusBarManager - Manages two status bar items for Claude usage monitoring
 * - Metrics item: cost, usage percentage, burn rate
 * - Cooldown item: soonest rate limit reset timer
 */

import * as vscode from 'vscode';
import type { StatusBarData, RateLimitInfo } from '../types.js';
import {
  formatTokens,
  formatTokensExact,
  formatCooldown,
  formatCost,
  formatPercentage,
  formatBurnRate,
} from './formatting.js';

export class StatusBarManager {
  private metricsItem: vscode.StatusBarItem;
  private cooldownItem: vscode.StatusBarItem;
  private isCompactMode: boolean;
  private errorTimer: NodeJS.Timeout | undefined;

  constructor(context: vscode.ExtensionContext) {
    // Create metrics item (higher priority = further right)
    this.metricsItem = vscode.window.createStatusBarItem(
      'claude-usage.metrics',
      vscode.StatusBarAlignment.Right,
      100
    );
    this.metricsItem.command = 'claude-usage.showMenu';
    context.subscriptions.push(this.metricsItem);

    // Create cooldown item (slightly lower priority, appears to left of metrics)
    this.cooldownItem = vscode.window.createStatusBarItem(
      'claude-usage.cooldown',
      vscode.StatusBarAlignment.Right,
      99
    );
    this.cooldownItem.command = 'claude-usage.showMenu';
    context.subscriptions.push(this.cooldownItem);

    // Read compact mode setting
    const config = vscode.workspace.getConfiguration('claude-usage');
    this.isCompactMode = config.get<boolean>('compactMode', false);

    // Show initial loading state
    this.metricsItem.text = '$(loading~spin) Claude: Loading...';
    this.metricsItem.show();
    this.cooldownItem.hide();
  }

  /**
   * Update both status bar items with new data
   */
  update(data: StatusBarData): void {
    // Clear any error timer
    if (this.errorTimer) {
      clearTimeout(this.errorTimer);
      this.errorTimer = undefined;
    }

    // Update metrics item text
    if (this.isCompactMode) {
      // Compact: cost + percentage only
      this.metricsItem.text = `$(cloud) ${formatCost(data.totalCost)} ${formatPercentage(data.rateLimits.worstPercentage)}`;
    } else {
      // Normal: cost + percentage + burn rate
      let text = `$(cloud) ${formatCost(data.totalCost)} | ${formatPercentage(data.rateLimits.worstPercentage)}`;
      if (data.burnRate > 0) {
        text += ` | ${formatBurnRate(data.burnRate)}`;
      }
      this.metricsItem.text = text;
    }

    // Update background color based on worst percentage
    const worstPct = data.rateLimits.worstPercentage;
    if (worstPct >= 80) {
      this.metricsItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      this.cooldownItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (worstPct >= 60) {
      this.metricsItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      this.cooldownItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.metricsItem.backgroundColor = undefined;
      this.cooldownItem.backgroundColor = undefined;
    }

    // Update metrics item tooltip (markdown formatted)
    const tooltip = new vscode.MarkdownString();
    tooltip.isTrusted = true;
    tooltip.supportHtml = false;

    tooltip.appendMarkdown('**Claude Usage Monitor**\n\n');
    tooltip.appendMarkdown(`**Today:** ${formatCost(data.todayCost)} | **Month:** ${formatCost(data.monthCost)}\n\n`);
    tooltip.appendMarkdown(`**Tokens:** ${formatTokensExact(data.totalInputTokens)} in / ${formatTokensExact(data.totalOutputTokens)} out\n\n`);
    tooltip.appendMarkdown('**Rate Limits** _(estimated)_\n\n');

    // Add each rate limit with details
    const limits = [data.rateLimits.session5h, data.rateLimits.weekly, data.rateLimits.weeklySonnet];
    for (const limit of limits) {
      let line = `- ${limit.name}: ${formatPercentage(limit.percentage)} (${formatTokensExact(limit.currentTokens)} / ${formatTokensExact(limit.estimatedLimit)})`;
      if (limit.isHit) {
        line += ` -- **LIMIT HIT**, resets ${formatCooldown(limit.resetTime)}`;
      } else if (limit.resetTime) {
        line += ` -- resets ${formatCooldown(limit.resetTime)}`;
      }
      tooltip.appendMarkdown(line + '\n\n');
    }

    // Add burn rate if active
    if (data.burnRate > 0) {
      tooltip.appendMarkdown(`**Burn Rate:** ${formatBurnRate(data.burnRate)}\n\n`);
    }

    // Add metadata
    tooltip.appendMarkdown(`Files: ${data.filesProcessed} | Updated: ${data.lastUpdated.toLocaleTimeString()}`);

    this.metricsItem.tooltip = tooltip;
    this.metricsItem.show();

    // Update cooldown item
    this.updateCooldownItem(data);
  }

  /**
   * Update cooldown item based on rate limit status
   */
  private updateCooldownItem(data: StatusBarData): void {
    const limits = [data.rateLimits.session5h, data.rateLimits.weekly, data.rateLimits.weeklySonnet];

    // Find hit limits and their reset times
    const hitLimits = limits.filter(l => l.isHit && l.resetTime);
    if (hitLimits.length > 0) {
      // Show soonest reset among hit limits
      const soonest = hitLimits.reduce((earliest, current) => {
        if (!current.resetTime) return earliest;
        if (!earliest.resetTime) return current;
        return current.resetTime < earliest.resetTime ? current : earliest;
      });

      this.cooldownItem.text = `$(clock) ${formatCooldown(soonest.resetTime)}`;
      this.cooldownItem.tooltip = 'Soonest rate limit reset. Click for actions.';
      this.cooldownItem.show();
      return;
    }

    // If no hit limits but worst percentage >= 60%, show soonest reset of worst limit
    if (data.rateLimits.worstPercentage >= 60) {
      const worstLimit = limits.reduce((worst, current) => {
        return current.percentage > worst.percentage ? current : worst;
      });

      if (worstLimit.resetTime) {
        this.cooldownItem.text = `$(clock) ${formatCooldown(worstLimit.resetTime)}`;
        this.cooldownItem.tooltip = 'Soonest rate limit reset. Click for actions.';
        this.cooldownItem.show();
        return;
      }
    }

    // Otherwise hide cooldown item
    this.cooldownItem.hide();
  }

  /**
   * Show refreshing state with spinner
   */
  showRefreshing(): void {
    this.metricsItem.text = '$(sync~spin) Refreshing...';
    this.metricsItem.backgroundColor = undefined;
    this.cooldownItem.hide();
  }

  /**
   * Show error state
   */
  showError(message: string): void {
    this.metricsItem.text = '$(warning) Claude: Error';
    this.metricsItem.tooltip = message;
    this.metricsItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.cooldownItem.hide();

    // Auto-restore after 5 seconds (will be overwritten by next update)
    this.errorTimer = setTimeout(() => {
      this.showNoData();
    }, 5000);
  }

  /**
   * Show no data state
   */
  showNoData(): void {
    this.metricsItem.text = '$(cloud) Claude: No data';
    this.metricsItem.tooltip = 'No Claude usage data found. Start using Claude Code to see usage stats.';
    this.metricsItem.backgroundColor = undefined;
    this.metricsItem.show();
    this.cooldownItem.hide();
  }

  /**
   * Dispose status bar items
   */
  dispose(): void {
    if (this.errorTimer) {
      clearTimeout(this.errorTimer);
    }
    this.metricsItem.dispose();
    this.cooldownItem.dispose();
  }
}
