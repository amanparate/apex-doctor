import { spawn, ChildProcess } from 'child_process';
import * as vscode from 'vscode';
import { SalesforceService, ApexLogRecord } from './salesforceService';

export interface StreamEvent {
  log: ApexLogRecord;
}

type Listener = (event: StreamEvent) => void;
type StatusListener = (running: boolean, message?: string) => void;

export class StreamingService {
  private process: ChildProcess | undefined;
  private seenIds = new Set<string>();
  private listeners: Listener[] = [];
  private statusListeners: StatusListener[] = [];
  private pollTimer: NodeJS.Timeout | undefined;
  private lastPollTime: Date = new Date();

  constructor(private sf: SalesforceService) {}

  isRunning(): boolean {
    return this.process !== undefined;
  }

  onLog(listener: Listener): vscode.Disposable {
    this.listeners.push(listener);
    return new vscode.Disposable(() => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) {this.listeners.splice(idx, 1);}
    });
  }

  onStatus(listener: StatusListener): vscode.Disposable {
    this.statusListeners.push(listener);
    return new vscode.Disposable(() => {
      const idx = this.statusListeners.indexOf(listener);
      if (idx >= 0) {this.statusListeners.splice(idx, 1);}
    });
  }

  private emit(log: ApexLogRecord) {
    for (const l of this.listeners) { l({ log }); }
  }

  private emitStatus(running: boolean, message?: string) {
    for (const l of this.statusListeners) {l(running, message);}
  }

  async start(): Promise<void> {
    if (this.process) {
      vscode.window.showInformationMessage('Log streaming is already running.');
      return;
    }

    const org = await this.sf.getDefaultOrg();
    if (!org) {
      vscode.window.showErrorMessage('No default Salesforce org. Run: sf org login web');
      return;
    }

    const config = vscode.workspace.getConfiguration('apexLogAnalyzer');
    const debugLevel = (config.get<string>('streamDebugLevel') || '').trim();

    this.seenIds.clear();
    this.lastPollTime = new Date(Date.now() - 60_000); // start with last minute's logs

    // Approach: use polling via Tooling API, which is simpler and more reliable
    // than parsing sf apex tail output (format varies by CLI version)
    this.emitStatus(true, 'Starting…');

    // Dummy "process" object to mark running state without spawning a real tail
    // (we poll the Tooling API instead for cross-platform reliability)
    this.process = { kill: () => {} } as unknown as ChildProcess;

    // Also try to spawn the real tail in the background to activate streaming trace flags.
    // If it fails, polling still works.
    try {
      const args = ['apex', 'tail', 'log', '--target-org', org];
      if (debugLevel) { args.push('--debug-level', debugLevel); }
      const child = spawn('sf', args, { shell: true });
      child.on('error', () => { /* ignore; polling covers us */ });
      // Keep child alive but don't listen — we use polling for data
      this.process = child;
    } catch {
      // Continue with polling-only mode
    }

    // Poll every 3 seconds for new logs
    const pollInterval = 3000;
    this.pollTimer = setInterval(() => this.pollForNewLogs().catch(() => { /* swallow */ }), pollInterval);

    // Do one immediate poll so something shows up fast
    this.pollForNewLogs().catch(() => { /* swallow */ });

    this.emitStatus(true, `Streaming (polling every ${pollInterval / 1000}s)`);
  }

  private async pollForNewLogs() {
    if (!this.process) {return;}
    try {
      const logs = await this.sf.listRecentLogs(20);
      // Sort ascending by StartTime so we emit in order
      const sorted = [...logs].sort(
        (a, b) => new Date(a.StartTime).getTime() - new Date(b.StartTime).getTime()
      );
      for (const log of sorted) {
        if (this.seenIds.has(log.Id)) {continue;}
        this.seenIds.add(log.Id);
        // Skip logs older than when we started
        if (new Date(log.StartTime).getTime() < this.lastPollTime.getTime()) {continue;}
        this.emit(log);
      }
    } catch (e: any) {
      this.emitStatus(true, `Poll error: ${e.message}`);
    }
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    if (this.process) {
      try { this.process.kill(); } catch { /* ignore */ }
      this.process = undefined;
    }
    this.emitStatus(false);
  }

  dispose() {
    this.stop();
    this.listeners = [];
    this.statusListeners = [];
  }
}