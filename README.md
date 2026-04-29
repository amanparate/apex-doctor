# Apex Doctor

> Diagnose Salesforce Apex debug logs in seconds. AI root-cause analysis, live log streaming, performance insights, trace-flag setup, and one-click navigation to Apex source — all inside VS Code.

![Apex Doctor — Performance Insights, Issues and Errors](https://raw.githubusercontent.com/amanparate/apex-doctor/main/docs/screenshot-1.png)

---

## ✨ What it does

Paste any Salesforce Apex debug log into VS Code, right-click, and get an instant, structured breakdown:

- 💡 **Performance Insights** — plain-English summary of where time went
- 🛑 **Issues & errors** — fatal errors, exceptions, SOQL-in-loop, governor-limit violations
- 🛠️ **Inline diagnostics** — issues become red squiggles directly in the log file (Problems pane integration)
- 🔗 **Stack-trace parsing** — exception frames render as clickable class links
- 📈 **Activity Timeline** — stacked area chart showing when SOQL / DML / methods / callouts ran
- 📊 **Code units** — every trigger, workflow, and execution entry point with timing
- 🐌 **Slowest methods** — top 50 methods ranked by duration, clickable to jump to source
- 🗃️ **SOQL queries** — every query, row count, and execution time, with per-table search
- ✏️ **DML operations** — inserts, updates, deletes with row counts
- 🐞 **Debug statements** — all `System.debug()` output, filterable
- 📊 **Parsed governor limits** — colored progress bars (green &lt;50%, amber 50–80%, red ≥80%)
- 🧪 **Apex test results** — `TEST_PASS` / `TEST_FAIL` events surface as a dedicated panel
- 🎯 **Trace Flag Manager** — set up debug logs for any user from VS Code (no Setup-UI trip)
- 🔴 **Live streaming** — watch logs arrive from your org in real time
- 🔀 **Compare two logs** — side-by-side diff for before / after optimisations
- 🗂️ **Recent analyses** — last 10 analyses persisted per workspace, one click to reopen
- 🤖 **AI root-cause + follow-up chat** — OpenRouter, Anthropic, OpenAI, or Google Gemini

---

## 🎯 Trace Flag Manager

**New in v0.4.0** — capture debug logs for any user in the org without leaving VS Code or visiting Salesforce Setup.

![Trace Flag Manager + Live Stream + analysis side-by-side](https://raw.githubusercontent.com/amanparate/apex-doctor/main/docs/screenshot-6.png)

Run **"Apex Doctor: Manage Trace Flags"** from the Command Palette (or click **+ Trace user** in the Live Stream panel) to:

- See every active `TraceFlag` record (user, debug level, expiration)
- **+ Trace another user** — search active users by name, username, or email; pick a debug level (`SFDC_DevConsole`, your own custom levels, etc.); pick a duration up to 24 hours
- Extend or delete flags inline with one click
- Get smart conflict handling — if the user already has an active flag, Apex Doctor offers to extend it instead

Pair it with **Live Apex Log Stream** to watch the traced user's logs arrive in real time, then click any row for a full analysis. Backed by the Tooling API via the `sf` CLI — no extra setup needed beyond a logged-in default org.

---

## 💡 Performance Insights, Issues & Errors

At the top of every analysis, plain-English insights highlight exactly where time went and what's wrong — followed by a structured list of every detected issue with severity and line numbers.

Examples:

- "🗃️ 62% of runtime is SOQL — 14 queries took 1,150 ms combined"
- "🔁 SOQL-in-loop detected — same query executed 8 times"
- "🐌 One query took 30% of total runtime — 4,562 rows"
- "🛑 Execution halted by fatal error — NullPointerException at line 230"

All deterministic rules — no API calls needed. Free, instant, on every analysis.

### Inline diagnostics in the log file

Detected issues also appear as red squiggles in the open log file, with full integration into VS Code's Problems pane. Press `F8` to step through them. Toggle via the `apexDoctor.enableInlineDiagnostics` setting.

### Clickable stack traces

Fatal errors and exceptions are parsed into structured stack frames. Each frame is a clickable link that opens the relevant `.cls` file at the right line — even retrieving the class from the org if it's not in your workspace.

---

## 📈 Activity Timeline & Code Units

A stacked-area chart visualises exactly when SOQL, DML, methods, and callouts ran across the log — so you can spot bottlenecks at a glance. Below it, every code unit (trigger, workflow, execution entry point) is listed with timing.

![Activity Timeline and Code Units](https://raw.githubusercontent.com/amanparate/apex-doctor/main/docs/screenshot-2.png)

---

## 🔗 Navigate directly to your Apex source

In the "Slowest Methods" table, method names like `AccountHandler.processAccounts` are clickable. Click once → opens `AccountHandler.cls` at the exact line number in the editor.

![Slowest Methods with clickable source links](https://raw.githubusercontent.com/amanparate/apex-doctor/main/docs/screenshot-3.png)

**Works with any SFDX project** — Apex Doctor reads `sfdx-project.json` and finds the class under your `packageDirectories`.

**Class not in your workspace?** No problem — you'll get a prompt offering to retrieve it from the org via `sf project retrieve`. Approve once, and the class is pulled down and opened automatically.

---

## 🗃️ Full data at a glance

Every SOQL query, DML operation, debug statement, and governor-limit snapshot — laid out in sortable tables with **per-table search** so nothing gets missed even on huge logs.

![SOQL, DML, Debug statements and Governor Limits](https://raw.githubusercontent.com/amanparate/apex-doctor/main/docs/screenshot-4.png)

### Parsed governor limits

`LIMIT_USAGE_FOR_NS` blocks are no longer dumped as raw text — every metric (SOQL, DML, CPU, heap, callouts, future calls, etc.) is parsed into a colored progress bar:

- 🟢 **Green** under 50%
- 🟡 **Amber** 50–80%
- 🔴 **Red** at or above 80%

You'll spot governor-limit pressure long before it actually exceeds.

---

## 🔴 Live Log Streaming

Debug in real time. Click the **"⏺ Stream Apex Logs"** button in the status bar (or run "Start Log Streaming" from the Command Palette) and a dedicated panel opens showing incoming logs as they happen.

![Live Apex Log Stream with + Trace user button](https://raw.githubusercontent.com/amanparate/apex-doctor/main/docs/screenshot-7.png)

- Each new log appears in a table with operation, status, duration, size, user, and timestamp
- **+ Trace user** button right in the panel — opens the Trace Flag Manager flow
- **Search by operation, user, or ID**; filter by status or specific user
- Click any row → full analysis of that log in the main panel
- Status bar shows a red "⏺ Streaming" indicator while active
- Polls every 3 seconds — typical latency between log completion and appearance is &lt; 6 seconds

---

## 🤖 AI-assisted root-cause analysis & follow-up chat

One click and the AI explains exactly **what went wrong, where it broke, and how to fix it** — in plain English, with working Apex code suggestions.

The initial response is structured into four sections:

- **Root Cause** — what actually went wrong, in plain English
- **Where it broke** — the class, method, and line number
- **Likely Fix** — concrete recommendation with an Apex code snippet
- **Prevention** — practices to prevent this class of issue recurring

**Then keep the conversation going.** Ask follow-ups like _"what if we made this query selective?"_ or _"show me a bulkified version"_ — the AI keeps the analysis context loaded across turns. Conversation history persists across webview reloads.

**Per-issue focus**: click "Explain this" next to any detected issue to get focused analysis of just that problem.

### Choose your AI provider

Apex Doctor supports four LLM providers — pick one in settings (`apexDoctor.provider`):

| Provider | Default model | Free tier? |
|---|---|---|
| **OpenRouter** | `openrouter/free` (auto-routes to free models) | ✅ Yes |
| **Anthropic Claude** | `claude-sonnet-4-5` | ❌ Paid |
| **OpenAI ChatGPT** | `gpt-4o-mini` | ❌ Paid |
| **Google Gemini** | `gemini-2.0-flash` | ✅ Yes |

API keys are stored in VS Code's encrypted SecretStorage — never written to disk in plaintext.

---

## 🧪 Apex test results

Logs from `sf apex run test --json` (or any test execution) automatically surface a 🧪 **Test Results** section above the issues view, with pass/fail pills, the assertion message for failures, and clickable links to the test class.

Failed tests also appear as `Test Failed` entries in the issues list, ready for AI explanation.

---

## 🗂️ Recent analyses

Apex Doctor remembers the last 10 analyses per workspace. Open the **Explorer sidebar** and look for the **"Apex Doctor: Recent Logs"** view — every prior analysis is one click away to reopen, complete with the issues, SOQL, methods, and AI conversation context restored.

Each entry shows total duration, SOQL count, and a red/yellow/green health icon based on whether errors / warnings were detected.

---

## 🔀 Compare Two Logs

Before and after an optimisation? Run **"Compare Two Apex Logs"** from the Command Palette, pick your baseline and your comparison log, and Apex Doctor renders a diff panel:

- Summary deltas (duration, SOQL, DML, errors) with % change
- Verdict banner — _"Comparison is 34% faster"_ or _"Comparison regressed — 2 new errors"_
- **Method performance table** — total time per method (sum across all calls) with call count delta
- SOQL pattern changes grouped by normalised query
- New vs resolved issues
- One-click export of the comparison as Markdown for Jira / Slack

---

## ⚙️ Custom heuristics

Tune Apex Doctor's deterministic rules to your team's perf budget via VS Code settings:

| Setting | Default | Description |
|---|---|---|
| `apexDoctor.soqlInLoopThreshold` | `5` | Flag SOQL-in-loop when the same query repeats this many times |
| `apexDoctor.largeQueryThreshold` | `1000` | Flag a query as "large" when it returns this many rows |
| `apexDoctor.slowSoqlThresholdMs` | `1000` | Flag a SOQL query as "slow" above this duration |
| `apexDoctor.slowMethodThresholdMs` | `0` | Flag any method slower than this (set 0 to disable) |
| `apexDoctor.flagSoqlOnObjects` | `[]` | List of sObjects (e.g. `["Account", "Opportunity"]`) — warn whenever a query touches one |
| `apexDoctor.enableInlineDiagnostics` | `true` | Show issues as red squiggles in the open log file |
| `apexDoctor.streamDebugLevel` | `""` | Optional `--debug-level` for `sf apex tail log` |

---

## 🚀 Getting started

### Install from the VS Code Marketplace

Search for **"Apex Doctor"** in the Extensions panel (`Cmd+Shift+X` / `Ctrl+Shift+X`) and click **Install**.

### Install from VSIX (latest pre-release)

Download the latest `apex-doctor-*.vsix` from the [Releases page](https://github.com/amanparate/apex-doctor/releases), then in VS Code:

1. Open the Extensions panel (`Cmd+Shift+X`)
2. Click the `…` menu (top-right) → **Install from VSIX…**
3. Pick the downloaded file → reload when prompted

### Install on Cursor / VSCodium / Gitpod (Open VSX)

If you're not on official VS Code, the same VSIX works — use the "Install from VSIX…" flow above.

### Prerequisites

- **Salesforce CLI (`sf`)** logged into a default org — install via `npm install --global @salesforce/cli` and authenticate with `sf org login web`. Required for log fetching, streaming, trace-flag management, and class retrieval.
- **An LLM API key** if you want AI explanations — set it via the **"Apex Doctor: Set LLM API Key"** command. Free options: [OpenRouter](https://openrouter.ai/keys), [Google Gemini](https://aistudio.google.com/apikey).

### Quick start

1. Open any `.log` file containing Apex debug output → **right-click → Analyse this Apex Log**
2. _Or_ run **"Fetch Log from Salesforce"** to pick from your org's recent logs
3. _Or_ run **"Manage Trace Flags"** to set up debug logging for a teammate, then **"Start Log Streaming"** to watch logs arrive live

---

## 📋 Commands

All commands live under the **Apex Doctor** category in the Command Palette:

| Command | What it does |
|---|---|
| Analyse this Apex Log | Right-click on any open log file |
| Fetch Log from Salesforce | Pick from the 20 most recent logs in your default org |
| Manage Trace Flags | Open the Trace Flag Manager panel |
| Start / Stop Log Streaming | Live tail of the org's Apex logs |
| Compare Two Apex Logs | Side-by-side diff of two analyses |
| Export Analysis as Markdown | Copy the current analysis to clipboard |
| Set / Clear LLM API Key | Configure the AI provider |
| Clear Recent Analyses | Wipe the saved history |

---

## 🔒 Privacy

- API keys live in VS Code's encrypted **SecretStorage** — never written to disk in plaintext.
- The AI is sent a **distilled summary** of your log (issue list, top SOQL, slowest methods, governor-limit metrics) — _never_ the raw debug log. You control which provider it goes to.
- All deterministic rules (insights, SOQL-in-loop detection, governor-limit parsing) run **entirely locally** with no network calls.

---

## 🐛 Found a bug?

Open an issue at [github.com/amanparate/apex-doctor/issues](https://github.com/amanparate/apex-doctor/issues) — please include the relevant snippet of the Apex log if you can.

---

## 📜 License

MIT — see [LICENSE](LICENSE).
