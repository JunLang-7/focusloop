# Focus notice surface (#77)

## Product decisions

The focus screen has one bottom-anchored notice slot, with this precedence:

1. **Resume**: recover the learner's position before offering help with it.
2. **Help**: a learner-requested rescue, or an already-issued policy suggestion.
3. **Time up**: the clock must not replace a pending cognitive choice.

Slot selection does not consume the losing candidates. Their existing state remains authoritative;
when the higher-priority choice is resolved, the next still-pending notice becomes visible.
This decision is implemented and unit-tested in `apps/desktop/src/app/core/focus-notice.ts`.

## Folding is not declining

The toggle and Escape within the notice change **presentation only**. They do not resolve an
intervention, accept/dismiss a checkpoint, resume a task, or extend a timer. A folded notice retains
its heading and a keyboard-reachable Show notice button. New evaluations/notifications and focus-route
remounts preserve the fold for the same session. A new session starts unfolded. This is renderer
session state, not a persisted preference.

The focus resume surface is non-modal: it neither steals focus nor traps Tab. Escape returns focus
to the fold toggle. Because the surface is non-modal it also owns the keyboard deliberately: a choice
row and the resume card both remove the element a learner just activated, so the notice hands focus
back to its fold toggle instead of leaving it on the document, where the next Tab restarts at the top
of the screen. Focus is never taken when the notice merely appears. Other routes retain the existing agent panel and modal resume card, and that
modal surface keeps its own coverage: `focus-notice.spec.ts` drives `/dashboard` with a pending
checkpoint and asserts `role=dialog`, `aria-modal`, Tab containment and Escape-dismiss. Moving this
screen's assertion to the non-modal contract had removed the modal card's only end-to-end exercise.

## Three-way help choice

- **Continue** uses the existing `MICRO_START` plan to help restart the same task. A paused
  clock resumes; an expired clock receives a minute through the existing timer command.
- **Make this step smaller** explicitly requests `too-big` through `HELP_REQUESTED` and accepts
  the resulting deterministic `SIMPLIFY` rescue plan.
- **Rest for 3 minutes** explicitly requests `tired` and accepts the existing `BREAK` lifecycle;
  the focus clock pauses until the learner chooses Continue. Three minutes is the voluntary UI
  suggestion, not a new enforced break timer or an automatic return to learning.

A choice matching the current offer accepts that offer without generating a duplicate request.
Changing the kind of help resolves the superseded offer before issuing a new explicit request
(`cannot-start`, `too-big` or `tired`). Both facts remain auditable in the existing lifecycle. Only the matching current response may be
accepted: a bridge failure or a session/task change cannot accidentally accept another offer.

The secondary Try this affordance is retained for HINT/EXAMPLE so the surface does not regress
AG2's reason-specific help. Automatic legacy suggestions retain their existing actions. No policy
cooldown, daily budget, priority, model call, persistence schema or IPC contract is changed.
SIMPLIFY still provides the existing local plan; actual adaptive-task mutation remains AG4 work.

Two behaviours are worth stating rather than discovering. A policy suggestion that exists before any
request exposes both routes: the panel's own accept (HINT/EXAMPLE only) and the three-way choice,
which are two paths to a rescue for one intent with different event logs. And a choice the policy
does not answer - the session's intervention budget is spent, so `decideIntervention` returns
`NO_ACTION` before the reason rule - dismisses the superseded offer, leaves the slot empty and tells
the learner nothing; that matches how the existing stuck picker already behaves and no test pins it.

## Layout and motion

The surface occupies a reserved last row in the focus workspace, not a fixed overlay over the
current task. It is anchored above the simulator's 56px reservation and uses z-index 30. The task
area and notice contents scroll independently on short windows. Resume actions remain reachable at
the notice's bottom edge. The sheet reuses `plan-rise`; both sheet and contents disable motion
under `prefers-reduced-motion: reduce`. Colours reuse existing theme tokens.

## Verification

- Desktop unit suite includes quiet state, each moment, competing notices, retained losing
  candidates and session-scoped fold tests.
- `apps/desktop-e2e/tests/focus-notice.spec.ts` drives the real offline Electron app: timer expiry,
  help/resume precedence, fold without dismissal across an evaluation and route remount, keyboard
  folding/reopening, all three help choices, new-session reset, reduced motion, and geometry at
  1280×900, 1024×768 and 800×700. The small-window cases explicitly force 15px classic scrollbars
  to cover the width loss seen on macOS CI, independently of the developer's OS scrollbar preference.
  It also checks the CSS branch with the simulator element absent
  (not a claim of testing a packaged production build).
- The existing golden-path tests now assert the focus resume's non-modal contract instead of a
  modal focus trap, and still exercise the original rescue lifecycle.
- The notice E2E emits `time-up.png`, `stuck.png` and `resume.png` into its Playwright result
  directory for review. These use the synthetic built-in demo course, never learner data.
  Checked-in review snapshots: [time up](./screenshots/77/time-up.png),
  [stuck](./screenshots/77/stuck.png), [resume](./screenshots/77/resume.png).

This document records implementation decisions, not a claim that the issue or PR is merged.
