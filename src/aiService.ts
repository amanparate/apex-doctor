import * as vscode from 'vscode';
import * as https from 'https';
import { Analysis, Issue } from './analyzer';

const API_VERSION_ANTHROPIC = '2023-06-01';
const SECRET_KEY = 'apexLogAnalyzer.apiKey';

type Provider = 'openrouter' | 'anthropic';

export class AiService {
  constructor(private secrets: vscode.SecretStorage) {}

  private getProvider(): Provider {
    const config = vscode.workspace.getConfiguration('apexLogAnalyzer');
    return (config.get<string>('provider') || 'openrouter') as Provider;
  }

  async setApiKey(): Promise<boolean> {
    const provider = this.getProvider();
    const label = provider === 'anthropic' ? 'Anthropic' : 'OpenRouter';
    const hint = provider === 'anthropic'
      ? 'Starts with sk-ant-. Get one at console.anthropic.com'
      : 'Starts with sk-or-. Get one FREE at openrouter.ai/keys';
    const prefix = provider === 'anthropic' ? 'sk-ant-' : 'sk-or-';

    const key = await vscode.window.showInputBox({
      prompt: `Enter your ${label} API key. ${hint}`,
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) =>
        v && v.startsWith(prefix) ? null : `Must start with ${prefix}`
    });
    if (!key) return false;
    await this.secrets.store(SECRET_KEY, key);
    vscode.window.showInformationMessage(`${label} API key saved securely.`);
    return true;
  }

  async clearApiKey(): Promise<void> {
    await this.secrets.delete(SECRET_KEY);
    vscode.window.showInformationMessage('API key cleared.');
  }

  private async getApiKey(): Promise<string | undefined> {
    let key = await this.secrets.get(SECRET_KEY);
    if (!key) {
      const set = await this.setApiKey();
      if (set) key = await this.secrets.get(SECRET_KEY);
    }
    return key;
  }

  /**
   * Distilled, token-efficient context. We do NOT send the raw log.
   */
  buildContext(analysis: Analysis, focusIssue?: Issue): string {
    const lines: string[] = [];
    lines.push(`API Version: ${analysis.summary.apiVersion}`);
    lines.push(`Total runtime: ${analysis.summary.totalDurationMs.toFixed(2)} ms`);
    lines.push(`SOQL count: ${analysis.soql.length}, DML count: ${analysis.dml.length}`);
    if (analysis.userInfo) {
      lines.push(`Executed by: ${analysis.userInfo.Name} (${analysis.userInfo.ProfileName ?? 'no profile'})`);
    }
    lines.push('');

    if (focusIssue) {
      lines.push('## ISSUE TO EXPLAIN');
      lines.push(`[${focusIssue.severity.toUpperCase()}] ${focusIssue.type} @ line ${focusIssue.lineNumber ?? '?'}`);
      lines.push(focusIssue.message);
      lines.push('');
    } else {
      lines.push('## ALL ISSUES DETECTED');
      for (const i of analysis.issues.slice(0, 10)) {
        lines.push(`[${i.severity.toUpperCase()}] ${i.type}${i.lineNumber ? ' (line ' + i.lineNumber + ')' : ''}: ${i.message.slice(0, 300)}`);
      }
      lines.push('');
    }

    const relevantDebugs = analysis.debugs.slice(-15);
    if (relevantDebugs.length) {
      lines.push('## LAST DEBUG STATEMENTS BEFORE FAILURE');
      for (const d of relevantDebugs) {
        lines.push(`line ${d.lineNumber ?? '?'} [${d.level}]: ${d.message.slice(0, 200)}`);
      }
      lines.push('');
    }

    if (analysis.methods.length) {
      lines.push('## TOP 10 SLOWEST METHODS');
      for (const m of analysis.methods.slice(0, 10)) {
        lines.push(`${m.name} — ${m.durationMs.toFixed(2)} ms (line ${m.lineNumber ?? '?'})`);
      }
      lines.push('');
    }

    if (analysis.soql.length) {
      lines.push('## SOQL QUERIES (up to 15)');
      for (const q of analysis.soql.slice(0, 15)) {
        lines.push(`line ${q.lineNumber ?? '?'} (${q.rows ?? '?'} rows, ${(q.durationMs ?? 0).toFixed(2)} ms): ${q.query.slice(0, 250)}`);
      }
      lines.push('');
    }

    if (analysis.dml.length) {
      lines.push('## DML OPERATIONS');
      for (const d of analysis.dml.slice(0, 10)) {
        lines.push(`${d.operation} line ${d.lineNumber ?? '?'}: ${d.rows ?? '?'} rows, ${(d.durationMs ?? 0).toFixed(2)} ms`);
      }
      lines.push('');
    }

    if (analysis.limits.length) {
      lines.push('## GOVERNOR LIMITS (raw)');
      lines.push(analysis.limits[analysis.limits.length - 1].slice(0, 1500));
    }

    return lines.join('\n');
  }

  private buildPrompt(analysis: Analysis, focusIssue?: Issue): string {
    const context = this.buildContext(analysis, focusIssue);
    const task = focusIssue
      ? `Explain the root cause of the specific issue flagged above, and recommend a concrete fix.`
      : `Summarise the root cause of the failure(s) in this Apex log and recommend concrete fixes.`;

    return `You are a senior Salesforce Apex developer helping debug a failing transaction. You will be given structured excerpts from a Salesforce Apex debug log.

${task}

Respond in this exact markdown structure:

**Root Cause**
A 2-3 sentence plain-English explanation of what actually went wrong and why.

**Where it broke**
The class/method and line number, if identifiable.

**Likely Fix**
A concrete, actionable recommendation. If code changes are needed, show a short Apex snippet (5-15 lines max).

**Prevention**
One or two practices that would prevent this class of issue recurring.

Be direct. No filler, no restating what the user already sees.

---
LOG CONTEXT:

${context}`;
  }

  async streamExplanation(
    analysis: Analysis,
    focusIssue: Issue | undefined,
    onChunk: (text: string) => void,
    onDone: (fullText: string) => void,
    onError: (err: string) => void
  ): Promise<void> {
    const apiKey = await this.getApiKey();
    if (!apiKey) { onError('No API key provided.'); return; }

    const config = vscode.workspace.getConfiguration('apexLogAnalyzer');
    const provider = this.getProvider();
    const model = config.get<string>('model') ||
      (provider === 'anthropic' ? 'claude-sonnet-4-5' : 'google/gemini-2.0-flash-exp:free');
    const maxTokens = config.get<number>('maxTokens') || 1500;
    const prompt = this.buildPrompt(analysis, focusIssue);

    if (provider === 'anthropic') {
      this.streamAnthropic(apiKey, model, maxTokens, prompt, onChunk, onDone, onError);
    } else {
      this.streamOpenRouter(apiKey, model, maxTokens, prompt, onChunk, onDone, onError);
    }
  }

  private streamAnthropic(
    apiKey: string, model: string, maxTokens: number, prompt: string,
    onChunk: (t: string) => void, onDone: (t: string) => void, onError: (e: string) => void
  ) {
    const body = JSON.stringify({
      model, max_tokens: maxTokens, stream: true,
      messages: [{ role: 'user', content: prompt }]
    });
    const req = https.request({
      host: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION_ANTHROPIC,
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        let errBody = '';
        res.on('data', (c) => (errBody += c.toString()));
        res.on('end', () => onError(`HTTP ${res.statusCode}: ${errBody}`));
        return;
      }
      let buffer = ''; let fullText = '';
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const evt = JSON.parse(payload);
              if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && typeof evt.delta.text === 'string') {
                fullText += evt.delta.text;
                onChunk(evt.delta.text);
              }
            } catch { /* ignore */ }
          }
        }
      });
      res.on('end', () => onDone(fullText));
    });
    req.on('error', (e) => onError(e.message));
    req.write(body); req.end();
  }

  private streamOpenRouter(
    apiKey: string, model: string, maxTokens: number, prompt: string,
    onChunk: (t: string) => void, onDone: (t: string) => void, onError: (e: string) => void
  ) {
    const body = JSON.stringify({
      model, max_tokens: maxTokens, stream: true,
      messages: [{ role: 'user', content: prompt }]
    });
    const req = https.request({
      host: 'openrouter.ai', path: '/api/v1/chat/completions', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/aman/apex-log-analyzer-by-aman',
        'X-Title': 'Apex Log Analyzer by Aman',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        let errBody = '';
        res.on('data', (c) => (errBody += c.toString()));
        res.on('end', () => onError(`HTTP ${res.statusCode}: ${errBody}`));
        return;
      }
      let buffer = ''; let fullText = '';
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const evt = JSON.parse(payload);
              const delta = evt.choices?.[0]?.delta?.content;
              if (typeof delta === 'string' && delta.length > 0) {
                fullText += delta;
                onChunk(delta);
              }
            } catch { /* ignore keepalives / malformed lines */ }
          }
        }
      });
      res.on('end', () => onDone(fullText));
    });
    req.on('error', (e) => onError(e.message));
    req.write(body); req.end();
  }
}