import * as vscode from "vscode";
import * as path from "path";
import { Analysis, Issue } from "./analyzer";
import { tryTemplatedFix } from "./fixTemplates";

export const APPLY_FIX_COMMAND = "apexDoctor.applyIssueFix";

/**
 * Offers quick-fixes on `.cls` / `.trigger` files for issues found in the most
 * recent analysis. An action is only surfaced when a templated transform
 * actually applies to the open file at that line — so there are no false offers
 * and the lightbulb maps 1:1 to something we can really do.
 */
export class ApexFixActionProvider implements vscode.CodeActionProvider {
  static readonly providedKinds = [vscode.CodeActionKind.QuickFix];

  constructor(private getAnalysis: () => Analysis | undefined) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    const analysis = this.getAnalysis();
    if (!analysis || !this.isApexFile(document.uri)) {
      return [];
    }
    const className = path.basename(document.uri.fsPath).replace(/\.(cls|trigger)$/i, "");
    const fileText = document.getText();
    const actions: vscode.CodeAction[] = [];

    analysis.issues.forEach((issue, index) => {
      if (issue.lineNumber === undefined) {
        return;
      }
      // Apex log line numbers are 1-based; editor ranges are 0-based.
      const issueLine = issue.lineNumber - 1;
      if (issueLine < range.start.line - 1 || issueLine > range.end.line + 1) {
        return;
      }
      const fix = tryTemplatedFix({ issue, fileText, filePath: document.uri.fsPath });
      if (!fix) {
        return;
      }
      const action = new vscode.CodeAction(
        `Apex Doctor: ${fix.title}`,
        vscode.CodeActionKind.QuickFix,
      );
      action.command = {
        command: APPLY_FIX_COMMAND,
        title: fix.title,
        arguments: [index, className],
      };
      action.isPreferred = issue.type === "SOQL in Loop";
      actions.push(action);
    });

    return actions;
  }

  private isApexFile(uri: vscode.Uri): boolean {
    return /\.(cls|trigger)$/i.test(uri.fsPath);
  }
}

/**
 * Map an issue to a stable diagnostic `code` so the editor can correlate a
 * Problems-pane entry back to its analysis issue (used when wiring diagnostics).
 */
export function issueDiagnosticCode(issue: Issue, index: number): string {
  return `apexDoctor:${index}:${issue.type}`;
}
