# Runtime input and output budgets

Scope: [#143](https://github.com/nianpingy-cpu/focusloop/issues/143), second slice of
[#94](https://github.com/nianpingy-cpu/focusloop/issues/94), following cancellation/deadline #142.
This budget boundary is distinct from [#144 incremental streaming](runtime-streaming.md) and the
future #145 retry policy.

## One input boundary

`RuntimeBudgets` declares `contextBudget` and `tokenBudget`. Despite the historical name,
`contextBudget` bounds **all outbound text**: `system.length + prompt.length`, in UTF-16 code units.
This matches the Tutor's existing character accounting. It is not a token
estimate, Unicode glyph count, UTF-8 byte count or HTTP/role-wrapper size.

A context budget must be a non-negative safe integer; zero accepts only empty system/prompt text.
Token budgets and a supplied `maxTokens` must be positive safe integers. Missing structured budget
fields, null, negative, fractional and non-finite values are rejected before any provider work.
Invalid caller caps are not repaired by `Math.min` or converted to defaults.

The prepared request preserves system/prompt text, seed and temperature, with
`maxTokens = min(caller cap, tokenBudget)`; a missing caller cap uses the token budget. It is a
frozen, projected snapshot, shared by primary, the existing one schema retry and fallback.
Caller/provider mutation cannot widen later attempts or alter the question they receive. The token
cap is per provider completion, not an aggregate spend ceiling across attempts or an input-token cap.

## Reject, do not silently trim

An input above its cap throws `RuntimeBudgetError` (`RangeError`) with the closed code
`context-budget-exceeded`. Other codes identify invalid context/token/caller budgets or malformed
request text. Errors never contain the prompt; an overflow error exposes numeric caps/counts only.
No fallback is started for invalid caller input, and no structured value is committed.

The runtime cannot identify which substring is the current question or schema instruction.
Consequently, it does not truncate any part of an oversized request. Skills that can safely select
bounded context must do so before calling it; Tutor retains its existing visible clipping/refusal
policy and now explicitly passes its 4000-character / 2048-completion-token ceilings to Runtime.

## Text compatibility and explicit budgets

Text/fragment APIs and direct `completeWithFallback` accept `BudgetExecutionOptions.budgets`.
Omitting that entire field selects named finite compatibility defaults: 16384 UTF-16 code units and
4096 completion tokens. Those are ceilings above Tutor's existing limits, not wider caller caps.
A supplied budget must contain both valid fields; a partial or null budget does not select defaults.

```ts
await runtime.completeText(
  { system: 'Existing instructions', prompt: 'Keep this entire question', maxTokens: 256 },
  { budgets: { contextBudget: 4000, tokenBudget: 2048 }, signal },
);
```

Cancellation/deadline controls remain process-local. Do not serialize the execution-options object
or put an `AbortSignal` in shared request data. Budget declarations and reports contain JSON data.
Structured APIs use the required budgets in `RuntimeRequestData`, not an independent options copy.

## Inspection data and reported usage

Text and structured results include `budget`, with:

- Requested context/token budgets, optional caller cap, and effective `maxTokens`.
- Measured `inputCharacters` and explicit `characterUnit: 'utf16-code-units'`.
- Optional valid provider-reported `usage`: input/output/total tokens when known. Unknown counters
  stay absent; totals are never derived from text length or guessed from other counters.

Character counts describe the **assembled request**, not proof that a transport sent it: a request
may expire or be cancelled before work. Usage describes the selected completion only, not a sum
of primary/retry/fallback costs or a verified billing record. Invalid counters/opaque metadata are
not propagated. No prompt logging, telemetry, persistence or UI change is introduced.

DeepSeek maps `prompt_tokens`, `completion_tokens` and `total_tokens` into the optional usage
contract. A valid reported output count above the effective cap is a `bad-response` provider
failure: completion APIs may fall back while the runtime deadline remains active. Streams may
select fallback only before first text; after first text they fail without splicing another answer.
An over-cap fallback
cannot commit a structured value. Raw text or JSON is never clipped to make it appear compliant.

Adapters receive the cap but may not supply usage. Without a tokenizer/verified count, Runtime
cannot prove exact token compliance for an ignoring custom adapter or the offline mock. It reports
unknown usage honestly rather than labelling a character heuristic as token accounting.

`streamText` now consumes optional provider iterables; completion-only adapters remain explicitly
collected compatibility fragments. Its final iterator value contains the budget report; normal
`for await` ignores that return value. Cancellation returns no successful final report, and
expiration throws. Fragments are not structured commits. See [#144 streaming](runtime-streaming.md)
for provenance-aware events, finite output assembly guards and pre/post-first-text failure rules.

## Regression gates

`budgets.spec.ts` covers all four Runtime entry paths, direct registry fallback, immutable snapshot
identity through retry/fallback, boundary/invalid inputs, no question loss, Unicode units, defaults,
reported/unknown/invalid usage, overshoot without commit, cancellation and safe error projection.
Engine integration tests pin optional-enrichment metadata/refusal; existing Tutor bounds and the
hermetic offline product golden path remain regression gates.

```sh
pnpm --filter @focusloop/llm-provider test
pnpm test
pnpm typecheck
pnpm verify:spec-types
pnpm lint
pnpm build
pnpm e2e
```
