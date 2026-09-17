# FocusLoop demo — engineering execution plan

> **DeepSeek orchestration × implementation agent × GitHub Issue/PR discipline**
>
> Closed loop: Repo → standards → Milestone → Issue → Branch → TDD → Commit → PR → independent
> review → fixes → tests → merge → release → cleanup.

## 0. What the demo is

FocusLoop is a **local-first, cross-platform desktop learning-continuity agent** for people who find
attention and task initiation hard. It does not diagnose ADHD. It recognises the state of a learning
interaction and helps the learner recover continuity.

### The v0.1 golden path

1. Open the built-in demo course, or import material.
2. The system shows 3–5 micro learning tasks.
3. Start a Focus Session.
4. Save a Learning Checkpoint.
5. The extension or the Demo Event Simulator triggers one interruption.
6. The state engine enters `INTERRUPTED`.
7. The resume engine produces a Resume Card.
8. The learner clicks Continue.
9. Resume latency and intervention outcome are recorded.
10. The dashboard updates.

### Explicitly out of scope for v0.1

Medical diagnosis or severity scoring · always-on camera/eye-tracking/microphone · mobile apps ·
accounts · a central business server · Redis / PostgreSQL / NestJS · collaboration · reinforcement
learning · multi-agent orchestration.

---

## 1. Technical baseline

```text
focusloop/
├─ apps/
│  ├─ desktop/          Electron + Angular
│  ├─ desktop-e2e/      Playwright golden path
│  └─ extension/        Chrome/Edge MV3 + TypeScript
├─ packages/
│  ├─ shared-types/
│  ├─ agent-core/
│  ├─ learning-state/
│  ├─ continuity/
│  ├─ intervention-policy/
│  ├─ material-parser/
│  ├─ persistence/
│  └─ llm-provider/
└─ tooling/
```

TypeScript · Electron · Angular · the Node.js runtime inside Electron · pnpm · Nx · SQLite ·
Vitest · Playwright · ESLint + Prettier · GitHub Actions · a Manifest V3 extension ·
provider adapter with a required mock provider.

**Local-first is an architectural constraint.** With no central server, the core demo must still
run.

---

## 2. Repository initialisation

```bash
mkdir focusloop && cd focusloop
git init && git branch -M main
corepack enable
pnpm dlx create-nx-workspace@latest . --preset=apps --packageManager=pnpm --nxCloud=skip
```

The initial tree contains:

```text
.github/            ISSUE_TEMPLATE/, workflows/, pull_request_template.md
.claude/            review-policy.md
apps/  packages/  docs/  scripts/
.editorconfig  .gitignore  .nvmrc  README.md  CONTRIBUTING.md  pnpm-workspace.yaml
```

---

## 3. Engineering standards

**Branches** — never push to `main`. One branch per issue, containing the issue number:
`feat/12-learning-state-engine`, `fix/18-resume-card-timing`, `test/27-golden-path-e2e`,
`chore/4-ci-quality-gates`.

**Commits** — Conventional Commits, scoped:
`feat(state): add interruption detection`, `fix(resume): prevent duplicate resume card`,
`test(state): cover idle transition`, `refactor(policy): extract selector`, `chore(ci): add PR gates`.
`update`, `final`, `misc` and similar are rejected.

**TDD** — feature issues are strictly RED → GREEN → REFACTOR, and the pull request must show both
halves. Documentation, CI and packaging may skip strict TDD but need a runnable verification command.

**Definition of Done** — acceptance criteria met · new behaviour tested · lint · typecheck · test ·
build · no unexplained TODO/FIXME · independent review · CI green · docs in sync.

---

## 4. Milestones

| Milestone | Theme                         | Outcome                                      |
| --------- | ----------------------------- | -------------------------------------------- |
| M0        | Repository & quality baseline | developable, testable, reviewable, mergeable |
| M1        | Desktop shell & persistence   | Electron + Angular + local storage           |
| M2        | Learning session core         | courses, micro tasks, focus session          |
| M3        | Learning continuity           | state, checkpoints, resume                   |
| M4        | Intervention & browser bridge | policy, outcomes, extension                  |
| M5        | Demo, release & cleanup       | E2E, installer, release, repository hygiene  |

