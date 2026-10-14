# Focus notice surface (#77)

## Product decisions

The focus screen has one bottom-anchored notice slot, and it carries exactly one thing: the **return
card**. The screen somebody is working in gets a strip pinned over the bottom of it only when they have
just come back from somewhere else and their place has to be found for them.

It used to be a three-way slot with this precedence:

1. **Resume**: recover the learner's position before offering help with it.
2. **Help**: a learner-requested rescue, or an already-issued policy suggestion.
3. **Time up**: the clock must not replace a pending cognitive choice.

Both of the losing candidates are still reachable, and neither is reachable _here_ any more. What
decided it is that both were second surfaces for choices that already existed on the screen the learner
was reading:

- **Help** was a copy of the stuck picker. Its three quick choices — Continue, Make this step smaller,
  Rest for 3 minutes — are `cannot-start`, `too-big` and `tired`, which are three of the six reasons the
  step's own Ask-for-help control already offers; and its inline panel drew the same agent card that now
  sits in the step's control row (`focus.page.ts`, `fl-agent-panel`). The strip said what the control
  under the step said, over the step.
- **Time up** was a copy of the control that owns the clock: for an expired commitment the primary
  control already becomes "+1 minute", and a quiet "+1 minute" always sits beside it.

So the suggestion is answered where it is asked, the expired clock is answered where it is drawn, and
what is left for the slot is the one genuinely interruptive case. This decision is implemented and
unit-tested in `apps/desktop/src/app/core/focus-notice.ts`.

## Folding is not declining

The toggle and Escape within the notice change **presentation only**. They do not resolve an
intervention, accept/dismiss a checkpoint, resume a task, or extend a timer. A folded notice retains
its heading and a keyboard-reachable Show notice button. New evaluations/notifications and focus-route
remounts preserve the fold for the same session. A new session starts unfolded. This is renderer
session state, not a persisted preference.

The focus resume surface is non-modal: it neither steals focus nor traps Tab. Escape returns focus
to the fold toggle. Because the surface is non-modal it also owns the keyboard deliberately, and it now
has to hand it back across a boundary it did not have before: answering the card removes the button that
had focus _and_ unmounts the notice around it, so the notice's own reclaim has nothing left to focus.
The page does it (`handBackAfterNotice` in `focus.page.ts`), only when the keyboard is actually
orphaned, and the stage is the landmark it lands on. Focus is never taken when the notice merely
appears. Other routes retain the existing agent panel and modal resume card, and that
modal surface keeps its own coverage: `focus-notice.spec.ts` drives `/dashboard` with a pending
checkpoint and asserts `role=dialog`, `aria-modal`, Tab containment and Escape-dismiss. Moving this
screen's assertion to the non-modal contract had removed the modal card's only end-to-end exercise.

## The suggestion, in the step

An agent card is drawn by `fl-agent-panel`, whose non-inline form is the whole rescue lifecycle:
the offer with its own accept/dismiss, the bounded local plan once accepted, and Continue to end it.
It renders inside the step's control row, which means it is in the flow of the box rather than over it:
the box grows by the card's height, and the card cannot cover the buttons because it is one of them.
A resume does not consume it, and neither does anything else on the screen — the offer is the main
process's, and a surface that shows it is not a surface that answers it.

The reasons still come from one place, the six buttons the step has always offered, and the events they
send are unchanged: the panel's own buttons call `resolveRescue`, exactly as the notice's choices did.
The old choice row's one extra behaviour — re-dispatching `HELP_REQUESTED` when the pressed choice did
not match the pending offer — is gone with it, because the picker is what asks in the first place. A
reason the policy does not answer — the session's intervention budget is spent, so `decideIntervention`
returns `NO_ACTION` before the reason rule — leaves the row as it was and tells the learner nothing;
that matches how the stuck picker already behaves and no test pins it.

