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
- **Bilingual interface** — English and Simplified Chinese, switchable from the sidebar. The domain
  emits message keys and interpolation params rather than prose; the renderer owns the wording, so
  there is one bilingual implementation rather than two. A missing translation is a compile error,
  and a test asserts that both languages use the same placeholders.
- **Insights dashboard** — the dashboard re-aggregates over this session, today, the last seven days
  or all time: total and daily-average time, a focus ratio, a ring of time by learning state, a
  daily activity grid, a per-course breakdown, and the share of the window that was actually on
  task. Everything is rebuilt from the event log by replaying it through the real state machine, so
  the charts cannot disagree with the engine; silent stretches are capped by the engine's own idle
  threshold rather than counted as focus.
- **Light and dark themes** — the theme preference is `system`, `light` or `dark`, switchable from
  the sidebar. Every colour comes from a token, so a theme is one block of overrides rather than a
  hunt for hardcoded hexes; `system` re-resolves live when the OS setting changes, and the window
  background follows the OS so there is no flash before the renderer paints.
- **A shell that uses the room it has** — the sidebar carries an ambient _today_ summary (total
  time, a ribbon of the time by state, and the day's task and interruption counts) rather than
  leaving a hole under a three-item nav, and it is pinned above the state chip so the bottom of the
  sidebar is one cluster instead of one lonely pill. It always reports _today_, whichever window the
  dashboard is showing, which is why it fetches its own summary rather than borrowing the
  dashboard's. The content column is capped at a measure and centred, so a wide window gets a
  readable column instead of cards stretched edge to edge, and the donut and its legend wrap
  instead of ellipsising every state name at the minimum window width.- **A folded event log** — consecutive events of the same type and source collapse into one row
  (`HELP_REQUESTED ×3`) with a time span when the run is wider than an instant, and the rows are
  hairline list rows rather than one bordered card per event. Only _adjacent_ repeats fold, so an
  unrelated event in between keeps the two runs apart instead of inventing an order that never
  happened. This also fixes two log defects found while testing: reopening the app showed "No events
  recorded yet" for a session that had plenty, and ending a session left its log on screen.- **Quality gates** — ESLint (flat config), TypeScript strict mode, Vitest, Playwright and GitHub
  Actions.

### Known limitations

- PDF import is not implemented (`.txt` and `.md` only).
- The state engine's thresholds are configurable in code, not yet in the UI.
- The packaged installer is unsigned, so Windows SmartScreen will warn on first run.
- The extension currently reports tab changes only; it does not yet send an origin.
- Two interface languages ship (English, Simplified Chinese). Adding a third means adding one
  dictionary file — but the wording itself is not yet user-editable or community-translated.
