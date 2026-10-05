import * as vscode from "vscode";

const sampleUris = new Set<string>();
let closeListenerRegistered = false;

/** True if this document was opened via "Try with Sample Log". */
export function isSampleUri(uri: vscode.Uri): boolean {
  return sampleUris.has(uri.toString());
}

/**
 * Opens the bundled sample log as an untitled document (so the installed
 * extension folder is never modified) and runs the normal analysis on it.
 */
export async function openSampleLog(
  context: vscode.ExtensionContext,
): Promise<void> {
  // Lazy-register the close listener so sampleUris doesn't grow forever and
  // a reused untitled URI isn't still flagged as "sample" after the user
  // closes the tab.
  if (!closeListenerRegistered) {
    closeListenerRegistered = true;
    context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        sampleUris.delete(doc.uri.toString());
      }),
    );
  }

  const fileUri = vscode.Uri.joinPath(
    context.extensionUri,
    "media",
    "sample.log",
  );
  let content: string;
  try {
    const bytes = await vscode.workspace.fs.readFile(fileUri);
    content = new TextDecoder("utf-8").decode(bytes);
  } catch {
    vscode.window.showErrorMessage(
      "Apex Doctor: the bundled sample log could not be found.",
    );
    return;
  }

  const doc = await vscode.workspace.openTextDocument({
    content,
    language: "log",
  });
  sampleUris.add(doc.uri.toString());
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.One,
    preview: false,
  });
  // If analyze fails it surfaces its own error popup, so don't follow up
  // with a "try the Profiler tab" message that would just confuse the user.
  try {
    await vscode.commands.executeCommand("apexDoctor.analyze");
  } catch {
    return;
  }

  vscode.window.showInformationMessage(
    "This is a bundled sample log — no org needed. Try the Profiler tab, the 🔧 Suggest fix button, or 🤖 Explain root cause.",
  );
}
