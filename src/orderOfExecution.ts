import { LogEvent } from "./parser";

/**
 * Canonical Salesforce save-order steps we can observe (or meaningfully imply)
 * from a debug log. Steps marked `observable: false` never emit log events —
 * they're rendered greyed-out so the map still reads as the familiar
 * order-of-execution diagram every Salesforce developer has memorised.
 */
export interface ExecutionStep {
  key: string;
  label: string;
  /** Whether this step can ever be seen in a debug log */
  observable: boolean;
  /** Whether it actually fired in this save cycle */
  fired: boolean;
  /** Number of matching events */
  count: number;
  /** Short human detail, e.g. trigger names or "2 field updates" */
  detail?: string;
  /** First log line number for click-through */
  lineNumber?: number;
}

export interface SaveCycle {
  /** sObject being saved, when derivable */
  sObject?: string;
  /** DML operation (Insert / Update / …), when derivable */
  operation?: string;
  timestamp: string;
  steps: ExecutionStep[];
  /** True when a workflow field update caused triggers to fire a second time */
  reEntry: boolean;
}

interface StepDef {
  key: string;
  label: string;
  observable: boolean;
  match?: (ev: LogEvent) => boolean;
}

const isTriggerEvent = (ev: LogEvent, phase: "Before" | "After"): boolean =>
  ev.eventType === "CODE_UNIT_STARTED" &&
  new RegExp(`trigger\\s+event\\s+${phase}`, "i").test(ev.details);

const STEP_DEFS: StepDef[] = [
  { key: "systemValidation", label: "System validation rules", observable: false },
  {
    key: "beforeTriggers",
    label: "Before triggers",
    observable: true,
    match: (ev) => isTriggerEvent(ev, "Before"),
  },
  {
    key: "validationRules",
    label: "Custom validation rules",
    observable: true,
    match: (ev) => ev.eventType.startsWith("VALIDATION_"),
  },
  {
    key: "duplicateRules",
    label: "Duplicate rules",
    observable: true,
    match: (ev) => ev.eventType.startsWith("DUPLICATE_"),
  },
  { key: "saveRecord", label: "Record saved (not committed)", observable: false },
  {
    key: "afterTriggers",
    label: "After triggers",
    observable: true,
    match: (ev) => isTriggerEvent(ev, "After"),
  },
  {
    key: "assignmentRules",
    label: "Assignment rules",
    observable: true,
    match: (ev) => ev.eventType === "WF_ASSIGN",
  },
  {
    key: "workflowRules",
    label: "Workflow rules",
    observable: true,
    match: (ev) =>
      ev.eventType.startsWith("WF_") &&
      ev.eventType !== "WF_ASSIGN" &&
      !ev.eventType.startsWith("WF_ESCALATION"),
  },
  {
    key: "escalationRules",
    label: "Escalation rules",
    observable: true,
    match: (ev) => ev.eventType.startsWith("WF_ESCALATION"),
  },
  {
    key: "flows",
    label: "Record-triggered flows / processes",
    observable: true,
    match: (ev) => ev.eventType.startsWith("FLOW_"),
  },
  { key: "rollups", label: "Roll-up summary parents", observable: false },
  { key: "commit", label: "Commit & post-commit logic", observable: false },
];

/**
 * Reconstruct the Salesforce order of execution from the event stream.
 *
 * A "save cycle" is a top-level DML window (DML_BEGIN…DML_END at stack depth 0).
 * When the transaction was *initiated* by a record save (UI save → the log's
 * root code units are triggers, with no enclosing DML event), the whole log is
 * treated as one cycle.
 */
