import { ParsedLog, LogEvent } from './parser';
import * as vscode from 'vscode';
import { generateInsights, Insight } from './insights';
import { buildCpuProfile, CpuProfile } from './profiler';
import { extractTriggers, TriggerPhaseGroup } from './triggerOrder';
import { extractAsyncInvocations, detectAsyncEntryPoint, AsyncInvocation, AsyncEntryPoint } from './asyncTracer';
import { recommendDebugLevels, DebugLevelRecommendation } from './debugLevelAdvisor';

export interface StackFrame {
  className: string;
  methodName?: string;
  line?: number;
  column?: number;
  raw: string;
}

export interface Issue {
  severity: 'fatal' | 'error' | 'warning' | 'info';
  type: string;
  message: string;
  lineNumber?: number;
  timestamp: string;
  context?: string;
  stackFrames?: StackFrame[];
}

export interface TestResult {
  name: string;
  passed: boolean;
  message?: string;
  durationMs?: number;
  lineNumber?: number;
  timestamp: string;
}

export interface SoqlEntry { query: string; rows?: number; durationMs?: number; lineNumber?: number; timestamp: string; }
export interface DmlEntry { operation: string; rows?: number; durationMs?: number; lineNumber?: number; timestamp: string; }
export interface MethodEntry { name: string; lineNumber?: number; durationMs: number; timestamp: string; }
export interface DebugEntry { level: string; message: string; lineNumber?: number; timestamp: string; }

export interface LimitMetric {
  name: string;
  used: number;
  limit: number;
  pct: number;
}

export interface LimitUsage {
  namespace: string;
  metrics: LimitMetric[];
}

export interface FlameNode {
  name: string;
  kind: 'code_unit' | 'method' | 'soql' | 'dml' | 'callout' | 'root';
  startNs: number;
  endNs: number;
  durationMs: number;
  lineNumber?: number;
  children: FlameNode[];
}

export interface Analysis {
  summary: {
    apiVersion: string;
    totalEvents: number;
    totalDurationMs: number;
    executionStart?: string;
    executionEnd?: string;
    logLevels: Record<string, string>;
  };
  issues: Issue[];
  soql: SoqlEntry[];
  dml: DmlEntry[];
  methods: MethodEntry[];
  debugs: DebugEntry[];
  limits: LimitUsage[];
  rawLimits: string[];
  codeUnits: { name: string; durationMs: number; timestamp: string }[];
  testResults: TestResult[];
  userInfo?: { Name: string; Username: string; Email: string; ProfileName?: string };
  flameRoot: FlameNode;
  insights: Insight[];
  cpuProfile: CpuProfile;
  triggerGroups: TriggerPhaseGroup[];
  asyncInvocations: AsyncInvocation[];
  asyncEntryPoint?: AsyncEntryPoint;
  debugLevelRecommendations: DebugLevelRecommendation[];
}