Target release: `v0.1.0-demo`.

---

## 5. Issues

### M0

| #   | Issue                            | Acceptance                                                                                                                             |
| --- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Bootstrap the Nx + pnpm monorepo | `pnpm install/lint/test/build` all pass, versions pinned, README runnable                                                              |
| 2   | Engineering standards            | `CONTRIBUTING.md`, `docs/testing.md`, `docs/architecture.md` define branch/commit/PR/TDD                                               |
| 3   | Issue & PR templates             | Issue: context/goal/non-goals/acceptance/test plan/dependencies. PR: closes/what/why/TDD evidence/tests/risk/screenshot/checklist      |
| 4   | CI quality gates                 | every PR runs `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`                                                                 |
| 5   | Review policy                    | `.claude/review-policy.md` covers scope, TDD, Electron security, local-first, privacy, dependencies, error paths, races, coverage gaps |

### M1

| #   | Issue                    | Acceptance                                                                                                                         |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 6   | Electron + Angular shell | `contextIsolation=true`, `nodeIntegration=false`, `sandbox=true`                                                                   |
| 7   | Typed IPC bridge         | only a whitelisted `window.focusloop` surface, every argument re-validated                                                         |
| 8   | SQLite persistence       | courses, materials, micro_tasks, learning_sessions, learning_events, checkpoints, interventions, outcomes; the UI never writes SQL |
| 9   | AI provider abstraction  | `AIProvider` interface, `MockAIProvider` first, real provider optional, no secrets in Git                                          |

### M2

| #   | Issue                        | Acceptance                                                                                      |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| 10  | Built-in demo course fixture | original material; 4 concepts, 5 micro tasks, 2 quizzes, 1 interruption fixture                 |
| 11  | Material import pipeline     | `.txt` / `.md`; PDF is a stretch goal                                                           |
| 12  | Micro-task generation        | `MaterialDocument` → `MicroTask[]`; mock mode deterministic                                     |
| 13  | Focus session workspace      | course, concept, goal, task, elapsed, progress, agent panel; Start / Complete / Need help / End |

### M3

| #   | Issue                       | Acceptance                                                                                  |
| --- | --------------------------- | ------------------------------------------------------------------------------------------- |
| 14  | Learning state domain model | the eight states; the first engine is pure rules, never an LLM                              |
| 15  | Learning event model        | the twelve event types; every state change is event driven                                  |
| 16  | Learning checkpoint         | the documented shape, persisted                                                             |
| 17  | Interruption detection      | `TAB_LEFT` and `IDLE_STARTED` beyond configurable thresholds → `INTERRUPTED`                |
| 18  | Resume engine               | checkpoint + recent events + session → `ResumeCard`                                         |
| 19  | Resume card UI              | Continue / Dismiss / Show context; records shownAt, acceptedAt, dismissedAt, resume latency |

### M4

| #   | Issue                           | Acceptance                                                                                           |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 20  | Intervention policy v1          | the eight actions, rule-based, `NO_ACTION` is first-class                                            |
| 21  | Intervention outcome logging    | state, action, accepted, dismissed, taskCompleted, resumeLatency, quizOutcome                        |
| 22  | Demo event simulator            | distraction / return / confusion / overload / success; hidden in production                          |
| 23  | MV3 extension shell             | only active-tab change, dwell, leave-return — no page text, input, passwords, cookies or history     |
| 24  | Desktop–extension bridge        | loopback WebSocket on `127.0.0.1`, session token, schema validation, reconnect, duplicate protection |
| 25  | Extension events → state engine | browser event → normalised learning event → state engine → checkpoint/policy                         |

### M5

| #   | Issue                 | Acceptance                                                                                                                                                                                   |
| --- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 26  | Dashboard             | duration, task completion, interruption count, average resume latency, intervention outcomes                                                                                                 |
| 27  | Golden-path E2E       | launch → course → session → task → interruption → return → resume → continue → outcome → dashboard                                                                                           |
| 28  | Degraded mode         | no network, no API key, LLM timeout, extension disconnected — the core demo must not break                                                                                                   |
| 29  | Windows package       | `FocusLoop-Setup.exe`, installable with no Node or pnpm                                                                                                                                      |
| 30  | Repository cleanup    | remove prompt dumps, scratch docs, debug logs, temporary screenshots, unused dependencies, commented-out code, console.log, temporary AI instruction files; resolve or file every TODO/FIXME |
| 31  | Documentation polish  | README: what / demo / architecture / install / development / privacy / roadmap / licence                                                                                                     |
| 32  | Release `v0.1.0-demo` | `FocusLoop-Setup.exe`, `focusloop-extension.zip`, `SHA256SUMS.txt`                                                                                                                           |

