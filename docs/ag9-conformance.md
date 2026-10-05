# AG9 runtime conformance and offline-fallback evidence

Scope: [#146](https://github.com/nianpingy-cpu/focusloop/issues/146), the fifth and final AG9 slice of
[#94](https://github.com/nianpingy-cpu/focusloop/issues/94). It audits the deterministic skill
fallback against runtime failure, adds the missing provider-failure scenarios, and records what AG9
delivered. It does not add adapters, telemetry or a task-adaptation contract.

## Where the runtime meets a skill

`AgentRuntime` is the only door: a skill calls it and never sees which provider answered.

- The tutor has an explicit offline gate. When the configured primary is offline the runtime is **not
  called at all**, and the outcome is `unavailable('no-model')` with the prompt reported as unsent
  (`agent-core/src/engine.ts`). Calling the mock there would produce a refusal, a retry and no
  answer — two calls, no answer, which is worse than saying so.
- Every tutor failure outcome carries a deterministic local fallback (`fallbackFor(reason, context)`),
  so "the model did not answer" still leaves the learner a next step. A degraded provider result is
  reported as `unavailable('provider-failed')` with the real provider identity, and the retry prompt
  is only composed when the reading is retryable.
- The tutor reads text and refuses what does not match the mode's shape (`tutor.ts`). Prose is a
  `rejected` reading, never a value: that is the same property `executeStructured` enforces
  structurally, reached from the text side.
- `executeStructured`/`executeStructuredViaStream` are the structured door. No _skill_ calls them yet;
  the tutor's contract is text. That is recorded under "outstanding" rather than claimed as coverage.
- `buildRescuePlan` (`intervention-policy/src/rescue.ts`) is the AG9.7 rule fallback: local steps for
  `SIMPLIFY`, `MICRO_START`, `BREAK`, `HINT` and `EXAMPLE`, marked `source: 'deterministic-local'`,
  built from `message()` keys with no network or credentials. Copy lives in the renderer
  (`apps/desktop/src/app/core/i18n/messages.{en,zh}.ts`); no domain sentence is authored in a package.

## AG9.1–AG9.8 evidence

| Sub-item                             | Delivered by                                                                                                                                   | Evidence                                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| AG9.1 stable provider interface      | `feat(provider): add the AI provider abstraction with a deterministic mock`; `#125` added the runtime façade (`AbortSignal` never crosses IPC) | `provider.spec.ts`, `runtime.spec.ts`, `budgets.spec.ts` process-local control tests                                             |
| AG9.2 structured output              | `#125`                                                                                                                                         | `runtime.spec.ts` structured conformance (valid, malformed, wrong types, unknown keys, commit-once), `shared-types` schema tests |
| AG9.3 streaming                      | `#161`                                                                                                                                         | `streaming.spec.ts`, `stream-protocol.spec.ts`, `stream-control.spec.ts`                                                         |
| AG9.4 abort generation               | `#147`                                                                                                                                         | `cancellation.spec.ts`, `execution.spec.ts` resource ownership                                                                   |
| AG9.5 timeout and retry              | `#147` (deadline) + `#162` (bounded retry)                                                                                                     | `retry-policy.spec.ts`, `runtime.spec.ts`, `execution.spec.ts` provider-local timeout                                            |
| AG9.6 provider fallback              | `feat(provider)…` + `#162`                                                                                                                     | `provider.spec.ts` degraded mode and bounded transport retry, `budgets.spec.ts` shared bounded snapshot                          |
| AG9.7 deterministic offline fallback | `feat(provider)…` mock, `intervention-policy` rescue plans, the tutor offline gate                                                             | `rescue.spec.ts`, `policy.spec.ts`, `engine.spec.ts`, the AG2 and AG9 eval packs, the desktop golden path                        |
| AG9.8 token and context budget       | `#156`                                                                                                                                         | `budgets.spec.ts` (four entry paths, invalid input, usage, overshoot)                                                            |

## The AG9 provider-failure scenarios

`packages/agent-evals/src/scenarios/ag9/runtime-failures.json` holds ten scenarios, run by `ag9.ts`
through the **production** `AgentRuntime` with scripted providers, an injected pause and synthetic
data — no network, no credentials, no real clock. The pause is injected so a scenario can assert the
exact backoff rather than measure it; `ag9.spec.ts` runs the pack twice and requires identical
results, and cross-checks the pause against `DEFAULT_RETRY_POLICY.baseBackoffMs` so the scenario
cannot drift from the published policy.

Recorded output (`status`, `value`, `committed`, `providerId`, `primaryCalls`, `fallbackCalls`,
`pauses`), abridged to the parts the scenarios assert:

| Scenario              | status     | value      | committed | primary calls | fallback calls | pauses       |
| --------------------- | ---------- | ---------- | --------- | ------------- | -------------- | ------------ |
| provider unavailable  | `degraded` | local step | yes       | 2             | 1              | `[250]`      |
| provider timeout      | `degraded` | local step | yes       | 2             | 1              | `[250]`      |
| provider rate limited | `degraded` | local step | yes       | 2             | 1              | `[250]`      |
| malformed output      | `degraded` | local step | yes       | 2             | 1              | `[250]`      |
| authentication        | `degraded` | local step | yes       | 1             | 1              | `[]`         |
| bad response          | `degraded` | local step | yes       | 1             | 1              | `[]`         |
| fallback exhaustion   | `degraded` | **none**   | **no**    | 2             | 2              | `[250, 250]` |
| attempt limit 1       | `degraded` | local step | yes       | 1             | 1              | `[]`         |
| cancellation mid-call | `aborted`  | none       | no        | 1             | 0              | `[]`         |
| expiration            | `expired`  | none       | no        | 0             | 0              | `[]`         |

What the pack proves, in the words of the criteria: a transient failure costs one bounded pause and
one retry before the local provider answers; a terminal reason costs none; the schema retry is
paused like the transport retry; when even the deterministic provider returns prose the runtime
hands back **no value** and commits nothing, so generic prose can never pass as structured output;
and neither cancellation nor expiration resurrects generation, runs a model fallback or commits a
late result — the cancellation scenario aborts a call whose _reason_ was transient, so it cannot
pass for the wrong reason.

## Outstanding before #94 can be closed

- **Skill-side structured completion is unused.** No skill calls `executeStructured`; the tutor's
  contract is text plus its own reading. Wiring a skill to the structured door is its own slice.
- **Renderer streaming IPC and chat UX** were an explicit #144 non-goal and remain unwired.
- **#152** (desktop `focus-notice` e2e flake) and **#43** (repository Dependency-graph setting) are
  open and unrelated to the AG9 contract, but they are visible in the same gates.
- **#160** carries failing golden-path jobs for a different change; it is not merged and does not
  affect this evidence.

## Regression gates

```sh
pnpm --filter @focusloop/agent-evals test
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```
