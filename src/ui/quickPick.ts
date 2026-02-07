/**
 * Quick pick menu for Claude usage monitoring actions
 * Provides interim actions before Phase 5's webview implementation
 */

import * as vscode from 'vscode';
import { PLAN_CONFIGS } from '../pricing/plans.js';
import type { PlanType } from '../types.js';

/**
 * Show usage menu with available actions
 */
export async function showUsageMenu(): Promise<void> {
  const items: vscode.QuickPickItem[] = [
    {
      label: '$(refresh) Refresh Data',
      description: 'Reparse all JSONL files',
    },
    {
      label: '$(gear) Switch Plan Tier',
      description: 'Change plan (Pro, Max 5x, Max 20x)',
    },
    {
      label: '$(export) Export Usage Data',
      description: 'Save usage data as JSON',
    },
    {
      label: '$(dashboard) Open Dashboard',
      description: 'Show detailed usage dashboard',
    },
    {
      label: '$(eye) Toggle Status Bar',
      description: 'Show/hide status bar items',
    },
    {
      label: '$(folder) Show Data Source',
      description: 'Show watched directory path',
    },
    {
      label: '$(settings-gear) Open Settings',
      description: 'Configure extension settings',
    },
    {
      label: '$(discard) Reset Rate Limits',
      description: 'Clear learned rate limit estimates',
    },
    {
      label: '$(trash) Reset Session Tracking',
      description: 'Clear all data and reparse',
    },
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Claude Usage Monitor',
  });

  if (!selected) {
    return; // User cancelled
  }

  // Dispatch to appropriate command based on selection
  if (selected.label.includes('Refresh Data')) {
    await vscode.commands.executeCommand('claude-usage.refresh');
  } else if (selected.label.includes('Switch Plan')) {
    await vscode.commands.executeCommand('claude-usage.switchPlan');
  } else if (selected.label.includes('Export Usage Data')) {
    await vscode.commands.executeCommand('claude-usage.exportData');
  } else if (selected.label.includes('Open Dashboard')) {
    await vscode.commands.executeCommand('claude-usage.openDashboard');
  } else if (selected.label.includes('Toggle Status Bar')) {
    await vscode.commands.executeCommand('claude-usage.toggleStatusBar');
  } else if (selected.label.includes('Show Data Source')) {
    await vscode.commands.executeCommand('claude-usage.showDataSource');
  } else if (selected.label.includes('Open Settings')) {
    await vscode.commands.executeCommand('claude-usage.openSettings');
  } else if (selected.label.includes('Reset Rate Limits')) {
    await vscode.commands.executeCommand('claude-usage.resetRateLimits');
  } else if (selected.label.includes('Reset Session Tracking')) {
    await vscode.commands.executeCommand('claude-usage.resetSession');
  }
}

/**
 * Show plan picker and return selected plan type
 */
export async function showPlanPicker(): Promise<PlanType | undefined> {
  const items: vscode.QuickPickItem[] = Object.values(PLAN_CONFIGS).map(plan => ({
    label: plan.displayName,
    description: plan.type,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select your Claude plan',
  });

  if (!selected) {
    return undefined; // User cancelled
  }

  return selected.description as PlanType;
}
