# Apex Log Analyzer by Aman

A VS Code extension that parses and analyses Salesforce Apex debug logs — now with **AI-assisted root-cause summaries** powered by Claude.

## Features

- **Right-click → "Analyse this Apex Log"** on any file containing Apex log content
- Detects fatal errors, exceptions, governor-limit violations, slow SOQL, large queries
- Shows every SOQL query, DML op, method timing, debug statement, and code unit
- **🤖 AI root-cause analysis**: click one button to get a plain-English explanation of what broke, where, and how to fix it
- **Per-issue "Explain this"** buttons for focused analysis
- **Sync with Salesforce Org** to fetch the user who executed the log via `sf` CLI

## Setup

```bash
npm install
npm run compile
```

Press **F5** in VS Code to launch the Extension Development Host.

## Using the AI feature

1. Get a FREE OpenRouter API key at openrouter.ai/keys (no credit card needed)
2. Or use Anthropic directly by changing `apexLogAnalyzer.provider` to `anthropic`
3. Run "Apex Log Analyzer: Set LLM API Key" from the Command Palette...

### Privacy note

The extension sends a **distilled summary** of the log (issues, stack, SOQL, top debugs) to Anthropic's API — not the raw log. If your logs contain sensitive data (PII in debug statements, record IDs with confidential names, etc.), review the `buildContext()` method in `aiService.ts` and redact/filter as needed before shipping this to your team.

### Model & token settings

Configurable in VS Code settings (`apexLogAnalyzer.model`, `apexLogAnalyzer.maxTokens`). Default model is `claude-sonnet-4-5` which offers a good speed/quality/cost balance.

## Using the Salesforce sync

You need the Salesforce CLI installed and authenticated:

```bash
sf org login web
sf config set target-org=<your-alias>
```

## Packaging

```bash
npm install -g @vscode/vsce
vsce package
```
