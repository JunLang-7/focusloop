# Changelog

All notable changes to FocusLoop are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-demo] — 2026-09-17

The first demonstrable end-to-end slice. FocusLoop does not diagnose ADHD; it tracks the learning
interaction and helps the learner resume.

### Added

- **Desktop shell** — Electron main process with an Angular renderer, `contextIsolation: true`,
  `nodeIntegration: false` and `sandbox: true`.
- **Typed IPC bridge** — a closed whitelist of channels exposed as `window.focusloop`, with
  argument validation re-run in the main process.
- **Local persistence** — SQLite via Node's built-in `node:sqlite`, append-only migrations and
  repositories for courses, concepts, micro tasks, quizzes, materials, sessions, events,
  checkpoints, interventions, outcomes and resume-card timings.
- **Learning state engine** — a pure, deterministic reducer over eight states
  (`READY`, `INITIATION_FRICTION`, `FOCUSED`, `CONFUSED`, `OVERLOADED`, `DISTRACTED`,
  `INTERRUPTED`, `RESUMING`) driven entirely by events. No LLM is involved in judging state.
- **Learning checkpoints** — the learner's cognitive position: concept, goal, mastered, unresolved,
  current step, friction state and next best action.
- **Interruption detection** — configurable tab-left and idle thresholds, plus time-based
  evaluation for the case where no event arrives.
- **Resume engine and Resume Card** — a rule-based card that restores context, with recorded
  `shownAt` / `acceptedAt` / `dismissedAt` / resume latency.
- **Intervention policy v1** — rule-based, explainable, with `NO_ACTION` as a first-class answer,
  a session budget, a cooldown, urgency-based escalation, and `HELP_REQUESTED` overload detection.
- **Intervention outcome logging** — accepted, dismissed, task completed, resume latency and quiz
  outcome, aggregated for the dashboard.
- **Dashboard** — session duration, micro-task completion, interruption count, average resume
  latency and per-action intervention outcomes.
- **Material import** — `.txt` and `.md` parsed into a normalised document, with deterministic
  concept and micro-task generation (mock mode is reproducible).
- **Built-in demo course** — "Red-black trees: the basics": 4 concepts, 5 micro tasks, 2 quizzes and
  a scripted interruption fixture. Written for this project so it ships without attribution debt.
- **Demo Event Simulator** — distraction, return, confusion, overload and success. Available in
  development builds, hidden in packaged builds.
- **Manifest V3 browser bridge** — tracks tab activation and idle state only. It requests no page
  access at all, so it cannot read URLs, titles, text, input or cookies.
- **Loopback bridge server** — binds to `127.0.0.1`, requires a per-run token compared in constant
  time, schema-validates every message, and applies each event id at most once.
- **Degraded mode** — no network, no API key, provider timeout or a disconnected extension all
  keep the golden path working.
- **Provider abstraction** — `MockAIProvider` (default, offline, deterministic) and an optional
  DeepSeek adapter behind the same interface.
- **Windows packaging** — NSIS installer, extension zip and checksums.
- **Quality gates** — ESLint (flat config), TypeScript strict mode, Vitest, Playwright and GitHub
  Actions.

### Known limitations

- PDF import is not implemented (`.txt` and `.md` only).
- The state engine's thresholds are configurable in code, not yet in the UI.
- The packaged installer is unsigned, so Windows SmartScreen will warn on first run.
- The extension currently reports tab changes only; it does not yet send an origin.
