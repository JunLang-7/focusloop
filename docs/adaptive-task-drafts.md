# Adaptive-task drafts (AG4 first slice)

Tracking: [#149](https://github.com/nianpingy-cpu/focusloop/issues/149), part of
[#89](https://github.com/nianpingy-cpu/focusloop/issues/89). This is a read-only foundation, not
complete task adaptation or an application-level feature.

## What exists

- `packages/shared-types/src/adaptive-task.ts`: a closed `SHRINK_TASK` draft, named bounds and
  `isAdaptiveTaskDraft(unknown)` shape validation.
- `packages/agent-core/src/adaptive-task.ts`: deterministic `buildShrinkDraft(context)` and
  `matchesShrinkContext(draft, context)` for checking provenance against supplied context.
- Package entry points export the contract and pure functions. Neither module depends on a
  provider, store, clock, renderer or network.

A draft identifies the source session/task/concept, records the original estimate, contains one
bounded focus with its evidence source, proposes a shorter estimate, and fixes
`requiresConfirmation` to `true`. There is no execution callback, authorization token or
"confirmed" status in the draft. All fields are JSON data.

## Offline selection

The builder consumes an existing `AgentContext`, not a course, database or unbounded document.
It inspects at most six concept key points in order and copies the first suitable point with its
index. If none qualifies, it extracts the first punctuation-terminated material sentence from the
bounded excerpt. Chinese terminators need no following space; an ASCII decimal point does not
terminate a sentence. This is a lexical extraction, **not** a semantic model-generated summary.

The copied focus must be nonempty and at most 600 Unicode code points. It is never silently
clipped, and cannot merely repeat the current task title/instructions with a shorter timer.
A complete first sentence may be used even if the remainder of the excerpt was truncated;
an incomplete first sentence is unavailable. Task instructions, checkpoints, events, material
identifiers and extra context fields are not copied into the draft.

The preferred estimate is two minutes, or one minute when two would not be a strict reduction.
Source estimates must be finite and positive; tasks already at or below one minute are unavailable.
Only read/practice tasks are eligible: shrinking a scored quiz into prose would change assessment
semantics. All draft estimates are 1–5 minutes and strictly shorter than the source estimate.

Unavailable cases return closed reason codes, not learner-facing English prose or invented content:
`missing-context`, `missing-task`, `missing-concept`, `unsupported-task-kind`, `invalid-estimate`,
`already-small`, `no-grounded-focus`.

## Validation is not authorization

`isAdaptiveTaskDraft` checks exact fields, bounded text/ids, numeric relationships, the confirmation
marker and focus provenance shape. It rejects unexpected fields, accessors, symbols and non-data
records. It **cannot** prove that a claimed quote actually came from material or authorize a write.

`matchesShrinkContext` additionally checks identifiers, the original estimate and the exact focus
against the supplied context. It is still **not** an execution gate: callers can supply an old
context, and it does not check the current session's lifecycle, source-task revision, proposal TTL,
permissions or user consent. Model-produced drafts must not become trusted just by passing either
function.

The existing `executeAgentProposal` records intent/audit; it does not apply task payloads. This slice
does not register a new proposal kind, change that behavior, create an IPC channel, call the builder
from the engine/UI, or mutate/persist a plan. A true confirmation marker is a requirement, not proof
of confirmation.

## Next slices

1. Apply a confirmed draft atomically to **session-scoped** adaptive tasks, bound to live task/state
   fingerprints, with idempotency and rollback. Never overwrite a shared course or another session.
2. Learner preview/confirmation, decline handling, persisted task display and restart/resume restore.
3. Split, modality change, plan reorder and targeted practice with their own validation and tests.

Each slice closes only its sub-issue. Do not close #89 or describe SIMPLIFY as a real plan mutation
until those paths are implemented and verified.

## Verification

```sh
pnpm --filter @focusloop/shared-types test
pnpm --filter @focusloop/agent-core test
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm e2e
```

New suites cover JSON round-trips, malformed/adversarial drafts, mandatory confirmation, strict
budget reduction, grounding, Chinese/decimal boundaries, Unicode bounds, no mutation and private
field projection. While #140 awaits merge, the new specs also receive an explicit compiler check;
the normal library build configurations on upstream main still exclude specs.
