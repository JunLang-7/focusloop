# Incremental Runtime streams (#144)

Third slice of [#94](https://github.com/nianpingy-cpu/focusloop/issues/94), consuming merged
#142 cancellation/deadline and #143 budgets. Renderer streaming IPC and chat UX are **not** included.

## Contracts and compatibility

`ExecutableAIProvider.stream` is an optional process-local capability. `StreamingProvider` makes it
required; it returns `ProviderStreamEvent` text deltas and exactly one matching completion. No
iterable, callback or signal is added to shared request/IPC/persistence data.

`AgentRuntime.streamEvents` emits provenance-aware text (provider ID, actual model, degraded flag,
`mode: 'provider' | 'collected'`) and a final `CompleteWithFallbackResult` including budget/usage.
`streamText` is the string view, preserving its final budget iterator value and quiet caller-abort
behavior. Deadline, malformed data and interrupted post-text work reject, rather than completing a
truncated answer. Display fragments never invoke a structured commit.

A completion-only adapter remains compatible via **collected** display fragments. That is explicitly
not real network/token streaming. The deterministic offline mock implements a bounded display
stream with the same seeded text as `complete`; it does not simulate token accounting. `mode:
'provider'` describes use of the iterable contract, not evidence of network traffic for an offline
adapter. Existing `completeText` / `executeStructured` remain completion APIs.

## DeepSeek transport and parser

The existing configured chat-completion endpoint/model are reused, without new adapters or changing
model defaults. Fetch sends `stream: true`, `stream_options: { include_usage: true }`, and the bounded
`max_tokens`, seed, temperature and unmodified system/question text.

The [official chat-completion contract](https://api-docs.deepseek.com/api/create-chat-completion)
describes SSE content deltas and a terminal `[DONE]`. Current documentation places usage on the last
content/finish chunk; the parser also accepts an empty-choices usage chunk for compatible transports.
Synthetic fixtures cover both. No real request or credential is needed for tests.

- Byte-delimited parsing tolerates UTF-8 code points and CR/LF/CRLF split across reads, multiline
  `data`, comments, empty frames, role-only deltas and terminal data without a trailing newline.
- UTF-8 is strict; JSON/choice/content/provenance errors are generic `bad-response` failures without
  echoing a raw frame. A model change after first content is rejected instead of rewriting provenance.
- `[DONE]` is required. EOF, transport failure or non-normal finish reasons (e.g. `length`, filtering,
  tool calls) are not a successful answer, even if a prefix happens to be valid JSON.
- The terminal event cancels/releases the reader; HTTP/MIME failures cancel the unused body too.
  Cancellation and abandonment release pending reads, even while a consumer is paused.

## Bounds and resource ownership

One frozen request and unchanged per-completion token cap are reused across attempts. Input bounds
remain [whole system+prompt UTF-16 counts](runtime-budgets.md). Valid reported token overshoot is
rejected; missing counters remain unknown, never estimated from characters.

Two independent finite memory guards supplement, **not approximate**, the token cap:

- 65536 bytes per SSE frame (including unterminated data/comments).
- 65536 UTF-16 code units accumulated output per attempt. `maxOutputCharacters` can tighten that
  ceiling, never widen it. A crossing fragment is refused before yielding; a collected response is
  checked before creating its character array. Both Runtime and DeepSeek bound assembly.

`controlledStream` owns timers/listeners for the full iterator lifetime, including idle consumer
pauses and an outstanding `next()`. `return()` aborts immediately rather than queuing behind a stuck
read; late failures are observed. Long deadlines rearm at Node's timer maximum. Success, failure,
abort, expiration and abandonment all clean up. Final event delivery also closes the scope; consumers
do not have to request another `next()` to release resources after success.

The absolute Runtime deadline is forwarded to stream parsers as well as enforced by the outer
race. Parser checks during reads/scans prevent a fast comment-only microtask loop from starving the
deadline timer. The provider-local timeout remains distinct and may degrade **before first text**.
Cooperative fetch/reader resources are cancelled; custom adapters that ignore signals cannot be
forcibly released or CPU-preempted. Callers must finish, `return()`/break, cancel, or supply a deadline
for an abandoned iterator; merely dropping a reference has no deterministic disposal notification.

## Failure, retries and structured acceptance

**Display:** primary failure before any accepted non-empty text can start fallback with the same
bounded request and remaining absolute deadline. After first text, any interruption/overshoot fails
that stream, without appending another provider's answer. Fallback failure does not recurse. Caller
abort/total expiration never start another attempt. Provider-owned abort is a provider failure, not
learner cancellation.

**Structured:** `executeStructuredViaStream` collects a full, protocol-complete stream, then checks
schema and cancellation/deadline immediately before its synchronous commit. Complete-but-invalid
JSON may get the existing one schema retry, then a separately validated fallback; these hidden
attempts do not splice display answers. A pre-text transport failure goes directly to fallback.
An interrupted partial stream (including a syntactically valid prefix) returns no value and never
commits, retries or starts fallback. Such failures return `degraded` with the failing source's actual
provenance; when no value exists, this does not imply a fallback answer was selected. Cancellation
and expiration return `aborted`/`expired` and no value. A throwing caller commit propagates, without
retry or duplicate invocation.

## Evidence and gates

First RED against unchanged production code: **17 failed / 173 passed** provider tests. This is the
initial behavioral batch, not a claim that new helper ownership unit tests could fail against main.
`streaming.spec.ts` demonstrates first text before closing a synthetic response body, interruption,
cancellation, deadline, abandonment and structured validation. `stream-protocol.spec.ts` covers
parser/provenance/usage/memory bounds and schema retry identity. `stream-control.spec.ts` checks new
resource-ownership mechanics independently. All transport, text and counters are synthetic.

```sh
pnpm --filter @focusloop/llm-provider test
pnpm test
pnpm typecheck
pnpm verify:spec-types
pnpm lint
pnpm build
pnpm e2e
```

No prompt telemetry, scratch output, model credentials, new dependencies or intervention-policy
changes. #145 policy configuration and #146 skill-specific fallback/final conformance remain separate.
