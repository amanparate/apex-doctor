import * as vscode from 'vscode';
import { ApexLogParser } from './parser';
import { ApexLogAnalyzer, Analysis } from './analyzer';
import { SalesforceService, ApexLogRecord } from './salesforceService';
import { AiService } from './aiService';
import { renderAnalysisHtml } from './webview';

let currentPanel: vscode.WebviewPanel | undefined;
let currentAnalysis: Analysis | undefined;
let currentLogUri: vscode.Uri | undefined;

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

    await analyzeText(context, text, editor.document.uri, parser, analyzer, ai);
  });

  const fetchLogCmd = vscode.commands.registerCommand('apexLogAnalyzer.fetchLog', async () => {
    try {
      const logs = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Fetching logs from Salesforce…' },
        async () => sf.listRecentLogs(20)
      );

      if (!logs.length) {
        vscode.window.showWarningMessage('No Apex logs found in the default org.');
        return;
      }

      const picked = await showLogPicker(logs);
      if (!picked) {return;}

      const filePath = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Downloading log ${picked.Id}…` },
        async () => sf.downloadLog(picked.Id)
      );

      const uri = vscode.Uri.file(filePath);

      // Close any already-open tab for this file to avoid stale cached docs
      for (const tabGroup of vscode.window.tabGroups.all) {
        for (const tab of tabGroup.tabs) {
          const input = tab.input as { uri?: vscode.Uri } | undefined;
          if (input?.uri?.fsPath === uri.fsPath) {
            await vscode.window.tabGroups.close(tab);
          }
        }
      }

      const fs = await import('fs');
      const freshText = fs.readFileSync(filePath, 'utf8');

      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.One,
        preview: false,
        preserveFocus: false
      });

      // Analyse first so the panel renders, then fetch user info and update
      await analyzeText(context, freshText, uri, parser, analyzer, ai);

      // Auto-fetch user info in the background (don't block the UI)
      sf.fetchUserForLogId(picked.Id).then((user) => {
        if (!user || !currentAnalysis || !currentPanel) {return;}
        currentAnalysis.userInfo = {
          Name: user.Name,
          Username: user.Username,
          Email: user.Email,
          ProfileName: user.Profile?.Name
        };
        currentPanel.webview.html = renderAnalysisHtml(currentAnalysis);
      }).catch(() => {
        // silent — user info is a nice-to-have, not critical
      });
    } catch (e: any) {
      vscode.window.showErrorMessage(`Fetch failed: ${e.message}`);
    }
  });


  const exportCmd = vscode.commands.registerCommand('apexLogAnalyzer.exportMarkdown', async () => {
    if (!currentAnalysis) {
      vscode.window.showWarningMessage('No analysis to export. Analyse a log first.');
      return;
    }
    const md = buildMarkdownReport(currentAnalysis, '');
    await vscode.env.clipboard.writeText(md);
    vscode.window.showInformationMessage('Analysis copied to clipboard as Markdown.');
  });

  context.subscriptions.push(analyzeCmd, fetchLogCmd, exportCmd);
}

async function showLogPicker(logs: ApexLogRecord[]): Promise<ApexLogRecord | undefined> {
  const items = logs.map((log) => ({
    label: `$(file-code) ${log.Operation || 'Anonymous'}`,
    description: `${log.DurationMilliseconds}ms · ${log.Status}`,
    detail: `${log.Id} · ${log.LogUser?.Name ?? 'Unknown'} · ${new Date(log.StartTime).toLocaleString()} · ${(log.LogLength / 1024).toFixed(1)} KB`,
    log
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select an Apex log',
    matchOnDescription: true,
    matchOnDetail: true
  });
  return picked?.log;
}

async function analyzeText(
  context: vscode.ExtensionContext,
  text: string,
  uri: vscode.Uri,
  parser: ApexLogParser,
  analyzer: ApexLogAnalyzer,
  ai: AiService
) {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Analysing Apex log…' },
    async () => {
      const parsed = parser.parse(text);
      const analysis = analyzer.analyze(parsed);

      // If switching to a different log, dispose the old panel so we get fresh state
      if (currentPanel && currentLogUri?.fsPath !== uri.fsPath) {
        currentPanel.dispose();
        // disposal handler will clear currentPanel / currentAnalysis
      }

      currentAnalysis = analysis;
      currentLogUri = uri;
      openAnalysisPanel(context, analysis, ai);
    }
  );
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
    if (msg.command === 'explainAll') {
      if (!currentAnalysis) {return;}
      await ai.streamExplanation(
        currentAnalysis,
        undefined,
        (chunk) => panel.webview.postMessage({ command: 'aiChunk', text: chunk }),
        () => panel.webview.postMessage({ command: 'aiDone' }),
        (err) => panel.webview.postMessage({ command: 'aiError', error: err })
      );
    } else if (msg.command === 'explainIssue') {
      if (!currentAnalysis) {return;}
      const issue = currentAnalysis.issues[msg.index];
      if (!issue) {return;}
      await ai.streamExplanation(
        currentAnalysis,
        issue,
        (chunk) => panel.webview.postMessage({ command: 'aiChunk', text: chunk }),
        () => panel.webview.postMessage({ command: 'aiDone' }),
        (err) => panel.webview.postMessage({ command: 'aiError', error: err })
      );
    } else if (msg.command === 'jumpToLine') {
      await jumpToLogLine(msg.line);
    } else if (msg.command === 'exportMarkdown') {
      if (!currentAnalysis) {return;}
      const md = buildMarkdownReport(currentAnalysis, msg.aiText || '');
      await vscode.env.clipboard.writeText(md);
      vscode.window.showInformationMessage('Analysis copied to clipboard as Markdown.');
    }
  });

  panel.onDidDispose(() => {
    currentPanel = undefined;
    currentAnalysis = undefined;
    currentLogUri = undefined;
  });
}

/** Reveal a given 1-based line number in the current log document. */
async function jumpToLogLine(line: number) {
  if (!currentLogUri) {return;}
  try {
    const doc = await vscode.workspace.openTextDocument(currentLogUri);
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    // Line numbers in Apex logs refer to Apex class line numbers, not log-file lines.
    // Best effort: search the log for "|[<line>]|" and reveal that line in the log file.
    const marker = `|[${line}]|`;
    const text = doc.getText();
    const idx = text.indexOf(marker);
    if (idx >= 0) {
      const pos = doc.positionAt(idx);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      editor.selection = new vscode.Selection(pos, pos);
    } else {
      vscode.window.showInformationMessage(`No [${line}] marker in the log.`);
    }
  } catch (e: any) {
    vscode.window.showErrorMessage(`Could not jump to line: ${e.message}`);
  }
}

function buildMarkdownReport(a: Analysis, aiText: string): string {
  const fmt = (n?: number) => (n ?? 0).toFixed(2);
  const lines: string[] = [];
  lines.push(`# Apex Log Analysis`);
  lines.push('');
  lines.push(`*Generated by Apex Log Analyzer by Aman*`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push('');
  lines.push(`- **API Version:** ${a.summary.apiVersion}`);
  lines.push(`- **Total Duration:** ${fmt(a.summary.totalDurationMs)} ms`);
  lines.push(`- **SOQL Queries:** ${a.soql.length}`);
  lines.push(`- **DML Operations:** ${a.dml.length}`);
  lines.push(`- **Errors:** ${a.issues.filter(i => i.severity === 'fatal' || i.severity === 'error').length}`);
  lines.push(`- **Warnings:** ${a.issues.filter(i => i.severity === 'warning').length}`);
  lines.push(`- **Debug Statements:** ${a.debugs.length}`);
  if (a.userInfo) {
    lines.push(`- **Executed by:** ${a.userInfo.Name} (${a.userInfo.Username}) — ${a.userInfo.ProfileName ?? 'No profile'}`);
  }
  lines.push('');

  if (a.issues.length) {
    lines.push(`## Issues`);
    lines.push('');
    for (const i of a.issues) {
      lines.push(`### [${i.severity.toUpperCase()}] ${i.type}${i.lineNumber ? ` (line ${i.lineNumber})` : ''}`);
      lines.push('');
      lines.push('```');
      lines.push(i.message);
      lines.push('```');
      if (i.context) {lines.push(`> ${i.context}`);}
      lines.push('');
    }
  }

  if (aiText) {
    lines.push(`## AI Root-Cause Analysis`);
    lines.push('');
    lines.push(aiText);
    lines.push('');
  }

  if (a.methods.length) {
    lines.push(`## Slowest Methods`);
    lines.push('');
    lines.push(`| Method | Duration (ms) | Line |`);
    lines.push(`|---|---|---|`);
    for (const m of a.methods.slice(0, 20)) {
      lines.push(`| \`${m.name}\` | ${fmt(m.durationMs)} | ${m.lineNumber ?? '-'} |`);
    }
    lines.push('');
  }

  if (a.soql.length) {
    lines.push(`## SOQL Queries`);
    lines.push('');
    lines.push(`| # | Duration (ms) | Rows | Line | Query |`);
    lines.push(`|---|---|---|---|---|`);
    a.soql.forEach((q, i) => {
      lines.push(`| ${i + 1} | ${fmt(q.durationMs)} | ${q.rows ?? '-'} | ${q.lineNumber ?? '-'} | \`${q.query.replace(/\|/g, '\\|')}\` |`);
    });
    lines.push('');
  }

  if (a.dml.length) {
    lines.push(`## DML Operations`);
    lines.push('');
    lines.push(`| # | Op | Rows | Duration (ms) | Line |`);
    lines.push(`|---|---|---|---|---|`);
    a.dml.forEach((d, i) => {
      lines.push(`| ${i + 1} | ${d.operation} | ${d.rows ?? '-'} | ${fmt(d.durationMs)} | ${d.lineNumber ?? '-'} |`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

export function deactivate() {
  currentPanel?.dispose();
}