import { LogEvent } from "./parser";

export interface FlowElement {
  /** Element name as it appears in the log */
  name: string;
  /** Element type (e.g. recordLookups, recordUpdates, decisions, loops, assignments) */
  elementType: string;
  durationMs: number;
  /** Order of first execution within the flow (1-based) */
  order: number;
  /** Times this element executed — > 1 strongly implies it ran inside a loop */
  executions: number;
  /** True when the element type implies DML/SOQL work (perf-sensitive in a loop) */
  dbBearing: boolean;
  timestamp: string;
}

export interface FlowExecution {
  /** Flow / Process Builder API name */
  flowName: string;
  /** Interview type, if present (Flow, Workflow, etc.) */
  flowType?: string;
  totalDurationMs: number;
  elements: FlowElement[];
  /** Element names that executed enough times to look loop-bound */
  loopedElements: string[];
  /** Slowest element name */
  slowestName?: string;
}

// FLOW_START_INTERVIEWS_BEGIN details vary; the interview/flow name typically
// appears in a following FLOW_START_INTERVIEW_BEGIN or in the element events.
// We key everything off the element events, which carry the flow + element name.
//
// FLOW_ELEMENT_BEGIN / FLOW_ELEMENT_END details look like:
//   <interviewId>|<elementType>|<elementName>
// FLOW_BULK_ELEMENT_BEGIN / FLOW_BULK_ELEMENT_END look like:
//   <elementType>|<elementName>
const DB_BEARING = new Set([
  "recordlookups",
  "recordcreates",
  "recordupdates",
  "recorddeletes",
  "recordqueries",
  "queryrecords",
  "lookuprecords",
  "createrecords",
  "updaterecords",
  "deleterecords",
]);

const LOOP_THRESHOLD = 5;

export function extractFlows(events: LogEvent[]): FlowExecution[] {
  interface OpenElement {
    ev: LogEvent;
    flowName: string;
    elementType: string;
    elementName: string;
  }
  const elementStack: OpenElement[] = [];
  // flowName -> execution
  const flows = new Map<string, FlowExecution>();
  // Track interview → flow name from FLOW_START events
  let currentFlowName = "Flow";

  const elementOrder = new Map<string, Map<string, number>>(); // flow -> element -> order

  for (const ev of events) {
    switch (ev.eventType) {
      case "FLOW_START_INTERVIEWS_BEGIN":
      case "FLOW_START_INTERVIEW_BEGIN":
      case "FLOW_CREATE_INTERVIEW_BEGIN": {
        const parts = ev.details.split("|").map(p => p.trim()).filter(Boolean);
        // Last meaningful segment is usually the flow/interview name
        const candidate = parts[parts.length - 1];
        if (candidate && !/^\d+$/.test(candidate)) {
          currentFlowName = candidate;
        }
        break;
      }
      case "FLOW_ELEMENT_BEGIN":
      case "FLOW_BULK_ELEMENT_BEGIN": {
        const parts = ev.details.split("|").map(p => p.trim()).filter(Boolean);
        // For FLOW_ELEMENT_BEGIN: [interviewId, elementType, elementName]
        // For FLOW_BULK_ELEMENT_BEGIN: [elementType, elementName]
        const elementName = parts[parts.length - 1] || "(unnamed)";
        const elementType = parts.length >= 2 ? parts[parts.length - 2] : "element";
        elementStack.push({ ev, flowName: currentFlowName, elementType, elementName });
        break;
      }
      case "FLOW_ELEMENT_END":
      case "FLOW_BULK_ELEMENT_END": {
        const opened = elementStack.pop();
        if (!opened) {
          break;
        }
        const durationMs = (ev.nanoseconds - opened.ev.nanoseconds) / 1e6;
        let flow = flows.get(opened.flowName);
        if (!flow) {
          flow = {
            flowName: opened.flowName,
            totalDurationMs: 0,
            elements: [],
            loopedElements: [],
          };
          flows.set(opened.flowName, flow);
          elementOrder.set(opened.flowName, new Map());
        }
        const orderMap = elementOrder.get(opened.flowName)!;
        const existing = flow.elements.find(e => e.name === opened.elementName);
        if (existing) {
          existing.durationMs += durationMs;
          existing.executions += 1;
        } else {
          orderMap.set(opened.elementName, orderMap.size + 1);
          flow.elements.push({
            name: opened.elementName,
            elementType: opened.elementType,
            durationMs,
            order: orderMap.get(opened.elementName)!,
            executions: 1,
            dbBearing: DB_BEARING.has(opened.elementType.toLowerCase()),
            timestamp: opened.ev.timestamp,
          });
        }
        flow.totalDurationMs += durationMs;
        break;
      }
    }
  }

  for (const flow of flows.values()) {
    flow.elements.sort((a, b) => a.order - b.order);
    flow.loopedElements = flow.elements
      .filter(e => e.executions >= LOOP_THRESHOLD)
      .map(e => e.name);
    if (flow.elements.length) {
      flow.slowestName = flow.elements.reduce((slow, e) =>
        e.durationMs > slow.durationMs ? e : slow,
      ).name;
    }
  }

  return [...flows.values()];
}
