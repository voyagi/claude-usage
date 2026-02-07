import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Claude Usage Monitor');
  outputChannel.appendLine('[' + new Date().toISOString() + '] Claude Usage Monitor activating...');

  const clearDataCommand = vscode.commands.registerCommand('claude-usage.clearData', () => {
    vscode.window.showInformationMessage('Clear data command registered (not yet implemented)');
  });

  context.subscriptions.push(clearDataCommand);
  context.subscriptions.push(outputChannel);
}

export function deactivate() {
  console.log('[' + new Date().toISOString() + '] Claude Usage Monitor deactivating...');
}
