# ADR 0001: Agent memory deletion semantics

- **Status**: Accepted
- **Date**: 2026-09-25
- **Blocks**: AG7 implementation, AG6 preference inspection/delete (hard gate)
- **Related**: [#110](https://github.com/nianpingy-cpu/focusloop/issues/110), `docs/wiki/delivery-roadmap.md` Phase 4

## Context

AG7’s plan required two things that could not both hold without a mechanism:

1. After clearing Agent Memory, Context / Tutor must not be able to query it.
2. Clearing must not delete learning facts (courses, events, checkpoints).

“Still there but the agent cannot see it” is a wish until the kind of deletion, the derived views, the audit trail, and cache invalidation are written down. This ADR freezes those four answers **before** AG7 code.

## Decision (the four questions)

### 1. Kind of deletion — per memory class

| Class                                         | What it is today                                                                                   | Decision                                                  | Why not the alternative                                                                                                                                                                                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Working**                                   | Tutor transcript + last outbound prompt (in-process Maps)                                          | **Physical delete** (`Map.delete` / `forget`)             | Nothing else reads them; a tombstone would keep learner text in memory for no reader.                                                                                                                                                             |
| **Episodic** (agent-scoped session history)   | `learning_events`, `checkpoints`, `interventions`, `outcomes`, `resume_cards` rows for one session | **Physical delete** of those rows for the cleared session | Soft delete keeps content on disk that a “clear” promised to remove; access tombstones require every future reader to remember the denylist (easy to miss in a new query). Physical delete is the only kind a `DELETE then query` test can prove. |
| **Preference** (AG6/AG7, not yet implemented) | N/A                                                                                                | **Physical delete** of preference rows when built         | Same reason as episodic: inspection UI must show the row gone, not `deleted_at`.                                                                                                                                                                  |

**Session catalog rows** (`learning_sessions`, course structure, material documents) are **not** memory in this ADR’s sense: they are the learner’s own course state (which course, which tasks completed). Clearing agent/session memory does **not** remove the course or the session row.

### 2. Dashboard and Insights

**They may not use cleared episodic data.** After `clearAgentMemory(sessionId)`:

- `learning_events` / `checkpoints` / `interventions` / `outcomes` / `resume_cards` for that session are gone → dashboard aggregates and insights that fold those tables drop to zero contribution **for that session**.
- If a view still showed the cleared numbers, the data was not cleared and the product wording would be a lie — so we do **not** keep a parallel “display copy”.

Session-level fields that live on the session row itself (e.g. `completedTaskIds` on `engine_state`) remain: they are catalog/progress facts about _which tasks were done_, not the episodic event stream. Dashboard **task counts** therefore may still include completed tasks from a cleared session; **interruptions, event timeline, resume outcomes, intervention outcomes** must not.

Wording rule: the UI says **“Clear session memory”** (清除会话记忆), not “Delete my learning history”, unless a separate destructive catalog wipe is ever designed.

### 3. Audit

| Kept                                                   | Not kept                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| `session_id` (opaque id already known to the local DB) | Event payloads, checkpoint text, intervention reasons, resume timings |
| `cleared_at` timestamp                                 | Tutor question/answer strings (never persisted anyway)                |
| `actor` (`user` \| `system`)                           | Material excerpts, learner prose                                      |

A dedicated `agent_memory_clears` table records only those three columns. An audit that retained content would defeat the deletion; an opaque id + timestamp is enough to answer “was this session cleared, and when?”.

Retention of the audit row: **same lifetime as the local database** (no auto-purge). It contains no learner content.

### 4. Invalidation

There is **no long-lived cache** of agent context or tutor prompts: `buildAgentContext` and `buildTutorPrompt` run per request from the store. Checkpoints are rows, not a cache.

Invalidation is therefore “delete the rows / maps the readers use”:

| Reader               | After clear                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Tutor transcript     | `forget(sessionId)` — next ask has an empty turn list                                                                     |
| Outbound inspector   | Map entry deleted                                                                                                         |
| `getAgentContext`    | Session flagged cleared → `{ context: null }` + omission; even without the flag, deleted events/checkpoints cannot appear |
| Dashboard / insights | Query empty tables for that session                                                                                       |

**Proof**: a regression test per class does **write → clear → query**, asserting empty on the direct path **and** on derived paths (dashboard aggregate, context builder, tutor transcript). A test that only checked the direct `listEvents` would pass while a stale checkpoint still fed the dashboard.

## Consequences

- AG7 implements inspection UI on top of this ADR; **preference delete** follows the same physical-delete rule when AG6 lands.
- AG6’s hard gate (preference inspection/delete) can proceed once AG7 ships that path — semantics are frozen here.
- Learner-facing copy must not promise “events vanish from disk” for _working_ memory only — transcript was never on disk.

## Alternatives considered

1. **Soft delete (`deleted_at` on every episodic row)** — keeps forensic copy; every query must filter; dashboard “cleared” views still find rows unless filtered twice. Rejected: easier to ship a leak.
2. **Access tombstone (denylist table)** — preserves rows forever; any new reader that forgets the denylist re-exposes data. Rejected: the failure mode is exactly “cleared but still queried”.
3. **Dashboard keeps using cleared events** (with copy change only) — honest only if we never said “cleared”. Rejected: AG7’s acceptance criteria require derived paths to go empty.
