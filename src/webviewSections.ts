import { Analysis } from "./analyzer";
import { MethodAggregate } from "./profiler";
import { HeapAllocator, formatBytes } from "./heapProfiler";
import { TriggerPhaseGroup } from "./triggerOrder";
import { FlowExecution } from "./flowAnalysis";
import { AsyncInvocation, AsyncLink } from "./asyncTracer";
import { DebugLevelRecommendation } from "./debugLevelAdvisor";
import { RecurringPatterns } from "./recurringPatterns";
import { SaveCycle } from "./orderOfExecution";
import { JourneyEntry } from "./journey";

export function escapeHtml(s: string): string {
  return (s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

const fmt = (n?: number) => (n ?? 0).toFixed(2);
const pct = (n: number) => `${n.toFixed(1)}%`;

function classLink(name: string, line?: number): string {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\./.exec(name);
  if (!match) {
    return `<code>${escapeHtml(name)}</code>`;
  }
  const className = match[1];
  return `<a href="#" class="class-link" data-class="${escapeHtml(className)}" data-line="${line ?? ""}"><code>${escapeHtml(name)}</code></a>`;
}

export function renderCpuProfiler(a: Analysis): string {
  const profile = a.cpuProfile;
  if (!profile.totalMs || !profile.bySelf.length) {
    return `<p class="muted">Not enough method-timing data to build a profile. Set <code>APEX_PROFILING</code> to <code>FINE</code> or higher in your debug level.</p>`;
  }

  const hotLeaf = profile.hotLeaf;
  const hotLeafSummary = hotLeaf
    ? `<div class="hot-leaf">
         <div class="muted">Bottleneck — ${pct((hotLeaf.selfMs / profile.totalMs) * 100)} of total CPU time spent here</div>
         <div class="hot-leaf-name">${classLink(hotLeaf.name, hotLeaf.lineNumber)}</div>
         <div class="muted small">${fmt(hotLeaf.selfMs)} ms self · ${fmt(hotLeaf.totalMs)} ms total · ${hotLeaf.kind}</div>
       </div>`
    : "";

  const hotPathHtml = profile.hotPath.length
    ? `<div class="hot-path">
        <div class="muted small">HOT PATH — root → bottleneck</div>
        <ol class="hot-path-list">
          ${profile.hotPath
            .map(
              (n, idx) => `
            <li class="hot-path-step">
              <span class="step-num">${idx + 1}</span>
              ${classLink(n.name, n.lineNumber)}
              <span class="muted small">${fmt(n.totalMs)} ms total · ${fmt(n.selfMs)} ms self</span>
            </li>`,
            )
            .join("")}
        </ol>
      </div>`
    : "";

  const aggregateRow = (m: MethodAggregate) => `
    <tr>
      <td>${classLink(m.name, m.lineNumber)}</td>
      <td class="num">${fmt(m.selfMs)}</td>
      <td class="num">${fmt(m.totalMs)}</td>
      <td class="num">${m.callCount}</td>
      <td class="num">${pct(m.pctOfTotal)}</td>
      <td>
        <div class="bar-cell">
          <div class="bar-fill" style="width:${Math.min(100, m.pctOfTotal).toFixed(1)}%"></div>
        </div>
      </td>
    </tr>`;

  return `
    ${hotLeafSummary}
    ${hotPathHtml}

    <h3>Hottest by self time</h3>
    <p class="muted small">Time spent <em>directly</em> in this method, excluding child calls.</p>
    <table class="profile-table">
      <thead><tr><th>Method</th><th class="num">Self ms</th><th class="num">Total ms</th><th class="num">Calls</th><th class="num">% of total</th><th>Bar</th></tr></thead>
      <tbody>${profile.bySelf.slice(0, 20).map(aggregateRow).join("")}</tbody>
    </table>

    <h3>Hottest by total time</h3>
    <p class="muted small">Time spent in this method <em>and</em> its children. Useful for identifying high-level hotspots.</p>
    <table class="profile-table">
      <thead><tr><th>Method</th><th class="num">Self ms</th><th class="num">Total ms</th><th class="num">Calls</th><th class="num">% of total</th><th>Bar</th></tr></thead>
      <tbody>${profile.byTotal.slice(0, 20).map(aggregateRow).join("")}</tbody>
    </table>
  `;
}

export function renderHeapProfiler(a: Analysis): string {
  const heap = a.heapProfile;
  if (!heap.allocationCount) {
    return `<p class="muted">No heap allocations captured. Heap attribution needs <code>APEX_PROFILING</code> at <code>FINEST</code> (or a debug level that emits <code>HEAP_ALLOCATE</code>).</p>`;
  }

  const top = heap.topAllocator;
  const peakLine =
    heap.peakHeapBytes !== undefined && heap.heapLimitBytes
      ? `<div class="muted small">Peak live heap: ${formatBytes(heap.peakHeapBytes)} of ${formatBytes(heap.heapLimitBytes)} (${(heap.pctOfLimit ?? 0).toFixed(0)}%)</div>`
      : "";
  const headline = top
    ? `<div class="hot-leaf">
         <div class="muted">Biggest allocator — ${pct(top.pctOfTotal)} of all allocated bytes</div>
         <div class="hot-leaf-name">${classLink(top.name, top.lineNumber)}</div>
         <div class="muted small">${formatBytes(top.bytes)} across ${top.count} allocation${top.count === 1 ? "" : "s"}</div>
         ${peakLine}
       </div>`
    : "";

  const row = (m: HeapAllocator) => `
    <tr>
      <td>${classLink(m.name, m.lineNumber)}</td>
      <td class="num">${formatBytes(m.bytes)}</td>
      <td class="num">${m.count}</td>
      <td class="num">${pct(m.pctOfTotal)}</td>
      <td>
        <div class="bar-cell">
          <div class="bar-fill" style="width:${Math.min(100, m.pctOfTotal).toFixed(1)}%"></div>
        </div>
      </td>
    </tr>`;

  return `
    <h2>Heap / Memory</h2>
    <p class="muted small">Total allocated: <strong>${formatBytes(heap.totalAllocatedBytes)}</strong> across ${heap.allocationCount} allocations. Bytes are attributed to the enclosing method.</p>
    ${headline}
    <h3>Biggest allocators</h3>
    <table class="profile-table">
      <thead><tr><th>Allocator</th><th class="num">Bytes</th><th class="num">Allocs</th><th class="num">% of total</th><th>Bar</th></tr></thead>
      <tbody>${heap.byAllocator.slice(0, 20).map(row).join("")}</tbody>
    </table>
  `;
}

export function renderFlows(flows: FlowExecution[]): string {
  if (!flows.length) {
    return "";
  }
  return `
    <h2>Flows &amp; Process Builder</h2>
    <p class="muted small">Flow interviews with per-element timing. Elements that ran many times are likely loop-bound.</p>
    ${flows
      .map(
        (f) => `
      <div class="trigger-phase">
        <div class="phase-header">
          <strong>${escapeHtml(f.flowName)}</strong>
          <span class="muted small">${fmt(f.totalDurationMs)} ms total · ${f.elements.length} element${f.elements.length === 1 ? "" : "s"}</span>
        </div>
        <ol class="trigger-list">
          ${f.elements
            .map((e) => {
              const isSlow = e.name === f.slowestName && f.elements.length > 1;
              const looped = f.loopedElements.includes(e.name);
              return `<li class="trigger-row ${isSlow ? "trigger-slow" : ""}">
                <span class="trigger-name"><code>${escapeHtml(e.name)}</code></span>
                <span class="muted small">${escapeHtml(e.elementType)} · ${fmt(e.durationMs)} ms${e.executions > 1 ? ` · ×${e.executions}` : ""}</span>
                ${e.dbBearing ? `<span class="recursive-pill">DB</span>` : ""}
                ${looped ? `<span class="slow-pill">in loop</span>` : ""}
              </li>`;
            })
            .join("")}
        </ol>
      </div>
    `,
      )
      .join("")}
  `;
}

export function renderOrderOfExecution(cycles: SaveCycle[]): string {
  if (!cycles.length) {
    return "";
  }
  const cycle = (c: SaveCycle, idx: number) => `
    <div class="ooe-cycle">
      <div class="ooe-header">
        <strong>${escapeHtml(c.operation ?? "Save")}${c.sObject ? ` · ${escapeHtml(c.sObject)}` : ""}</strong>
        <span class="muted small">@ ${escapeHtml(c.timestamp)}</span>
        ${c.reEntry ? `<span class="slow-pill">↻ triggers re-fired</span>` : ""}
      </div>
      <ol class="ooe-steps">
        ${c.steps
          .map((s) => {
            const cls = s.fired ? "fired" : s.observable ? "silent" : "implicit";
            const meta = s.fired
              ? `${s.detail ? escapeHtml(s.detail) : `${s.count} event${s.count === 1 ? "" : "s"}`}`
              : s.observable
                ? "did not fire"
                : "not visible in logs";
            return `<li class="ooe-step ooe-${cls}">
              <span class="ooe-dot"></span>
              <span class="ooe-label">${escapeHtml(s.label)}</span>
              <span class="muted small">${meta}</span>
            </li>`;
          })
          .join("")}
      </ol>
    </div>${idx < cycles.length - 1 ? '<div class="ooe-divider"></div>' : ""}`;

  return `
    <h2>Order of Execution</h2>
    <p class="muted small">The canonical Salesforce save order, reconstructed from this transaction. Greyed steps never emit log events; dimmed steps emit events but didn't fire here.</p>
    ${cycles.map(cycle).join("")}
  `;
}

export function renderJourneyStrip(journey: JourneyEntry[]): string {
  if (!journey.length) {
    return "";
  }
  const chips = journey
    .map((j) => {
      const error = j.errorCount > 0 ? `<span class="journey-err">⚠ ${j.errorCount}</span>` : "";
      const body = `
        <span class="journey-time">${escapeHtml(j.startedAt ?? "")}</span>
        <span class="journey-label">${escapeHtml(j.label)}</span>
        <span class="muted small">${j.totalDurationMs.toFixed(0)} ms</span>
        ${error}`;
      return j.isCurrent
        ? `<span class="journey-chip current" title="This log">${body}</span>`
        : `<a href="#" class="journey-chip" data-journey-id="${escapeHtml(j.id)}" title="Open this log's analysis">${body}</a>`;
    })
    .join('<span class="journey-arrow">→</span>');

  return `
    <h2>User Journey</h2>
    <p class="muted small">${journey.length} logs from the same action, stitched by execution time. Click a chip to hop between them.</p>
    <div class="journey-strip">${chips}</div>
  `;
}

export function renderTriggerOrder(groups: TriggerPhaseGroup[]): string {
  if (!groups.length) {
    return "";
  }
  return `
    <h2>Trigger Order</h2>
    <p class="muted small">Order in which triggers fired, grouped by sObject and DML phase.</p>
    ${groups
      .map(
        (g) => `
      <div class="trigger-phase">
        <div class="phase-header">
          <strong>${escapeHtml(g.sObject)}</strong>
          <span class="phase-pill">${escapeHtml(g.phase)}</span>
          <span class="muted small">${fmt(g.totalDurationMs)} ms total · ${g.triggers.length} trigger${g.triggers.length === 1 ? "" : "s"}</span>
        </div>
        <ol class="trigger-list">
          ${g.triggers
            .map((t) => {
              const isSlow = t.name === g.slowestName && g.triggers.length > 1;
              return `<li class="trigger-row ${isSlow ? "trigger-slow" : ""}">
                <span class="trigger-name">${classLink(t.name, t.lineNumber)}</span>
                <span class="muted small">${fmt(t.durationMs)} ms</span>
                ${t.recursive ? `<span class="recursive-pill">recursive</span>` : ""}
                ${isSlow ? `<span class="slow-pill">slowest</span>` : ""}
              </li>`;
            })
            .join("")}
        </ol>
      </div>
    `,
      )
      .join("")}
  `;
}

export function renderAsyncTracer(
  invocations: AsyncInvocation[],
  links: AsyncLink[],
  entryPoint?: Analysis["asyncEntryPoint"],
): string {
  if (!invocations.length && !entryPoint) {
    return "";
  }

  const entryHtml = entryPoint
    ? `<div class="async-entry">
        <div class="muted small">This log is itself an async execution</div>
        <div><strong>${escapeHtml(entryPoint.kind)}</strong> entry: ${classLink(entryPoint.className + (entryPoint.methodName ? "." + entryPoint.methodName : ""))}</div>
        <div class="muted small">started ${escapeHtml(entryPoint.startedAt)}${entryPoint.durationMs ? ` · ran for ${fmt(entryPoint.durationMs)} ms` : ""}</div>
      </div>`
    : "";

  const linkRow = (l: AsyncLink) => {
    const matched = l.childLogLabel ? "matched" : "unmatched";
    const conf = l.confidence > 0 ? `${Math.round(l.confidence * 100)}%` : "—";
    return `
      <div class="async-row async-${matched}">
        <div class="async-kind">${escapeHtml(l.parent.kind)}</div>
        <div class="async-class">${classLink(l.parent.className + (l.parent.methodName ? "." + l.parent.methodName : ""), l.parent.lineNumber)}</div>
        <div class="async-link">
          ${
            l.childLogLabel
              ? `<span class="muted small">↳ ${escapeHtml(l.childLogLabel)} · started ${escapeHtml(l.childStartedAt ?? "?")}${l.childDurationMs ? ` · ${fmt(l.childDurationMs)} ms` : ""}</span>`
              : `<span class="muted small">↳ no matching log found in recent history</span>`
          }
        </div>
        <div class="async-confidence muted small">${conf}</div>
      </div>`;
  };

  const invocationsHtml = links.length
    ? `<div class="async-grid">
        <div class="async-header">
          <div>Kind</div><div>Class</div><div>Linked log</div><div>Confidence</div>
        </div>
        ${links.map(linkRow).join("")}
      </div>`
    : "";

  return `
    <h2>Async Operations</h2>
    ${entryHtml}
    ${invocationsHtml}
  `;
}

export function renderDebugLevelRecs(recs: DebugLevelRecommendation[]): string {
  if (!recs.length) {
    return "";
  }
  return `
    <h2>Debug Level Recommendations</h2>
    <p class="muted small">Adjust your trace flag's debug level to match what this log actually needs.</p>
    <div class="dlr-grid">
      ${recs
        .map(
          (r) => `
        <div class="dlr-card dlr-${r.direction}">
          <div class="dlr-cat">${escapeHtml(r.category)}</div>
          <div class="dlr-line">
            <code>${escapeHtml(r.currentLevel ?? "off")}</code>
            <span class="dlr-arrow">→</span>
            <code class="dlr-rec">${escapeHtml(r.recommendedLevel)}</code>
          </div>
          <div class="muted small">${escapeHtml(r.reason)}</div>
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}

export function renderRecurringBanner(p: RecurringPatterns | undefined): string {
  if (!p || !p.issues.length) {
    return "";
  }
  const top = p.issues.slice(0, 3);
  return `
    <div class="recurring-banner">
      <div class="recurring-title">⚠️ Recurring issues detected (last ${p.analysesExamined} analyses)</div>
      ${top
        .map(
          (i) => `
        <div class="recurring-row">
          <span class="recurring-count recurring-${i.severity}">×${i.occurrences}</span>
          <span class="recurring-type">${escapeHtml(i.type)}</span>
          ${i.lineNumber ? `<a href="#" class="line-link" data-line="${i.lineNumber}">line ${i.lineNumber}</a>` : ""}
          <span class="muted small">${escapeHtml(i.message.slice(0, 100))}${i.message.length > 100 ? "…" : ""}</span>
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}

export function tabSwitchingCss(): string {
  return `
    .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--vscode-panel-border); margin: 12px 0 16px; }
    .tab-btn { background: transparent; color: var(--vscode-foreground); border: none; padding: 6px 14px; cursor: pointer; font-size: 13px; opacity: 0.65; border-bottom: 2px solid transparent; border-radius: 0; }
    .tab-btn:hover { opacity: 1; background: transparent; }
    .tab-btn.active { opacity: 1; border-bottom-color: var(--vscode-textLink-foreground); }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }
    .hot-leaf { padding: 12px 16px; background: var(--vscode-editorWidget-background); border-left: 3px solid #ef4444; border-radius: 4px; margin-bottom: 12px; }
    .hot-leaf-name { font-size: 16px; font-weight: 600; margin: 4px 0; }
    .hot-path { padding: 12px 16px; background: var(--vscode-editorWidget-background); border-radius: 4px; margin-bottom: 12px; }
    .hot-path-list { list-style: none; padding: 0; margin: 6px 0 0; }
    .hot-path-step { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 13px; }
    .step-num { display: inline-block; width: 18px; height: 18px; border-radius: 9px; background: var(--vscode-textLink-foreground); color: var(--vscode-button-foreground); text-align: center; font-size: 10px; line-height: 18px; }
    .profile-table .num { text-align: right; font-family: var(--vscode-editor-font-family); font-size: 12px; }
    .bar-cell { background: var(--vscode-editorWidget-background); height: 8px; border-radius: 4px; overflow: hidden; min-width: 80px; }
    .bar-fill { height: 100%; background: var(--vscode-textLink-foreground); opacity: 0.5; transition: width 0.2s ease; }
    .small { font-size: 11px; }
    .trigger-phase { margin: 12px 0; padding: 10px 12px; background: var(--vscode-editorWidget-background); border-radius: 4px; }
    .phase-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .phase-pill { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; padding: 2px 8px; border-radius: 10px; background: var(--vscode-badge-background, #3b82f6); color: var(--vscode-badge-foreground, #fff); }
    .trigger-list { list-style: decimal; padding-left: 28px; margin: 4px 0; }
    .trigger-row { display: flex; align-items: center; gap: 8px; padding: 2px 0; font-size: 13px; }
    .trigger-row.trigger-slow .trigger-name { font-weight: 600; }
    .recursive-pill { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
    .slow-pill { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: rgba(239, 68, 68, 0.15); color: #ef4444; }
    .async-entry { padding: 12px 16px; background: var(--vscode-editorWidget-background); border-left: 3px solid var(--vscode-textLink-foreground); border-radius: 4px; margin-bottom: 12px; }
    .async-grid { display: grid; gap: 0; margin-top: 8px; }
    .async-header { display: grid; grid-template-columns: 100px 1fr 1.5fr 80px; gap: 12px; padding: 6px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.6; border-bottom: 1px solid var(--vscode-panel-border); }
    .async-row { display: grid; grid-template-columns: 100px 1fr 1.5fr 80px; gap: 12px; padding: 6px 8px; font-size: 12px; align-items: center; border-bottom: 1px solid var(--vscode-panel-border); }
    .async-kind { text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; opacity: 0.7; }
    .async-matched { background: rgba(34, 197, 94, 0.05); }
    .async-unmatched { opacity: 0.7; }
    .dlr-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; margin-top: 8px; }
    .dlr-card { padding: 10px 12px; background: var(--vscode-editorWidget-background); border-left: 3px solid; border-radius: 4px; }
    .dlr-card.dlr-increase { border-color: #22c55e; }
    .dlr-card.dlr-decrease { border-color: #f59e0b; }
    .dlr-cat { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.7; }
    .dlr-line { font-size: 14px; margin: 2px 0 4px; }
    .dlr-arrow { margin: 0 6px; opacity: 0.6; }
    .dlr-rec { color: var(--vscode-textLink-foreground); font-weight: 600; }
    .recurring-banner { padding: 12px 16px; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 6px; margin: 12px 0; }
    .recurring-title { font-weight: 600; margin-bottom: 8px; }
    .recurring-row { display: flex; align-items: center; gap: 8px; padding: 2px 0; font-size: 13px; }
    .recurring-count { display: inline-block; min-width: 36px; text-align: center; font-family: var(--vscode-editor-font-family); font-size: 12px; padding: 1px 6px; border-radius: 10px; }
    .recurring-count.recurring-info { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
    .recurring-count.recurring-warning { background: rgba(245, 158, 11, 0.2); color: #f59e0b; }
    .recurring-count.recurring-critical { background: rgba(239, 68, 68, 0.2); color: #ef4444; }
    .recurring-type { font-weight: 600; }
    /* Order of execution */
    .ooe-cycle { padding: 12px 16px; background: var(--vscode-editorWidget-background); border-radius: 6px; margin: 10px 0; }
    .ooe-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .ooe-steps { list-style: none; margin: 0; padding: 0; position: relative; }
    .ooe-steps::before { content: ''; position: absolute; left: 5px; top: 8px; bottom: 8px; width: 2px; background: var(--vscode-panel-border); }
    .ooe-step { display: flex; align-items: baseline; gap: 10px; padding: 3px 0 3px 0; font-size: 13px; position: relative; }
    .ooe-dot { width: 12px; height: 12px; border-radius: 6px; flex: none; position: relative; z-index: 1; background: var(--vscode-editor-background); border: 2px solid var(--vscode-panel-border); }
    .ooe-fired .ooe-dot { background: var(--vscode-textLink-foreground); border-color: var(--vscode-textLink-foreground); }
    .ooe-fired .ooe-label { font-weight: 600; }
    .ooe-silent { opacity: 0.55; }
    .ooe-implicit { opacity: 0.35; }
    .ooe-implicit .ooe-dot { border-style: dashed; }
    .ooe-divider { height: 8px; }
    /* Journey strip */
    .journey-strip { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 10px 12px; background: var(--vscode-editorWidget-background); border-radius: 6px; }
    .journey-chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 14px; font-size: 12px; text-decoration: none; color: var(--vscode-foreground); background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); }
    a.journey-chip:hover { border-color: var(--vscode-textLink-foreground); }
    .journey-chip.current { border-color: var(--vscode-textLink-foreground); box-shadow: 0 0 0 1px var(--vscode-textLink-foreground); }
    .journey-time { font-family: var(--vscode-editor-font-family); font-size: 11px; opacity: 0.7; }
    .journey-label { font-weight: 600; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .journey-err { color: #ef4444; font-size: 11px; }
    .journey-arrow { opacity: 0.5; }
    /* Overview navigator chips */
    .navchips { display: flex; gap: 8px; flex-wrap: wrap; margin: 14px 0 4px; }
    .navchip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 14px; font-size: 12px; cursor: pointer; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); color: var(--vscode-foreground); }
    .navchip:hover { border-color: var(--vscode-textLink-foreground); background: var(--vscode-editorWidget-background); }
    .navchip .navchip-k { opacity: 0.6; }
    /* Assistant drawer */
    .assistant-drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(480px, 92vw); background: var(--vscode-editor-background); border-left: 1px solid var(--vscode-panel-border); box-shadow: -8px 0 24px rgba(0,0,0,0.35); z-index: 1000; display: none; flex-direction: column; }
    .assistant-drawer.open { display: flex; }
    .assistant-head { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--vscode-panel-border); }
    .assistant-head h3 { margin: 0; font-size: 14px; flex: 1; }
    .assistant-body { flex: 1; overflow-y: auto; padding: 12px 16px; }
    .assistant-close { background: transparent; color: var(--vscode-foreground); border: none; font-size: 16px; cursor: pointer; padding: 2px 8px; }
    .assistant-section-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.6; margin: 14px 0 6px; }
  `;
}

export function tabSwitchingScript(): string {
  return `
    (function() {
      const persistKey = 'apexDoctor.activeTab';
      const tabs = document.querySelectorAll('.tab-btn');
      const panels = document.querySelectorAll('.tab-panel');
      const validIds = new Set([...panels].map(p => p.dataset.panel));
      function activate(id) {
        if (!validIds.has(id)) { id = 'overview'; }
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === id));
        panels.forEach(p => p.classList.toggle('active', p.dataset.panel === id));
        const state = vscode.getState() || {};
        state[persistKey] = id;
        vscode.setState(state);
      }
      window.__activateTab = activate;
      tabs.forEach(t => t.addEventListener('click', () => activate(t.dataset.tab)));
      // Navigator chips on Overview jump to their tab
      document.querySelectorAll('.navchip[data-tab]').forEach(c =>
        c.addEventListener('click', () => activate(c.dataset.tab)));
      // Journey chips open sibling analyses
      document.querySelectorAll('.journey-chip[data-journey-id]').forEach(c =>
        c.addEventListener('click', (e) => {
          e.preventDefault();
          vscode.postMessage({ command: 'openJourneyEntry', id: c.dataset.journeyId });
        }));
      const persisted = (vscode.getState() || {})[persistKey];
      activate(persisted || 'overview');
    })();
  `;
}
