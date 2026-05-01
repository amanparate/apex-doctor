import * as vscode from "vscode";
import * as path from "path";
import * as fsPromises from "fs/promises";
import { Issue } from "./analyzer";
import { AiService } from "./aiService";
import { ApexClassResolver } from "./apexClassResolver";
import { tryTemplatedFix, TemplateFix } from "./fixTemplates";

export interface AppliedFix {
  fileUri: vscode.Uri;
  source: "templated" | "ai";
  title: string;
}

/**
 * Orchestrate the "Suggest fix" flow:
 *   1. Find the source class for the issue's `lineNumber`
 *   2. Try a templated transform first (fast, deterministic)
 *   3. Fall back to AI for the long tail
 *   4. Open a diff preview, let the user decide whether to apply
 */
export async function suggestFixForIssue(
  issue: Issue,
  classNameHint: string | undefined,
  ai: AiService,
  classResolver: ApexClassResolver,
): Promise<AppliedFix | undefined> {
  if (!classResolver.isSfdxProject()) {
    vscode.window.showWarningMessage(
      "Suggest Fix needs an SFDX project (sfdx-project.json) so we can read the source class.",
    );
    return undefined;
  }

  const className = classNameHint || guessClassNameFromIssue(issue);
  if (!className) {
    vscode.window.showWarningMessage(
      "Couldn't infer the source class for this issue. Open the .cls file you want to fix and try from there.",
    );
    return undefined;
  }

  const loc = await classResolver.resolve(className);
  if (!loc) {
    vscode.window.showWarningMessage(
      `Couldn't find ${className}.cls in the workspace. Run "Apex Doctor: Retrieve Class" first or open the file manually.`,
    );
    return undefined;
  }

  const fileUri = loc.uri;
  const fileText = await fsPromises.readFile(fileUri.fsPath, "utf8");

  // 1) Try templated fix
  const templated = tryTemplatedFix({ issue, fileText, filePath: fileUri.fsPath });
  if (templated) {
    return await previewAndMaybeApply(fileUri, fileText, templated);
  }

  // 2) Fall back to AI
  const aiFix = await generateAiFix(issue, fileText, ai);
  if (!aiFix) {
    vscode.window.showWarningMessage(
      "AI could not generate a confident fix for this issue. Check the issue details and try editing manually.",
    );
    return undefined;
  }
  return await previewAndMaybeApply(fileUri, fileText, aiFix);
}

/** Open a side-by-side diff and ask the user whether to apply. */
async function previewAndMaybeApply(
  fileUri: vscode.Uri,
  originalText: string,
  fix: TemplateFix,
): Promise<AppliedFix | undefined> {
  if (fix.newFileText === originalText) {
    vscode.window.showInformationMessage("No change suggested.");
    return undefined;
  }

  // Stage the proposed text in an untitled URI so we can show a real diff.
  const proposedUri = vscode.Uri.parse(
    `apexdoctor-fix:${path.basename(fileUri.fsPath)}.suggested.cls?${Date.now()}`,
  );
  registerFixContent(proposedUri, fix.newFileText);

  await vscode.commands.executeCommand(
    "vscode.diff",
    fileUri,
    proposedUri,
    `${path.basename(fileUri.fsPath)} ↔ ${fix.title}`,
    { preview: true },
  );

  const choice = await vscode.window.showInformationMessage(
    `Apex Doctor suggests: ${fix.title}\n\n${fix.rationale}`,
    { modal: true },
    "Apply fix",
    "Cancel",
  );
  if (choice !== "Apply fix") {
    return undefined;
  }

  const edit = new vscode.WorkspaceEdit();
  const doc = await vscode.workspace.openTextDocument(fileUri);
  edit.replace(
    fileUri,
    new vscode.Range(0, 0, doc.lineCount, 0),
    fix.newFileText,
  );
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) {
    vscode.window.showErrorMessage("Failed to apply the fix.");
    return undefined;
  }
  await doc.save();
  vscode.window.showInformationMessage(`Applied: ${fix.title}`);

  return { fileUri, source: fix.source, title: fix.title };
}

async function generateAiFix(
  issue: Issue,
  fileText: string,
  ai: AiService,
): Promise<TemplateFix | undefined> {
  const lines = fileText.split(/\r?\n/);
  const issueLine = (issue.lineNumber ?? 0) - 1;
  const start = Math.max(0, issueLine - 20);
  const end = Math.min(lines.length, issueLine + 20);
  const snippet = lines.slice(start, end).join("\n");

  const prompt = [
    "You are a senior Salesforce Apex developer. The user has a flagged issue in their code and wants you to rewrite the surrounding code to fix it.",
    "",
    `ISSUE: [${issue.severity}] ${issue.type} at line ${issue.lineNumber ?? "?"}`,
    issue.message,
    issue.context ? `CONTEXT: ${issue.context}` : "",
    "",
    "ORIGINAL FILE:",
    "```apex",
    fileText,
    "```",
    "",
    `RELEVANT WINDOW (lines ${start + 1}–${end}):`,
    "```apex",
    snippet,
    "```",
    "",
    "Rewrite the FULL file to fix the issue. Return ONLY the new file content inside a single ```apex code block — no explanation, no comments outside the code. Preserve all unrelated code unchanged.",
  ].join("\n");

  const fullText = await ai.completeOnce(prompt);
  if (!fullText) {
    return undefined;
  }
  const codeMatch = fullText.match(/```(?:apex|java)?\s*\n([\s\S]+?)\n```/i);
  const newFileText = codeMatch ? codeMatch[1] : fullText.trim();
  if (!newFileText || newFileText === fileText) {
    return undefined;
  }
  return {
    title: `AI fix for ${issue.type}`,
    rationale: `Generated by your configured LLM provider. Always review the diff before applying.`,
    newFileText,
    source: "ai",
  };
}

function guessClassNameFromIssue(issue: Issue): string | undefined {
  if (issue.stackFrames && issue.stackFrames.length) {
    return issue.stackFrames[0].className;
  }
  // Try the issue context: many of our heuristics include a class hint.
  const m =
    issue.context?.match(/\b([A-Z][A-Za-z0-9_]*)\.\w+/) ??
    issue.message.match(/\b([A-Z][A-Za-z0-9_]*)\.\w+/);
  return m?.[1];
}

/**
 * Provider that serves the in-memory "suggested" file content over the
 * `apexdoctor-fix:` URI scheme so VS Code's diff viewer can read it.
 */
export class FixDiffContentProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): string {
    return contentByUri.get(uri.toString()) ?? "";
  }
}

const contentByUri = new Map<string, string>();

function registerFixContent(uri: vscode.Uri, content: string): void {
  contentByUri.set(uri.toString(), content);
  // Keep the cache from growing unbounded — drop after 5 minutes.
  setTimeout(() => contentByUri.delete(uri.toString()), 5 * 60_000);
}