Cleanup scans for `Generated by Claude`, `Generated by AI`, `As an AI`, `AI-generated`,
`placeholder`, `lorem ipsum` — and removes only temporary AI scaffolding. It never removes
third-party licences, required attribution, real contribution history, and never rewrites Git
history to fake provenance.

---

## 6. The mandatory loop for every issue

```text
 1. DeepSeek checks main / CI / the milestone
 2. Choose exactly ONE ready issue
 3. Produce an implementation brief for the coding agent
 4. Agent creates the issue branch
 5. Write the failing test first (RED)
 6. Run the test and prove RED
 7. Minimum implementation (GREEN)
 8. Refactor
 9. lint / typecheck / test / build
10. Commit
11. Push the branch
12. Open the pull request
13. A fresh-context reviewer reviews the PR
14. BLOCKING / NON-BLOCKING findings
15. Implementer fixes
16. Re-run the tests
17. Reviewer re-reviews
18. CI is green
19. Squash merge
20. Delete the branch
21. Close the issue
22. DeepSeek moves to the next issue
```

Forbidden: mixing two issues, pushing to `main`, merging before review, merging with failing tests,
smuggling "while I was here" refactors into a feature issue.

---

## 7. The per-round orchestrator brief

Send only this to the implementation agent:

```text
Issue
Goal
Context
Likely files
Non-goals
TDD steps
Acceptance Criteria
Required commands
Commit expectation
Exit condition
```

Never say "and finish anything else that seems related".

---

## 8. Implementer prompt

```text
You are the implementation agent for FocusLoop.

You are working on exactly ONE GitHub Issue.

Hard constraints:
 1. Do not expand scope beyond the current Issue.
 2. Do not modify unrelated files unless strictly required.
 3. Never push directly to main.
 4. Use a branch containing the Issue number.
 5. Follow RED → GREEN → REFACTOR.
 6. Inspect existing code/tests before coding.
 7. Add/update tests first and demonstrate the intended test fails.
 8. Implement the minimum code required.
 9. Run pnpm lint, pnpm typecheck, pnpm test, pnpm build.
10. Do not hide failing tests.
11. Do not use `any` to bypass typing without explicit justification.
12. Do not hard-code secrets.
13. Do not add dependencies unless necessary; explain them.
14. Do not leave prompts, debug logs, generated notes, or unexplained TODOs.
15. Do not create unrelated refactors.
16. Update docs only when behaviour or architecture changes.

Before coding: restate the goal, list the relevant files, identify the first failing test.

Exit only when: acceptance criteria pass, tests pass, the branch is clean, commits are logical,
and the PR description is ready.
```

---

## 9. Independent reviewer prompt

```text
You are an independent senior reviewer for FocusLoop.

Review only the Issue, the PR diff, the tests, the architecture rules and CI.
Do not rely on the implementer's reasoning.

Check: scope correctness · acceptance criteria · TDD evidence · test coverage · type safety ·
Electron security boundary · local-first/privacy boundary · state and event correctness ·
error handling · race and duplicate events · persistence integrity · unnecessary dependencies ·
UI regressions · documentation drift · debug or AI scaffolding left in the repository.

Classify every finding BLOCKING or NON-BLOCKING.
For each, give file, symbol/line, problem, impact, and the minimal fix.

Your final verdict must be exactly one of:
APPROVE
REQUEST CHANGES
```

---

## 10. CI gates

Pull request: `lint`, `typecheck`, `unit-test`, `build`.
M5 adds: `e2e` (golden path) and `package` (Windows installer, extension zip, checksums) on tags.

---

## 11. Five screens, no more

