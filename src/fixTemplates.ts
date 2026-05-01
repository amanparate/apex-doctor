import { Issue } from "./analyzer";

export interface FixTemplateInput {
  issue: Issue;
  /** Source-file content of the surrounding method/class. */
  fileText: string;
  /** Path of the source file. */
  filePath: string;
}

export interface TemplateFix {
  /** Title shown above the diff preview */
  title: string;
  /** Plain-English explanation */
  rationale: string;
  /** The proposed full file content (after the fix) */
  newFileText: string;
  /** "templated" — deterministic transform; "ai" — LLM-generated. */
  source: "templated" | "ai";
}

/**
 * Try every known templated transform; return the first one that applies, or
 * undefined if none match.
 */
export function tryTemplatedFix(input: FixTemplateInput): TemplateFix | undefined {
  for (const tmpl of TEMPLATES) {
    const result = tmpl(input);
    if (result) {
      return result;
    }
  }
  return undefined;
}

type Template = (input: FixTemplateInput) => TemplateFix | undefined;

const TEMPLATES: Template[] = [
  bulkifySoqlInLoop,
  addQueryLimit,
  unwrapSingleQuery,
];

// ───────── Template: SOQL in loop ─────────
//
// Detect a `for (... :  ...)` block that contains a `[SELECT ...]` and rewrite
// it to:
//   1. Collect the loop var IDs into a Set / List
//   2. Run a single bulk query before the loop
//   3. Use a Map<Id, Object> lookup inside the loop
//
// We use a conservative regex match: only fire when the loop body has exactly
// one inline SOQL expression. Anything more nuanced falls through to AI.

