# Bounded retry and provider fallback policy (#145)

Fourth slice of [#94](https://github.com/nianpingy-cpu/focusloop/issues/94), after merged
#142 cancellation/deadline, #143 budgets and #144 incremental streaming. It extends the existing
primary → local-fallback contract; it does not replace it and does not add providers or health probes.

## Closed failure classification

`classifyFailure` maps every `ProviderFailureReason` to exactly one class. The vocabulary is closed:
adding an unclassified reason is a compile error, so retry behaviour cannot drift silently.

| Reason           | Class     | Why                                                                                                                  |
| ---------------- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| `offline`        | retryable | A dropped transport often succeeds on a second try.                                                                  |
| `timeout`        | retryable | Transient slowness; the absolute deadline still bounds the whole operation.                                          |
| `rate-limited`   | retryable | Ends when the quota window moves.                                                                                    |
| `unauthorized`   | terminal  | Needs a human to fix a key; repeating the identical request cannot help.                                             |
| `not-configured` | terminal  | Configuration, not transport.                                                                                        |
| `bad-response`   | terminal  | Deterministic contract violation; the same request reproduces it. Schema content gets its own bounded retry instead. |

`unauthorized`, `not-configured`, `bad-response`, caller cancellation and the absolute deadline are
never retried, on any path.

## Policy, defaults and injection

`RetryPolicy` is process-local configuration, like `AbortSignal`: it never enters shared DTOs, IPC
or persistence.

| Field                  | Default            | Meaning                                                                            |
| ---------------------- | ------------------ | ---------------------------------------------------------------------------------- |
| `maxTransportAttempts` | 2                  | Provider calls per provider for text/fragment and streaming paths, first included. |
| `maxSchemaAttempts`    | 2                  | Parse attempts per provider for structured output, first included.                 |
| `maxModelCalls`        | 4                  | Hard cap on provider calls for the whole operation.                                |
| `baseBackoffMs`        | 250                | First pause; doubles per retry.                                                    |
| `maxBackoffMs`         | 2000               | Pause ceiling.                                                                     |
| `sleep`                | signal-aware timer | Injected in tests; zero delay never schedules a timer.                             |

`resolveRetryPolicy` validates every field (safe integers, `maxModelCalls >= 2`,
`maxBackoffMs >= baseBackoffMs`) and freezes the result. `backoffDelay(policy, retryIndex)` is
deterministic (`retryIndex` 1 gives `baseBackoffMs`) and capped. Overrides go in through the
`AgentRuntime` constructor or a per-call `retry` field; per-call values merge over the runtime policy.

## One combined bound

`maxModelCalls` is enforced by a single ledger that every provider call consumes — primary retries,
schema retries and fallback calls alike. The primary also reserves one slot
(`primaryCallLimit`), so a retrying primary can never starve the required deterministic local
fallback. Consequently nesting cannot multiply model calls: an operation never exceeds
`maxModelCalls` calls, whatever the retry kinds are.

Defaults therefore allow at most: primary ×2, then local fallback ×2.

## Pauses never cross a boundary

`pauseBeforeRetry` checks cancellation/deadline _before_ deciding to sleep, refuses to start a pause
that would land at or after the absolute deadline, and re-checks afterwards. Caller cancellation and
the deadline are reported as `ExecutionAbortError` / `RuntimeDeadlineError`, never as a provider
failure, and never start another attempt or a fallback.

## Provider order and provenance

Order is fixed: primary (bounded retries) → required deterministic local fallback (bounded retries).
The fallback gets its own bounded attempts under the same policy, its failures are terminal for the
operation, and there is no loop back to the primary and no fallback-of-the-fallback. A terminal
primary failure goes straight to the fallback without a pause.

Every failed attempt is recorded in order as `ProviderFailure { reason, message, providerId }`, so
retries cannot hide where a failure came from, and `attempts` reports the number of provider calls
actually spent. `failure` remains the first (primary) failure for the existing UI reason. Text
results carry `attempts`/`failures` on `CompleteWithFallbackResult`; structured results carry the
same fields on `StructuredRuntimeResult`.

When both providers are exhausted the text path rejects with the last provider error object
(unchanged, documented boundary); the structured path returns a `degraded` result with no value and
the recorded provenance.

## Streaming

Streaming keeps the #144 contract. A retryable failure **before** any accepted non-empty text may
retry the same provider inside the attempt limit; when the primary is exhausted the local fallback
starts. A failure **after** text was emitted (`StreamInterruptedError`) is never retried and never
spliced with another provider's answer. A fallback stream failure is terminal. Structured streamed
output is still collected, then schema-validated; a partial/interrupted stream never commits.

## Tests and non-goals

RED (against unchanged production code): `17 failed | 1 passed` in the new
`retry-policy.spec.ts` / `retry-behavior.spec.ts` files. GREEN: **260** provider tests and **1254**
workspace tests pass, with fake providers, fake transport and injected sleeps — never a real
credential or a real wait.

`retry-policy.spec.ts` pins the closed classification, validation, deterministic/capped backoff and
the ledger; `retry-behavior.spec.ts` covers timeout/rate-limit/network/auth/schema/exhaustion,
injected backoff, cancellation and deadline during pauses, terminal failures, the combined bound,
no-loop fallback, provenance, streaming before/after text, and the unchanged offline path.

Four existing tests were updated rather than weakened, because they pinned the previous implicit
single-attempt default: the registry budget-snapshot test now asserts the same frozen snapshot across
_every_ attempt; two deadline-crossing-in-fallback tests and one provider-local-timeout test pass an
explicit `maxTransportAttempts: 1` and state why; the tutor test that is about the tutor's _own_
retry now uses a terminal provider failure so the runtime does not retry it first.

Non-goals: no new adapters, no multi-provider chain, no health probing, no persistent prompt logs,
no unbounded retry, no UI changes. The skill-specific fallback and final conformance are covered
separately by the [AG9 scenario pack](ag9-conformance.md), which replays this exact policy through
the production runtime.

```sh
pnpm --filter @focusloop/llm-provider test
pnpm test
pnpm typecheck
pnpm verify:spec-types
pnpm lint
pnpm build
pnpm e2e
```
