import { Issue } from "./analyzer";
import { RecentAnalysisEntry } from "./recentHistory";

export type RecurringSeverity = "info" | "warning" | "critical";

export interface RecurringIssuePattern {
  key: string;
  type: string;
  message: string;
  lineNumber?: number;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  severity: RecurringSeverity;
}

export interface RecurringSoqlPattern {
  pattern: string;
  occurrences: number;
  totalRows: number;
  logCount: number;
}

export interface MetricTrend {
  metric: "soqlCount" | "dmlCount" | "totalDurationMs" | "errorCount";
  baseline: number;
  recent: number;
  deltaPct: number;
  direction: "improving" | "regressing" | "stable";
}

export interface RecurringPatterns {
  issues: RecurringIssuePattern[];
  soql: RecurringSoqlPattern[];
  trends: MetricTrend[];
  analysesExamined: number;
}

const DEFAULT_WINDOW_DAYS = 7;
const RECURRING_THRESHOLD = 3;

export function detectRecurringPatterns(
  history: RecentAnalysisEntry[],
  windowDays = DEFAULT_WINDOW_DAYS,
): RecurringPatterns {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const inWindow = history.filter(h => new Date(h.savedAt).getTime() >= cutoff);

  return {
    issues: detectIssuePatterns(inWindow),
    soql: detectSoqlPatterns(inWindow),
    trends: detectTrends(inWindow),
    analysesExamined: inWindow.length,
  };
}

function detectIssuePatterns(history: RecentAnalysisEntry[]): RecurringIssuePattern[] {
  const map = new Map<string, RecurringIssuePattern>();
  for (const h of history) {
    for (const issue of h.analysis.issues) {
      const key = issueKey(issue);
      const existing = map.get(key);
      const stamp = h.savedAt;
      if (existing) {
        existing.occurrences += 1;
        if (stamp < existing.firstSeen) {
          existing.firstSeen = stamp;
        }
        if (stamp > existing.lastSeen) {
          existing.lastSeen = stamp;
        }
      } else {
        map.set(key, {
          key,
          type: issue.type,
          message: issue.message.slice(0, 200),
          lineNumber: issue.lineNumber,
          occurrences: 1,
          firstSeen: stamp,
          lastSeen: stamp,
          severity: classifyRecurringSeverity(issue, 1),
        });
      }
    }
  }

  const out: RecurringIssuePattern[] = [];
  for (const p of map.values()) {
    if (p.occurrences >= RECURRING_THRESHOLD) {
      p.severity =
        p.occurrences >= 7
          ? "critical"
          : p.occurrences >= 5
            ? "warning"
            : "info";
      out.push(p);
    }
  }
  return out.sort((a, b) => b.occurrences - a.occurrences);
}

function classifyRecurringSeverity(issue: Issue, count: number): RecurringSeverity {
  if (issue.severity === "fatal" || count >= 7) {
    return "critical";
  }
  if (issue.severity === "error" || count >= 5) {
    return "warning";
  }
  return "info";
}

function issueKey(issue: Issue): string {
  return `${issue.type}|${issue.lineNumber ?? "?"}|${issue.message.slice(0, 60)}`;
}

function detectSoqlPatterns(history: RecentAnalysisEntry[]): RecurringSoqlPattern[] {
  interface Agg {
    occurrences: number;
    rows: number;
    logIds: Set<string>;
  }
  const map = new Map<string, Agg>();
  for (const h of history) {
    const seenInThisLog = new Set<string>();
    for (const q of h.analysis.soql) {
      const norm = normaliseQuery(q.query);
      const a = map.get(norm) || { occurrences: 0, rows: 0, logIds: new Set<string>() };
      a.occurrences += 1;
      a.rows += q.rows ?? 0;
      seenInThisLog.add(norm);
      map.set(norm, a);
    }
    for (const norm of seenInThisLog) {
      map.get(norm)!.logIds.add(h.id);
    }
  }
  const out: RecurringSoqlPattern[] = [];
  for (const [pattern, a] of map.entries()) {
    if (a.logIds.size >= RECURRING_THRESHOLD) {
      out.push({
        pattern,
        occurrences: a.occurrences,
        totalRows: a.rows,
        logCount: a.logIds.size,
      });
    }
  }
  return out
    .sort((a, b) => b.logCount - a.logCount || b.occurrences - a.occurrences)
    .slice(0, 20);
}

function normaliseQuery(q: string): string {
  return q
    .replace(/:\w+/g, ":?")
    .replace(/'[^']*'/g, "'?'")
    .replace(/\b\d+\b/g, "?")
    .replace(/\s+/g, " ")
    .trim();
}

function detectTrends(history: RecentAnalysisEntry[]): MetricTrend[] {
  if (history.length < 4) {
    return [];
  }
  const sorted = [...history].sort(
    (a, b) => new Date(a.savedAt).getTime() - new Date(b.savedAt).getTime(),
  );
  const half = Math.floor(sorted.length / 2);
  const baseline = sorted.slice(0, half);
  const recent = sorted.slice(half);

  const metrics: { key: MetricTrend["metric"]; pick: (e: RecentAnalysisEntry) => number }[] = [
    { key: "soqlCount", pick: e => e.soqlCount },
    { key: "dmlCount", pick: e => e.dmlCount },
    { key: "totalDurationMs", pick: e => e.totalDurationMs },
    { key: "errorCount", pick: e => e.errorCount },
  ];

  return metrics.map(m => {
    const baselineMean = mean(baseline.map(m.pick));
    const recentMean = mean(recent.map(m.pick));
    const deltaPct = baselineMean > 0 ? ((recentMean - baselineMean) / baselineMean) * 100 : 0;
    const direction: MetricTrend["direction"] =
      Math.abs(deltaPct) < 10
        ? "stable"
        : deltaPct > 0
          ? "regressing"
          : "improving";
    return {
      metric: m.key,
      baseline: baselineMean,
      recent: recentMean,
      deltaPct,
      direction,
    };
  });
}

function mean(xs: number[]): number {
  if (!xs.length) {
    return 0;
  }
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
