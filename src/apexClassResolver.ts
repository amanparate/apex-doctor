import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface ClassLocation {
  uri: vscode.Uri;
  line?: number;
}

export class ApexClassResolver {
  private cache: Map<string, ClassLocation | null> = new Map();
  private sfdxRoot: string | undefined;
  private packageDirs: string[] | undefined;

  constructor() {
    this.initSfdxRoot();
  }

  private initSfdxRoot() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) { return; }

    for (const folder of folders) {
      const projectFile = path.join(folder.uri.fsPath, 'sfdx-project.json');
      if (fs.existsSync(projectFile)) {
        this.sfdxRoot = folder.uri.fsPath;
        try {
          const manifest = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
          this.packageDirs = (manifest.packageDirectories || [])
            .map((pd: { path: string }) => path.join(this.sfdxRoot!, pd.path));
        } catch {
          this.packageDirs = [path.join(this.sfdxRoot, 'force-app')];
        }
        return;
      }
    }
  }

  isSfdxProject(): boolean {
    return !!this.sfdxRoot;
  }

  async resolve(className: string): Promise<ClassLocation | null> {
    if (!this.sfdxRoot) { return null; }
    if (this.cache.has(className)) { return this.cache.get(className) ?? null; }

    const fileName = `${className}.cls`;
    const candidates: string[] = [];
    for (const dir of this.packageDirs || []) {
      candidates.push(path.join(dir, 'main', 'default', 'classes', fileName));
      candidates.push(path.join(dir, 'classes', fileName));
    }
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        const loc = { uri: vscode.Uri.file(candidate) };
        this.cache.set(className, loc);
        return loc;
      }
    }

    const matches = await vscode.workspace.findFiles(
      `**/classes/${fileName}`,
      '**/node_modules/**',
      1
    );
    if (matches.length) {
      const loc = { uri: matches[0] };
      this.cache.set(className, loc);
      return loc;
    }

    this.cache.set(className, null);
    return null;
  }

  extractClassName(methodFullName: string): string | undefined {
    if (!methodFullName) { return undefined; }
    if (/[\s(]/.test(methodFullName) && !methodFullName.includes('.')) { return undefined; }
    const firstSegment = methodFullName.split('.')[0];
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(firstSegment)) { return undefined; }
    return firstSegment;
  }

  async open(location: ClassLocation, line?: number): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(location.uri);
    const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
    if (line && line > 0) {
      const pos = new vscode.Position(Math.max(0, line - 1), 0);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      editor.selection = new vscode.Selection(pos, pos);
    }
  }

  clearCache() {
    this.cache.clear();
  }
}