import * as vscode from "vscode";

const COUNT_KEY = "apexDoctor.review.analysisCount";
const NEXT_KEY = "apexDoctor.review.nextPromptAt";
const DONE_KEY = "apexDoctor.review.done";

const FIRST_PROMPT_AT = 5;
const SNOOZE_BY = 20;

const MARKETPLACE_URL =
  "https://marketplace.visualstudio.com/items?itemName=AmanParate.apex-doctor&ssr=false#review-details";
const OPEN_VSX_URL = "https://open-vsx.org/extension/amanparate/apex-doctor";

/** Call once in activate() so the "done" flag syncs across the user's machines. */
export function registerReviewState(context: vscode.ExtensionContext): void {
  context.globalState.setKeysForSync([DONE_KEY]);
}

function reviewUrl(): string {
  return vscode.env.appName.includes("Visual Studio Code")
    ? MARKETPLACE_URL
    : OPEN_VSX_URL;
}

// Serialise the globalState read/update sequence so two near-simultaneous
// analyses can't both read the same count and both prompt.
let inFlight: Promise<void> = Promise.resolve();

/** Call after every successful analysis of a real (non-sample) log. Never awaited by callers. */
export function maybeAskForReview(
  context: vscode.ExtensionContext,
): Promise<void> {
  inFlight = inFlight.then(() => maybeAskForReviewImpl(context));
  return inFlight;
}

async function maybeAskForReviewImpl(
  context: vscode.ExtensionContext,
): Promise<void> {
  if (context.globalState.get<boolean>(DONE_KEY)) {
    return;
  }

  const count = (context.globalState.get<number>(COUNT_KEY) ?? 0) + 1;
  await context.globalState.update(COUNT_KEY, count);

  const promptAt = context.globalState.get<number>(NEXT_KEY) ?? FIRST_PROMPT_AT;
  if (count < promptAt) {
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    `You've analysed ${count} logs with Apex Doctor 🩺 If it's saving you time, a quick rating helps other Salesforce devs find it.`,
    "Rate Apex Doctor",
    "Maybe later",
    "Don't ask again",
  );

  if (choice === "Rate Apex Doctor") {
    await vscode.env.openExternal(vscode.Uri.parse(reviewUrl()));
    await context.globalState.update(DONE_KEY, true);
  } else if (choice === "Don't ask again") {
    await context.globalState.update(DONE_KEY, true);
  } else {
    // "Maybe later" or dismissed
    await context.globalState.update(NEXT_KEY, count + SNOOZE_BY);
  }
}
