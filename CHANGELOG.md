# Changelog

All notable changes to Apex Doctor are documented here.

## [0.13.0]

### Added

- **Try with Sample Log** — analyse a bundled log with no org, CLI, or API key
- **Getting Started walkthrough** — opens on install; reopen via "Open Getting Started Guide"
- **Automatic model fallback** — if a configured OpenRouter / Gemini model is retired or has no quota, a currently available model is used for the session
- One-time rating prompt after a few real analyses

### Changed

- README rewritten around the top features; Commands and Settings tables now generated from package.json
- Marketplace categories and keywords updated

## [0.12.0]

### Added

- **Salesforce Einstein provider** — AI features run through your org's Einstein Models API; prompts stay inside the Einstein Trust Layer

## [0.9.0 – 0.11.x]

### Added

- Heap / memory profiler
- Flow and Process Builder analysis, including "element in loop" detection
- Order-of-Execution map
- User-journey stitching
- Editor quick-fixes on `.cls` files
- Activity-bar sidebar: Current Analysis, Recent Logs, Recurring Issues

## [0.8.0]

### Added

- Execution-path diff (event-by-event LCS diff) in Compare Two Logs
- Anonymous Apex playground

## [0.7.0]

### Added

- SOQL Query Plan integration (per-row Plan button and ad-hoc command)
- Test coverage gutter overlay

## [0.6.0]

### Added

- Ask the Log — natural-language queries over the parsed log
- Suggest Fix — templated and AI-assisted refactors with diff preview

## [0.5.0]

### Added

- CPU profiler with self-time attribution, hot path, and bottleneck callout
- Recurring patterns across saved analyses
- Async operation tracer
- Trigger order visualiser
- Debug-level recommendations

## [0.4.0]

### Added

- Trace Flag Manager
- Inline log diagnostics (Problems pane)
- Clickable stack traces
- Parsed governor limits with progress bars
- Apex test results panel
- Recent analyses
- AI follow-up chat; OpenAI and Gemini providers
- Custom heuristic settings

## [0.3.0]

### Added

- Performance Insights, activity timeline, live log streaming, Apex class navigation, Compare Two Logs, SOQL-in-loop detection, Markdown export

## [0.1.0]

### Added

- Initial release: Apex log parser, analysis panel, AI root-cause analysis
