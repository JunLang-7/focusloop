import type {
  CompletionRequest,
  ProviderFailure,
  RuntimeBudgetReport,
  RuntimeRequestData,
  RuntimeSchema,
  StructuredRuntimeResult,
} from '@focusloop/shared-types';
import { validateRuntimeSchema } from '@focusloop/shared-types';
import { completionBudget, prepareBudget, type BudgetExecutionOptions } from './budgets';
import { controlledStream } from './stream-control';
import {
  outputLimit,
  providerStream,
  StreamInterruptedError,
  type ProviderStreamEvent,
} from './streaming';
import type { CompletionResult } from '@focusloop/shared-types';
import type { CompleteWithFallbackResult, ProviderSelection } from './registry';
import { completeWithFallback, toProviderFailure } from './registry';
import {
  assertExecutionActive,
  ExecutionAbortError,
  isExecutionAbort,
  RuntimeDeadlineError,
  validateExecutionOptions,
  withExecution,
  type ExecutableAIProvider,
  type ExecutionOptions,
  type ProviderExecutionOptions,
} from './execution';
import {
  classifyFailure,
  createAttemptLedger,
  pauseBeforeRetry,
  primaryCallLimit,
  resolveRetryPolicy,
  type RetryPolicy,
} from './retry-policy';

/** In-process controls only: never shared/IPC/persisted request data. */
export type RuntimeExecutionOptions = ProviderExecutionOptions;

export interface StreamExecutionOptions extends BudgetExecutionOptions {
  /** Independent finite assembly guard, not a token estimate. May tighten the 65536-unit ceiling. */
  readonly maxOutputCharacters?: number;
}
export interface StructuredStreamOptions extends StructuredExecuteOptions {
  readonly maxOutputCharacters?: number;
}
export type RuntimeStreamEvent =
  | (Extract<ProviderStreamEvent, { type: 'text' }> & {
      readonly degraded: boolean;
      readonly mode: 'provider' | 'collected';
    })
  | { readonly type: 'complete'; readonly result: CompleteWithFallbackResult };

export interface StructuredExecuteOptions extends RuntimeExecutionOptions {
  /** Invoked once only after validation and a final cancellation/deadline check. */
  readonly commit?: (value: unknown) => void;
  /** Per-call overrides for the runtime's bounded retry policy; process-local only. */
  readonly retry?: Partial<RetryPolicy>;
}

/**
 * The one door between skills and providers. Cancellation reaches provider work;
 * a runtime deadline bounds primary, the single schema retry, and fallback together.
 * Provider-local failures may degrade while time remains, but cancellation/expiration
 * never launches another attempt. Text fragments and final structured commits stay separate.
 */
export class AgentRuntime {
  private lastDegraded = false;
  private readonly retry: RetryPolicy;
  public constructor(
    private readonly selection: ProviderSelection,
    options?: { readonly retry?: Partial<RetryPolicy> },
  ) {
    this.retry = resolveRetryPolicy(options?.retry);
  }

  /** Per-call overrides merge over the runtime policy; both stay process-local. */
  private policyFor(overrides?: Partial<RetryPolicy>): RetryPolicy {
    return overrides === undefined
      ? this.retry
      : resolveRetryPolicy({ ...this.retry, ...overrides });
  }

  get degraded(): boolean {
    return this.lastDegraded;
  }
  get primary(): ProviderSelection['primary'] {
    return this.selection.primary;
  }

  /** Cancelled text calls reject with AbortError; expired calls reject with timeout. */
  async completeText(
    request: CompletionRequest,
    options?: BudgetExecutionOptions,
  ): Promise<CompleteWithFallbackResult> {
    this.lastDegraded = false;
    const result = await completeWithFallback(
      this.selection,
      request,
      options,
      this.policyFor(options?.retry),
    );
    assertExecutionActive(options, result.providerId);
    this.lastDegraded = result.degraded;
    return result;
  }

