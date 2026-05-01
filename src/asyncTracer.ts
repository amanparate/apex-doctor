import { LogEvent } from "./parser";

export type AsyncKind =
  | "future"
  | "queueable"
  | "batch"
  | "schedulable"
  | "platform_event"
  | "unknown";

export interface AsyncInvocation {
  kind: AsyncKind;
  className: string;
  methodName?: string;
  jobId?: string;
  lineNumber?: number;
  timestamp: string;
  raw: string;
}

export interface AsyncEntryPoint {
  kind: AsyncKind;
  className: string;
  methodName?: string;
  startedAt: string;
  durationMs?: number;
}

const ASYNC_TRIGGERED_RE =
  /(?:Type:)?(future|queueable|batch|schedulable|sched|platform.*event)\s*[|;,]?\s*(?:Class:|Job:|Id:)?\s*([A-Za-z0-9_.]+)?/i;

export function extractAsyncInvocations(events: LogEvent[]): AsyncInvocation[] {
  const out: AsyncInvocation[] = [];
  for (const ev of events) {
    if (ev.eventType === "ASYNC_OPERATION_TRIGGERED" || ev.eventType === "ASYNC_OPERATION_BEGIN") {
      const m = ASYNC_TRIGGERED_RE.exec(ev.details);
      const kind = normaliseKind(m?.[1]);
      const className = (m?.[2] || ev.details.split("|").pop() || "").trim();
      out.push({
        kind,
        className,
        lineNumber: ev.lineNumber,
        timestamp: ev.timestamp,
        raw: ev.raw,
      });
    } else if (
      ev.eventType === "FUTURE_METHOD_INVOCATION" ||
      ev.eventType === "FUTURE_METHOD_INVOKED"
    ) {
      const detail = ev.details.replace(/^\|/, "").trim();
      const [cls, mth] = detail.split(".");
      out.push({
        kind: "future",
        className: cls || detail,
        methodName: mth,
        lineNumber: ev.lineNumber,
        timestamp: ev.timestamp,
        raw: ev.raw,
      });
    } else if (
      ev.eventType === "QUEUEABLE_PENDING" ||
      ev.eventType === "ENQUEUE_JOB"
    ) {
      const detail = ev.details.replace(/^\|/, "").trim();
      out.push({
        kind: "queueable",
        className: detail.split("|").pop() || detail,
        lineNumber: ev.lineNumber,
        timestamp: ev.timestamp,
        raw: ev.raw,
      });
    }
  }
  return out;
}

export function detectAsyncEntryPoint(events: LogEvent[]): AsyncEntryPoint | undefined {
  let executionStart: LogEvent | undefined;
  let executionEnd: LogEvent | undefined;
  let firstCodeUnit: LogEvent | undefined;
  for (const ev of events) {
    if (ev.eventType === "EXECUTION_STARTED" && !executionStart) {
      executionStart = ev;
    } else if (ev.eventType === "EXECUTION_FINISHED") {
      executionEnd = ev;
    } else if (ev.eventType === "CODE_UNIT_STARTED" && !firstCodeUnit) {
      firstCodeUnit = ev;
    }
    if (executionStart && firstCodeUnit && executionEnd) {
      break;
    }
  }
  if (!firstCodeUnit) {
    return undefined;
  }
  const details = firstCodeUnit.details;
  let kind: AsyncKind = "unknown";
  if (/queueable/i.test(details)) {
    kind = "queueable";
  } else if (/batch/i.test(details)) {
    kind = "batch";
  } else if (/schedulable|scheduled/i.test(details)) {
    kind = "schedulable";
  } else if (/future/i.test(details)) {
    kind = "future";
  } else {
    return undefined;
  }
  const segments = details.split("|").map(s => s.trim()).filter(Boolean);
  const className = segments[segments.length - 1] || "Unknown";
  const methodMatch = /([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/.exec(className);
  return {
    kind,
    className: methodMatch ? methodMatch[1] : className,
    methodName: methodMatch ? methodMatch[2] : undefined,
    startedAt: firstCodeUnit.timestamp,
    durationMs:
      executionStart && executionEnd
        ? (executionEnd.nanoseconds - executionStart.nanoseconds) / 1e6
        : undefined,
  };
}

function normaliseKind(s: string | undefined): AsyncKind {
  if (!s) {
    return "unknown";
  }
  const v = s.toLowerCase();
  if (v.includes("future")) {
    return "future";
  }
  if (v.includes("queue")) {
    return "queueable";
  }
  if (v.includes("batch")) {
    return "batch";
  }
  if (v.includes("sched")) {
    return "schedulable";
  }
  if (v.includes("platform")) {
    return "platform_event";
  }
  return "unknown";
}

export interface AsyncLink {
  parent: AsyncInvocation;
  childLogLabel?: string;
  childStartedAt?: string;
  childDurationMs?: number;
  confidence: number;
}

export interface AsyncHistoryEntry {
  label: string;
  savedAt: string;
  entryPoint?: AsyncEntryPoint;
}

export function linkAsyncChain(
  invocations: AsyncInvocation[],
  history: AsyncHistoryEntry[],
): AsyncLink[] {
  const out: AsyncLink[] = [];
  for (const inv of invocations) {
    const parentTime = parseLogTimestamp(inv.timestamp);
    let bestMatch: AsyncHistoryEntry | undefined;
    let bestConfidence = 0;

    for (const h of history) {
      if (!h.entryPoint) {
        continue;
      }
      if (h.entryPoint.kind !== inv.kind && inv.kind !== "unknown") {
        continue;
      }
      if (h.entryPoint.className !== inv.className) {
        continue;
      }
      const childTime = new Date(h.savedAt).getTime();
      const delta = childTime - parentTime;
      if (delta < -1000 || delta > 10 * 60_000) {
        continue;
      }
      const seconds = delta / 1000;
      const confidence = Math.max(0.1, 1 - seconds / (10 * 60));
      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestMatch = h;
      }
    }

    out.push({
      parent: inv,
      childLogLabel: bestMatch?.label,
      childStartedAt: bestMatch?.entryPoint?.startedAt,
      childDurationMs: bestMatch?.entryPoint?.durationMs,
      confidence: bestConfidence,
    });
  }
  return out;
}

function parseLogTimestamp(ts: string): number {
  const m = /^(\d{2}):(\d{2}):(\d{2})\.(\d+)/.exec(ts);
  if (!m) {
    return Date.now();
  }
  const today = new Date();
  today.setHours(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]));
  return today.getTime();
}
