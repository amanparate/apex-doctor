import { LogEvent } from "./parser";

export type TriggerPhase =
  | "BeforeInsert"
  | "AfterInsert"
  | "BeforeUpdate"
  | "AfterUpdate"
  | "BeforeDelete"
  | "AfterDelete"
  | "BeforeUndelete"
  | "AfterUndelete"
  | "Unknown";

export interface TriggerExecution {
  name: string;
  sObject?: string;
  phase: TriggerPhase;
  lineNumber?: number;
  orderInPhase: number;
  durationMs: number;
  timestamp: string;
  recursive: boolean;
}

export interface TriggerPhaseGroup {
  phase: TriggerPhase;
  sObject: string;
  totalDurationMs: number;
  slowestName?: string;
  triggers: TriggerExecution[];
}

const TRIGGER_DETAIL_RE =
  /(?:\[\w+\]\|)?(?:[a-z0-9]{15,18}\|)?([A-Za-z0-9_]+)\s+on\s+([A-Za-z0-9_]+)\s+trigger\s+event\s+(Before|After)(Insert|Update|Delete|Undelete)/i;

export function extractTriggers(events: LogEvent[]): TriggerPhaseGroup[] {
  interface OpenTrigger {
    ev: LogEvent;
    name: string;
    sObject: string;
    phase: TriggerPhase;
  }
  const stack: OpenTrigger[] = [];
  const flat: TriggerExecution[] = [];

  for (const ev of events) {
    if (ev.eventType === "CODE_UNIT_STARTED") {
      const m = TRIGGER_DETAIL_RE.exec(ev.details);
      if (m) {
        const phase = `${m[3]}${m[4]}` as TriggerPhase;
        stack.push({
          ev,
          name: m[1],
          sObject: m[2],
          phase,
        });
      } else {
        stack.push({ ev, name: "", sObject: "", phase: "Unknown" });
      }
    } else if (ev.eventType === "CODE_UNIT_FINISHED") {
      const opened = stack.pop();
      if (opened && opened.name) {
        flat.push({
          name: opened.name,
          sObject: opened.sObject,
          phase: opened.phase,
          lineNumber: opened.ev.lineNumber,
          orderInPhase: 0,
          durationMs: (ev.nanoseconds - opened.ev.nanoseconds) / 1e6,
          timestamp: opened.ev.timestamp,
          recursive: false,
        });
      }
    }
  }

  const groups = new Map<string, TriggerPhaseGroup>();
  for (const t of flat) {
    const key = `${t.sObject}::${t.phase}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        phase: t.phase,
        sObject: t.sObject || "Unknown",
        totalDurationMs: 0,
        triggers: [],
      };
      groups.set(key, g);
    }
    t.orderInPhase = g.triggers.length + 1;
    t.recursive = g.triggers.some(prev => prev.name === t.name);
    g.triggers.push(t);
    g.totalDurationMs += t.durationMs;
  }

  for (const g of groups.values()) {
    if (g.triggers.length) {
      g.slowestName = g.triggers.reduce((slow, t) =>
        t.durationMs > slow.durationMs ? t : slow,
      ).name;
    }
  }

  return [...groups.values()];
}
