import { Analysis, SoqlEntry, DmlEntry, MethodEntry, DebugEntry, Issue } from "./analyzer";

export type QueryKind = "soql" | "dml" | "methods" | "debugs" | "issues" | "code_units";

export interface NlQueryResult {
  kind: QueryKind;
  /** Indices into the matching analysis array. We trust these to point at real items. */
  matchedIndices: number[];
  /** 1-line plain-English summary of what the LLM filtered for. */
  summary: string;
  /** The matched items, hydrated from indices. */
  items: unknown[];
}

/**
 * Build a compact context string the LLM can reason over without ballooning tokens.
 * Each array is summarised with its length + a sample of fields.
 */
export function buildNlQueryContext(analysis: Analysis): string {
  const lines: string[] = [];
  lines.push(`API ${analysis.summary.apiVersion}, ${analysis.summary.totalDurationMs.toFixed(0)} ms total`);
  lines.push("");
  lines.push("# Available arrays you can filter (return matchedIndices into these)");
  lines.push("");

  lines.push(`## soql (${analysis.soql.length} items) — fields: query, rows, durationMs, lineNumber, timestamp`);
  for (let i = 0; i < Math.min(analysis.soql.length, 15); i++) {
    const q = analysis.soql[i];
    lines.push(
      `[${i}] line ${q.lineNumber ?? "?"}, ${q.rows ?? "?"} rows, ${(q.durationMs ?? 0).toFixed(0)}ms — ${q.query.slice(0, 120)}`,
    );
  }
  lines.push("");

  lines.push(`## dml (${analysis.dml.length} items) — fields: operation, rows, durationMs, lineNumber`);
  for (let i = 0; i < Math.min(analysis.dml.length, 10); i++) {
    const d = analysis.dml[i];
    lines.push(
      `[${i}] line ${d.lineNumber ?? "?"}, ${d.operation}, ${d.rows ?? "?"} rows, ${(d.durationMs ?? 0).toFixed(0)}ms`,
    );
  }
  lines.push("");

  lines.push(`## methods (${analysis.methods.length} items) — fields: name, durationMs, lineNumber, timestamp`);
  for (let i = 0; i < Math.min(analysis.methods.length, 15); i++) {
    const m = analysis.methods[i];
    lines.push(`[${i}] ${m.name} — ${m.durationMs.toFixed(0)}ms (line ${m.lineNumber ?? "?"})`);
  }
  lines.push("");

  lines.push(`## debugs (${analysis.debugs.length} items) — fields: level, message, lineNumber, timestamp`);
  for (let i = 0; i < Math.min(analysis.debugs.length, 15); i++) {
    const d = analysis.debugs[i];
    lines.push(`[${i}] line ${d.lineNumber ?? "?"} [${d.level}] ${d.message.slice(0, 120)}`);
  }
  lines.push("");

  lines.push(`## issues (${analysis.issues.length} items) — fields: severity, type, message, lineNumber, timestamp`);
  for (let i = 0; i < analysis.issues.length; i++) {
    const issue = analysis.issues[i];
    lines.push(
      `[${i}] [${issue.severity}] ${issue.type} (line ${issue.lineNumber ?? "?"} @ ${issue.timestamp}) — ${issue.message.slice(0, 120)}`,
    );
  }
  lines.push("");

  lines.push(`## code_units (${analysis.codeUnits.length} items) — fields: name, durationMs, timestamp`);
  for (let i = 0; i < Math.min(analysis.codeUnits.length, 10); i++) {
    const c = analysis.codeUnits[i];
    lines.push(`[${i}] ${c.name} — ${c.durationMs.toFixed(0)}ms`);
  }

  return lines.join("\n");
}

export function buildNlQueryPrompt(analysis: Analysis, question: string): string {
  return `You are a Salesforce Apex log query engine. The user asks a question about a debug log; your job is to identify which array in the analysis they want and which items in that array match.

LOG ANALYSIS CONTEXT
====================
${buildNlQueryContext(analysis)}

USER QUESTION: ${question}

Respond with ONLY a JSON object on a single line, in this exact shape:

{"kind":"soql"|"dml"|"methods"|"debugs"|"issues"|"code_units","matchedIndices":[<numbers>],"summary":"<one short sentence>"}

Rules:
- Choose the most relevant kind. If the question mentions queries / SOQL / rows, use "soql". DML / inserts / updates → "dml". Methods / functions → "methods". Debug statements / System.debug → "debugs". Errors / exceptions / fatal → "issues". Triggers / code units → "code_units".
- matchedIndices must be valid 0-based indices into that array, in the order most relevant to the question.
- Keep summary under 100 characters.
- If the question doesn't match any array, return {"kind":"issues","matchedIndices":[],"summary":"No matching items"}.
- DO NOT include any text outside the JSON.
`;
}

/**
 * Parse the LLM's JSON response and hydrate matchedIndices back into real items
 * from the analysis. Throws if the JSON is malformed or indices are out of range.
 */
export function parseNlQueryResponse(analysis: Analysis, raw: string): NlQueryResult {
  // Extract JSON if the model wrapped it in markdown
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON object found in response.");
  }
  const parsed = JSON.parse(jsonMatch[0]);
  if (
    typeof parsed !== "object" ||
    !parsed ||
    typeof parsed.kind !== "string" ||
    !Array.isArray(parsed.matchedIndices) ||
    typeof parsed.summary !== "string"
  ) {
    throw new Error("Response did not match the expected shape.");
  }

  const kind = parsed.kind as QueryKind;
  const arr = pickArray(analysis, kind);
  const items = parsed.matchedIndices
    .filter((i: unknown) => typeof i === "number" && i >= 0 && i < arr.length)
    .slice(0, 50)
    .map((i: number) => arr[i]);

  return {
    kind,
    matchedIndices: items.map((_: unknown, i: number) => parsed.matchedIndices[i]).filter((v: unknown) => typeof v === "number"),
    summary: parsed.summary,
    items,
  };
}

function pickArray(
  analysis: Analysis,
  kind: QueryKind,
): SoqlEntry[] | DmlEntry[] | MethodEntry[] | DebugEntry[] | Issue[] | { name: string; durationMs: number; timestamp: string }[] {
  switch (kind) {
    case "soql":
      return analysis.soql;
    case "dml":
      return analysis.dml;
    case "methods":
      return analysis.methods;
    case "debugs":
      return analysis.debugs;
    case "issues":
      return analysis.issues;
    case "code_units":
      return analysis.codeUnits;
  }
}