export class ApexDoctor {
  analyze(parsed: ParsedLog): Analysis {
    const issues: Issue[] = [];
    const soql: SoqlEntry[] = [];
    const dml: DmlEntry[] = [];
    const methods: MethodEntry[] = [];
    const debugs: DebugEntry[] = [];
    const rawLimits: string[] = [];
    const parsedLimits: LimitUsage[] = [];
    const codeUnits: { name: string; durationMs: number; timestamp: string }[] = [];
    const testResults: TestResult[] = [];

    let execStart: LogEvent | undefined;
    let execEnd: LogEvent | undefined;

    // Parallel stacks for durations
    const methodStack: { ev: LogEvent; name: string }[] = [];
    const soqlStack: { ev: LogEvent; query: string }[] = [];
    const dmlStack: { ev: LogEvent; op: string; rows?: number }[] = [];
    const codeUnitStack: { ev: LogEvent; name: string }[] = [];

    // Flame-graph tree built via an "active" stack
    const flameRoot: FlameNode = {
      name: 'Execution', kind: 'root',
      startNs: 0, endNs: 0, durationMs: 0,
      children: []
    };
    const flameStack: FlameNode[] = [flameRoot];

    const openNode = (ev: LogEvent, name: string, kind: FlameNode['kind']) => {
      const node: FlameNode = {
        name, kind,
        startNs: ev.nanoseconds,
        endNs: ev.nanoseconds,
        durationMs: 0,
        lineNumber: ev.lineNumber,
        children: []
      };
      flameStack[flameStack.length - 1].children.push(node);
      flameStack.push(node);
    };

    const closeNode = (ev: LogEvent) => {
      if (flameStack.length <= 1) {return;}
      const node = flameStack.pop()!;
      node.endNs = ev.nanoseconds;
      node.durationMs = (node.endNs - node.startNs) / 1e6;
    };

    for (const ev of parsed.events) {
      switch (ev.eventType) {
        case 'EXECUTION_STARTED':
          execStart = ev;
          flameRoot.startNs = ev.nanoseconds;
          break;
        case 'EXECUTION_FINISHED':
          execEnd = ev;
          flameRoot.endNs = ev.nanoseconds;
          flameRoot.durationMs = (flameRoot.endNs - flameRoot.startNs) / 1e6;
          break;

        case 'CODE_UNIT_STARTED': {
          const parts = ev.details.split('|');
          const name = parts[parts.length - 1] || ev.details;
          codeUnitStack.push({ ev, name });
          openNode(ev, name, 'code_unit');
          break;
        }
        case 'CODE_UNIT_FINISHED': {
          const opened = codeUnitStack.pop();
          if (opened) {codeUnits.push({
            name: opened.name,
            durationMs: (ev.nanoseconds - opened.ev.nanoseconds) / 1e6,
            timestamp: opened.ev.timestamp
          });}
          closeNode(ev);
          break;
        }

        case 'METHOD_ENTRY': {
          const parts = ev.details.split('|');
          const name = parts[parts.length - 1];
          methodStack.push({ ev, name });
          openNode(ev, name, 'method');
          break;
        }
        case 'METHOD_EXIT': {
          const opened = methodStack.pop();
          if (opened) {methods.push({
            name: opened.name,
            lineNumber: opened.ev.lineNumber,
            durationMs: (ev.nanoseconds - opened.ev.nanoseconds) / 1e6,
            timestamp: opened.ev.timestamp
          });}
          closeNode(ev);
          break;
        }

        case 'SOQL_EXECUTE_BEGIN': {
          const parts = ev.details.split('|');
          const query = parts[parts.length - 1] || ev.details;
          soqlStack.push({ ev, query });
          openNode(ev, `SOQL: ${query.slice(0, 60)}…`, 'soql');
          break;
        }
        case 'SOQL_EXECUTE_END': {
          const opened = soqlStack.pop();
          const rowsMatch = /Rows:(\d+)/.exec(ev.details);
          soql.push({
            query: opened?.query || 'Unknown',
            rows: rowsMatch ? Number(rowsMatch[1]) : undefined,
            durationMs: opened ? (ev.nanoseconds - opened.ev.nanoseconds) / 1e6 : undefined,
            lineNumber: opened?.ev.lineNumber,
            timestamp: opened?.ev.timestamp || ev.timestamp
          });
          closeNode(ev);
          break;
        }

        case 'DML_BEGIN': {
          const opMatch = /Op:(\w+)/.exec(ev.details);
          const rowsMatch = /Rows:(\d+)/.exec(ev.details);
          const op = opMatch ? opMatch[1] : 'UNKNOWN';
          dmlStack.push({ ev, op, rows: rowsMatch ? Number(rowsMatch[1]) : undefined });
          openNode(ev, `DML: ${op}`, 'dml');
          break;
        }
        case 'DML_END': {
          const opened = dmlStack.pop();
          dml.push({
            operation: opened?.op || 'UNKNOWN',
            rows: opened?.rows,
            durationMs: opened ? (ev.nanoseconds - opened.ev.nanoseconds) / 1e6 : undefined,
            lineNumber: opened?.ev.lineNumber,
            timestamp: opened?.ev.timestamp || ev.timestamp
          });
          closeNode(ev);
          break;
        }

        case 'CALLOUT_REQUEST':
          openNode(ev, 'CALLOUT', 'callout');
          break;
        case 'CALLOUT_RESPONSE':
          closeNode(ev);
          break;

        case 'USER_DEBUG': {
          const parts = ev.details.split('|');
          debugs.push({
            level: parts[0] || 'DEBUG',
            message: parts.slice(1).join('|'),
            lineNumber: ev.lineNumber,
            timestamp: ev.timestamp
          });
          break;
        }

        case 'EXCEPTION_THROWN': {
          const frames = parseStackTrace(ev.details);
          issues.push({
            severity: 'error',
            type: 'Exception Thrown',
            message: extractExceptionMessage(ev.details),
            lineNumber: ev.lineNumber,
            timestamp: ev.timestamp,
            context: 'An exception was thrown — check the stack trace and surrounding methods.',
            stackFrames: frames.length ? frames : undefined,
          });
          break;
        }

        case 'FATAL_ERROR': {
          const frames = parseStackTrace(ev.details);
          issues.push({
            severity: 'fatal',
            type: 'Fatal Error',
            message: extractExceptionMessage(ev.details),
            lineNumber: ev.lineNumber,
            timestamp: ev.timestamp,
            context: 'Execution was halted by this error. This is most likely the root cause.',
            stackFrames: frames.length ? frames : undefined,
          });
          break;
        }

        case 'TEST_PASS':
        case 'TEST_FAIL': {
          const parts = ev.details.split('|');
          const name = (parts[0] || '').trim() || 'Unknown';
          const message = parts.slice(1).join('|').trim();
          const passed = ev.eventType === 'TEST_PASS';
          testResults.push({
            name,
            passed,
            message: message || undefined,
            lineNumber: ev.lineNumber,
            timestamp: ev.timestamp,
          });
          if (!passed) {
            issues.push({
              severity: 'error',
              type: 'Test Failed',
              message: `${name}: ${message || 'assertion failed'}`,
              lineNumber: ev.lineNumber,
              timestamp: ev.timestamp,
              context: 'Test assertion failed. Check the assertion message and the Apex source for the failing test.',
            });
          }
          break;
        }

        case 'CUMULATIVE_LIMIT_USAGE':
          rawLimits.push(ev.raw);
          break;
        case 'LIMIT_USAGE_FOR_NS': {
          rawLimits.push(ev.raw);
          const usage = parseLimitUsageBlock(ev.details);
          if (usage) { parsedLimits.push(usage); }
          break;
        }
      }
    }

    // Read thresholds from user settings
    const config = vscode.workspace.getConfiguration('apexDoctor');
    const largeQueryThreshold = config.get<number>('largeQueryThreshold') ?? 1000;
    const soqlInLoopThreshold = config.get<number>('soqlInLoopThreshold') ?? 5;
    const slowSoqlThresholdMs = config.get<number>('slowSoqlThresholdMs') ?? 1000;
    const slowMethodThresholdMs = config.get<number>('slowMethodThresholdMs') ?? 0;
    const flaggedObjects = (config.get<string[]>('flagSoqlOnObjects') ?? [])
      .map(o => o.trim().toLowerCase())
      .filter(o => o.length > 0);

    // Heuristic: large and slow queries
    for (const q of soql) {
      if ((q.rows ?? 0) >= largeQueryThreshold) {
        issues.push({
          severity: 'warning',
          type: 'Large Query Result',
          message: `Query returned ${q.rows} rows`,
          lineNumber: q.lineNumber,
          timestamp: q.timestamp,
          context: `Query: ${q.query}`
        });
      }
      if ((q.durationMs ?? 0) >= slowSoqlThresholdMs) {
        issues.push({
          severity: 'warning',
          type: 'Slow SOQL Query',
          message: `Query took ${q.durationMs?.toFixed(2)} ms`,
          lineNumber: q.lineNumber,
          timestamp: q.timestamp,
          context: `Query: ${q.query}`
        });
      }
      if (flaggedObjects.length) {
        const fromMatch = /\bFROM\s+([A-Za-z0-9_]+)/i.exec(q.query);
        if (fromMatch) {
          const obj = fromMatch[1].toLowerCase();
          if (flaggedObjects.includes(obj)) {
            issues.push({
              severity: 'warning',
              type: 'Restricted Object Query',
              message: `Query touches monitored object "${fromMatch[1]}"`,
              lineNumber: q.lineNumber,
              timestamp: q.timestamp,
              context: `Configured via apexDoctor.flagSoqlOnObjects. Query: ${q.query}`,
            });
          }
        }
      }
    }

    // Heuristic: slow methods (only if user opted in)
    if (slowMethodThresholdMs > 0) {
      for (const m of methods) {
        if (m.durationMs >= slowMethodThresholdMs) {
          issues.push({
            severity: 'warning',
            type: 'Slow Method',
            message: `${m.name} took ${m.durationMs.toFixed(2)} ms`,
            lineNumber: m.lineNumber,
            timestamp: m.timestamp,
            context: `Threshold: ${slowMethodThresholdMs} ms (apexDoctor.slowMethodThresholdMs)`,
          });
        }
      }
    }

    // Heuristic: SOQL-in-loop detection (group by normalised query text)
    const queryFrequency = new Map<string, SoqlEntry[]>();
    for (const q of soql) {
      // Normalise bind-variable differences: :oppIds, 'abc', 12345 become placeholders
      const key = q.query
        .replace(/:\w+/g, ':?')
        .replace(/'[^']*'/g, "'?'")
        .replace(/\b\d+\b/g, '?')
        .trim();
      if (!queryFrequency.has(key)) {queryFrequency.set(key, []);}
      queryFrequency.get(key)!.push(q);
    }
    for (const [normalisedQuery, entries] of queryFrequency) {
      if (entries.length >= soqlInLoopThreshold) {
        issues.push({
          severity: 'error',
          type: 'SOQL in Loop',
          message: `Same query executed ${entries.length} times — likely inside a loop`,
          lineNumber: entries[0].lineNumber,
          timestamp: entries[0].timestamp,
          context: `Bulkify: collect IDs into a Set, then run ONE query with WHERE ... IN :ids. Query pattern: ${normalisedQuery.slice(0, 200)}`
        });
      }
    }

    // Governor limit warnings
    if (soql.length > 100) {
      issues.push({
        severity: 'error',
        type: 'SOQL Governor Limit Exceeded',
        message: `${soql.length} SOQL queries executed (synchronous limit is 100)`,
        timestamp: execStart?.timestamp || '00:00:00.000',
        context: 'Look for SOQL inside loops — the classic culprit.'
      });
    }
    if (dml.length > 150) {
      issues.push({
        severity: 'error',
        type: 'DML Governor Limit Exceeded',
        message: `${dml.length} DML statements (limit is 150)`,
        timestamp: execStart?.timestamp || '00:00:00.000',
        context: 'Bulkify your DML.'
      });
    }

    // Close any lingering flame nodes (defensive, in case the log ended mid-stack)
    while (flameStack.length > 1) {
      const node = flameStack.pop()!;
      node.endNs = flameRoot.endNs || node.startNs;
      node.durationMs = (node.endNs - node.startNs) / 1e6;
    }
    if (flameRoot.endNs === 0 && parsed.events.length > 0) {
      flameRoot.endNs = parsed.events[parsed.events.length - 1].nanoseconds;
      flameRoot.durationMs = (flameRoot.endNs - flameRoot.startNs) / 1e6;
    }

    const sortedIssues = issues.sort((a, b) => this.sev(a.severity) - this.sev(b.severity));
    const sortedMethods = methods.sort((a, b) => b.durationMs - a.durationMs).slice(0, 50);

    // De-duplicate parsed limits per namespace, keeping the most recent (highest "used") block
    const limitsByNs = new Map<string, LimitUsage>();
    for (const lu of parsedLimits) {
      const existing = limitsByNs.get(lu.namespace);
      if (!existing) {
        limitsByNs.set(lu.namespace, lu);
        continue;
      }
      const existingMax = Math.max(...existing.metrics.map(m => m.pct), 0);
      const newMax = Math.max(...lu.metrics.map(m => m.pct), 0);
      if (newMax >= existingMax) { limitsByNs.set(lu.namespace, lu); }
    }
    const limits = Array.from(limitsByNs.values());

    const preliminary: Analysis = {
      summary: {
        apiVersion: parsed.apiVersion,
        totalEvents: parsed.events.length,
        totalDurationMs: execEnd && execStart ? (execEnd.nanoseconds - execStart.nanoseconds) / 1e6 : 0,
        executionStart: execStart?.timestamp,
        executionEnd: execEnd?.timestamp,
        logLevels: parsed.logLevels
      },
      issues: sortedIssues,
      soql,
      dml,
      methods: sortedMethods,
      debugs,
      limits,
      rawLimits,
      codeUnits,
      testResults,
      flameRoot,
      insights: [],
      cpuProfile: buildCpuProfile(flameRoot, sortedMethods),
      triggerGroups: extractTriggers(parsed.events),
      asyncInvocations: extractAsyncInvocations(parsed.events),
      asyncEntryPoint: detectAsyncEntryPoint(parsed.events),
      debugLevelRecommendations: recommendDebugLevels(parsed),
    };

    preliminary.insights = generateInsights(preliminary);

    return preliminary;
  }

