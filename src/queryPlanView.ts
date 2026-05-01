import * as vscode from "vscode";
import { QueryPlan, QueryPlanResponse, SalesforceService } from "./salesforceService";

let currentPanel: vscode.WebviewPanel | undefined;

/**
 * Open (or reuse) a panel showing the query plan for `query`.
 */
export async function showQueryPlan(
  query: string,
  sf: SalesforceService,
): Promise<void> {
  if (!currentPanel) {
    currentPanel = vscode.window.createWebviewPanel(
      "apexDoctor.queryPlan",
      "🔎 SOQL Query Plan",
      vscode.ViewColumn.Beside,
      { enableScripts: false, retainContextWhenHidden: true },
    );
    currentPanel.onDidDispose(() => {
      currentPanel = undefined;
    });
  } else {
    currentPanel.reveal(vscode.ViewColumn.Beside);
  }

  currentPanel.webview.html = renderLoading(query);

  try {
    const response = await sf.explainQuery(query);
    currentPanel.webview.html = renderPlan(query, response);
  } catch (e: any) {
    currentPanel.webview.html = renderError(query, e.message || String(e));
  }
}

function renderLoading(query: string): string {
  return shell(`
    <h1>🔎 Query Plan</h1>
    <pre class="query">${esc(query)}</pre>
    <p class="muted">Running Salesforce Query Plan tool…</p>
  `);
}

function renderError(query: string, msg: string): string {
  return shell(`
    <h1>🔎 Query Plan</h1>
    <pre class="query">${esc(query)}</pre>
    <div class="error">
      <strong>Could not get a query plan.</strong>
      <pre>${esc(msg)}</pre>
      <p class="muted">Check that you're logged into a default org with <code>sf org login web</code> and that the SOQL parses cleanly.</p>
    </div>
  `);
}

function renderPlan(query: string, response: QueryPlanResponse): string {
  const plans = response.plans ?? [];
  if (!plans.length) {
    return shell(`
      <h1>🔎 Query Plan</h1>
      <pre class="query">${esc(query)}</pre>
      <p class="muted">No plans returned for this query.</p>
    `);
  }

  // Sort plans by relativeCost (lower = better; Salesforce picks the leading one)
  const sorted = [...plans].sort((a, b) => a.relativeCost - b.relativeCost);
  const leading = sorted[0];

  const verdictHtml = renderVerdict(leading);

  const planRows = sorted
    .map((p, i) => `
      <tr class="plan-row ${i === 0 ? "leading" : ""}">
        <td>${i === 0 ? `<span class="leading-pill">LEADING</span>` : ""}</td>
        <td><code>${esc(p.leadingOperationType)}</code></td>
        <td class="num">${p.relativeCost.toFixed(3)}</td>
        <td class="num">${p.cardinality.toLocaleString()}</td>
        <td class="num">${p.sobjectCardinality.toLocaleString()}</td>
        <td>${esc((p.fields || []).join(", "))}</td>
      </tr>
    `)
    .join("");

  const notesHtml = (leading.notes || [])
    .map(
      (n) => `<li><strong>${esc(n.tableEnumOrId)}</strong> — ${esc(n.description)}</li>`,
    )
    .join("");

  return shell(`
    <h1>🔎 Query Plan</h1>
    <pre class="query">${esc(query)}</pre>
    ${verdictHtml}

    <h2>All considered plans</h2>
    <table class="plans">
      <thead><tr><th></th><th>Leading op</th><th class="num">Cost</th><th class="num">Cardinality</th><th class="num">sObject rows</th><th>Fields</th></tr></thead>
      <tbody>${planRows}</tbody>
    </table>

    ${
      notesHtml
        ? `<h2>Notes from Salesforce</h2><ul>${notesHtml}</ul>`
        : ""
    }
  `);
}

function renderVerdict(leading: QueryPlan): string {
  const op = leading.leadingOperationType;
  const cost = leading.relativeCost;

  // The Query Plan tool considers a query "selective" when relativeCost < 1.
  let severity: "good" | "warning" | "critical";
  let icon: string;
  let msg: string;

  if (op === "TableScan" || op === "Other") {
    severity = "critical";
    icon = "🔴";
    msg = `Full table scan — Salesforce will read every row in <strong>${esc(leading.sobjectType)}</strong>. Add a selective WHERE clause or an index on a filter field.`;
  } else if (cost >= 1) {
    severity = "warning";
    icon = "🟡";
    msg = `Not selective enough (cost ${cost.toFixed(2)}). The Query Plan tool considers cost < 1 as selective.`;
  } else if (op === "Index" || op.startsWith("Index")) {
    severity = "good";
    icon = "🟢";
    msg = `Selective query using an index. Estimated to scan <strong>${leading.cardinality.toLocaleString()}</strong> rows.`;
  } else {
    severity = "good";
    icon = "🟢";
    msg = `Selective query (cost ${cost.toFixed(3)}).`;
  }

  return `
    <div class="verdict verdict-${severity}">
      <div class="verdict-icon">${icon}</div>
      <div class="verdict-body">
        <div class="verdict-msg">${msg}</div>
        <div class="muted small">${esc(op)} · cost ${cost.toFixed(3)} · cardinality ${leading.cardinality.toLocaleString()} · sObject rows ${leading.sobjectCardinality.toLocaleString()}</div>
      </div>
    </div>
  `;
}

function shell(body: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { font-family: -apple-system, Segoe UI, sans-serif; padding: 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  h1 { margin: 0 0 8px; }
  h2 { margin-top: 24px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
  pre.query { background: var(--vscode-textCodeBlock-background); padding: 10px 12px; border-radius: 4px; white-space: pre-wrap; font-size: 12px; }
  .muted { opacity: 0.7; font-size: 12px; }
  .small { font-size: 11px; }
  table.plans { border-collapse: collapse; width: 100%; margin-top: 8px; }
  table.plans th, table.plans td { border: 1px solid var(--vscode-panel-border); padding: 6px 8px; text-align: left; font-size: 12px; vertical-align: top; }
  table.plans th { background: var(--vscode-editorWidget-background); }
  table.plans .num { text-align: right; font-family: var(--vscode-editor-font-family); }
  table.plans .leading td { background: rgba(34, 197, 94, 0.05); font-weight: 600; }
  .leading-pill { display: inline-block; font-size: 9px; padding: 2px 6px; border-radius: 8px; background: #22c55e; color: #fff; letter-spacing: 0.5px; }
  .verdict { display: flex; gap: 12px; padding: 12px 16px; border-radius: 6px; border-left: 4px solid; margin: 12px 0; background: var(--vscode-editorWidget-background); }
  .verdict-good { border-color: #22c55e; }
  .verdict-warning { border-color: #f59e0b; }
  .verdict-critical { border-color: #ef4444; }
  .verdict-icon { font-size: 24px; line-height: 1; }
  .verdict-msg { font-size: 14px; line-height: 1.4; margin-bottom: 4px; }
  .error { padding: 12px; background: rgba(239, 68, 68, 0.05); border-left: 4px solid #ef4444; border-radius: 4px; }
  .error pre { background: transparent; }
  ul { margin: 6px 0 0 22px; padding: 0; }
  li { margin: 2px 0; font-size: 12px; }
  code { font-family: var(--vscode-editor-font-family); font-size: 12px; background: var(--vscode-textCodeBlock-background); padding: 1px 5px; border-radius: 3px; }
</style></head><body>${body}</body></html>`;
}

function esc(s: string): string {
  return (s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
