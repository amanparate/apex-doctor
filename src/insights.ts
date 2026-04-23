import { Analysis, FlameNode } from './analyzer';

export interface Insight {
  icon: string;
  severity: 'good' | 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  metric?: string;
}

/**
 * Generate plain-English performance insights from an analysis.
 * All rules are deterministic — no API calls needed.
 */
export function generateInsights(a: Analysis): Insight[] {
  const insights: Insight[] = [];
  const totalMs = a.summary.totalDurationMs;

  if (totalMs <= 0) {
    return [{
      icon: 'ℹ️',
      severity: 'info',
      title: 'No execution duration captured',
      detail: 'The log did not contain EXECUTION_STARTED / EXECUTION_FINISHED events with measurable elapsed time.'
    }];
  }

  // Aggregate time by kind from the flame tree
  const timeByKind = aggregateByKind(a.flameRoot);
  const soqlMs = timeByKind.soql;
  const dmlMs = timeByKind.dml;
  const calloutMs = timeByKind.callout;
  const methodMs = Math.max(0, timeByKind.method - soqlMs - dmlMs - calloutMs);
  const otherMs = Math.max(0, totalMs - soqlMs - dmlMs - calloutMs - methodMs);

  const pct = (ms: number) => Math.round((ms / totalMs) * 100);

  // --- Rule: SOQL dominance ---
  if (pct(soqlMs) >= 40) {
    insights.push({
      icon: '🗃️',
      severity: 'critical',
      title: `${pct(soqlMs)}% of runtime is SOQL`,
      detail: `${a.soql.length} queries took ${soqlMs.toFixed(0)} ms combined. Database access is the dominant cost — look for opportunities to cache, query less, or use selective filters.`,
      metric: `${soqlMs.toFixed(0)} ms · ${a.soql.length} queries`
    });
  } else if (pct(soqlMs) >= 20) {
    insights.push({
      icon: '🗃️',
      severity: 'warning',
      title: `${pct(soqlMs)}% of runtime is SOQL`,
      detail: `${a.soql.length} queries took ${soqlMs.toFixed(0)} ms combined. Consider whether any can be batched or cached.`,
      metric: `${soqlMs.toFixed(0)} ms · ${a.soql.length} queries`
    });
  }

  // --- Rule: Single expensive query ---
  if (a.soql.length) {
    const slowest = [...a.soql].sort((x, y) => (y.durationMs ?? 0) - (x.durationMs ?? 0))[0];
    if (slowest && (slowest.durationMs ?? 0) > 0 && pct(slowest.durationMs!) >= 15) {
      insights.push({
        icon: '🐌',
        severity: (slowest.durationMs! / totalMs) > 0.3 ? 'critical' : 'warning',
        title: `One query took ${pct(slowest.durationMs!)}% of total runtime`,
        detail: `A single query returning ${slowest.rows ?? '?'} rows used ${slowest.durationMs!.toFixed(0)} ms. Review selectivity and indexes for: ${slowest.query.slice(0, 140)}${slowest.query.length > 140 ? '…' : ''}`,
        metric: `${slowest.durationMs!.toFixed(0)} ms · ${slowest.rows ?? '?'} rows`
      });
    }
  }

  // --- Rule: DML dominance ---
  if (pct(dmlMs) >= 30) {
    insights.push({
      icon: '✏️',
      severity: pct(dmlMs) >= 50 ? 'critical' : 'warning',
      title: `${pct(dmlMs)}% of runtime is DML`,
      detail: `${a.dml.length} DML operations took ${dmlMs.toFixed(0)} ms combined. Bulkify and combine inserts/updates where possible.`,
      metric: `${dmlMs.toFixed(0)} ms · ${a.dml.length} ops`
    });
  }

  // --- Rule: Callout dominance ---
  if (calloutMs > 0 && pct(calloutMs) >= 20) {
    insights.push({
      icon: '📡',
      severity: pct(calloutMs) >= 50 ? 'critical' : 'warning',
      title: `${pct(calloutMs)}% of runtime is external callouts`,
      detail: `Callouts took ${calloutMs.toFixed(0)} ms. Consider async patterns (@future, Queueable) or caching external responses.`,
      metric: `${calloutMs.toFixed(0)} ms`
    });
  }

  // --- Rule: SOQL-in-loop detection feeds here ---
  const soqlInLoop = a.issues.find(i => i.type === 'SOQL in Loop');
  if (soqlInLoop) {
    insights.push({
      icon: '🔁',
      severity: 'critical',
      title: 'SOQL-in-loop detected',
      detail: `${soqlInLoop.message}. This is a classic anti-pattern — each loop iteration hits the database. Bulkify by collecting IDs into a Set, then running ONE query with WHERE ... IN :ids.`
    });
  }

  // --- Rule: Governor limits near ceiling ---
  if (a.soql.length >= 80 && a.soql.length <= 100) {
    insights.push({
      icon: '⚠️',
      severity: 'warning',
      title: `${a.soql.length}/100 SOQL queries — close to the governor limit`,
      detail: `You have ${100 - a.soql.length} queries of headroom. Review whether any queries can be consolidated.`
    });
  }
  if (a.dml.length >= 120 && a.dml.length <= 150) {
    insights.push({
      icon: '⚠️',
      severity: 'warning',
      title: `${a.dml.length}/150 DML operations — close to the governor limit`,
      detail: `You have ${150 - a.dml.length} DML operations of headroom.`
    });
  }

  // --- Rule: Fatal error present ---
  const fatal = a.issues.find(i => i.severity === 'fatal');
  if (fatal) {
    insights.push({
      icon: '🛑',
      severity: 'critical',
      title: 'Execution halted by fatal error',
      detail: `${fatal.type} at line ${fatal.lineNumber ?? '?'}. Everything below this point in the transaction was rolled back. Fix the root cause before optimising anything else.`
    });
  }

  // --- Rule: CPU-bound ---
  const interactiveMs = soqlMs + dmlMs + calloutMs;
  if (pct(interactiveMs) < 30 && totalMs > 100) {
    insights.push({
      icon: '⚙️',
      severity: 'info',
      title: 'Transaction is CPU-bound',
      detail: `Only ${pct(interactiveMs)}% of time is spent on SOQL/DML/Callouts — the rest is method execution. If this is too slow, profile the slowest methods and look for inefficient loops or nested iterations.`,
      metric: `${methodMs.toFixed(0)} ms method time`
    });
  }

  // --- Rule: Healthy execution ---
  if (insights.length === 0 && totalMs < 2000 && !a.issues.some(i => i.severity === 'error' || i.severity === 'fatal')) {
    insights.push({
      icon: '✅',
      severity: 'good',
      title: 'Execution looks healthy',
      detail: `${totalMs.toFixed(0)} ms total · ${a.soql.length} SOQL · ${a.dml.length} DML · no governor limit concerns detected.`
    });
  }

  // --- Always include a time breakdown card ---
  insights.push({
    icon: '📊',
    severity: 'info',
    title: 'Time breakdown',
    detail: [
      pct(soqlMs) > 0 ? `SOQL ${pct(soqlMs)}%` : null,
      pct(dmlMs) > 0 ? `DML ${pct(dmlMs)}%` : null,
      pct(calloutMs) > 0 ? `Callouts ${pct(calloutMs)}%` : null,
      pct(methodMs) > 0 ? `Methods ${pct(methodMs)}%` : null,
      pct(otherMs) > 0 ? `Other ${pct(otherMs)}%` : null
    ].filter(Boolean).join(' · '),
    metric: `${totalMs.toFixed(0)} ms total`
  });

  return insights;
}

function aggregateByKind(node: FlameNode): Record<string, number> {
  const totals: Record<string, number> = { code_unit: 0, method: 0, soql: 0, dml: 0, callout: 0, root: 0 };
  walk(node);
  return totals;

  function walk(n: FlameNode) {
    if (n.kind !== 'root') {
      totals[n.kind] = (totals[n.kind] || 0) + n.durationMs;
    }
    for (const c of n.children) {walk(c);}
  }
}