  private sev(s: Issue['severity']): number {
    return { fatal: 0, error: 1, warning: 2, info: 3 }[s];
  }
}

/**
 * Parse Apex stack-trace lines from an exception/fatal-error details block.
 * Recognised patterns:
 *   Class.AccountTrigger.handle: line 42, column 1
 *   Trigger.AccountTrigger: line 12, column 1
 *   AnonymousBlock: line 5, column 1
 */
function parseStackTrace(details: string): StackFrame[] {
  const frames: StackFrame[] = [];
  const re = /^\s*(?:Class\.|Trigger\.)?([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_<>]*)*?)(?:\.([A-Za-z_][A-Za-z0-9_<>]*))?\s*:\s*line\s+(\d+)(?:,\s*column\s+(\d+))?/i;
  for (const rawLine of details.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) { continue; }
    const m = re.exec(trimmed);
    if (m) {
      frames.push({
        className: m[1],
        methodName: m[2],
        line: Number(m[3]),
        column: m[4] ? Number(m[4]) : undefined,
        raw: trimmed,
      });
    }
  }
  return frames;
}

function extractExceptionMessage(details: string): string {
  const lines = details.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) { return details; }
  const stackRe = /:\s*line\s+\d+/i;
  const messageLines: string[] = [];
  for (const line of lines) {
    if (stackRe.test(line)) { break; }
    messageLines.push(line);
  }
  return messageLines.join('\n') || lines[0];
}

function parseLimitUsageBlock(detailsBlock: string): LimitUsage | undefined {
  const lines = detailsBlock.split(/\r?\n/);
  if (!lines.length) { return undefined; }
  const firstLine = lines[0] || '';
  const ns = (firstLine.split('|')[0] || '').trim() || '(default)';
  const metrics: LimitMetric[] = [];
  const lineRegex = /^\s*(?:Number of |Maximum )(.+?):\s*(\d+(?:\.\d+)?)\s+out of\s+(\d+(?:\.\d+)?)/i;
  for (const line of lines.slice(1)) {
    const m = lineRegex.exec(line);
    if (m) {
      const used = Number(m[2]);
      const limit = Number(m[3]);
      metrics.push({
        name: m[1].trim(),
        used,
        limit,
        pct: limit > 0 ? (used / limit) * 100 : 0
      });
    }
  }
  if (!metrics.length) { return undefined; }
  return { namespace: ns, metrics };
}