The lifecycle itself is untouched: `MICRO_START` narrows the task (#171), `SIMPLIFY` splits it into the
steps its own concept is grounded in (#172), and `BREAK` pauses the focus clock until the learner chooses
Continue. The task is served rewritten rather than written. No policy cooldown, daily budget, priority,
model call, persistence schema or IPC contract is changed. Modality change, plan reorder and adaptive
practice remain AG4 work.

Two consequences are stated rather than discovered. Accepting a suggestion no longer restarts an expired
clock as a side effect: the notice's Continue used to do that, and the timer is now the learner's own
"+1 minute" decision. And the control row is taller whenever a suggestion is pending, so at a window
smaller than the app's own minimum the step is the box that yields when the return card is also up — the
test that measures that pairing dismisses the pending suggestion first, and asserts the suggestion's own
geometry where it lives.

## Layout and motion

The surface occupies a reserved last row in the focus workspace, not a fixed overlay over the
current task. It is anchored above the simulator's 56px reservation and uses z-index 30. Resume
actions remain reachable at the notice's bottom edge. The sheet reuses `plan-rise`; both sheet and
contents disable motion under `prefers-reduced-motion: reduce`. Colours reuse existing theme tokens.

The frame the row belongs to is laid out rather than calculated: `fl-focus` is the column's flex item
and is allowed to be shorter than its content, and `.focus-workspace` fills it, so the frame is the
window whatever the column's padding, its gaps and the empty `router-outlet` beside it add up to. That
replaced a `height: calc(100dvh - 48px)`, which knew none of those numbers: the frame stood taller than
its box, so the _page_ scrolled as well as the stage. The column finishes inside the window now, which
leaves one scroller — the stage — and the page never moves under the learner.

Two consequences are worth stating. The stage's floor — the plan, which is its open sheet when the learner
has one and its trigger otherwise — is lifted clear of the notice when the row arrives, whenever its height
changes, and whenever the sheet opens or closes (`focus.page.ts` measures the intersection through a resize
observer and an effect on the plan's own state), because the row takes that space from the stage. The step
is above the plan, so clearing the plan clears the step; measuring only the step was true while the plan
never shared the screen with the notice, and opening the sheet under one put its rows behind the card. The
step's title is what the closed case does not spend, so a window shorter than the app's own minimum keeps
the title and lets the trigger wait for a scroll. And the notice's row is allowed to end inside the 96px
the column reserves below the plan, since that padding is what the row is laid into: without it, a closed
sheet would park 72px of empty page under the notice.

## Verification

- Desktop unit suite covers the empty slot, the return card, and session-scoped folding. The
  three-way precedence tests were removed along with the precedence.
- `apps/desktop-e2e/tests/focus-notice.spec.ts` drives the real offline Electron app: that an expired
  commitment takes the control row instead of the slot and that "+1 minute" answers it, that a
  suggestion appears inside the step's control row and leaves the row's own controls on screen and in
  view, that neither an evaluation nor a resume consumes it, that the plan trigger and its opened sheet
  clear the notice, fold without dismissal across a route
  remount, the keyboard hand-back when the card's decision unmounts the slot, the whole offered →
  accepted → plan → continue lifecycle including BREAK's pause of the live clock, new-session reset,
  reduced motion, and geometry at 1280×900, 1024×768 and 800×700. The small-window cases explicitly
  force 15px classic scrollbars
  to cover the width loss seen on macOS CI, independently of the developer's OS scrollbar preference.
  The geometry assertions no longer scroll the step into view before measuring it: that scrolling was
  what hid the defect they were meant to catch — the step's control row sat 48px behind the notice's
  top edge on a 1140x767 window while the assertion, having scrolled it out itself, agreed with the app
  that all was well.
  It also checks the CSS branch with the simulator element absent
  (not a claim of testing a packaged production build).
- The existing golden-path tests drive the rescue lifecycle through the panel in the step, and assert
  the focus resume's non-modal contract instead of a modal focus trap.
- The notice E2E emits `time-up.png`, `stuck.png` and `resume.png` into its Playwright result
  directory for review. These use the synthetic built-in demo course, never learner data.
  Checked-in review snapshots: [time up](./screenshots/77/time-up.png),
  [stuck](./screenshots/77/stuck.png), [resume](./screenshots/77/resume.png).

This document records implementation decisions, not a claim that the issue or PR is merged.