  /** Final structured output: one schema retry, then one validated fallback. */
  async executeStructured<T>(
    data: RuntimeRequestData,
    request: CompletionRequest,
    options?: StructuredExecuteOptions,
  ): Promise<StructuredRuntimeResult<T>> {
    const schema = data.schema;
    if (schema === undefined)
      throw new Error('executeStructured requires RuntimeRequestData.schema');
    const controls: ExecutionOptions = {
      ...options,
      ...(data.deadlineMs === undefined ? {} : { deadlineMs: data.deadlineMs }),
    };
    validateExecutionOptions(controls);
    this.lastDegraded = false;
    const prepared = prepareBudget(request, data);
    return this.runStructured<T>(
      schema,
      prepared,
      controls,
      options,
      this.policyFor(options?.retry),
      async (provider, observe) => {
        const raw = await withExecution(
          (signal) => provider.complete(prepared.request, { signal }),
          controls,
          provider.id,
        );
        observe({ id: raw.providerId, model: raw.model });
        return raw;
      },
      false,
    );
  }

  /** Provenance-aware display events. Only a pre-first-text failure may select fallback. */
  streamEvents(
    request: CompletionRequest,
    options?: StreamExecutionOptions,
  ): AsyncGenerator<RuntimeStreamEvent> {
    this.lastDegraded = false;
    const prepared = prepareBudget(request, options?.budgets);
    const maxCharacters = outputLimit(options?.maxOutputCharacters);
    const controls = { signal: options?.signal, deadlineMs: options?.deadlineMs };
    return controlledStream(
      async function* (
        this: AgentRuntime,
        signal: AbortSignal,
      ): AsyncGenerator<RuntimeStreamEvent> {
        const policy = this.policyFor(options?.retry);
        const ledger = createAttemptLedger(policy.maxModelCalls);
        const failures: ProviderFailure[] = [];
        let lastError: unknown;
        providers: for (const [index, provider] of [
          this.selection.primary,
          this.selection.fallback,
        ].entries()) {
          const degraded = index > 0;
          const callLimit = Math.min(
            index === 0 ? primaryCallLimit(policy) : policy.maxTransportAttempts,
            ledger.remaining,
          );
          for (let attempt = 1; attempt <= callLimit; attempt += 1) {
            if (!ledger.take()) break;
            try {
              for await (const event of providerStream(
                provider,
                prepared.request,
                prepared.report,
                { ...controls, signal },
                maxCharacters,
              )) {
                assertExecutionActive({ ...controls, signal }, provider.id);
                this.lastDegraded = degraded;
                if (event.type === 'text')
                  yield {
                    ...event,
                    degraded,
                    mode: provider.stream === undefined ? 'collected' : 'provider',
                  };
                else {
                  const budget = completionBudget(prepared.report, event.result);
                  yield {
                    type: 'complete',
                    result: {
                      text: event.result.text,
                      providerId: event.result.providerId,
                      model: event.result.model,
                      latencyMs: event.result.latencyMs,
                      ...(budget.usage === undefined ? {} : { usage: budget.usage }),
                      budget,
                      degraded,
                      failure: failures[0] ?? null,
                      attempts: ledger.used,
                      failures,
                    },
                  };
                }
              }
              return;
            } catch (error) {
              assertExecutionActive({ ...controls, signal }, provider.id);
              lastError = error;
              // A stream that already emitted text is never continued by another provider.
              if (error instanceof StreamInterruptedError) break providers;
              // A failing local fallback is terminal: never loop back to the primary.
              if (index > 0) throw error;
              const failure = toProviderFailure(error, provider.id);
              failures.push(failure);
              if (
                classifyFailure(failure.reason) === 'terminal' ||
                attempt >= callLimit ||
                ledger.remaining === 0
              )
                break;
              await pauseBeforeRetry(policy, controls, provider.id, attempt);
            }
          }
        }
        throw lastError;
      }.bind(this),
      controls,
      this.selection.primary.id,
      (event) => event.type === 'complete',
    );
  }

