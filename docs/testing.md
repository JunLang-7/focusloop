# Testing

## Commands

```bash
pnpm test                                       # every unit test in the workspace
pnpm --filter @focusloop/learning-state test    # one package
pnpm --filter @focusloop/desktop-e2e run e2e    # the golden path, in the real app
node scripts/verify-no-scaffolding.mjs          # release hygiene gate
```

`pnpm test` is the fast loop and must stay under a few seconds per package. It deliberately does
**not** run Playwright: `apps/desktop-e2e` has only an `e2e` target, so the E2E suite cannot be
pulled into the unit run by accident. `pnpm e2e` is the slow loop — it builds the desktop app as a
dependency, launches Electron and drives the real UI.

## The pyramid, and why it is shaped this way

```text
        ▲  E2E (Playwright, 4 tests)
       ╱ ╲   the product, launched and clicked
      ╱   ╲
     ╱     ╲  Integration (agent-core, 71 tests)
    ╱       ╲ the golden path with a real database, in memory
   ╱         ╲
  ╱___________╲ Unit (domain packages, 267 tests)
                the rules, with no IO at all
```

Almost everything is a unit test, because almost everything is a pure function. The E2E layer only
has to prove that the pieces are wired together — it does not re-prove the rules.

## Where each behaviour is proven

### `learning-state` — 33 tests

- Every transition, in both directions, including the ones that must _not_ happen.
- Threshold behaviour, including the boundary (a value exactly at the threshold counts).
- Duplicate event ids are ignored; the dedupe ring stays bounded.
- The reducer never mutates its input, and is deterministic for identical input.
- Configuration validation rejects negative and non-finite thresholds.

### `continuity` — 31 tests

- `describeProgress` splits concepts into mastered and unresolved correctly, including partial work.
- Checkpoint content for a fresh session, a mid-task session, a completed session, and a session
  interrupted mid-task.
- Checkpoint ids are stable, so checkpoint creation is idempotent.
- Resume card content, including the "no interruption event present" path.
- `computeResumeLatencyMs` returns `null` for a missing, invalid or skewed timestamp.
- Interruption detection matching already-interrupted state without re-deriving it.

### `intervention-policy` — 38 tests

- `NO_ACTION` for every state that should be left alone.
- Every action rule, including the escalation from `HINT` to `EXAMPLE`.
- The session budget, the cooldown, escalation through the cooldown, and back-off after a dismissed
  resume.
- `RESUME` is never rate limited.
- Outcome recording, per-action aggregation, average latency that ignores non-finite values, and an
  acceptance rate that excludes `NO_ACTION`.

### `persistence` — 31 tests

- Migrations are idempotent.
- Course, concept, task and quiz round-trips; `saveCourse` replaces children rather than duplicating.
- Two courses may share a concept id without colliding (the composite-key regression).
- Material dedupe by content hash.
- Session round-trip preserves the engine state.
- Events are append-only, ordered, counted, and duplicate ids are rejected.
- Checkpoints, outcomes and resume timings round-trip, including `null` latency.
- A file-backed database survives close and reopen.
- Sessions are isolated from one another.

### `agent-core` — 71 tests

- The demo course has the shape the golden path needs.
- Material import is idempotent per content hash.
- Session lifecycle, progress, and dashboard aggregation.
- The full interruption → checkpoint → resume card → accept → outcome sequence.
- Replayed bridge events are ignored.
- Every policy rule _through the engine_, not just in the policy package.
- Degraded mode: the golden path completes while the provider is unreachable.
- Simulator availability, including the production-disabled path.
- Deterministic micro-task generation: same material in, same course out.

### `apps/desktop` — 69 tests

- IPC validation rejects non-objects, unknown event types, unknown sources, oversize payloads,
  unknown session-end reasons, unknown simulator commands, unsupported locales, and unexpected
  arguments.
- The bridge binds to loopback, rejects a wrong or malformed token, rejects malformed JSON,
  rejects a schema violation, rejects a mismatched protocol version, applies an event id once,
  strips a full URL down to its origin, and reports an error when no session is active.
- The preload and the main process agree on every payload, driven through the shared builders.
- Both language dictionaries define the same key set, cover every key the domain can emit, and use
  the same `{name}` placeholders.

### `apps/extension` — 21 tests

- The tracker adopts the first tab, emits left/return with a measured duration, does not double
  emit, and never exposes anything but ids.
- The client queues while disconnected, flushes on connect, keeps a stable id per emission, sends a
  closed payload shape, reconnects after a close, bounds the offline queue, and survives a socket
  factory that throws.

### `apps/desktop-e2e` — 4 tests

The golden path, in the real application:

```text
launch → demo course → start session → start task → complete task
      → simulate distraction → simulate return → INTERRUPTED
      → resume card visible → Continue → RESUMING
      → dashboard shows 1 interruption and a measured resume latency
```

Plus: the agent offers a break on overload and the learner can decline it, the resume card is the
only surface that offers `RESUME`, and the interface can be switched to Chinese with the choice
surviving a real restart of the app.

There is no `test` target for this project on purpose. When there was one it ran Playwright under
`pnpm test`, which meant the unit run tried to launch Electron without a build — CI could never go
green.

## Conventions

- Test files live next to the code as `*.spec.ts`.
- Test names describe behaviour, not implementation: `it('moves to INTERRUPTED when the learner
returns after the threshold')`, not `it('tests reduceState')`.
- Fixtures live in `fixtures.ts` and are excluded from the build output.
- Time is always injected. There is no `Date.now()` and no `Math.random()` in a domain package.
- A regression test names the bug it prevents.

## What is intentionally not tested

- Angular component rendering. The renderer holds no decisions; the E2E test covers the wiring that
  matters.
- Electron's own behaviour.
- Anything requiring the network. The DeepSeek adapter is tested against an injected `fetch`, so its
  status mapping, timeout, and key handling are proven without a single real request.