1. **Home** — continue learning, courses, recent session, import.
2. **Course** — concepts, micro tasks, start session.
3. **Focus workspace** — goal, task, material, agent, progress.
4. **Resume card** — last context, completed, friction, next action, continue.
5. **Dashboard** — duration, tasks, interruptions, resume latency, outcomes.

---

## 12. Demo script

```text
00:00  Launch FocusLoop
00:15  Open "Red-black trees: the basics"
00:30  Show the micro tasks
00:45  Start Focus Session
01:10  Complete the first task
01:30  Trigger distraction
01:45  FocusLoop does not nag
02:00  The learner returns
02:05  The Resume Card appears
02:15  Where you were / what you finished / what is open / next step
02:35  Continue
02:45  Back on the micro task
03:05  Complete it
03:15  Dashboard: interruption, resume latency, outcome
```

---

## 13. Release checklist

**Code** — main CI green · no known blocking bug · no secrets · debug off by default · the mock
provider demonstrates everything · the app does not crash when the extension disconnects.

**Product** — clean install works · golden path works · resume card is stable · sample data is
original · the privacy boundary is visible in the interface.

**Repository** — README / LICENSE / CHANGELOG · third-party licences preserved · no prompt dumps ·
no scratch docs · no debug logs · no AI boilerplate · no unexplained TODO/FIXME.

**Release** — tag `v0.1.0-demo` · Windows installer · extension zip · checksum · release notes ·
known limitations.

---

## 14. Long-term orchestrator prompt

```text
You are the engineering orchestrator for the FocusLoop repository.

Project:
FocusLoop is a local-first Electron + Angular TypeScript desktop learning-continuity agent.
It does not diagnose ADHD. v0.1 focuses on learning state, interruption checkpointing, resume,
and intervention outcome tracking.

Architecture:
Electron + Angular desktop · TypeScript · pnpm · Nx · SQLite · Chrome/Edge MV3 extension ·
local-first · no mandatory backend in v0.1 · optional external model through provider adapters ·
a required mock provider.

Development model:
repository → milestones → issues → exactly one issue at a time → its own branch → TDD → commit →
PR → independent review → fixes → CI → merge → next issue → release.

Absolute rules:
 1. Never run multiple feature issues in parallel.
 2. Never allow direct pushes to main.
 3. Every issue gets its own branch.
 4. Feature work follows RED → GREEN → REFACTOR.
 5. Every PR requires an independent reviewer context.
 6. Never merge failing lint/typecheck/tests/build.
 7. Keep the v0.1 scope small.
 8. Do not introduce cloud infrastructure without a dedicated issue.
 9. Do not allow unrelated refactors.
10. Local data privacy is an architectural invariant.
11. The Electron renderer stays isolated from Node.
12. Never remove required third-party attribution.
13. Cleanup removes temporary AI scaffolding and debug artefacts — never legitimate provenance
    or licences.
14. Every merged issue keeps main releasable.

At the start of every loop: inspect the milestone, list open issues in dependency order, inspect
main and CI, choose exactly ONE ready issue, and issue a precise brief.

Never say "done" until the repository state and CI prove it.

Target release: v0.1.0-demo

Golden path:
open demo course → start session → complete a task → interrupt → return → Resume Card → continue
→ persist the outcome → update the dashboard.

Priority:
correctness > demo reliability > privacy > tests > maintainability > feature count.
```

---

## 15. Execution order

```text
#1 → #2 → #3 → #4 → #5
↓
#6 → #7 → #8 → #9
↓
#10 → #11 → #12 → #13
↓
#14 → #15 → #16 → #17 → #18 → #19
↓
#20 → #21 → #22
↓
#23 → #24 → #25
↓
#26 → #27 → #28 → #29 → #30 → #31 → #32
```

If time runs short, `#23–#25` may be covered by the `#22` simulator — but `#18/#19` resume,
`#20/#21` policy and outcomes, and `#27` E2E are not optional.

---

## 16. How success is judged

Only four things matter:

1. The desktop client behaves like real software.
2. The learning state is a real domain model, not a prompt wrapper.
3. An interruption can be resumed to the learner's _cognitive_ position.
4. The Git history clearly shows the issue → branch → TDD → PR → review → merge → release process.

Everything else is second priority.