  /** String compatibility view over real streams. Caller abort is quiet; other failures reject. */
  streamText(
    request: CompletionRequest,
    options?: StreamExecutionOptions,
  ): AsyncGenerator<string, RuntimeBudgetReport | undefined> {
    const events = this.streamEvents(request, options);
    let budget: RuntimeBudgetReport | undefined;
    const next = async (): Promise<IteratorResult<string, RuntimeBudgetReport | undefined>> => {
      try {
        for (;;) {
          const event = await events.next();
          if (event.done) return { done: true, value: budget };
          if (event.value.type === 'text') return { done: false, value: event.value.text };
          budget = event.value.result.budget;
        }
      } catch (error) {
        if (isExecutionAbort(error)) {
          this.lastDegraded = false;
          return { done: true, value: undefined };
        }
        if (error instanceof RuntimeDeadlineError) this.lastDegraded = false;
        throw error;
      }
    };
    return {
      next,
      return: async (value) => {
        await events.return(undefined);
        return { done: true, value: await value };
      },
      throw: async (error) => {
        await events.throw(error);
        throw error;
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  /** Assemble each real stream completely, then validate/commit. No partial stream is accepted. */
  async executeStructuredViaStream<T>(
    data: RuntimeRequestData,
    request: CompletionRequest,
    options?: StructuredStreamOptions,
  ): Promise<StructuredRuntimeResult<T>> {
    const schema = data.schema;
    if (schema === undefined)
      throw new Error('executeStructuredViaStream requires RuntimeRequestData.schema');
    const controls: ExecutionOptions = {
      signal: options?.signal,
      deadlineMs: data.deadlineMs ?? options?.deadlineMs,
    };
    validateExecutionOptions(controls);
    this.lastDegraded = false;
    const prepared = prepareBudget(request, data);
    const streamLimit = outputLimit(options?.maxOutputCharacters);
    return this.runStructured<T>(
      schema,
      prepared,
      controls,
      options,
      this.policyFor(options?.retry),
      async (provider, observe) => {
        let raw: CompletionResult | undefined;
        for await (const event of providerStream(
          provider,
          prepared.request,
          prepared.report,
          controls,
          streamLimit,
        )) {
          if (event.type === 'text') observe({ id: event.providerId, model: event.model });
          else {
            raw = event.result;
            observe({ id: raw.providerId, model: raw.model });
          }
        }
        if (raw === undefined) throw new Error('Missing final stream result');
        return raw;
      },
      true,
    );
  }

  /**
   * One bounded attempt loop shared by the completion and streamed structured entry points.
   * `acquire` performs exactly one provider call (already raced against the absolute deadline) and
   * reports the real provider/model it reached. Schema and transport retries share a per-provider
   * cap, and the ledger bounds every provider call in the operation.
   */
  private async runStructured<T>(
    schema: RuntimeSchema,
    prepared: { readonly request: CompletionRequest; readonly report: RuntimeBudgetReport },
    controls: ExecutionOptions,
    options: StructuredExecuteOptions | undefined,
    policy: RetryPolicy,
    acquire: (
      provider: ExecutableAIProvider,
      observe: (origin: { readonly id: string; readonly model: string }) => void,
    ) => Promise<CompletionResult>,
    stopOnInterrupted: boolean,
  ): Promise<StructuredRuntimeResult<T>> {
    const ledger = createAttemptLedger(policy.maxModelCalls);
    const failures: ProviderFailure[] = [];
    // Schema and transport retries share this per-provider cap; the ledger still bounds the total.
    const providerCap = policy.maxTransportAttempts + policy.maxSchemaAttempts - 1;
    let failureReason: string | undefined;
    let origin = { id: this.selection.primary.id, model: this.selection.primary.model };
    providers: for (const [index, provider] of [
      this.selection.primary,
      this.selection.fallback,
    ].entries()) {
      let transportFailures = 0;
      let schemaFailures = 0;
      let committing = false;
      const limit = Math.min(
        index === 0 ? primaryCallLimit(policy, providerCap) : providerCap,
        ledger.remaining,
      );
      for (let call = 1; call <= limit; call += 1) {
        if (!ledger.take()) break;
        try {
          const raw = await acquire(provider, (reached) => {
            origin = reached;
          });
          const budget = completionBudget(prepared.report, raw);
          const parsed = parseSchema(raw.text, schema);
          assertExecutionActive(controls, raw.providerId);
          if (parsed.ok) {
            // No asynchronous boundary between the final check and this synchronous commit.
            committing = true;
            this.lastDegraded = index > 0;
            options?.commit?.(parsed.value);
            return {
              status: index > 0 ? 'degraded' : 'ok',
              value: parsed.value as T,
              providerId: raw.providerId,
              model: raw.model,
              degraded: index > 0,
              budget,
              attempts: ledger.used,
              failures,
              ...(failureReason === undefined ? {} : { failureReason }),
            };
          }
          schemaFailures += 1;
          failureReason = parsed.problems.join('; ');
          if (schemaFailures >= policy.maxSchemaAttempts || ledger.remaining === 0) break;
          await pauseBeforeRetry(policy, controls, provider.id, schemaFailures);
        } catch (error) {
          // A caller's failed commit is not a provider failure: never retry/fallback and commit twice.
          if (committing) throw error;
          const stopped = this.stoppedResult(
            controls,
            prepared.report,
            origin,
            ledger.used,
            failures,
          );
          if (stopped !== null) return stopped;
          const failure = toProviderFailure(error, provider.id);
          failures.push(failure);
          failureReason = failure.reason;
          // A stream that already emitted text is never continued by another provider.
          if (stopOnInterrupted && error instanceof StreamInterruptedError) break providers;
          transportFailures += 1;
          if (
            classifyFailure(failure.reason) === 'terminal' ||
            transportFailures >= policy.maxTransportAttempts ||
            ledger.remaining === 0
          )
            break;
          await pauseBeforeRetry(policy, controls, provider.id, transportFailures);
        }
      }
    }
    // Exhausted (or the ledger is). Keep the recorded provenance instead of inventing a provider.
    this.lastDegraded = true;
    return {
      status: 'degraded',
      providerId: origin.id,
      model: origin.model,
      degraded: true,
      budget: prepared.report,
      attempts: ledger.used,
      failures,
      ...(failureReason === undefined ? {} : { failureReason }),
    };
  }

  private stoppedResult(
    controls: ExecutionOptions,
    budget: RuntimeBudgetReport,
    origin: { readonly id: string; readonly model: string } = this.selection.primary,
    attempts = 0,
    failures: readonly ProviderFailure[] = [],
  ): StructuredRuntimeResult<never> | null {
    let boundary: unknown = null;
    try {
      assertExecutionActive(controls, this.selection.primary.id);
    } catch (thrown) {
      boundary = thrown;
    }
    // Derived from the boundary this call observed, not from the raw error: an `AbortError` a
    // provider authored for its own transport is a provider failure, and must degrade like any
    // other rather than being reported as the learner's own cancellation.
    const status =
      boundary instanceof ExecutionAbortError
        ? 'aborted'
        : boundary instanceof RuntimeDeadlineError
          ? 'expired'
          : null;
    if (status === null) return null;
    this.lastDegraded = false;
    return {
      status,
      providerId: origin.id,
      model: origin.model,
      degraded: false,
      budget,
      attempts,
      failures,
    };
  }
}

function parseSchema(
  text: string,
  schema: RuntimeSchema,
): { ok: true; value: unknown } | { ok: false; problems: readonly string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, problems: ['response is not valid JSON'] };
  }
  const problems = validateRuntimeSchema(parsed, schema);
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value: parsed };
}
