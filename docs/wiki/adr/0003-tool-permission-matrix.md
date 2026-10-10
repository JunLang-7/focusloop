# ADR 0003: Tool permission levels and the matrix

- **Status**: Accepted
- **Date**: 2026-10-09
- **Parent**: [#93](https://github.com/nianpingy-cpu/focusloop/issues/93) (AG8 Tools & Actions)
- **Blocks**: [#208](https://github.com/nianpingy-cpu/focusloop/issues/208) (the `permission` union), [#209](https://github.com/nianpingy-cpu/focusloop/issues/209) (what each level shows), [#212](https://github.com/nianpingy-cpu/focusloop/issues/212) (one scenario per cell)
- **Related**: [#114](https://github.com/nianpingy-cpu/focusloop/issues/114) confirmation envelope (PR #126), [ADR 0001](./0001-agent-memory-deletion.md), [ADR 0002](./0002-runtime-execution-boundary.md)

## Context

The epic's line is `LLM → Structured Tool Call → Validation → Domain Command → Event`, and the agent
never touches storage. Three of the four links exist today:

- domain commands and the event log (`dispatch`, `LEARNING_EVENT_TYPES`, the store's replay
  detection in `appendEvent`);
- the confirmation envelope from #114 — propose → confirm → execute, hash-bound so a confirmation
  after the state moved is refused, idempotent, expiring, cross-session-proof, audited in
  `agent_proposals` and evented as `AGENT_PROPOSAL_EXECUTED`;
- the structured door AG9 left unused — `AgentRuntime.executeStructured` validates model output
  against a schema (`docs/ag9-conformance.md` records that no skill calls it yet).

What does not exist is the layer between the model and those three: no `AgentTool` type, no
registry, no permission vocabulary, no check anywhere in the repo, and no renderer code that calls
`confirmProposal`. Registering tools without freezing what the three permission levels mean would
write the meaning into whichever slice landed first — which is how a convention becomes the only
thing enforcing permission.

This ADR freezes the levels and maps **the epic's fourteen candidate tools over the commands the
app already has**, before any registry code. It is a decision record, not an implementation: the
matrix is what #208's types will express and what #212's scenarios will try to cross.

## Decision

### 1. The three levels — each answers one question

| Level                | The question it answers                                        | Cost when the model is wrong                                 | Obligations                                                                                          |
| -------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **safe-read**        | Nothing happens.                                               | Nothing.                                                     | No confirmation. No store write on the path (asserted, not assumed). Bounded output. Session-scoped. |
| **reversible-write** | If it is wrong, a way back already exists inside the contract. | One tap of undo — or the effect expires on its own.          | Quick confirmation. `idempotencyKey`. An undo path or self-expiry, named in the matrix.              |
| **structural-write** | If it is wrong, nothing in the system can take it back.        | A confirmation the learner gave with full information, once. | The proposal envelope: hash/TOCTOU, expiry, idempotency, the #209 screen, an event on success.       |

**The rule in one line:** reversible ⇔ a tested way back already exists — an undo tool, self-expiry,
or re-derivation on read. No way back ⇔ structural. Granting an undo tool is how a tool gets
re-graded downward, and a re-grade amends this ADR; it is never a silent change of a `kind` value.

The levels grade **risk to the learner's world, not vocabulary**: a tool that stores nothing can sit
at read risk even though the learner sees an action (see `openMaterialSection` below). Whether the
agent may interrupt at all is not a permission question — that decision stays in the deterministic
intervention policy, unchanged by this ADR.

### 2. One mechanism, not two

Every write — reversible or structural — goes propose → confirm → execute through the **existing**
envelope. The level drives presentation and obligations, not a second pipeline:

- reads never create a proposal;
- `AGENT_PROPOSAL_KINDS` grew to `['reversible-write', 'structural-write']` when the first
  reversible tool registered (AG8.3, `#238`), and the adaptive rewrites were re-graded to
  `reversible-write` with AG8.4 (#227) — the deferral this bullet used to carry is now spent, which
  is the change being deliberate: the matrix row and the proposal kind agree. What still types
  `structural-write` is exactly what has no way back: `completeTask`, `reorderSessionPlan`,
  `saveCheckpoint`;
- refusals reuse the `ProposalRefusal` vocabulary (closed reasons, translatable keys), extended by
  #208 for the read-path reasons (`unknown-tool`, `bad-schema`, `wrong-session`, `permission`).

### 3. The matrix

Every tool named in #93's goal, its level, what exists today (with the evidence), and why it holds
that level. "Today" is `main` at `d9f1783`.

#### safe-read

| Tool                  | Existing implementation today (evidence)                                                                                                                      | Why this level                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `readCurrentTask`     | `getAgentContext().task`, `getCurrentSession` / `getSessionProgress` (IPC `agent:context`, `session:current/progress`)                                        | Reads a projection; the path writes nothing.                                                                                                                                         |
| `readConcept`         | `getAgentContext().concept` — summary, key points, title                                                                                                      | Same projection, same path.                                                                                                                                                          |
| `readMaterial`        | `listMaterials` → `excerptMaterial`: the bounded excerpt the context already carries (`AGENT_CONTEXT_LIMITS.materialCharacters`), never the imported document | The agent has never held the whole document; the tool cannot widen that.                                                                                                             |
| `readCheckpoint`      | `getLatestCheckpoint` (IPC `checkpoint:latest`)                                                                                                               | A row read.                                                                                                                                                                          |
| `openMaterialSection` | Renderer view state only — `course.page.ts`'s `<summary>` disclosure; no engine method, no IPC write, nothing persisted                                       | Graded by effect: it stores nothing, so it runs without asking. If it ever becomes an interruption, the intervention policy — not permission — governs it, and this cell is amended. |

#### reversible-write

| Tool                 | Existing implementation today (evidence)                                                                                                                     | Way back (why it is not structural)                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `startTask`          | `dispatch(TASK_STARTED)`; `appendEvent` already reports current truth on a replayed event instead of writing twice                                           | Switching back is another `TASK_STARTED`; nothing is deleted, progress is unaffected. Session precondition checked in main.                                                                      |
| `pauseTask`          | Renderer `focus-timer.ts` `pause()` — phases `ready/active/paused/expired`, no domain event today; the tool lands in phase 2 over IPC                        | Undo is `resumeTask`; the timer never outlives the session.                                                                                                                                      |
| `resumeTask`         | `acceptResume` / `dismissResume` + `dispatch(TASK_STARTED)`; renderer `focus-timer.ts` `resume()`                                                            | The mirror of pause; the learner can always dismiss instead.                                                                                                                                     |
| `extendTask`         | Renderer `focus-timer.ts` `addMinute()` — no engine write today                                                                                              | Self-expiring: an extension ends at expiry or session end; there is nothing to clean up afterwards.                                                                                              |
| `createAdaptiveTask` | AG4's rewrites through the envelope (`engine.ts` proposes kind `structural-write`); the rewrite is derived on every read, the stored course is never written | Derived on read and ends with the task or with Continue — the reversibility AG2 documented. Registers as `reversible-write` when the kind vocabulary grows (AG8.4); typed structural until then. |
| `startBreak`         | The BREAK rescue path (#169): the deterministic policy offers, `resolveRescue` accepts, steps come from `buildRescuePlan`                                    | Self-expiring — three minutes that keep the position. Policy-gated: the tool cannot break where policy did not offer one.                                                                        |

#### structural-write

| Tool                 | Existing implementation today (evidence)                                                            | Why there is no way back (why it is not reversible)                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `completeTask`       | `dispatch(TASK_COMPLETED)` → progress and dashboard counts                                          | No compensating event exists; a wrong completion is counted forever. Structural **until an un-complete design exists** — that re-grade amends §1's rule here, with its own test. |
| `reorderSessionPlan` | `TASKS_REORDERED` (#23, #158) — the learner's own decision, recorded as the complete intended order | Plan order is the learner's decision to make; #93 names it as structural. Another reorder by the agent is not an undo, it is a second structural write.                          |
| `saveCheckpoint`     | `createCheckpoint` (IPC `checkpoint:create`); the resume path reads the latest checkpoint           | No checkpoint delete exists; a wrong row steers every later resume.                                                                                                              |

Each level has at least one command the app already performs today (reads, `focus-timer`'s
`pause`/`addMinute`, `TASK_COMPLETED`/`TASKS_REORDERED`/`createCheckpoint`), so the matrix grades
existing behaviour rather than a hypothetical API. Cells that name a future IPC surface say so.

**Idempotency and session preconditions, per group.** Every tool is validated against the current
session in main before it runs — that column is one value for all fourteen, so it lives in §4 rather
than being repeated. The idempotency mechanism differs by what the tool already is:

- **The four reads** are naturally idempotent (no write, nothing to double) and carry no key.
- **Every write that touches the store** — the seven non-renderer rows — carries the tool call's
  `idempotencyKey` as its proposal key, because §2 routes all writes through the envelope: a second
  execute with the same key is a no-op replay, which #114 already tests. Where executing the
  proposal means dispatching an event (`startTask`, `completeTask`, `reorderSessionPlan`), the
  store's replay detection — `appendEvent` reporting current truth instead of appending twice — is
  the second belt under the key.
- **Renderer-local tools** (`pauseTask`, `extendTask`) have no store write today, so there is
  nothing to double — until they gain an IPC surface in phase 2, at which point the key sits on the
  **tool**, not the command: `addMinute` twice is two minutes, which is exactly the kind of double
  the tool layer must absorb.

### 4. Invariants the levels ride on

- **Validation lives in main**: input schema, permission level, and current-session preconditions
  are checked before anything runs. The renderer displays; it does not judge arguments.
- **The model's entry is one schema, not a channel list.** Tool calls arrive through
  `AgentRuntime.executeStructured` with a closed tool vocabulary; no SQL, no table name, no
  arbitrary IPC channel is expressible.
- **The renderer still has no database permission** — unchanged by everything above.
- **A successful write has an event; a failed write leaves no half-state; every call — attempt or
  refusal — leaves a `ToolCall` audit row** (#210), with ADR 0001's redaction discipline: args are
  recorded to answer "what was attempted", not as a second copy of the learner's content.
- **Idempotency is required of every write**: envelope `idempotencyKey` for proposals, event
  replay detection for dispatches.

## Consequences

- #208's permission union is exactly `'safe-read' | 'reversible-write' | 'structural-write'` —
  closed; adding a level amends this ADR.
- #209 renders the level: structural gets the full confirm screen (params, impact, undo, refusal
  reasons); reversible gets the quick confirmation over the same envelope.
- #212 writes at least one scenario per permission level attempting to cross it, plus a
  forged-confirmation case; its Expected values name the closed refusal reason from this document.
- Phase 2 (AG8.3/8.4/8.5) registers the write tools against this matrix; two regrades are already
  named and deferred — `createAdaptiveTask`'s kind when the vocabulary grows, `completeTask`'s level
  if an un-complete design ever exists. Both amend this ADR.
- AG8.7's confirmation UI, AG8.8's audit, and AG10.6's safety scenarios all read §3 rather than
  inventing their own permission story.

## What this ADR does not decide

Confirmation wording and layout (#209's concern), which tools ship in which slice (#93's scope
comment), and whether the intervention policy offers an action at all (unchanged — deterministic,
in `packages/intervention-policy`).
