# ADR 0002: Runtime cancellation and total deadline

Status: proposed implementation in the #142 PR; not a claim of merged delivery.
Parent: #94 (AG9 Model Runtime).

## Decision and scope

The first AG9 slice forwards cancellation to cooperative providers and bounds the entire request
with one absolute deadline. It does not implement real streaming, configurable retries/chains,
new providers or skill-specific fallback redesign.

Implementation sequence: #142 cancellation/deadline → #143 budgets → #144 real streaming →
#145 retry/fallback policy → #146 deterministic skill fallback and final conformance audit.
Tests ship with every slice. Landing one slice does not close #94.

## Process boundary

`CompletionRequest` and `RuntimeRequestData` remain JSON-safe data. Neither receives an
`AbortSignal`, callback, controller or executable provider object. Signals remain in
`ProviderExecutionOptions` / `RuntimeExecutionOptions` in `@focusloop/llm-provider`.

`ExecutableAIProvider` extends the existing vocabulary contract with an optional process-local
second argument. Existing one-argument providers remain structurally compatible. The runtime races
non-cooperative providers too, but cannot forcibly release resources a custom adapter refuses to
release; cooperative transports must consume the supplied signal.

## Cancellation versus expiration versus local timeout

| Cause                                                                                                  | Text API                             | Structured API                     | Further provider work  |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------ | ---------------------------------- | ---------------------- |
| Caller cancellation                                                                                    | rejects with `AbortError`            | `aborted`, no value/commit         | none                   |
| Total runtime deadline reached                                                                         | rejects with timeout `ProviderError` | `expired`, no value/commit         | none                   |
| Provider-local timeout/error while runtime time remains                                                | bounded fallback                     | bounded, schema-validated fallback | existing fallback only |
| Provider-local `AbortError` with the caller's signal untouched (an adapter bounding its own transport) | bounded fallback                     | bounded, schema-validated fallback | existing fallback only |

Equality counts as expired: `Date.now() >= deadlineMs`. A deadline is absolute epoch milliseconds,
not a duration restarted on retry/fallback. Non-finite deadlines are rejected before work starts.
Caller cancellation takes precedence when both boundaries are observed. A primary-local timeout is
not the same as runtime expiration; DeepSeek normalizes its own timer to the existing provider
`timeout` failure classification.

Only the caller's own cancellation is terminal. Cancellation is decided by `ExecutionAbortError`
(raised when `options.signal` is aborted) or `RuntimeDeadlineError`, never by matching
`error.name === 'AbortError'` on whatever a provider threw: an `AbortError` a provider authored for
itself is a provider failure and still degrades to the deterministic fallback, on both the text and
the structured path. The fallback call is not wrapped in a second catch, so a fallback that itself
throws rejects the text call instead of being reported as degraded; the shipped deterministic
fallback cannot throw, so that is a documented boundary rather than an exercised path.

The linked execution signal reaches fetch and response-body consumption. Each execution releases
its timer and caller abort listener on success, error, cancellation or expiration. Timer delays above
Node's maximum are re-armed instead of being clamped to a premature 1ms expiration. A late result
or rejection from an adapter that ignores the signal is observed but never accepted or used to
start fallback.

## Validation and commit

Check cancellation/deadline before every attempt, after awaited completion, and after schema
validation immediately before accepting/committing a value. Validation and the commit invocation
have no intervening asynchronous boundary. The hook is a synchronous caller-owned action; this
contract does not cancel asynchronous work initiated by that hook.

A throwing commit is a caller failure, not a model/provider failure: propagate it rather than retry,
invoke fallback, or commit twice. Invalid primary output still gets at most one schema retry,
followed by one fallback. A fallback's output must validate before any commit; generic mock prose
is not magically valid structured JSON.

`executeStructuredViaStream` is a compatibility entry point over the same structured final-result
path. It was already a collected completion, not a real provider stream. `streamText` still emits
post-completion display fragments: cancellation ends the stream quietly, while expiration between
fragments rejects with the same timeout the text API uses, so a truncated display is never handed
back as a complete one. #144 will introduce the actual streaming contract without claiming this
slice delivers it.

## Regression evidence

The first RED run against upstream main recorded **11 failed / 37 passed** in
`pnpm --filter @focusloop/llm-provider test`: no forwarded signal, cancellation-triggered fallback,
late deadline work/commit, and DeepSeek caller cancellation misclassified as timeout. Those counts
are from the first batch of tests; the final suite is larger. Repeating the run against `1cfb124`
with the final suite fails **20** of the 29 assertions in the two new files.

Test power, stated precisely: the seven `execution.spec.ts` resource-ownership cases unit-test the
new `execution.ts` directly, so they cannot fail against main - they are new-code unit tests, not
regression evidence. The regression evidence is the 20 failures above.

The GREEN provider suite includes both existing conformance tests and new fake-provider/fetch/time
fixtures for primary/fallback cancellation, deadlines before work and during retry/fallback,
response-body cancellation, non-cooperative late results, resource cleanup, long timers, validation
boundaries and failed commit hooks. No real API credentials, external model calls, prompt logs,
production telemetry or new dependencies are introduced.

Verify with `pnpm --filter @focusloop/llm-provider test`, repository test/typecheck/lint/build, and
`pnpm e2e`. The offline golden path remains the product integration gate. This slice exposes the
process-local controls but does not add a renderer cancel button or streaming IPC channel.