export function extractOrderOfExecution(events: LogEvent[]): SaveCycle[] {
  const windows: { start: number; end: number }[] = [];
  let depth = 0;
  let openIdx = -1;
  events.forEach((ev, i) => {
    if (ev.eventType === "DML_BEGIN") {
      if (depth === 0) {
        openIdx = i;
      }
      depth++;
    } else if (ev.eventType === "DML_END") {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && openIdx >= 0) {
        windows.push({ start: openIdx, end: i });
        openIdx = -1;
      }
    }
  });

  const cycles: SaveCycle[] = [];

  for (const w of windows.slice(0, 10)) {
    const slice = events.slice(w.start, w.end + 1);
    // Only build a cycle when the DML actually triggered automation —
    // a bare insert with no triggers/workflow isn't an interesting map.
    if (slice.some((ev) => stepMatchesAny(ev))) {
      cycles.push(buildCycle(slice, events[w.start]));
    }
  }

  // Trigger-initiated transaction: trigger events outside every DML window.
  const insideWindow = (i: number) => windows.some((w) => i >= w.start && i <= w.end);
  const rootTriggerIdx = events.findIndex(
    (ev, i) =>
      !insideWindow(i) && (isTriggerEvent(ev, "Before") || isTriggerEvent(ev, "After")),
  );
  if (rootTriggerIdx >= 0) {
    const outside = events.filter((_, i) => !insideWindow(i));
    cycles.unshift(buildCycle(outside, events[rootTriggerIdx]));
  }

  return cycles;
}

function stepMatchesAny(ev: LogEvent): boolean {
  return STEP_DEFS.some((d) => d.match?.(ev));
}

function buildCycle(slice: LogEvent[], anchor: LogEvent): SaveCycle {
  const steps: ExecutionStep[] = STEP_DEFS.map((def) => ({
    key: def.key,
    label: def.label,
    observable: def.observable,
    fired: false,
    count: 0,
  }));
  const byKey = new Map(steps.map((s) => [s.key, s]));
  const triggerNames = { before: new Set<string>(), after: new Set<string>() };
  let fieldUpdates = 0;
  let sawFieldUpdate = false;
  let reEntry = false;

  for (const ev of slice) {
    for (const def of STEP_DEFS) {
      if (!def.match || !def.match(ev)) {
        continue;
      }
      const step = byKey.get(def.key)!;
      step.fired = true;
      step.count++;
      if (step.lineNumber === undefined && ev.lineNumber !== undefined) {
        step.lineNumber = ev.lineNumber;
      }
      if (def.key === "beforeTriggers" || def.key === "afterTriggers") {
        const name = /\|?([A-Za-z0-9_]+)\s+on\s+/i.exec(ev.details)?.[1];
        if (name) {
          triggerNames[def.key === "beforeTriggers" ? "before" : "after"].add(name);
        }
        // Trigger firing AFTER a workflow field update ⇒ re-entry (save # 2)
        if (sawFieldUpdate) {
          reEntry = true;
        }
      }
      if (ev.eventType === "WF_FIELD_UPDATE") {
        fieldUpdates++;
        sawFieldUpdate = true;
      }
    }
  }

  const before = byKey.get("beforeTriggers")!;
  if (triggerNames.before.size) {
    before.detail = [...triggerNames.before].join(", ");
  }
  const after = byKey.get("afterTriggers")!;
  if (triggerNames.after.size) {
    after.detail = [...triggerNames.after].join(", ");
  }
  const wf = byKey.get("workflowRules")!;
  if (wf.fired) {
    wf.detail = fieldUpdates
      ? `${fieldUpdates} field update${fieldUpdates === 1 ? "" : "s"}${reEntry ? " → triggers re-fired" : ""}`
      : `${wf.count} workflow event${wf.count === 1 ? "" : "s"}`;
  }
  const flows = byKey.get("flows")!;
  if (flows.fired) {
    flows.detail = `${flows.count} flow event${flows.count === 1 ? "" : "s"}`;
  }

  // sObject / operation from the DML_BEGIN details or a trigger detail
  let sObject: string | undefined;
  let operation: string | undefined;
  if (anchor.eventType === "DML_BEGIN") {
    operation = /Op:(\w+)/.exec(anchor.details)?.[1];
    sObject = /Type:(\w+)/.exec(anchor.details)?.[1];
  }
  if (!sObject) {
    for (const ev of slice) {
      const m = /\s+on\s+([A-Za-z0-9_]+)\s+trigger\s+event\s+(Before|After)(\w+)/i.exec(
        ev.details,
      );
      if (m) {
        sObject = m[1];
        operation = operation ?? m[3];
        break;
      }
    }
  }

  return { sObject, operation, timestamp: anchor.timestamp, steps, reEntry };
}
