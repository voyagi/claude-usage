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
      description: 'Change Claude plan (Pro, Max 5x, Max 20x)',
    },
    {
      label: '$(graph) View Usage Summary',
      description: 'Show detailed usage breakdown',
    },
    {
      label: '$(trash) Reset Session Tracking',
      description: 'Clear session counters and reparse',
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
  } else if (selected.label.includes('View Usage')) {
    await vscode.commands.executeCommand('claude-usage.viewSummary');
  } else if (selected.label.includes('Reset')) {
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
