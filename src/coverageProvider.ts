import * as vscode from "vscode";
import * as path from "path";
import { ClassCoverage, SalesforceService } from "./salesforceService";

const STATE_KEY = "apexDoctor.coverage";
const VISIBILITY_KEY = "apexDoctor.coverageVisible";

interface CoverageState {
  fetchedAt: string;
  classes: Record<string, ClassCoverage>;
}

export class CoverageProvider {
  private coveredDecoration: vscode.TextEditorDecorationType;
  private uncoveredDecoration: vscode.TextEditorDecorationType;
  private statusBarItem: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];
  private visible = true;

  constructor(
    private context: vscode.ExtensionContext,
    private sf: SalesforceService,
  ) {
    this.coveredDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: "rgba(34, 197, 94, 0.08)",
      isWholeLine: true,
      overviewRulerColor: "#22c55e",
      overviewRulerLane: vscode.OverviewRulerLane.Left,
      gutterIconPath: this.makeGutterIcon("#22c55e"),
      gutterIconSize: "60%",
    });
    this.uncoveredDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: "rgba(239, 68, 68, 0.08)",
      isWholeLine: true,
      overviewRulerColor: "#ef4444",
      overviewRulerLane: vscode.OverviewRulerLane.Left,
      gutterIconPath: this.makeGutterIcon("#ef4444"),
      gutterIconSize: "60%",
    });

    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      99,
    );
    this.statusBarItem.command = "apexDoctor.toggleCoverage";

    this.disposables.push(
      this.coveredDecoration,
      this.uncoveredDecoration,
      this.statusBarItem,
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.applyToEditor(editor);
        } else {
          this.statusBarItem.hide();
        }
      }),
      vscode.workspace.onDidOpenTextDocument(() => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          this.applyToEditor(editor);
        }
      }),
    );

    this.visible = context.workspaceState.get<boolean>(VISIBILITY_KEY, true);

    // Apply on the currently active editor at activation time
    if (vscode.window.activeTextEditor) {
      this.applyToEditor(vscode.window.activeTextEditor);
    }
  }

  /** Pull the latest coverage from the org and persist it to workspaceState. */
  async refresh(): Promise<void> {
    const classes = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Fetching Apex code coverage…",
      },
      async () => this.sf.fetchCoverage(),
    );
    const map: Record<string, ClassCoverage> = {};
    for (const c of classes) {
      if (c.className) {
        map[c.className] = c;
      }
    }
    const state: CoverageState = {
      fetchedAt: new Date().toISOString(),
      classes: map,
    };
    await this.context.workspaceState.update(STATE_KEY, state);
    vscode.window.showInformationMessage(
      `Coverage refreshed for ${classes.length} classes.`,
    );
    // Re-apply to all visible editors
    for (const ed of vscode.window.visibleTextEditors) {
      this.applyToEditor(ed);
    }
  }

  toggle(): void {
    this.visible = !this.visible;
    void this.context.workspaceState.update(VISIBILITY_KEY, this.visible);
    for (const ed of vscode.window.visibleTextEditors) {
      this.applyToEditor(ed);
    }
    vscode.window.showInformationMessage(
      `Coverage overlay ${this.visible ? "shown" : "hidden"}.`,
    );
  }

  applyToEditor(editor: vscode.TextEditor): void {
    if (!this.isApexClassFile(editor.document.uri)) {
      this.statusBarItem.hide();
      editor.setDecorations(this.coveredDecoration, []);
      editor.setDecorations(this.uncoveredDecoration, []);
      return;
    }
    const className = path.basename(editor.document.uri.fsPath, ".cls");
    const state = this.context.workspaceState.get<CoverageState>(STATE_KEY);
    const cov = state?.classes?.[className];

    if (!cov) {
      this.statusBarItem.hide();
      editor.setDecorations(this.coveredDecoration, []);
      editor.setDecorations(this.uncoveredDecoration, []);
      return;
    }

    if (!this.visible) {
      editor.setDecorations(this.coveredDecoration, []);
      editor.setDecorations(this.uncoveredDecoration, []);
    } else {
      const total = cov.numLinesCovered + cov.numLinesUncovered;
      const lineCount = editor.document.lineCount;
      const coveredRanges = cov.coveredLines
        .filter((line) => line >= 1 && line <= lineCount)
        .map((line) => new vscode.Range(line - 1, 0, line - 1, 0));
      const uncoveredRanges = cov.uncoveredLines
        .filter((line) => line >= 1 && line <= lineCount)
        .map((line) => new vscode.Range(line - 1, 0, line - 1, 0));
      editor.setDecorations(this.coveredDecoration, coveredRanges);
      editor.setDecorations(this.uncoveredDecoration, uncoveredRanges);
      void total; // total kept for future status-bar pct
    }

    const total = cov.numLinesCovered + cov.numLinesUncovered;
    const pct = total > 0 ? Math.round((cov.numLinesCovered / total) * 100) : 0;
    this.statusBarItem.text = `$(beaker) ${pct}% coverage`;
    this.statusBarItem.tooltip = new vscode.MarkdownString(
      `**${className}** — ${cov.numLinesCovered} / ${total} lines covered\n\nClick to toggle the overlay.`,
    );
    this.statusBarItem.show();
  }

  /**
   * Render a 1×16 PNG-ish dot in green/red for the gutter. We use an
   * inline data URI; VS Code renders these as image icons.
   */
  private makeGutterIcon(hex: string): vscode.Uri {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="16" viewBox="0 0 8 16">` +
      `<rect x="2" y="2" width="4" height="12" rx="1" fill="${hex}" opacity="0.85"/>` +
      `</svg>`;
    return vscode.Uri.parse(
      `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    );
  }

  private isApexClassFile(uri: vscode.Uri): boolean {
    return uri.fsPath.endsWith(".cls") || uri.fsPath.endsWith(".trigger");
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
