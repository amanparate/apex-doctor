import { ParsedLog } from "./parser";

export type DebugCategory =
  | "APEX_CODE"
  | "APEX_PROFILING"
  | "DB"
  | "CALLOUT"
  | "VALIDATION"
  | "WORKFLOW"
  | "SYSTEM"
  | "VISUALFORCE"
  | "NBA";

export interface DebugLevelRecommendation {
  category: DebugCategory;
  currentLevel?: string;
  recommendedLevel: string;
  reason: string;
  direction: "increase" | "decrease";
}

interface CategorySignal {
  category: DebugCategory;
  events: string[];
  minCount?: number;
}

const SIGNALS: CategorySignal[] = [
  { category: "APEX_CODE", events: ["METHOD_ENTRY", "METHOD_EXIT", "USER_DEBUG"], minCount: 1 },
  {
    category: "APEX_PROFILING",
    events: ["METHOD_ENTRY", "METHOD_EXIT"],
    minCount: 1,
  },
  {
    category: "DB",
    events: ["SOQL_EXECUTE_BEGIN", "SOQL_EXECUTE_END", "DML_BEGIN", "DML_END"],
    minCount: 1,
  },
  { category: "CALLOUT", events: ["CALLOUT_REQUEST", "CALLOUT_RESPONSE"] },
  { category: "VALIDATION", events: ["VALIDATION_RULE", "VALIDATION_FAIL", "VALIDATION_PASS"] },
  { category: "WORKFLOW", events: ["WF_RULE_EVAL_BEGIN", "WF_RULE_EVAL_VALUE", "WF_FIELD_UPDATE", "WF_FLOW_ACTION_BEGIN"] },
  { category: "SYSTEM", events: ["LIMIT_USAGE_FOR_NS", "CUMULATIVE_LIMIT_USAGE"] },
  { category: "VISUALFORCE", events: ["VF_PAGE_MESSAGE", "VF_APEX_CALL_START"] },
  { category: "NBA", events: ["NBA_OFFER_ACCEPTED", "NBA_OFFER_REJECTED"] },
];

export function recommendDebugLevels(parsed: ParsedLog): DebugLevelRecommendation[] {
  const counts = new Map<DebugCategory, number>();
  for (const ev of parsed.events) {
    for (const sig of SIGNALS) {
      if (sig.events.includes(ev.eventType)) {
        counts.set(sig.category, (counts.get(sig.category) || 0) + 1);
      }
    }
  }

  const out: DebugLevelRecommendation[] = [];
  const total = parsed.events.length;

  for (const sig of SIGNALS) {
    const current = parsed.logLevels[sig.category];
    const seen = counts.get(sig.category) || 0;

    if (current && (current === "FINE" || current === "FINEST") && seen === 0) {
      out.push({
        category: sig.category,
        currentLevel: current,
        recommendedLevel: sig.category === "APEX_CODE" ? "INFO" : "ERROR",
        direction: "decrease",
        reason: `${sig.category} is at ${current} but produced 0 events — drop it to reduce log size.`,
      });
    }

    const wantedFor: Record<DebugCategory, string> = {
      APEX_CODE: "see method entries and debug statements",
      APEX_PROFILING: "see method timing",
      DB: "see SOQL & DML row counts",
      CALLOUT: "see HTTP request/response details",
      SYSTEM: "see governor-limit usage",
      VALIDATION: "see validation-rule firings",
      WORKFLOW: "see workflow rule evaluation",
      VISUALFORCE: "see Visualforce lifecycle events",
      NBA: "see Next Best Action decisions",
    };
    if ((!current || current === "NONE") && sig.category === "DB") {
      out.push({
        category: "DB",
        currentLevel: current,
        recommendedLevel: "FINEST",
        direction: "increase",
        reason: `DB is off — set to FINEST to ${wantedFor.DB}.`,
      });
    }
    if ((!current || current === "NONE") && sig.category === "APEX_PROFILING") {
      out.push({
        category: "APEX_PROFILING",
        currentLevel: current,
        recommendedLevel: "FINE",
        direction: "increase",
        reason: `APEX_PROFILING is off — set to FINE to ${wantedFor.APEX_PROFILING}.`,
      });
    }
    if ((!current || current === "NONE") && sig.category === "SYSTEM") {
      out.push({
        category: "SYSTEM",
        currentLevel: current,
        recommendedLevel: "DEBUG",
        direction: "increase",
        reason: `SYSTEM is off — set to DEBUG to ${wantedFor.SYSTEM}.`,
      });
    }

    if (
      sig.category === "APEX_CODE" &&
      current === "FINEST" &&
      total > 0 &&
      seen / total < 0.05
    ) {
      out.push({
        category: "APEX_CODE",
        currentLevel: current,
        recommendedLevel: "FINE",
        direction: "decrease",
        reason: `APEX_CODE is at FINEST but only ${seen} of ${total} events used it — drop to FINE.`,
      });
    }
  }

  return out;
}