function bulkifySoqlInLoop(input: FixTemplateInput): TemplateFix | undefined {
  if (input.issue.type !== "SOQL in Loop") {
    return undefined;
  }
  const lines = input.fileText.split(/\r?\n/);
  const issueLine = (input.issue.lineNumber ?? 0) - 1;
  if (issueLine < 0 || issueLine >= lines.length) {
    return undefined;
  }

  // Walk backwards from the issue line to find the enclosing `for (...) {`
  let forLineIdx = -1;
  let forMatch: RegExpMatchArray | null = null;
  for (let i = issueLine; i >= Math.max(0, issueLine - 10); i--) {
    const m = lines[i].match(
      /^(\s*)for\s*\(\s*([A-Za-z_][A-Za-z0-9_<>]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\)\s*\{?\s*$/,
    );
    if (m) {
      forLineIdx = i;
      forMatch = m;
      break;
    }
  }
  if (forLineIdx < 0 || !forMatch) {
    return undefined;
  }

  const [, indent, elemType, elemVar, listVar] = forMatch;

  // Find the SOQL expression inside the loop body
  let soqlLineIdx = -1;
  let soqlMatch: RegExpMatchArray | null = null;
  for (let i = forLineIdx + 1; i < Math.min(lines.length, forLineIdx + 20); i++) {
    if (/^\s*\}/.test(lines[i])) {
      break;
    }
    const m = lines[i].match(
      /^(\s*)([A-Za-z_][A-Za-z0-9_<>]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\[\s*SELECT\s+([\s\S]+?)\s+FROM\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+WHERE\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*:([A-Za-z_][A-Za-z0-9_.]*))?\s*\]\s*;\s*$/i,
    );
    if (m) {
      soqlLineIdx = i;
      soqlMatch = m;
      break;
    }
  }
  if (soqlLineIdx < 0 || !soqlMatch) {
    return undefined;
  }
  const [, , resultType, resultVar, fields, fromObj, whereField, whereExpr] = soqlMatch;

  // Only proceed if the WHERE expression references the loop variable directly
  // (`elemVar.SomethingId` or `elemVar`). Otherwise we can't bulkify safely.
  if (!whereExpr || !whereExpr.startsWith(`${elemVar}.`)) {
    return undefined;
  }
  const idAccessor = whereExpr.slice(elemVar.length + 1); // e.g. "Id"

  // Build the bulkified replacement
  const idsVar = pluralise(idAccessor) + "Set";
  const mapVar = lowerFirst(fromObj) + "ByKey";
  const fieldList = `Id, ${whereField}, ${fields.replace(/\s+/g, " ").trim()}`;
  const dedupedFields = dedupeFields(fieldList);

  const bulkified: string[] = [];
  bulkified.push(`${indent}// Bulkified by Apex Doctor — collect IDs, run ONE query, then lookup inside the loop.`);
  bulkified.push(`${indent}Set<Id> ${idsVar} = new Set<Id>();`);
  bulkified.push(`${indent}for (${elemType} ${elemVar} : ${listVar}) {`);
  bulkified.push(`${indent}  ${idsVar}.add(${elemVar}.${idAccessor});`);
  bulkified.push(`${indent}}`);
  bulkified.push(
    `${indent}Map<Id, ${resultType}> ${mapVar} = new Map<Id, ${resultType}>(`,
  );
  bulkified.push(
    `${indent}  [SELECT ${dedupedFields} FROM ${fromObj} WHERE ${whereField} IN :${idsVar}]`,
  );
  bulkified.push(`${indent});`);
  bulkified.push(`${indent}for (${elemType} ${elemVar} : ${listVar}) {`);
  bulkified.push(`${indent}  ${resultType} ${resultVar} = ${mapVar}.get(${elemVar}.${idAccessor});`);

  // Compute the loop-body content between forLineIdx+1 and the closing `}`,
  // excluding the SOQL line we replaced. Find the closing brace.
  let closeIdx = -1;
  for (let i = forLineIdx + 1; i < lines.length; i++) {
    if (/^\s*\}\s*$/.test(lines[i])) {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx < 0) {
    return undefined;
  }
  for (let i = forLineIdx + 1; i < closeIdx; i++) {
    if (i === soqlLineIdx) {
      continue;
    }
    bulkified.push(lines[i]);
  }
  bulkified.push(`${indent}}`);

  const newLines = [
    ...lines.slice(0, forLineIdx),
    ...bulkified,
    ...lines.slice(closeIdx + 1),
  ];

  return {
    title: "Bulkify SOQL-in-loop",
    rationale: `Collected the loop variable's ${idAccessor} into a Set, ran a single ${fromObj} query before the loop, then used a Map lookup inside the loop. This satisfies Salesforce's bulkification pattern and avoids the 100-SOQL governor limit.`,
    newFileText: newLines.join("\n"),
    source: "templated",
  };
}

// ───────── Template: add LIMIT to a large query ─────────

function addQueryLimit(input: FixTemplateInput): TemplateFix | undefined {
  if (input.issue.type !== "Large Query Result") {
    return undefined;
  }
  const lines = input.fileText.split(/\r?\n/);
  const issueLine = (input.issue.lineNumber ?? 0) - 1;
  if (issueLine < 0 || issueLine >= lines.length) {
    return undefined;
  }
  const orig = lines[issueLine];
  // Match a SELECT ... that does NOT already have LIMIT
  if (!/\[\s*SELECT\b/i.test(orig) || /\bLIMIT\s+\d+/i.test(orig)) {
    return undefined;
  }
  const replaced = orig.replace(/\]\s*;/, " LIMIT 200];");
  if (replaced === orig) {
    return undefined;
  }
  const newLines = [...lines];
  newLines[issueLine] = replaced;
  return {
    title: "Add LIMIT 200 to query",
    rationale:
      "Caps the result size so the query can't return more rows than the heap can hold. Pick a LIMIT that fits your business logic.",
    newFileText: newLines.join("\n"),
    source: "templated",
  };
}

// ───────── Template: unwrap a single-row [SELECT ... LIMIT 1] into a try/catch ─────────
//
// Catches the common case where the issue is a `Slow SOQL Query` on a row
// that's later accessed as a single Object — wrap with the safer
// `[SELECT ... LIMIT 1]` + null-check pattern.

function unwrapSingleQuery(input: FixTemplateInput): TemplateFix | undefined {
  // Stub for now — the SOQL-in-loop template handles the most common case.
  // This slot is reserved for future templates without changing the API.
  return undefined;
}

// ───────── Helpers ─────────

function pluralise(word: string): string {
  if (word.endsWith("y")) {
    return word.slice(0, -1) + "ies";
  }
  if (word.endsWith("s")) {
    return word;
  }
  return word + "s";
}

function lowerFirst(s: string): string {
  return s.length ? s[0].toLowerCase() + s.slice(1) : s;
}

function dedupeFields(fields: string): string {
  const out = new Set<string>();
  for (const f of fields.split(",")) {
    out.add(f.trim());
  }
  return [...out].filter(Boolean).join(", ");
}
