import * as vscode from "vscode";
import * as https from "https";
import { Analysis, Issue } from "./analyzer";

const API_VERSION_ANTHROPIC = "2023-06-01";
const SECRET_KEY = "apexDoctor.apiKey";
/** Separate secret slot for the Einstein External Client App consumer secret. */
const EINSTEIN_SECRET_KEY = "apexDoctor.einsteinConsumerSecret";
const EINSTEIN_DEFAULT_MODEL = "sfdc_ai__DefaultOpenAIGPT4OmniMini";
const EINSTEIN_API_VERSION = "v62.0";

/**
 * OpenRouter's free models rotate frequently, so any single hardcoded id rots —
 * the long-standing default `openrouter/free` no longer exists in OpenRouter's
 * catalogue, so it 400s every request. Default to a current free model and send
 * the rest as an OpenRouter `models` fallback array: if the primary is gone,
 * OpenRouter automatically tries the next one in order.
 */
export const OPENROUTER_DEFAULT_MODEL = "google/gemma-4-31b-it:free";
export const OPENROUTER_FREE_FALLBACKS = [
  OPENROUTER_DEFAULT_MODEL,
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
];
/** Retired OpenRouter id that older user settings may still hold — migrate off it. */
const RETIRED_OPENROUTER_MODEL = "openrouter/free";

type Provider = "openrouter" | "anthropic" | "openai" | "gemini" | "einstein";

interface ProviderConfig {
  label: string;
  keyHint: string;
  validateKey: (key: string) => string | null;
  defaultModel: string;
}

