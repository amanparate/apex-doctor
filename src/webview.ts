import { Analysis } from './analyzer';
import { renderAreaChartHtml } from './areaChart';
import { Insight } from './insights';


function renderInsightsHtml(insights: Insight[]): string {
  if (!insights.length) {return '';}
  return `<div class="insights">
    ${insights.map(i => `
      <div class="insight insight-${i.severity}">
        <div class="insight-icon">${i.icon}</div>
        <div class="insight-body">
          <div class="insight-title">${escapeHtml(i.title)}</div>
          <div class="insight-detail">${escapeHtml(i.detail)}</div>
          ${i.metric ? `<div class="insight-metric">${escapeHtml(i.metric)}</div>` : ''}
        </div>
      </div>
    `).join('')}
  </div>`;
}

function escapeHtml(s: string): string {
  return (s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function renderAnalysisHtml(a: Analysis): string {
  const fmt = (n?: number) => (n ?? 0).toFixed(2);
  const esc = (s: string) =>
    (s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)
    );

  const issuesHtml = a.issues.length
    ? a.issues.map((i, idx) => `
      <div class="issue ${i.severity}">
        <div class="row">
          <span class="badge ${i.severity}">${i.severity.toUpperCase()}</span>
          <strong>${esc(i.type)}</strong>
          ${i.lineNumber ? `<a href="#" class="line-link" data-line="${i.lineNumber}">line ${i.lineNumber}</a>` : ''}
          <span class="muted">@ ${esc(i.timestamp)}</span>
          <button class="mini" onclick="explainIssue(${idx})">🤖 Explain this</button>
        </div>
        <pre>${esc(i.message)}</pre>
        ${i.context ? `<p class="context">💡 ${esc(i.context)}</p>` : ''}
      </div>`).join('')
    : `<p class="muted">No issues detected. 🎉</p>`;

  const userInfoHtml = a.userInfo
    ? `<div class="card user-card">
         <div class="l">Executed by</div>
         <div class="v">${esc(a.userInfo.Name)}</div>
         <div class="muted">${esc(a.userInfo.Username)} · ${esc(a.userInfo.Email)}${a.userInfo.ProfileName ? ' · ' + esc(a.userInfo.ProfileName) : ''}</div>
       </div>` : '';

  const lineLink = (line?: number) =>
    line ? `<a href="#" class="line-link" data-line="${line}">${line}</a>` : '-';

  const soqlHtml = a.soql.length
    ? `<table><tr><th>#</th><th>Duration</th><th>Rows</th><th>Line</th><th>Query</th></tr>
        ${a.soql.map((q, i) => `<tr><td>${i + 1}</td><td>${fmt(q.durationMs)} ms</td><td>${q.rows ?? '-'}</td><td>${lineLink(q.lineNumber)}</td><td><code>${esc(q.query)}</code></td></tr>`).join('')}
      </table>` : `<p class="muted">No SOQL executed.</p>`;

  const dmlHtml = a.dml.length
    ? `<table><tr><th>#</th><th>Op</th><th>Rows</th><th>Duration</th><th>Line</th></tr>
        ${a.dml.map((d, i) => `<tr><td>${i + 1}</td><td>${esc(d.operation)}</td><td>${d.rows ?? '-'}</td><td>${fmt(d.durationMs)} ms</td><td>${lineLink(d.lineNumber)}</td></tr>`).join('')}
      </table>` : `<p class="muted">No DML executed.</p>`;

  const classLink = (name: string, line?: number) => {
    // Extract leading segment matching a class identifier
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\./.exec(name);
    if (!match) {return `<code>${esc(name)}</code>`;}
    const className = match[1];
    return `<a href="#" class="class-link" data-class="${esc(className)}" data-line="${line ?? ''}"><code>${esc(name)}</code></a>`;
  };

  const methodsHtml = a.methods.length
    ? `<table><tr><th>Method</th><th>Duration</th><th>Line</th></tr>
        ${a.methods.map(m => `<tr><td>${classLink(m.name, m.lineNumber)}</td><td>${fmt(m.durationMs)} ms</td><td>${lineLink(m.lineNumber)}</td></tr>`).join('')}
      </table>` : `<p class="muted">No method timing data.</p>`;

  const debugsHtml = a.debugs.length
    ? a.debugs.map(d => `<div class="debug"><span class="muted">${esc(d.timestamp)} · line ${lineLink(d.lineNumber)} · [${esc(d.level)}]</span><pre>${esc(d.message)}</pre></div>`).join('')
    : `<p class="muted">No debug statements.</p>`;

  const codeUnitsHtml = a.codeUnits.length
    ? `<table><tr><th>Code Unit</th><th>Duration</th></tr>
        ${a.codeUnits.map(c => `<tr><td><code>${esc(c.name)}</code></td><td>${fmt(c.durationMs)} ms</td></tr>`).join('')}
      </table>` : `<p class="muted">No code units captured.</p>`;

  const limitsHtml = a.limits.length
    ? a.limits.map(l => `<pre>${esc(l)}</pre>`).join('')
    : `<p class="muted">No limit usage block found.</p>`;

  const flameHtml = renderAreaChartHtml(a.flameRoot);

return `<!DOCTYPE html>
  <html><head><meta charset="utf-8"><style>
    .insights { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 8px; margin-top: 8px; }
    .insight { display: flex; gap: 12px; background: var(--vscode-editorWidget-background); padding: 12px 14px; border-radius: 6px; border-left: 4px solid; }
    .insight-good { border-color: #22c55e; }
    .insight-info { border-color: #3b82f6; }
    .insight-warning { border-color: #f59e0b; }
    .insight-critical { border-color: #ef4444; }
    .insight-icon { font-size: 20px; line-height: 1; padding-top: 2px; }
    .insight-title { font-weight: 600; margin-bottom: 2px; }
    .insight-detail { font-size: 12px; opacity: 0.85; line-height: 1.4; }
    .insight-metric { margin-top: 6px; font-size: 11px; opacity: 0.7; font-family: var(--vscode-editor-font-family); }
    .class-link { color: inherit; text-decoration: none; cursor: pointer; border-bottom: 1px dashed var(--vscode-textLink-foreground); }
    .class-link:hover { background: var(--vscode-editor-hoverHighlightBackground); }
    body { font-family: -apple-system, Segoe UI, sans-serif; padding: 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    h1 { margin: 0 0 4px; }
    h2 { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; margin-top: 28px; }
    table { border-collapse: collapse; width: 100%; margin-top: 8px; }
    th, td { border: 1px solid var(--vscode-panel-border); padding: 6px 8px; text-align: left; vertical-align: top; font-size: 12px; }
    th { background: var(--vscode-editorWidget-background); }
    code { font-family: var(--vscode-editor-font-family); font-size: 12px; }
    pre { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 12px; white-space: pre-wrap; margin: 4px 0; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; margin-top: 16px; }
    .card { background: var(--vscode-editorWidget-background); padding: 10px 12px; border-radius: 6px; }
    .card .v { font-size: 20px; font-weight: 600; }
    .card .l { font-size: 10px; text-transform: uppercase; opacity: 0.7; letter-spacing: 0.5px; }
    .user-card { border-left: 3px solid #3498db; }
    .issue { border-left: 4px solid; padding: 8px 12px; margin: 8px 0; background: var(--vscode-editorWidget-background); border-radius: 4px; }
    .issue.fatal { border-color: #d33; } .issue.error { border-color: #e67e22; }
    .issue.warning { border-color: #e6c74d; } .issue.info { border-color: #3498db; }
    .badge { padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 700; margin-right: 8px; }
    .badge.fatal { background: #d33; color: #fff; } .badge.error { background: #e67e22; color: #fff; }
    .badge.warning { background: #e6c74d; color: #000; } .badge.info { background: #3498db; color: #fff; }
    .muted { opacity: 0.7; font-size: 12px; margin-left: 8px; }
    .context { margin: 6px 0 0; font-size: 12px; opacity: 0.9; }
    .debug { margin: 6px 0; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.mini { padding: 2px 8px; font-size: 11px; margin-left: 8px; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .row { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
    .tagline { opacity: 0.6; font-size: 12px; margin: 0 0 8px; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
    .ai-panel { background: linear-gradient(135deg, rgba(155, 89, 182, 0.08), rgba(52, 152, 219, 0.08)); border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 16px; margin-top: 16px; }
    .ai-panel h3 { margin: 0 0 8px; display: flex; align-items: center; gap: 8px; }
    #ai-output { white-space: pre-wrap; font-size: 13px; line-height: 1.6; min-height: 20px; }
    #ai-output strong { color: var(--vscode-textLink-foreground); display: block; margin-top: 10px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; }
    #ai-output code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
    .spinner { display: inline-block; width: 10px; height: 10px; border: 2px solid var(--vscode-foreground); border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; margin-left: 8px; vertical-align: middle; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .line-link { color: var(--vscode-textLink-foreground); text-decoration: none; cursor: pointer; }
    .line-link:hover { text-decoration: underline; }
    .flame-controls { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
    .flame-block:hover rect { stroke: #fff; stroke-width: 1.5; }
    .flame-tooltip { position: absolute; background: var(--vscode-editorHoverWidget-background); border: 1px solid var(--vscode-editorHoverWidget-border); padding: 8px 10px; border-radius: 4px; font-size: 12px; pointer-events: none; max-width: 400px; z-index: 1000; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
    #followup-placeholder { margin-top: 12px; padding: 10px; background: var(--vscode-editorWidget-background); border: 1px dashed var(--vscode-panel-border); border-radius: 4px; font-size: 12px; opacity: 0.7; }
  </style></head>
  <body>
    <h1>Apex Log Analyzer by Aman</h1>
    <p class="tagline">API ${esc(a.summary.apiVersion)} · ${a.summary.totalEvents} events · ${fmt(a.summary.totalDurationMs)} ms total</p>

    ${userInfoHtml}

    <div class="summary">
      <div class="card"><div class="l">Total Duration</div><div class="v">${fmt(a.summary.totalDurationMs)} ms</div></div>
      <div class="card"><div class="l">SOQL Queries</div><div class="v">${a.soql.length}</div></div>
      <div class="card"><div class="l">DML Operations</div><div class="v">${a.dml.length}</div></div>
      <div class="card"><div class="l">Errors</div><div class="v">${a.issues.filter(i => i.severity === 'fatal' || i.severity === 'error').length}</div></div>
      <div class="card"><div class="l">Warnings</div><div class="v">${a.issues.filter(i => i.severity === 'warning').length}</div></div>
      <div class="card"><div class="l">Debug Logs</div><div class="v">${a.debugs.length}</div></div>
    </div>

    <div class="actions">
      <button onclick="explainAll()" id="btn-explain-all">🤖 Explain root cause with AI</button>
      <button onclick="exportMarkdown()">📋 Copy as Markdown</button>
    </div>
    ${a.insights.length ? `
      <h2>💡 Performance Insights</h2>
      ${renderInsightsHtml(a.insights)}
    ` : ''}

    <div class="ai-panel" id="ai-panel" style="display:none">
      <h3>🤖 AI Root-Cause Analysis <span class="spinner" id="ai-spinner" style="display:none"></span></h3>
      <div id="ai-output"></div>
      <div id="followup-placeholder">💬 Follow-up chat coming in v0.3 — you'll be able to ask things like "what would happen if we made this query selective?"</div>
    </div>

    <h2>🛑 Issues &amp; Errors</h2>
    ${issuesHtml}

    <h2>📈 Activity Timeline</h2>
    ${flameHtml}

    <h2>📊 Code Units</h2>
    ${codeUnitsHtml}

    <h2>🐌 Slowest Methods (top 50)</h2>
    ${methodsHtml}

    <h2>🗃️ SOQL Queries</h2>
    ${soqlHtml}

    <h2>✏️ DML Operations</h2>
    ${dmlHtml}

    <h2>🐞 Debug Statements</h2>
    ${debugsHtml}

    <h2>📈 Governor Limits</h2>
    ${limitsHtml}

    <script>
      const vscode = acquireVsCodeApi();
      const panel = document.getElementById('ai-panel');
      const output = document.getElementById('ai-output');
      const spinner = document.getElementById('ai-spinner');
      const btnAll = document.getElementById('btn-explain-all');
      let lastAiText = '';

      function exportMarkdown() { vscode.postMessage({ command: 'exportMarkdown', aiText: lastAiText }); }

      function explainAll() {
        panel.style.display = 'block';
        output.textContent = '';
        lastAiText = '';
        spinner.style.display = 'inline-block';
        btnAll.disabled = true;
        vscode.postMessage({ command: 'explainAll' });
      }

      function explainIssue(idx) {
        panel.style.display = 'block';
        output.textContent = '';
        lastAiText = '';
        spinner.style.display = 'inline-block';
        btnAll.disabled = true;
        vscode.postMessage({ command: 'explainIssue', index: idx });
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      function appendMarkdown(text) {
        lastAiText += text;
        let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
        html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
        output.innerHTML += html;
      }

      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg.command === 'aiChunk') {
          appendMarkdown(msg.text);
        } else if (msg.command === 'aiDone') {
          spinner.style.display = 'none';
          btnAll.disabled = false;
        } else if (msg.command === 'aiError') {
          spinner.style.display = 'none';
          btnAll.disabled = false;
          output.innerHTML += '<p style="color:#d33">⚠️ ' + msg.error + '</p>';
        }
      });
    </script>
  </body></html>`;
}