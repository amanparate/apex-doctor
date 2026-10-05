# 🩺 Apex Doctor

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/AmanParate.apex-doctor?label=VS%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=AmanParate.apex-doctor)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/AmanParate.apex-doctor)](https://marketplace.visualstudio.com/items?itemName=AmanParate.apex-doctor)
[![Open VSX](https://img.shields.io/open-vsx/v/amanparate/apex-doctor?label=Open%20VSX)](https://open-vsx.org/extension/amanparate/apex-doctor)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/amanparate/apex-doctor/blob/main/LICENSE)

**Find out why your Apex transaction is slow or broken — in seconds, without leaving VS Code.**

Apex Doctor turns raw Salesforce debug logs into a CPU profiler, a query-plan checker, and an AI pair-debugger. Free and open source.

![Apex Doctor demo](https://raw.githubusercontent.com/amanparate/apex-doctor/main/docs/demo.gif)

> **No org? No problem.** After installing, run **Apex Doctor: Try with Sample Log** from the Command Palette to see a full analysis in 10 seconds.

---

## Why Apex Doctor

### 🔥 A CPU profiler that shows _where_ the time went

Most tools tell you a method took 1,200 ms. Apex Doctor separates **self time** from time spent in child calls, walks the hot path, and calls out the single bottleneck:

```
AccountHandler.processAccounts   1,200 ms total ·  45 ms self
  ↳ ContractValidator.validate     890 ms total ·  12 ms self
      ↳ SOQL: Contract query       878 ms self   ← bottleneck
```

A matching **heap profiler** attributes memory allocations to the method that made them and warns when you approach the heap limit.

![CPU profiler](https://raw.githubusercontent.com/amanparate/apex-doctor/main/docs/profiler.png)

### 🔎 SOQL Query Plan on every query

Every SOQL row has a **Plan** button. One click runs Salesforce's Query Plan tool and shows whether the query is selective, which index it uses, its relative cost, and every alternative plan Salesforce considered. No more pasting queries into Developer Console one at a time.

![SOQL Query Plan](https://raw.githubusercontent.com/amanparate/apex-doctor/main/docs/query-plan.png)

### 🤖 AI root-cause analysis — even inside your org

One click explains **what broke, where, how to fix it, and how to prevent it**, with Apex code. Keep asking follow-up questions, or use **Ask the Log** for natural-language queries like _"SOQL that returned more than 500 rows"_ — matching rows come straight from the parsed log, so nothing is invented.

Works with OpenRouter, Google Gemini, Anthropic, OpenAI, or **🛡️ Salesforce Einstein**, which keeps every prompt inside your org's Trust Layer.

![AI root-cause analysis](https://raw.githubusercontent.com/amanparate/apex-doctor/main/docs/ai-chat.png)

### 🔧 Suggest Fix — preview, then apply

Every issue has a **Suggest fix** button. Apex Doctor finds the source `.cls`, applies a deterministic transform where one exists (SOQL-in-loop → bulkified query + Map lookup, missing LIMIT), falls back to AI otherwise, and shows the change in VS Code's diff view. Nothing is written until you confirm.

![Suggest fix diff](https://raw.githubusercontent.com/amanparate/apex-doctor/main/docs/suggest-fix.png)

### 🔴 Live streaming + Trace Flag Manager

Turn on debug logging for any user straight from VS Code — no Setup tab — then watch their logs arrive in real time. Click any row for a full analysis.

![Trace flags and live stream](https://raw.githubusercontent.com/amanparate/apex-doctor/main/docs/stream-traceflags.png)

---

## Quick start

1. **Install** Apex Doctor (links below). The **Getting Started** guide opens automatically — reopen it any time with **Apex Doctor: Open Getting Started Guide**.
2. **Try it instantly:** run **Apex Doctor: Try with Sample Log**.
3. **Connect your org** (needed for fetching, streaming, trace flags, and query plans):

   ```bash
   npm install --global @salesforce/cli
   sf org login web --set-default
   # sandbox:
   sf org login web --instance-url https://yourdomain--sandbox.sandbox.my.salesforce.com --set-default
   ```

4. **Analyse real logs:** right-click any open log → **Analyse this Apex Log**, or run **Fetch Log from Salesforce**.

## Install

- **VS Code:** [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=AmanParate.apex-doctor), or search "Apex Doctor" in Extensions
- **Cursor, VSCodium, Windsurf, Gitpod:** [Open VSX](https://open-vsx.org/extension/amanparate/apex-doctor)
- **Offline:** download a `.vsix` from [Releases](https://github.com/amanparate/apex-doctor/releases) → Extensions → `…` → **Install from VSIX…**

---

## Everything else it does

**Analysis**

- 💡 Plain-English **Performance Insights** — "62% of runtime is SOQL", "SOQL-in-loop detected"
- 🛑 Issue detection — fatal errors, exceptions, SOQL-in-loop, large and slow queries, slow methods, governor-limit risk, queries on objects you flag
- 📊 Governor limits as colored progress bars (green / amber / red)
- 🔗 Clickable stack traces and inline red squiggles in the log (Problems pane, `F8` to step through)
- 🧪 Apex test results panel
- 🎚️ Debug-level recommendations — which categories to raise or lower

**Execution structure**

- 📈 Activity timeline (SOQL / DML / methods / callouts over time)
- 🗺️ Order-of-Execution map reconstructed from your real transaction
- 🪝 Trigger order per sObject and DML phase, with recursion detection
- 🌊 Flow / Process Builder element timeline, including "element in loop" detection
- ⚡ Async tracer linking `@future`, Queueable, Batch, and Schedulable logs to their parent
- 🧵 User-journey stitching — the several logs one click produces, reassembled into one action

**Compare & history**

- 🔀 Compare two logs — summary deltas plus an event-by-event execution-path diff
- 🗂️ Recent analyses (last 10 per workspace) and 🔁 recurring patterns across them

**In the editor**

- Jump from any method to its `.cls` line, retrieving the class from the org if needed
- 🛠️ Lightbulb quick-fixes on `.cls` files
- 🧪 Test coverage overlay in the gutter, with per-class % in the status bar
- ▶️ Anonymous Apex playground — write, run, and analyse in one click

Everything lives under the **🩺 Apex Doctor** icon in the Activity Bar: Current Analysis, Recent Logs, and Recurring Issues.

---

## AI providers

| Provider               | Cost                          | Data leaves your org?             |
| ---------------------- | ----------------------------- | --------------------------------- |
| OpenRouter             | Free tier available           | Yes                               |
| Google Gemini          | Free tier available           | Yes                               |
| Anthropic Claude       | Paid                          | Yes                               |
| OpenAI                 | Paid                          | Yes                               |
| 🛡️ Salesforce Einstein | Uses your org's AI allocation | **No — stays in the Trust Layer** |

Set `apexDoctor.provider`, then run **Apex Doctor: Set LLM API Key**. If a configured free model is retired or has no quota on your key, Apex Doctor picks a currently available one for the session and tells you which.

**Einstein setup:** create an External Client App with OAuth, the `sfap_api`, `api` and `refresh_token` scopes, and the client-credentials flow with a run-as user. Then set `apexDoctor.provider` to `einstein`, `apexDoctor.einsteinDomain` to your My Domain host (e.g. `mycompany.my.salesforce.com`), and `apexDoctor.einsteinConsumerKey` to the consumer key, and store the consumer secret via **Set LLM API Key**. Requires an org entitled for Einstein generative AI.

---

## Commands

<!-- COMMANDS:START -->
| Command | ID |
| --- | --- |
| Apex Doctor: Analyse this Apex Log | `apexDoctor.analyze` |
| Apex Doctor: Fetch Log from Salesforce | `apexDoctor.fetchLog` |
| Apex Doctor: Export Analysis as Markdown | `apexDoctor.exportMarkdown` |
| Apex Doctor: Set LLM API Key | `apexDoctor.setApiKey` |
| Apex Doctor: Start Log Streaming | `apexDoctor.startStream` |
| Apex Doctor: Stop Log Streaming | `apexDoctor.stopStream` |
| Apex Doctor: Compare Two Apex Logs | `apexDoctor.compareLogs` |
| Apex Doctor: Clear LLM API Key | `apexDoctor.clearApiKey` |
| Apex Doctor: Clear Recent Analyses | `apexDoctor.clearRecent` |
| Apex Doctor: Manage Trace Flags | `apexDoctor.manageTraceFlags` |
| Apex Doctor: Refresh Test Coverage | `apexDoctor.refreshCoverage` |
| Apex Doctor: Toggle Coverage Overlay | `apexDoctor.toggleCoverage` |
| Apex Doctor: Run SOQL Query Plan… | `apexDoctor.queryPlan` |
| Apex Doctor: Open Anonymous Apex Editor | `apexDoctor.openAnonymousEditor` |
| Apex Doctor: Run This Anonymous Apex | `apexDoctor.runAnonymousApex` |
| Apex Doctor: Try with Sample Log | `apexDoctor.trySampleLog` |
| Apex Doctor: Open Getting Started Guide | `apexDoctor.openWalkthrough` |
<!-- COMMANDS:END -->

## Settings

<!-- SETTINGS:START -->
| Setting | Default | Description |
| --- | --- | --- |
| `apexDoctor.provider` | `"openrouter"` | LLM provider. OpenRouter and Gemini have free tiers; Einstein keeps all data inside the Salesforce Trust Layer. One of: `openrouter`, `anthropic`, `openai`, `gemini`, `einstein`. |
| `apexDoctor.model` | `""` | Model name. Leave empty to use the best default for the selected provider: google/gemma-4-31b-it:free (OpenRouter — free, with automatic fallback to other free models), claude-sonnet-4-5 (Anthropic), gpt-4o-mini (OpenAI), gemini-3.5-flash (Gemini), sfdc_ai__DefaultOpenAIGPT4OmniMini (Einstein — use any sfdc_ai__* model your org exposes). |
| `apexDoctor.einsteinDomain` | `""` | Salesforce Einstein only. Your My Domain host, e.g. mycompany.my.salesforce.com (no https://). Used for the OAuth token exchange and the Models API call. |
| `apexDoctor.einsteinConsumerKey` | `""` | Salesforce Einstein only. The consumer key (client_id) of your External Client App that has the sfap_api OAuth scope. Store the matching consumer secret via 'Apex Doctor: Set LLM API Key'. |
| `apexDoctor.maxTokens` | `1500` | Maximum tokens for AI response. |
| `apexDoctor.soqlInLoopThreshold` | `5` | Flag SOQL-in-loop when the same query repeats at least this many times. |
| `apexDoctor.largeQueryThreshold` | `1000` | Flag a SOQL query as 'large' when it returns at least this many rows. |
| `apexDoctor.streamDebugLevel` | `""` | Optional debug level to pass to 'sf apex tail log --debug-level'. Leave empty to stream with default trace flag. |
| `apexDoctor.slowSoqlThresholdMs` | `1000` | Flag a SOQL query as 'slow' when its duration is at least this many milliseconds. |
| `apexDoctor.slowMethodThresholdMs` | `0` | Flag any method slower than this many milliseconds. Set to 0 to disable. |
| `apexDoctor.flagSoqlOnObjects` | `[]` | List of sObject names (e.g. ["Account", "Opportunity"]) — Apex Doctor warns whenever a SOQL query touches one of these objects. Useful for objects with strict perf budgets. |
| `apexDoctor.enableInlineDiagnostics` | `true` | Show issues as red squiggles directly in the open log file (Problems pane integration). |
<!-- SETTINGS:END -->

_Both tables are generated from `package.json` on every release._

---

## Privacy

- API keys live in VS Code's encrypted **SecretStorage**, never in plain-text settings.
- AI features receive a **distilled summary** (issues, top SOQL, slowest methods, limit metrics) — never the raw log.
- Choose Einstein to keep AI processing inside Salesforce.
- All deterministic analysis — insights, profilers, issue detection, limit parsing — runs **locally** with no network calls.
- Salesforce access goes through your local Salesforce CLI; Apex Doctor never handles your credentials.

## Changelog

See [CHANGELOG.md](https://github.com/amanparate/apex-doctor/blob/main/CHANGELOG.md).

## Feedback

Found a bug or want a feature? [Open an issue](https://github.com/amanparate/apex-doctor/issues) — a snippet of the relevant log helps a lot. If Apex Doctor saves you time, a [rating on the Marketplace](https://marketplace.visualstudio.com/items?itemName=AmanParate.apex-doctor&ssr=false#review-details) helps other Salesforce developers find it.

## License

MIT — see [LICENSE](https://github.com/amanparate/apex-doctor/blob/main/LICENSE).
