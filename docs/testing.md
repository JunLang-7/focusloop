# Testing

## Commands

```bash
pnpm test                                       # every unit test in the workspace
pnpm --filter @focusloop/learning-state test    # one package
pnpm --filter @focusloop/desktop-e2e run e2e    # the golden path, in the real app
pnpm verify:scaffolding                         # no scaffolding, debug leftovers or bare TODOs
pnpm verify:workflows                           # pinned actions, stated permissions, timeouts
pnpm verify:docs                                # the commands, packages and links the docs cite
pnpm verify:tokens                              # one palette, and the native window background
```

For UI work there is a capture helper that drives the real app through the golden path and writes a
PNG per screen to `demo-ui-review/` **beside** the repository — screenshots are a review aid, not
source, so they are not committed:

```bash
pnpm --filter @focusloop/desktop run build
node apps/desktop-e2e/capture-ui.mjs
```

It is a review aid, not a test: nothing asserts on the images.

`pnpm test` is the fast loop and must stay under a few seconds per package. It deliberately does
**not** run Playwright: `apps/desktop-e2e` has only an `e2e` target, so the E2E suite cannot be
pulled into the unit run by accident. `pnpm e2e` is the slow loop — it builds the desktop app as a
dependency, launches Electron and drives the real UI.

## The pyramid, and why it is shaped this way

```text
        ▲  E2E (Playwright)
       ╱ ╲   the product, launched and clicked
      ╱   ╲
     ╱     ╲  Integration (agent-core)
    ╱       ╲ the golden path with a real database, in memory
   ╱         ╲
  ╱___________╲ Unit (domain packages)
                the rules, with no IO at all
```

Counts are deliberately absent from this document. `pnpm test` prints its own totals, and a number
quoted in prose is a promise nobody renews: ten tests added to `apps/desktop` in one afternoon were
enough to make three of them wrong. What matters here is _where_ a behaviour is proven, not how many
assertions it took.

Almost everything is a unit test, because almost everything is a pure function. The E2E layer only
has to prove that the pieces are wired together — it does not re-prove the rules.

## Where each behaviour is proven

### `learning-state`

- Every transition, in both directions, including the ones that must _not_ happen.
- Threshold behaviour, including the boundary (a value exactly at the threshold counts).
- Duplicate event ids are ignored; the dedupe ring stays bounded.
- The reducer never mutates its input, and is deterministic for identical input.
- Configuration validation rejects negative and non-finite thresholds.

### `continuity`

- `describeProgress` splits concepts into mastered and unresolved correctly, including partial work.
- Checkpoint content for a fresh session, a mid-task session, a completed session, and a session
  interrupted mid-task.
- Checkpoint ids are stable, so checkpoint creation is idempotent.
- Resume card content, including the "no interruption event present" path.
- `computeResumeLatencyMs` returns `null` for a missing, invalid or skewed timestamp.
- Interruption detection matching already-interrupted state without re-deriving it.

### `intervention-policy`

- `NO_ACTION` for every state that should be left alone.
- Every action rule, including the escalation from `HINT` to `EXAMPLE`.
- The session budget, the cooldown, escalation through the cooldown, and back-off after a dismissed
  resume.
- `RESUME` is never rate limited.
- Outcome recording, per-action aggregation, average latency that ignores non-finite values, and an
  acceptance rate that excludes `NO_ACTION`.

### `persistence`

- Migrations are idempotent.
- Course, concept, task and quiz round-trips; `saveCourse` replaces children rather than duplicating.
- Two courses may share a concept id without colliding (the composite-key regression).
- Material dedupe by content hash.
- Session round-trip preserves the engine state.
- Events are append-only, ordered, counted, and duplicate ids are rejected.
- Checkpoints, outcomes and resume timings round-trip, including `null` latency.
- A file-backed database survives close and reopen.
- Sessions are isolated from one another.

### `agent-core`

- The demo course has the shape the golden path needs.
- Material import is idempotent per content hash.
- Session lifecycle, progress, and dashboard aggregation.
- `getCurrentSession` reports the running session and only the running session: a finished one is
  not current, which is what stops the workspace and the home page from treating it as live.
- Starting a session ends the running one first, so at most one session is ever active — asserted
  through the observable consequence, that ending the running session leaves nothing current.
- An unknown course is rejected before anything is ended, so a bad request cannot cost the learner
  the session they are in.
- The full interruption → checkpoint → resume card → accept → outcome sequence.
- Replayed bridge events are ignored.
- Every policy rule _through the engine_, not just in the policy package.
- Degraded mode: the golden path completes while the provider is unreachable.
- Simulator availability, including the production-disabled path.
- Deterministic micro-task generation: same material in, same course out.

### `apps/desktop`

- IPC validation rejects non-objects, unknown event types, unknown sources, oversize payloads,
  unknown session-end reasons, unknown simulator commands, unsupported locales, and unexpected
  arguments.
- The bridge binds to loopback, rejects a wrong or malformed token, rejects malformed JSON,
  rejects a schema violation, rejects a mismatched protocol version, applies an event id once,
  strips a full URL down to its origin, and reports an error when no session is active.
- The preload and the main process agree on every payload, driven through the shared builders.
- Both language dictionaries define the same key set, cover every key the domain can emit, and use
  the same `{name}` placeholders.
- The document language: `<html lang>` follows the interface locale, so a screen reader is told which
  voice to use.
- The chart helpers the dashboard and the sidebar share: the donut arcs, the heat scale, the span
  formatter, which states count as focus, and which shares are worth drawing at all.
- The event-log folding: adjacent repeats merge, an unrelated event in between does not, two sources
  stay apart, the row is keyed by the oldest event so a new one does not re-key it, and the input
  array is left alone.
- The modal focus arithmetic: Tab and Shift+Tab wrap at both ends, focus entering the dialog from the
  container lands on the right control, and a dialog with no controls reports nothing to do.
- The session plan geometry: block heights are proportional to the estimates, the floor keeps a
  two-minute task readable, the blocks tile the column with no gap or overlap, a negative estimate
  counts as nothing, and every kind has its own glyph.
- The focus timer state machine: the three-minute default, a late tick reporting `expired` and
  never negative time, a paused timer ignoring every further tick, resume continuing from the new
  timestamp with the same remaining time, `+1 minute` preserving elapsed progress, an expired timer
  reopening when a minute is added, zero and negative commitments, immutability, and the `m:ss`
  formatting including the 61-minute case.

### `apps/extension`

- The tracker adopts the first tab, emits left/return with a measured duration, does not double
  emit, and never exposes anything but ids.
- The client queues while disconnected, flushes on connect, keeps a stable id per emission, sends a
  closed payload shape, reconnects after a close, bounds the offline queue, and survives a socket
  factory that throws.

### `apps/desktop-e2e`

The golden path, in the real application:

```text
launch → demo course → start session → start task → complete task
      → simulate distraction → simulate return → INTERRUPTED
      → resume card visible → Continue → RESUMING
      → dashboard shows 1 interruption and a measured resume latency
```

Plus: the agent offers a break on overload and the learner can decline it, the resume card is the
only surface that offers `RESUME`, the sidebar's ambient summary refreshes on a new event without
changing the window the dashboard is showing, three identical events from one click collapse into a
single `×3` row, the remaining work renders as contiguous blocks whose heights differ with the
estimates, the resume card takes focus and keeps it inside itself until Escape closes it, ending a
session leaves the app with nothing current, and the interface can be switched to Chinese with the
choice surviving a real restart of the app.

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
