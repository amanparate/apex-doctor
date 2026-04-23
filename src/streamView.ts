import * as vscode from 'vscode';
import { ApexLogRecord } from './salesforceService';

export class StreamView {
  private panel: vscode.WebviewPanel | undefined;
  private logs: ApexLogRecord[] = [];
  private onPickedCallback?: (logId: string) => void;
  private onStopRequestedCallback?: () => void;

  show(context: vscode.ExtensionContext) {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'apexLogStream',
      '🔴 Live Apex Log Stream',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.webview.onDidReceiveMessage((msg) => {
      if (msg.command === 'pickLog' && this.onPickedCallback) {
        this.onPickedCallback(msg.logId);
      } else if (msg.command === 'stopStream' && this.onStopRequestedCallback) {
        this.onStopRequestedCallback();
      } else if (msg.command === 'clearList') {
        this.logs = [];
        this.render();
      }
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    this.render();
  }

  onPicked(cb: (logId: string) => void) { this.onPickedCallback = cb; }
  onStopRequested(cb: () => void) { this.onStopRequestedCallback = cb; }

  addLog(log: ApexLogRecord) {
    // Prepend so newest is on top
    this.logs.unshift(log);
    if (this.logs.length > 100) {this.logs = this.logs.slice(0, 100);}
    this.render();
  }

  setStatus(running: boolean, message?: string) {
    if (!this.panel) {return;}
    this.panel.webview.postMessage({ command: 'status', running, message });
  }

  close() {
    this.panel?.dispose();
  }

  private render() {
    if (!this.panel) {return;}
    this.panel.webview.html = this.buildHtml();
  }

  private buildHtml(): string {
    const esc = (s: string) =>
      (s ?? '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

    const rowsHtml = this.logs.length
      ? this.logs.map(log => `
          <tr class="log-row" data-id="${esc(log.Id)}">
            <td class="id"><code>${esc(log.Id.slice(-8))}</code></td>
            <td class="op"><strong>${esc(log.Operation || 'Anonymous')}</strong></td>
            <td class="status ${log.Status?.toLowerCase() === 'success' ? 'ok' : 'err'}">${esc(log.Status || '-')}</td>
            <td class="dur">${log.DurationMilliseconds}ms</td>
            <td class="size">${(log.LogLength / 1024).toFixed(1)} KB</td>
            <td class="user">${esc(log.LogUser?.Name ?? 'Unknown')}</td>
            <td class="time">${new Date(log.StartTime).toLocaleTimeString()}</td>
            <td class="action"><button class="analyze-btn">Analyse</button></td>
          </tr>`).join('')
      : '<tr><td colspan="8" class="muted" style="text-align:center; padding: 20px">Waiting for logs… run any Apex in the org to see them appear here.</td></tr>';

    return `<!DOCTYPE html>
      <html><head><meta charset="utf-8"><style>
        body { font-family: -apple-system, Segoe UI, sans-serif; padding: 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
        h1 { margin: 0 0 4px; display: flex; align-items: center; gap: 10px; }
        .status-chip { font-size: 11px; padding: 3px 8px; border-radius: 12px; background: var(--vscode-editorWidget-background); font-weight: normal; opacity: 0.85; }
        .status-chip.running { background: #ef4444; color: #fff; }
        .controls { display: flex; gap: 8px; margin: 12px 0; }
        button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
        button:hover { background: var(--vscode-button-hoverBackground); }
        table { border-collapse: collapse; width: 100%; font-size: 12px; }
        th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--vscode-panel-border); }
        th { background: var(--vscode-editorWidget-background); font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; opacity: 0.8; }
        .log-row:hover { background: var(--vscode-list-hoverBackground); cursor: pointer; }
        .status.ok { color: #22c55e; }
        .status.err { color: #ef4444; }
        .id code { opacity: 0.7; font-size: 11px; }
        .muted { opacity: 0.6; }
        .tip { font-size: 11px; opacity: 0.6; margin-top: 12px; }
        .analyze-btn { padding: 2px 10px; font-size: 11px; }
      </style></head>
      <body>
        <h1>🔴 Live Apex Log Stream <span class="status-chip running" id="status">Streaming</span></h1>
        <div class="controls">
          <button onclick="stopStream()">⏹ Stop Streaming</button>
          <button onclick="clearList()">🗑 Clear list</button>
          <span class="muted" style="align-self:center; font-size:11px">${this.logs.length} log${this.logs.length === 1 ? '' : 's'} captured</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Operation</th><th>Status</th><th>Duration</th><th>Size</th><th>User</th><th>Time</th><th></th>
            </tr>
          </thead>
          <tbody id="rows">
            ${rowsHtml}
          </tbody>
        </table>
        <p class="tip">Click any row (or the Analyse button) to drill into full analysis in the main panel.</p>
        <script>
          const vscode = acquireVsCodeApi();
          function stopStream() { vscode.postMessage({ command: 'stopStream' }); }
          function clearList() { vscode.postMessage({ command: 'clearList' }); }

          document.querySelectorAll('.log-row').forEach(row => {
            row.addEventListener('click', () => {
              const id = row.getAttribute('data-id');
              if (id) vscode.postMessage({ command: 'pickLog', logId: id });
            });
          });

          window.addEventListener('message', (event) => {
            const msg = event.data;
            if (msg.command === 'status') {
              const chip = document.getElementById('status');
              if (msg.running) {
                chip.className = 'status-chip running';
                chip.textContent = msg.message || 'Streaming';
              } else {
                chip.className = 'status-chip';
                chip.textContent = msg.message || 'Stopped';
              }
            }
          });
        </script>
      </body></html>`;
  }
}