const PROVIDERS: Record<Provider, ProviderConfig> = {
  openrouter: {
    label: "OpenRouter",
    keyHint: "Starts with sk-or-. Get one FREE at openrouter.ai/keys",
    validateKey: (k) =>
      k.startsWith("sk-or-") ? null : "Must start with sk-or-",
    defaultModel: OPENROUTER_DEFAULT_MODEL,
  },
  anthropic: {
    label: "Anthropic (Claude)",
    keyHint: "Starts with sk-ant-. Get one at console.anthropic.com",
    validateKey: (k) =>
      k.startsWith("sk-ant-") ? null : "Must start with sk-ant-",
    defaultModel: "claude-sonnet-4-5",
  },
  openai: {
    label: "OpenAI (ChatGPT)",
    keyHint: "Starts with sk-. Get one at platform.openai.com/api-keys",
    validateKey: (k) => {
      if (!k.startsWith("sk-")) {
        return "Must start with sk-";
      }
      if (k.startsWith("sk-or-") || k.startsWith("sk-ant-")) {
        return "That looks like an OpenRouter or Anthropic key — change provider in settings first";
      }
      return null;
    },
    defaultModel: "gpt-4o-mini",
  },
  gemini: {
    label: "Google Gemini",
    keyHint: "Starts with AIza. Get one FREE at aistudio.google.com/apikey",
    validateKey: (k) => (k.startsWith("AIza") ? null : "Must start with AIza"),
    defaultModel: "gemini-2.0-flash",
  },
  einstein: {
    label: "Salesforce Einstein (Trust Layer)",
    keyHint:
      "Paste your External Client App consumer SECRET. Set the domain + consumer key in Apex Doctor settings first.",
    // The Einstein "key" is the consumer secret — no fixed prefix to validate.
    validateKey: () => null,
    defaultModel: EINSTEIN_DEFAULT_MODEL,
  },
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

interface EinsteinToken {
  accessToken: string;
  instanceUrl: string;
  expiresAt: number;
}

/**
 * Parse the Models API chat-generations response defensively across the couple
 * of shapes Salesforce has shipped. Exported for unit testing.
 */
export function parseEinsteinResponse(raw: string): string {
  const json = JSON.parse(raw);
  // Current shape: { generationDetails: { generations: [{ content }] } }
  const gens = json?.generationDetails?.generations;
  if (Array.isArray(gens) && gens.length && typeof gens[0]?.content === "string") {
    return gens.map((g: { content?: string }) => g.content ?? "").join("");
  }
  // Older single-generation shape: { generation: { generatedText } }
  if (typeof json?.generation?.generatedText === "string") {
    return json.generation.generatedText;
  }
  // chat-generations sometimes nests under messages[]
  const msg = json?.generationDetails?.messages?.[0]?.content ?? json?.messages?.[0]?.content;
  if (typeof msg === "string") {
    return msg;
  }
  throw new Error("Unrecognised Einstein response shape.");
}

/**
 * Resolve which model id to send for a provider, given the shared
 * `apexDoctor.model` setting value. The setting is shared across every provider,
 * so a value left over from another provider (an `sfdc_ai__*` Einstein model, or
 * the retired `openrouter/free` id) must not leak through — fall back to the
 * current provider's default in those cases, and when the setting is empty.
 * Pure + exported for unit testing.
 */
export function resolveModelName(provider: Provider, configuredRaw: string): string {
  const configured = (configuredRaw || "").trim();
  const isEinsteinModel = configured.startsWith("sfdc_ai__");
  if (provider === "einstein") {
    return isEinsteinModel ? configured : PROVIDERS.einstein.defaultModel;
  }
  if (!configured || isEinsteinModel || configured === RETIRED_OPENROUTER_MODEL) {
    return PROVIDERS[provider].defaultModel;
  }
  return configured;
}

/**
 * OpenRouter-only: when the resolved model is the default (user hasn't overridden
 * it), return a copy of the curated free-model fallback list so OpenRouter can
 * fail over if the primary free model has rotated out; otherwise undefined, so
 * the single explicitly-chosen model is sent as-is. Pure + exported for tests.
 */
export function openRouterModelList(resolvedModel: string): string[] | undefined {
  return resolvedModel === OPENROUTER_DEFAULT_MODEL ? [...OPENROUTER_FREE_FALLBACKS] : undefined;
}

export class AiService {
  private einsteinToken: EinsteinToken | undefined;

  constructor(private secrets: vscode.SecretStorage) {}

  private getProvider(): Provider {
    const config = vscode.workspace.getConfiguration("apexDoctor");
    const p = (config.get<string>("provider") || "openrouter") as Provider;
    return PROVIDERS[p] ? p : "openrouter";
  }

  /**
   * Resolve which model to send. The `apexDoctor.model` setting is shared across
   * every provider, so a value left over from a different provider (e.g. an
   * `sfdc_ai__*` Einstein model selected earlier, then switching back to
   * OpenRouter) must not leak through — fall back to the current provider's
   * default in that case.
   */
  private resolveModel(provider: Provider): string {
    const configured = vscode.workspace.getConfiguration("apexDoctor").get<string>("model") || "";
    return resolveModelName(provider, configured);
  }

  private openRouterModels(resolvedModel: string): string[] | undefined {
    return openRouterModelList(resolvedModel);
  }

  async setApiKey(): Promise<boolean> {
    const provider = this.getProvider();
    const cfg = PROVIDERS[provider];

    if (provider === "einstein") {
      return this.setEinsteinSecret();
    }

    const key = await vscode.window.showInputBox({
      prompt: `Enter your ${cfg.label} API key. ${cfg.keyHint}`,
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (v ? cfg.validateKey(v) : "API key is required"),
    });
    if (!key) {
      return false;
    }
    await this.secrets.store(SECRET_KEY, key);
    vscode.window.showInformationMessage(
      `${cfg.label} API key saved securely.`,
    );
    return true;
  }

  private async setEinsteinSecret(): Promise<boolean> {
    const config = vscode.workspace.getConfiguration("apexDoctor");
    const domain = (config.get<string>("einsteinDomain") || "").trim();
    const consumerKey = (config.get<string>("einsteinConsumerKey") || "").trim();
    if (!domain || !consumerKey) {
      vscode.window.showWarningMessage(
        "Set apexDoctor.einsteinDomain and apexDoctor.einsteinConsumerKey in Settings before saving the consumer secret.",
        "Open Settings",
      ).then((c) => {
        if (c === "Open Settings") {
          vscode.commands.executeCommand("workbench.action.openSettings", "apexDoctor.einstein");
        }
      });
      return false;
    }
    const secret = await vscode.window.showInputBox({
      prompt: "Enter your Einstein External Client App consumer secret.",
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (v ? null : "Consumer secret is required"),
    });
    if (!secret) {
      return false;
    }
    await this.secrets.store(EINSTEIN_SECRET_KEY, secret);
    this.einsteinToken = undefined; // force re-auth with the new secret
    vscode.window.showInformationMessage("Einstein consumer secret saved securely.");
    return true;
  }

  async clearApiKey(): Promise<void> {
    await this.secrets.delete(SECRET_KEY);
    await this.secrets.delete(EINSTEIN_SECRET_KEY);
    this.einsteinToken = undefined;
    vscode.window.showInformationMessage("API key cleared.");
  }

  private async getApiKey(): Promise<string | undefined> {
    let key = await this.secrets.get(SECRET_KEY);
    if (!key) {
      const set = await this.setApiKey();
      if (set) {
        key = await this.secrets.get(SECRET_KEY);
      }
    }
    return key;
  }

  /**
   * Distilled, token-efficient context. We do NOT send the raw log.
   */
  buildContext(analysis: Analysis, focusIssue?: Issue): string {
    const lines: string[] = [];
    lines.push(`API Version: ${analysis.summary.apiVersion}`);
    lines.push(
      `Total runtime: ${analysis.summary.totalDurationMs.toFixed(2)} ms`,
    );
    lines.push(
      `SOQL count: ${analysis.soql.length}, DML count: ${analysis.dml.length}`,
    );
    if (analysis.userInfo) {
      lines.push(
        `Executed by: ${analysis.userInfo.Name} (${analysis.userInfo.ProfileName ?? "no profile"})`,
      );
    }
    lines.push("");

    if (focusIssue) {
      lines.push("## ISSUE TO EXPLAIN");
      lines.push(
        `[${focusIssue.severity.toUpperCase()}] ${focusIssue.type} @ line ${focusIssue.lineNumber ?? "?"}`,
      );
      lines.push(focusIssue.message);
      lines.push("");
    } else {
      lines.push("## ALL ISSUES DETECTED");
      for (const i of analysis.issues.slice(0, 10)) {
        lines.push(
          `[${i.severity.toUpperCase()}] ${i.type}${i.lineNumber ? " (line " + i.lineNumber + ")" : ""}: ${i.message.slice(0, 300)}`,
        );
      }
      lines.push("");
    }

    const relevantDebugs = analysis.debugs.slice(-15);
    if (relevantDebugs.length) {
      lines.push("## LAST DEBUG STATEMENTS BEFORE FAILURE");
      for (const d of relevantDebugs) {
        lines.push(
          `line ${d.lineNumber ?? "?"} [${d.level}]: ${d.message.slice(0, 200)}`,
        );
      }
      lines.push("");
    }

    if (analysis.methods.length) {
      lines.push("## TOP 10 SLOWEST METHODS");
      for (const m of analysis.methods.slice(0, 10)) {
        lines.push(
          `${m.name} — ${m.durationMs.toFixed(2)} ms (line ${m.lineNumber ?? "?"})`,
        );
      }
      lines.push("");
    }

    if (analysis.soql.length) {
      lines.push("## SOQL QUERIES (up to 15)");
      for (const q of analysis.soql.slice(0, 15)) {
        lines.push(
          `line ${q.lineNumber ?? "?"} (${q.rows ?? "?"} rows, ${(q.durationMs ?? 0).toFixed(2)} ms): ${q.query.slice(0, 250)}`,
        );
      }
      lines.push("");
    }

    if (analysis.dml.length) {
      lines.push("## DML OPERATIONS");
      for (const d of analysis.dml.slice(0, 10)) {
        lines.push(
          `${d.operation} line ${d.lineNumber ?? "?"}: ${d.rows ?? "?"} rows, ${(d.durationMs ?? 0).toFixed(2)} ms`,
        );
      }
      lines.push("");
    }

    if (analysis.limits.length) {
      lines.push("## GOVERNOR LIMITS");
      for (const lu of analysis.limits) {
        lines.push(`Namespace: ${lu.namespace}`);
        for (const m of lu.metrics) {
          if (m.used > 0) {
            lines.push(
              `  ${m.name}: ${m.used} / ${m.limit} (${m.pct.toFixed(0)}%)`,
            );
          }
        }
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  buildSystemPrompt(analysis: Analysis): string {
    return `You are a senior Salesforce Apex developer helping debug a failing transaction. You will be given structured excerpts from a Salesforce Apex debug log, then asked questions about it. Be direct, no filler. Use Salesforce-aware terminology (governor limits, bulkification, selective queries, etc.).

---
LOG CONTEXT:

${this.buildContext(analysis)}`;
  }

  buildInitialUserPrompt(analysis: Analysis, focusIssue?: Issue): string {
    const lines: string[] = [];
    if (focusIssue) {
      lines.push(
        `Focus on this specific issue: [${focusIssue.severity.toUpperCase()}] ${focusIssue.type}${focusIssue.lineNumber ? ` at line ${focusIssue.lineNumber}` : ""}`,
      );
      lines.push(focusIssue.message);
      lines.push("");
      lines.push("Explain the root cause and recommend a concrete fix.");
    } else {
      lines.push(
        `Summarise the root cause of the failure(s) in this Apex log and recommend concrete fixes.`,
      );
    }
    lines.push("");
    lines.push("Respond in this exact markdown structure:");
    lines.push("");
    lines.push("**Root Cause**");
    lines.push(
      "A 2-3 sentence plain-English explanation of what actually went wrong and why.",
    );
    lines.push("");
    lines.push("**Where it broke**");
    lines.push("The class/method and line number, if identifiable.");
    lines.push("");
    lines.push("**Likely Fix**");
    lines.push(
      "A concrete, actionable recommendation. If code changes are needed, show a short Apex snippet (5-15 lines max).",
    );
    lines.push("");
    lines.push("**Prevention**");
    lines.push(
      "One or two practices that would prevent this class of issue recurring.",
    );
    void analysis;
    return lines.join("\n");
  }

  async streamExplanation(
    analysis: Analysis,
    focusIssue: Issue | undefined,
    onChunk: (text: string) => void,
    onDone: (fullText: string) => void,
    onError: (err: string) => void,
  ): Promise<void> {
    const userPrompt = this.buildInitialUserPrompt(analysis, focusIssue);
    await this.streamChat(
      analysis,
      [{ role: "user", content: userPrompt }],
      onChunk,
      onDone,
      onError,
    );
  }

  /**
   * Single-shot completion. Used for tasks that don't benefit from streaming,
   * e.g. a JSON response (NL query) or a one-off code refactor.
   *
   * Returns the full assistant text, or undefined on failure.
   */
  async completeOnce(prompt: string, opts?: { systemOverride?: string; maxTokens?: number }): Promise<string | undefined> {
    return new Promise((resolve) => {
      const messages: ChatMessage[] = [{ role: "user", content: prompt }];
      // Build a tiny analysis stub if streamChat needs it for the system prompt.
      const stubSystem = opts?.systemOverride ?? "You are a senior Salesforce Apex developer. Be precise and follow the user's output format exactly.";
      let buf = "";
      this.streamChatRaw(
        stubSystem,
        messages,
        opts?.maxTokens,
        (chunk) => {
          buf += chunk;
        },
        () => resolve(buf || undefined),
        () => resolve(undefined),
      );
    });
  }

  private async streamChatRaw(
    system: string,
    messages: ChatMessage[],
    maxTokensOverride: number | undefined,
    onChunk: (text: string) => void,
    onDone: (fullText: string) => void,
    onError: (err: string) => void,
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration("apexDoctor");
    const provider = this.getProvider();

    // Einstein authenticates via the org (domain + consumer key/secret), not an API key.
    if (provider === "einstein") {
      const maxTokens = maxTokensOverride ?? config.get<number>("maxTokens") ?? 1500;
      return this.generateEinstein(system, messages, maxTokens, onChunk, onDone, onError);
    }

    const apiKey = await this.getApiKey();
    if (!apiKey) {
      onError("No API key provided.");
      return;
    }
    const cfg = PROVIDERS[provider];

    if (apiKey) {
      const validation = cfg.validateKey(apiKey);
      if (validation) {
        onError(
          `Saved API key doesn't match provider "${provider}": ${validation}.`,
        );
        return;
      }
    }

    const model = this.resolveModel(provider);
    const maxTokens = maxTokensOverride ?? config.get<number>("maxTokens") ?? 1500;

    switch (provider) {
      case "anthropic":
        return this.streamAnthropic(apiKey, model, maxTokens, system, messages, onChunk, onDone, onError);
      case "openrouter":
        return this.streamOpenAICompat(
          {
            host: "openrouter.ai",
            path: "/api/v1/chat/completions",
            models: this.openRouterModels(model),
            extraHeaders: {
              "HTTP-Referer": "https://github.com/amanparate/apex-doctor",
              "X-Title": "Apex Doctor",
            },
          },
          apiKey, model, maxTokens, system, messages, onChunk, onDone, onError,
        );
      case "openai":
        return this.streamOpenAICompat(
          { host: "api.openai.com", path: "/v1/chat/completions" },
          apiKey, model, maxTokens, system, messages, onChunk, onDone, onError,
        );
      case "gemini":
        return this.streamGemini(apiKey, model, maxTokens, system, messages, onChunk, onDone, onError);
    }
  }

  async streamChat(
    analysis: Analysis,
    messages: ChatMessage[],
    onChunk: (text: string) => void,
    onDone: (fullText: string) => void,
    onError: (err: string) => void,
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration("apexDoctor");
    const provider = this.getProvider();
    const system = this.buildSystemPrompt(analysis);

    // Einstein authenticates via the org, not an API key — handle it first.
    if (provider === "einstein") {
      const maxTokens = config.get<number>("maxTokens") || 1500;
      return this.generateEinstein(system, messages, maxTokens, onChunk, onDone, onError);
    }

    const apiKey = await this.getApiKey();
    if (!apiKey) {
      onError("No API key provided.");
      return;
    }

    // Defensive: catch the case where the saved key doesn't match the current provider
    const validation = PROVIDERS[provider].validateKey(apiKey);
    if (validation) {
      onError(
        `Saved API key doesn't match provider "${provider}": ${validation}. Run "Apex Doctor: Clear LLM API Key" then "Set LLM API Key", or change the provider in settings.`,
      );
      return;
    }

    const model = this.resolveModel(provider);
    const maxTokens = config.get<number>("maxTokens") || 1500;

    switch (provider) {
      case "anthropic":
        return this.streamAnthropic(apiKey, model, maxTokens, system, messages, onChunk, onDone, onError);
      case "openrouter":
        return this.streamOpenAICompat(
          {
            host: "openrouter.ai",
            path: "/api/v1/chat/completions",
            models: this.openRouterModels(model),
            extraHeaders: {
              "HTTP-Referer": "https://github.com/amanparate/apex-doctor",
              "X-Title": "Apex Doctor",
            },
          },
          apiKey, model, maxTokens, system, messages, onChunk, onDone, onError,
        );
      case "openai":
        return this.streamOpenAICompat(
          { host: "api.openai.com", path: "/v1/chat/completions" },
          apiKey, model, maxTokens, system, messages, onChunk, onDone, onError,
        );
      case "gemini":
        return this.streamGemini(apiKey, model, maxTokens, system, messages, onChunk, onDone, onError);
    }
  }

  private streamAnthropic(
    apiKey: string,
    model: string,
    maxTokens: number,
    system: string,
    messages: ChatMessage[],
    onChunk: (t: string) => void,
    onDone: (t: string) => void,
    onError: (e: string) => void,
  ) {
    const body = JSON.stringify({
      model,
      max_tokens: maxTokens,
      stream: true,
      system,
      messages,
    });
    const req = https.request(
      {
        host: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": API_VERSION_ANTHROPIC,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let errBody = "";
          res.on("data", (c) => (errBody += c.toString()));
          res.on("end", () => onError(`HTTP ${res.statusCode}: ${errBody}`));
          return;
        }
        let buffer = "";
        let fullText = "";
        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const part of parts) {
            for (const line of part.split("\n")) {
              if (!line.startsWith("data:")) {
                continue;
              }
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") {
                continue;
              }
              try {
                const evt = JSON.parse(payload);
                if (
                  evt.type === "content_block_delta" &&
                  evt.delta?.type === "text_delta" &&
                  typeof evt.delta.text === "string"
                ) {
                  fullText += evt.delta.text;
                  onChunk(evt.delta.text);
                }
              } catch {
                /* ignore */
              }
            }
          }
        });
        res.on("end", () => onDone(fullText));
      },
    );
    req.on("error", (e) => onError(e.message));
    req.write(body);
    req.end();
  }

  /** Shared OpenAI-compatible SSE handler — used for both OpenRouter and OpenAI */
  private streamOpenAICompat(
    target: { host: string; path: string; extraHeaders?: Record<string, string>; models?: string[] },
    apiKey: string,
    model: string,
    maxTokens: number,
    system: string,
    messages: ChatMessage[],
    onChunk: (t: string) => void,
    onDone: (t: string) => void,
    onError: (e: string) => void,
  ) {
    const body = JSON.stringify({
      // OpenRouter accepts a `models` fallback array (primary first) and tries
      // them in order; plain OpenAI takes a single `model`. Prefer the array
      // when one is supplied so a rotated-out free model fails over instead of
      // breaking the whole request.
      ...(target.models && target.models.length ? { models: target.models } : { model }),
      max_tokens: maxTokens,
      stream: true,
      messages: [{ role: "system", content: system }, ...messages],
    });
    const req = https.request(
      {
        host: target.host,
        path: target.path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Length": Buffer.byteLength(body),
          ...(target.extraHeaders || {}),
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let errBody = "";
          res.on("data", (c) => (errBody += c.toString()));
          res.on("end", () => onError(`HTTP ${res.statusCode}: ${errBody}`));
          return;
        }
        let buffer = "";
        let fullText = "";
        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const part of parts) {
            for (const line of part.split("\n")) {
              if (!line.startsWith("data:")) {
                continue;
              }
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") {
                continue;
              }
              try {
                const evt = JSON.parse(payload);
                const delta = evt.choices?.[0]?.delta?.content;
                if (typeof delta === "string" && delta.length > 0) {
                  fullText += delta;
                  onChunk(delta);
                }
              } catch {
                /* ignore keepalives / malformed */
              }
            }
          }
        });
        res.on("end", () => onDone(fullText));
      },
    );
    req.on("error", (e) => onError(e.message));
    req.write(body);
    req.end();
  }

  private streamGemini(
    apiKey: string,
    model: string,
    maxTokens: number,
    system: string,
    messages: ChatMessage[],
    onChunk: (t: string) => void,
    onDone: (t: string) => void,
    onError: (e: string) => void,
  ) {
    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { maxOutputTokens: maxTokens },
    });
    const req = https.request(
      {
        host: "generativelanguage.googleapis.com",
        path: `/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let errBody = "";
          res.on("data", (c) => (errBody += c.toString()));
          res.on("end", () => onError(`HTTP ${res.statusCode}: ${errBody}`));
          return;
        }
        let buffer = "";
        let fullText = "";
        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const part of parts) {
            for (const line of part.split("\n")) {
              if (!line.startsWith("data:")) {
                continue;
              }
              const payload = line.slice(5).trim();
              if (!payload) {
                continue;
              }
              try {
                const evt = JSON.parse(payload);
                const text = evt.candidates?.[0]?.content?.parts?.[0]?.text;
                if (typeof text === "string" && text.length > 0) {
                  fullText += text;
                  onChunk(text);
                }
              } catch {
                /* ignore */
              }
            }
          }
        });
        res.on("end", () => onDone(fullText));
      },
    );
    req.on("error", (e) => onError(e.message));
    req.write(body);
    req.end();
  }

  // ───────────────────────── Salesforce Einstein (Trust Layer) ─────────────────────────

  /**
   * Non-streaming call to the Einstein Models API chat-generations endpoint,
   * authenticated via an External Client App (OAuth client-credentials).
   * Emits the full completion through onChunk once, then onDone — matching the
   * streaming callback contract the webview already speaks.
   */
  private async generateEinstein(
    system: string,
    messages: ChatMessage[],
    maxTokens: number,
    onChunk: (t: string) => void,
    onDone: (t: string) => void,
    onError: (e: string) => void,
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration("apexDoctor");
    const domain = (config.get<string>("einsteinDomain") || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
    const consumerKey = (config.get<string>("einsteinConsumerKey") || "").trim();
    if (!domain || !consumerKey) {
      onError(
        "Einstein isn't configured. Set apexDoctor.einsteinDomain and apexDoctor.einsteinConsumerKey in Settings, then run 'Apex Doctor: Set LLM API Key' to store the consumer secret.",
      );
      return;
    }
    let secret = await this.secrets.get(EINSTEIN_SECRET_KEY);
    if (!secret) {
      const ok = await this.setEinsteinSecret();
      if (ok) {
        secret = await this.secrets.get(EINSTEIN_SECRET_KEY);
      }
    }
    if (!secret) {
      onError("No Einstein consumer secret provided.");
      return;
    }

    const modelName = this.resolveModel("einstein");

    try {
      const token = await this.getEinsteinToken(domain, consumerKey, secret);
      const host = token.instanceUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
      const body = JSON.stringify({
        messages: [
          { role: "system", content: system },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        localization: { defaultLocale: "en_US", inputLocales: [{ locale: "en_US", probability: 1 }], expectedLocales: ["en_US"] },
        generationSettings: { maxTokens },
      });
      const res = await httpsJson({
        host,
        path: `/services/data/${EINSTEIN_API_VERSION}/models/${encodeURIComponent(modelName)}/chat-generations`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          "Content-Type": "application/json;charset=utf-8",
          "x-sfdc-app-context": "EinsteinGPT",
          "x-client-feature-id": "ai-platform-models-connected-app",
        },
      }, body);

      if (res.status >= 400) {
        // A stale token? Drop the cache so the next attempt re-auths.
        if (res.status === 401) {
          this.einsteinToken = undefined;
        }
        onError(`Einstein HTTP ${res.status}: ${res.body.slice(0, 500)}`);
        return;
      }
      const text = parseEinsteinResponse(res.body);
      onChunk(text);
      onDone(text);
    } catch (e: any) {
      onError(`Einstein request failed: ${e.message || e}`);
    }
  }

  /** OAuth 2.0 client-credentials token, cached in-memory until ~1 min before expiry. */
  private async getEinsteinToken(
    domain: string,
    consumerKey: string,
    consumerSecret: string,
  ): Promise<EinsteinToken> {
    const now = Date.now();
    if (this.einsteinToken && this.einsteinToken.expiresAt > now + 60_000) {
      return this.einsteinToken;
    }
    const form =
      `grant_type=client_credentials` +
      `&client_id=${encodeURIComponent(consumerKey)}` +
      `&client_secret=${encodeURIComponent(consumerSecret)}`;
    const res = await httpsJson({
      host: domain,
      path: "/services/oauth2/token",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }, form);
    if (res.status >= 400) {
      throw new Error(`token exchange HTTP ${res.status}: ${res.body.slice(0, 300)}`);
    }
    const json = JSON.parse(res.body);
    if (!json.access_token) {
      throw new Error("token exchange returned no access_token");
    }
    // Salesforce tokens default ~2h; cache conservatively for 20 min.
    this.einsteinToken = {
      accessToken: json.access_token,
      instanceUrl: (json.instance_url || `https://${domain}`).replace(/\/$/, ""),
      expiresAt: now + 20 * 60_000,
    };
    return this.einsteinToken;
  }
}

/** Minimal promise wrapper over https.request that buffers the whole response. */
function httpsJson(
  options: https.RequestOptions,
  body: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { ...options, headers: { ...options.headers, "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: buf }));
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}