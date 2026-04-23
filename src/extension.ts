import * as vscode from 'vscode';
import { ApexLogParser } from './parser';
import { ApexLogAnalyzer, Analysis } from './analyzer';
import { SalesforceService } from './salesforceService';
import { AiService } from './aiService';
import { renderAnalysisHtml } from './webview';

let currentPanel: vscode.WebviewPanel | undefined;
let currentAnalysis: Analysis | undefined;

export function activate(context: vscode.ExtensionContext) {
  const parser = new ApexLogParser();
  const analyzer = new ApexLogAnalyzer();
  const sf = new SalesforceService();
  const ai = new AiService(context.secrets);

  context.subscriptions.push(
    vscode.commands.registerCommand('apexLogAnalyzer.setApiKey', () => ai.setApiKey()),
    vscode.commands.registerCommand('apexLogAnalyzer.clearApiKey', () => ai.clearApiKey())
  );

  const analyzeCmd = vscode.commands.registerCommand('apexLogAnalyzer.analyze', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showErrorMessage('Open a file with Apex log content first.'); return; }
    const text = editor.document.getText(editor.selection.isEmpty ? undefined : editor.selection);
    if (!text.trim()) { vscode.window.showErrorMessage('The file (or selection) is empty.'); return; }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Analysing Apex log…' },
      async () => {
        const parsed = parser.parse(text);
        const analysis = analyzer.analyze(parsed);
        currentAnalysis = analysis;
        openAnalysisPanel(context, analysis, ai);
      }
    );
  });

  const syncCmd = vscode.commands.registerCommand('apexLogAnalyzer.syncUser', async () => {
    const editor = vscode.window.activeTextEditor;
    const text = editor?.document.getText() ?? '';

    let logId = sf.extractLogIdFromText(text);
    if (!logId) {
      logId = await vscode.window.showInputBox({
        prompt: 'Enter the ApexLog Id (starts with 07L)',
        placeHolder: '07LXXXXXXXXXXXXXXX',
        validateInput: (v) => (/^07L[a-zA-Z0-9]{12,15}$/.test(v) ? null : 'Must be a valid 07L… Id')
      });
      if (!logId) return;
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Fetching user from Salesforce…' },
      async () => {
        try {
          const user = await sf.fetchUserForLogId(logId!);
          if (!user) { vscode.window.showWarningMessage('Could not find user for that log ID.'); return; }

          const userInfo = {
            Name: user.Name, Username: user.Username,
            Email: user.Email, ProfileName: user.Profile?.Name
          };
          vscode.window.showInformationMessage(
            `Executed by: ${user.Name} (${user.Username})${user.Profile?.Name ? ' — ' + user.Profile.Name : ''}`
          );
          if (currentAnalysis && currentPanel) {
            currentAnalysis.userInfo = userInfo;
            currentPanel.webview.html = renderAnalysisHtml(currentAnalysis);
          }
        } catch (e: any) {
          vscode.window.showErrorMessage(`Salesforce sync failed: ${e.message}`);
        }
      }
    );
  });

  context.subscriptions.push(analyzeCmd, syncCmd);
}

function openAnalysisPanel(context: vscode.ExtensionContext, analysis: Analysis, ai: AiService) {
  if (currentPanel) {
    currentPanel.webview.html = renderAnalysisHtml(analysis);
    currentPanel.reveal(vscode.ViewColumn.Beside);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'apexLogAnalysis',
    'Apex Log Analyzer by Aman',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  currentPanel = panel;
  panel.webview.html = renderAnalysisHtml(analysis);

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.command === 'syncUser') {
      vscode.commands.executeCommand('apexLogAnalyzer.syncUser');
    } else if (msg.command === 'explainAll') {
      if (!currentAnalysis) return;
      await ai.streamExplanation(
        currentAnalysis,
        undefined,
        (chunk) => panel.webview.postMessage({ command: 'aiChunk', text: chunk }),
        () => panel.webview.postMessage({ command: 'aiDone' }),
        (err) => panel.webview.postMessage({ command: 'aiError', error: err })
      );
    } else if (msg.command === 'explainIssue') {
      if (!currentAnalysis) return;
      const issue = currentAnalysis.issues[msg.index];
      if (!issue) return;
      await ai.streamExplanation(
        currentAnalysis,
        issue,
        (chunk) => panel.webview.postMessage({ command: 'aiChunk', text: chunk }),
        () => panel.webview.postMessage({ command: 'aiDone' }),
        (err) => panel.webview.postMessage({ command: 'aiError', error: err })
      );
    }
  });

  panel.onDidDispose(() => {
    currentPanel = undefined;
    currentAnalysis = undefined;
  });
}

export function deactivate() {
  currentPanel?.dispose();
}