import * as vscode from "vscode";
import { Analysis } from "./analyzer";
import { formatBytes } from "./heapProfiler";

type Node =
  | { kind: "section"; label: string; children: Node[] }
  | { kind: "issue"; label: string; description: string; severity: string; line?: number }
  | { kind: "metric"; label: string; description: string; icon: string }
  | { kind: "empty"; label: string };

/**
 * A compact outline of the *currently open* analysis — issues, the hottest
 * method, and the biggest allocator — shown in the Apex Doctor activity-bar
 * sidebar. Fed from the extension's `currentAnalysis` global via a getter.
 */
export class CurrentAnalysisProvider implements vscode.TreeDataProvider<Node> {
  private readonly _emitter = new vscode.EventEmitter<Node | undefined | void>();
  readonly onDidChangeTreeData = this._emitter.event;

  constructor(private getAnalysis: () => Analysis | undefined) {}

  refresh(): void {
    this._emitter.fire();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "section") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = "section";
      return item;
    }
    if (node.kind === "empty") {
      const item = new vscode.TreeItem(node.label);
      item.iconPath = new vscode.ThemeIcon("info");
      return item;
    }
    if (node.kind === "metric") {
      const item = new vscode.TreeItem(node.label);
      item.description = node.description;
      item.iconPath = new vscode.ThemeIcon(node.icon);
      return item;
    }
    // issue
    const item = new vscode.TreeItem(node.label);
    item.description = node.description;
    item.iconPath = new vscode.ThemeIcon(
      node.severity === "fatal" || node.severity === "error"
        ? "error"
        : node.severity === "warning"
          ? "warning"
          : "info",
    );
    if (node.line !== undefined) {
      item.command = {
        command: "apexDoctor.jumpToLogLine",
        title: "Jump to line",
        arguments: [node.line],
      };
    }
    return item;
  }

  getChildren(node?: Node): Node[] {
    if (node) {
      return node.kind === "section" ? node.children : [];
    }
    const a = this.getAnalysis();
    if (!a) {
      return [{ kind: "empty", label: "Analyse a log to see its outline here" }];
    }

    const sections: Node[] = [];

    // Issues
    const issueNodes: Node[] = a.issues.length
      ? a.issues.slice(0, 25).map((i) => ({
          kind: "issue" as const,
          label: i.type,
          description: i.lineNumber ? `line ${i.lineNumber}` : "",
          severity: i.severity,
          line: i.lineNumber,
        }))
      : [{ kind: "empty", label: "No issues detected 🎉" }];
    sections.push({ kind: "section", label: `Issues (${a.issues.length})`, children: issueNodes });

    // Hotspots
    const hotspots: Node[] = [];
    const hotLeaf = a.cpuProfile?.hotLeaf;
    if (hotLeaf) {
      hotspots.push({
        kind: "metric",
        label: hotLeaf.name,
        description: `${hotLeaf.selfMs.toFixed(0)} ms self · CPU hotspot`,
        icon: "flame",
      });
    }
    const topAlloc = a.heapProfile?.topAllocator;
    if (topAlloc) {
      hotspots.push({
        kind: "metric",
        label: topAlloc.name,
        description: `${formatBytes(topAlloc.bytes)} · biggest allocator`,
        icon: "database",
      });
    }
    if (hotspots.length) {
      sections.push({ kind: "section", label: "Hotspots", children: hotspots });
    }

    // Summary
    sections.push({
      kind: "section",
      label: "Summary",
      children: [
        { kind: "metric", label: "Duration", description: `${a.summary.totalDurationMs.toFixed(0)} ms`, icon: "watch" },
        { kind: "metric", label: "SOQL", description: `${a.soql.length}`, icon: "database" },
        { kind: "metric", label: "DML", description: `${a.dml.length}`, icon: "edit" },
      ],
    });

    return sections;
  }
}
