import { ParsedLog, LogEvent } from './parser';

export interface Issue {
  severity: 'fatal' | 'error' | 'warning' | 'info';
  type: string;
  message: string;
  lineNumber?: number;
  timestamp: string;
  context?: string;
}

export interface SoqlEntry { query: string; rows?: number; durationMs?: number; lineNumber?: number; timestamp: string; }
export interface DmlEntry { operation: string; rows?: number; durationMs?: number; lineNumber?: number; timestamp: string; }
export interface MethodEntry { name: string; lineNumber?: number; durationMs: number; timestamp: string; }
export interface DebugEntry { level: string; message: string; lineNumber?: number; timestamp: string; }

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
  limits: string[];
  codeUnits: { name: string; durationMs: number; timestamp: string }[];
  userInfo?: { Name: string; Username: string; Email: string; ProfileName?: string };
}

export class ApexLogAnalyzer {
  analyze(parsed: ParsedLog): Analysis {
    const issues: Issue[] = [];
    const soql: SoqlEntry[] = [];
    const dml: DmlEntry[] = [];
    const methods: MethodEntry[] = [];
    const debugs: DebugEntry[] = [];
    const limits: string[] = [];
    const codeUnits: { name: string; durationMs: number; timestamp: string }[] = [];

    let execStart: LogEvent | undefined;
    let execEnd: LogEvent | undefined;

    const methodStack: { ev: LogEvent; name: string }[] = [];
    const soqlStack: { ev: LogEvent; query: string }[] = [];
    const dmlStack: { ev: LogEvent; op: string; rows?: number }[] = [];
    const codeUnitStack: { ev: LogEvent; name: string }[] = [];

    for (const ev of parsed.events) {
      switch (ev.eventType) {
        case 'EXECUTION_STARTED': execStart = ev; break;
        case 'EXECUTION_FINISHED': execEnd = ev; break;

        case 'CODE_UNIT_STARTED': {
          const parts = ev.details.split('|');
          codeUnitStack.push({ ev, name: parts[parts.length - 1] || ev.details });
          break;
        }
        case 'CODE_UNIT_FINISHED': {
          const opened = codeUnitStack.pop();
          if (opened) codeUnits.push({
            name: opened.name,
            durationMs: (ev.nanoseconds - opened.ev.nanoseconds) / 1e6,
            timestamp: opened.ev.timestamp
          });
          break;
        }

        case 'METHOD_ENTRY': {
          const parts = ev.details.split('|');
          methodStack.push({ ev, name: parts[parts.length - 1] });
          break;
        }
        case 'METHOD_EXIT': {
          const opened = methodStack.pop();
          if (opened) methods.push({
            name: opened.name,
            lineNumber: opened.ev.lineNumber,
            durationMs: (ev.nanoseconds - opened.ev.nanoseconds) / 1e6,
            timestamp: opened.ev.timestamp
          });
          break;
        }

        case 'SOQL_EXECUTE_BEGIN': {
          const parts = ev.details.split('|');
          soqlStack.push({ ev, query: parts[parts.length - 1] || ev.details });
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
          break;
        }

        case 'DML_BEGIN': {
          const opMatch = /Op:(\w+)/.exec(ev.details);
          const rowsMatch = /Rows:(\d+)/.exec(ev.details);
          dmlStack.push({
            ev,
            op: opMatch ? opMatch[1] : 'UNKNOWN',
            rows: rowsMatch ? Number(rowsMatch[1]) : undefined
          });
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
          break;
        }

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

        case 'EXCEPTION_THROWN':
          issues.push({
            severity: 'error',
            type: 'Exception Thrown',
            message: ev.details,
            lineNumber: ev.lineNumber,
            timestamp: ev.timestamp,
            context: 'An exception was thrown — check the stack trace and surrounding methods.'
          });
          break;

        case 'FATAL_ERROR':
          issues.push({
            severity: 'fatal',
            type: 'Fatal Error',
            message: ev.details,
            lineNumber: ev.lineNumber,
            timestamp: ev.timestamp,
            context: 'Execution was halted by this error. This is most likely the root cause.'
          });
          break;

        case 'CUMULATIVE_LIMIT_USAGE':
        case 'LIMIT_USAGE_FOR_NS':
          limits.push(ev.raw);
          break;
      }
    }

    // Heuristic warnings
    for (const q of soql) {
      if ((q.rows ?? 0) > 1000) {
        issues.push({
          severity: 'warning',
          type: 'Large Query Result',
          message: `Query returned ${q.rows} rows`,
          lineNumber: q.lineNumber,
          timestamp: q.timestamp,
          context: `Query: ${q.query}`
        });
      }
      if ((q.durationMs ?? 0) > 1000) {
        issues.push({
          severity: 'warning',
          type: 'Slow SOQL Query',
          message: `Query took ${q.durationMs?.toFixed(2)} ms`,
          lineNumber: q.lineNumber,
          timestamp: q.timestamp,
          context: `Query: ${q.query}`
        });
      }
    }
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

    return {
      summary: {
        apiVersion: parsed.apiVersion,
        totalEvents: parsed.events.length,
        totalDurationMs: execEnd && execStart ? (execEnd.nanoseconds - execStart.nanoseconds) / 1e6 : 0,
        executionStart: execStart?.timestamp,
        executionEnd: execEnd?.timestamp,
        logLevels: parsed.logLevels
      },
      issues: issues.sort((a, b) => this.sev(a.severity) - this.sev(b.severity)),
      soql,
      dml,
      methods: methods.sort((a, b) => b.durationMs - a.durationMs).slice(0, 50),
      debugs,
      limits,
      codeUnits
    };
  }

  private sev(s: Issue['severity']): number {
    return { fatal: 0, error: 1, warning: 2, info: 3 }[s];
  }
}