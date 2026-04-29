import * as vscode from "vscode";
import { Analysis } from "./analyzer";

const STATE_KEY = "apexDoctor.recentAnalyses";
const MAX_ENTRIES = 10;

export interface RecentAnalysisEntry {
  id: string;
  label: string;
  savedAt: string;
  source: string;
  totalDurationMs: number;
  soqlCount: number;
  dmlCount: number;
  errorCount: number;
  warningCount: number;
  analysis: Analysis;
}

function stripFlame(analysis: Analysis): Analysis {
  return {
    ...analysis,
    flameRoot: {
      ...analysis.flameRoot,
      children: [],
    },
  };
}

export function saveAnalysisToHistory(
  context: vscode.ExtensionContext,
  uri: vscode.Uri,
  analysis: Analysis,
): void {
  const filename = uri.fsPath.split("/").pop() || uri.fsPath;
  const errorCount = analysis.issues.filter(
    (i) => i.severity === "fatal" || i.severity === "error",
  ).length;
  const warningCount = analysis.issues.filter(
    (i) => i.severity === "warning",
  ).length;
  const entry: RecentAnalysisEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: filename,
    savedAt: new Date().toISOString(),
    source: uri.fsPath,
    totalDurationMs: analysis.summary.totalDurationMs,
    soqlCount: analysis.soql.length,
    dmlCount: analysis.dml.length,
    errorCount,
    warningCount,
    analysis: stripFlame(analysis),
  };

  const existing =
    context.workspaceState.get<RecentAnalysisEntry[]>(STATE_KEY, []) || [];
  const next = [entry, ...existing].slice(0, MAX_ENTRIES);
  void context.workspaceState.update(STATE_KEY, next);
}

export function loadHistory(
  context: vscode.ExtensionContext,
): RecentAnalysisEntry[] {
  return context.workspaceState.get<RecentAnalysisEntry[]>(STATE_KEY, []) || [];
}

export function clearHistory(context: vscode.ExtensionContext): void {
  void context.workspaceState.update(STATE_KEY, []);
}

export function removeEntry(
  context: vscode.ExtensionContext,
  id: string,
): void {
  const remaining = loadHistory(context).filter((e) => e.id !== id);
  void context.workspaceState.update(STATE_KEY, remaining);
}

export class RecentAnalysesProvider
  implements vscode.TreeDataProvider<RecentAnalysisEntry>
{
  private readonly _emitter = new vscode.EventEmitter<
    RecentAnalysisEntry | undefined | void
  >();
  readonly onDidChangeTreeData = this._emitter.event;

  constructor(private context: vscode.ExtensionContext) {}

  refresh(): void {
    this._emitter.fire();
  }

  getTreeItem(entry: RecentAnalysisEntry): vscode.TreeItem {
    const item = new vscode.TreeItem(entry.label);
    const ts = new Date(entry.savedAt);
    const ago = formatRelative(ts);
    item.description = `${entry.totalDurationMs.toFixed(0)} ms · ${entry.soqlCount} SOQL · ${ago}`;
    item.tooltip = new vscode.MarkdownString(
      `**${entry.label}**\n\n` +
        `- Saved: ${ts.toLocaleString()}\n` +
        `- Total duration: ${entry.totalDurationMs.toFixed(2)} ms\n` +
        `- SOQL: ${entry.soqlCount}\n` +
        `- DML: ${entry.dmlCount}\n` +
        `- Errors: ${entry.errorCount}\n` +
        `- Warnings: ${entry.warningCount}\n` +
        `- Source: ${entry.source}`,
    );
    item.iconPath = new vscode.ThemeIcon(
      entry.errorCount > 0
        ? "error"
        : entry.warningCount > 0
          ? "warning"
          : "pass",
    );
    item.contextValue = "apexDoctor.recentEntry";
    item.command = {
      command: "apexDoctor.openRecent",
      title: "Open analysis",
      arguments: [entry.id],
    };
    return item;
  }

  getChildren(): RecentAnalysisEntry[] {
    return loadHistory(this.context);
  }
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) { return "just now"; }
  const min = Math.round(sec / 60);
  if (min < 60) { return `${min}m ago`; }
  const hr = Math.round(min / 60);
  if (hr < 24) { return `${hr}h ago`; }
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}
