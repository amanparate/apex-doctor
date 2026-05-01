import * as vscode from "vscode";
import { detectRecurringPatterns, RecurringIssuePattern, RecurringSoqlPattern, MetricTrend } from "./recurringPatterns";
import { loadHistory } from "./recentHistory";

type RecurringNode =
  | { kind: "section"; label: string; children: RecurringNode[] }
  | { kind: "issue"; data: RecurringIssuePattern }
  | { kind: "soql"; data: RecurringSoqlPattern }
  | { kind: "trend"; data: MetricTrend }
  | { kind: "empty"; label: string };

export class RecurringIssuesProvider
  implements vscode.TreeDataProvider<RecurringNode>
{
  private readonly _emitter = new vscode.EventEmitter<
    RecurringNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._emitter.event;

  constructor(private context: vscode.ExtensionContext) {}

  refresh(): void {
    this._emitter.fire();
  }

  getTreeItem(node: RecurringNode): vscode.TreeItem {
    if (node.kind === "section") {
      const item = new vscode.TreeItem(
        node.label,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.contextValue = "section";
      return item;
    }
    if (node.kind === "empty") {
      const item = new vscode.TreeItem(node.label);
      item.iconPath = new vscode.ThemeIcon("info");
      return item;
    }
    if (node.kind === "issue") {
      const item = new vscode.TreeItem(`×${node.data.occurrences} · ${node.data.type}`);
      item.description = node.data.lineNumber ? `line ${node.data.lineNumber}` : "";
      item.tooltip = new vscode.MarkdownString(
        `**${node.data.type}** (×${node.data.occurrences})\n\n` +
          `${node.data.message}\n\n` +
          `First seen: ${node.data.firstSeen}\n\n` +
          `Last seen: ${node.data.lastSeen}`,
      );
      item.iconPath = new vscode.ThemeIcon(
        node.data.severity === "critical" ? "error" : node.data.severity === "warning" ? "warning" : "info",
      );
      return item;
    }
    if (node.kind === "soql") {
      const item = new vscode.TreeItem(
        node.data.pattern.length > 60
          ? node.data.pattern.slice(0, 57) + "…"
          : node.data.pattern,
      );
      item.description = `${node.data.logCount} logs · ${node.data.totalRows} rows total`;
      item.tooltip = new vscode.MarkdownString(
        `**Recurring SOQL**\n\n\`${node.data.pattern}\`\n\n` +
          `Seen in ${node.data.logCount} of the recent analyses · ` +
          `${node.data.occurrences} executions · ${node.data.totalRows} total rows`,
      );
      item.iconPath = new vscode.ThemeIcon("database");
      return item;
    }
    if (node.kind === "trend") {
      const arrow =
        node.data.direction === "regressing"
          ? "↗"
          : node.data.direction === "improving"
            ? "↘"
            : "→";
      const friendly: Record<MetricTrend["metric"], string> = {
        soqlCount: "SOQL count",
        dmlCount: "DML count",
        totalDurationMs: "Total runtime",
        errorCount: "Errors",
      };
      const label = `${arrow} ${friendly[node.data.metric]}`;
      const desc = `${node.data.baseline.toFixed(1)} → ${node.data.recent.toFixed(1)} (${node.data.deltaPct >= 0 ? "+" : ""}${node.data.deltaPct.toFixed(1)}%)`;
      const item = new vscode.TreeItem(label);
      item.description = desc;
      item.iconPath = new vscode.ThemeIcon(
        node.data.direction === "regressing"
          ? "graph-line"
          : node.data.direction === "improving"
            ? "graph-line"
            : "dash",
      );
      return item;
    }
    return new vscode.TreeItem("");
  }

  getChildren(node?: RecurringNode): RecurringNode[] {
    if (!node) {
      return this.buildSections();
    }
    if (node.kind === "section") {
      return node.children;
    }
    return [];
  }

  private buildSections(): RecurringNode[] {
    const history = loadHistory(this.context);
    const patterns = detectRecurringPatterns(history);

    if (!history.length) {
      return [
        {
          kind: "empty",
          label: "Run a few analyses to start seeing patterns",
        },
      ];
    }

    const sections: RecurringNode[] = [];

    sections.push({
      kind: "section",
      label: `Recurring issues (${patterns.issues.length})`,
      children: patterns.issues.length
        ? patterns.issues.map((data) => ({ kind: "issue", data }))
        : [{ kind: "empty", label: "No issue has recurred 3+ times yet" }],
    });

    sections.push({
      kind: "section",
      label: `Recurring SOQL (${patterns.soql.length})`,
      children: patterns.soql.length
        ? patterns.soql.map((data) => ({ kind: "soql", data }))
        : [{ kind: "empty", label: "No SOQL pattern recurs across 3+ logs" }],
    });

    if (patterns.trends.length) {
      sections.push({
        kind: "section",
        label: "Trends",
        children: patterns.trends.map((data) => ({ kind: "trend", data })),
      });
    }

    return sections;
  }
}
