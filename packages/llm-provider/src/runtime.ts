import type {
  CompletionRequest,
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
  type ExecutionOptions,
  type ProviderExecutionOptions,
} from './execution';

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
}

/**
 * The one door between skills and providers. Cancellation reaches provider work;
 * a runtime deadline bounds primary, the single schema retry, and fallback together.
 * Provider-local failures may degrade while time remains, but cancellation/expiration
 * never launches another attempt. Text fragments and final structured commits stay separate.
 */
export class AgentRuntime {
  private lastDegraded = false;
  public constructor(private readonly selection: ProviderSelection) {}

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
    const result = await completeWithFallback(this.selection, request, options);
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
    const bounded = prepared.request;
    let failureReason: string | undefined;
    let committing = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const raw = await withExecution(
          (signal) => this.selection.primary.complete(bounded, { signal }),
          controls,
          this.selection.primary.id,
        );
        const budget = completionBudget(prepared.report, raw);
        const parsed = parseSchema(raw.text, schema);
        assertExecutionActive(controls, raw.providerId);
        if (parsed.ok) {
          // No asynchronous boundary between the final check and this synchronous commit.
          committing = true;
          options?.commit?.(parsed.value);
          return {
            status: 'ok',
            value: parsed.value as T,
            providerId: raw.providerId,
            model: raw.model,
            degraded: false,
            budget,
          };
        }
        failureReason = parsed.problems.join('; ');
      } catch (error) {
        // A caller's failed commit is not a provider failure: never retry/fallback and commit twice.
        if (committing) throw error;
        const stopped = this.stoppedResult(controls, prepared.report);
        if (stopped !== null) return stopped;
        failureReason = toProviderFailure(error, this.selection.primary.id).reason;
        break; // transport failures do not gain another retry in this slice
      }
    }
    return this.degradeStructured<T>(
      bounded,
      schema,
      controls,
      options,
      failureReason,
      prepared.report,
    );
  }

  /** Provenance-aware display events. Only a pre-first-text failure may select fallback. */
  streamEvents(
    request: CompletionRequest,
    options?: StreamExecutionOptions,
  ): AsyncGenerator<RuntimeStreamEvent> {
    this.lastDegraded = false;
    const prepared = prepareBudget(request, options?.budgets);
    const limit = outputLimit(options?.maxOutputCharacters);
    const controls = { signal: options?.signal, deadlineMs: options?.deadlineMs };
    return controlledStream(
      async function* (
        this: AgentRuntime,
        signal: AbortSignal,
      ): AsyncGenerator<RuntimeStreamEvent> {
        let failure: CompleteWithFallbackResult['failure'] = null;
        for (const provider of [this.selection.primary, this.selection.fallback]) {
          const degraded = failure !== null;
          try {
            for await (const event of providerStream(
              provider,
              prepared.request,
              prepared.report,
              { ...controls, signal },
              limit,
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
                    failure,
                  },
                };
              }
            }
            return;
          } catch (error) {
            assertExecutionActive({ ...controls, signal }, provider.id);
            if (degraded || error instanceof StreamInterruptedError) throw error;
            failure = toProviderFailure(error, provider.id);
          }
        }
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
    const prepared = prepareBudget(request, data);
    const limit = outputLimit(options?.maxOutputCharacters);
    this.lastDegraded = false;
    let failureReason: string | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const provider = attempt === 2 ? this.selection.fallback : this.selection.primary;
      let origin = { id: provider.id, model: provider.model };
      let seen = false;
      let committing = false;
      try {
        let raw: CompletionResult | undefined;
        for await (const event of providerStream(
          provider,
          prepared.request,
          prepared.report,
          controls,
          limit,
        )) {
          if (event.type === 'text') {
            seen = true;
            origin = { id: event.providerId, model: event.model };
          } else {
            raw = event.result;
            origin = { id: raw.providerId, model: raw.model };
          }
        }
        if (raw === undefined) throw new Error('Missing final stream result');
        const budget = completionBudget(prepared.report, raw);
        const parsed = parseSchema(raw.text, schema);
        assertExecutionActive(controls, provider.id);
        this.lastDegraded = attempt === 2;
        if (parsed.ok) {
          committing = true;
          options?.commit?.(parsed.value);
          return {
            status: attempt === 2 ? 'degraded' : 'ok',
            value: parsed.value as T,
            providerId: raw.providerId,
            model: raw.model,
            degraded: attempt === 2,
            budget,
            ...(failureReason === undefined ? {} : { failureReason }),
          };
        }
        failureReason = parsed.problems.join('; ');
        if (attempt < 2) continue;
      } catch (error) {
        if (committing) throw error;
        const stopped = this.stoppedResult(controls, prepared.report, origin);
        if (stopped !== null) return stopped;
        failureReason = toProviderFailure(error, provider.id).reason;
        // Retrying hidden complete-but-invalid JSON is safe. An interrupted stream is not complete.
        if (!seen && !(error instanceof StreamInterruptedError) && attempt < 2) {
          attempt = 1;
          continue;
        }
      }
      this.lastDegraded = true;
      return {
        status: 'degraded',
        providerId: origin.id,
        model: origin.model,
        degraded: true,
        budget: prepared.report,
        ...(failureReason === undefined ? {} : { failureReason }),
      };
    }
    throw new Error('Unreachable stream attempt state');
  }

  private async degradeStructured<T>(
    request: CompletionRequest,
    schema: RuntimeSchema,
    controls: ExecutionOptions,
    options: StructuredExecuteOptions | undefined,
    failureReason: string | undefined,
    report: RuntimeBudgetReport,
  ): Promise<StructuredRuntimeResult<T>> {
    let committing = false;
    try {
      const raw = await withExecution(
        (signal) => this.selection.fallback.complete(request, { signal }),
        controls,
        this.selection.fallback.id,
      );
      const budget = completionBudget(report, raw);
      const parsed = parseSchema(raw.text, schema);
      assertExecutionActive(controls, raw.providerId);
      this.lastDegraded = true;
      if (parsed.ok) {
        committing = true;
        options?.commit?.(parsed.value);
        return {
          status: 'degraded',
          value: parsed.value as T,
          providerId: raw.providerId,
          model: raw.model,
          degraded: true,
          budget,
          ...(failureReason === undefined ? {} : { failureReason }),
        };
      }
      return {
        status: 'degraded',
        providerId: raw.providerId,
        model: raw.model,
        degraded: true,
        budget,
        failureReason: failureReason ?? parsed.problems.join('; '),
      };
    } catch (error) {
      if (committing) throw error;
      const stopped = this.stoppedResult(controls, report);
      if (stopped !== null) return stopped;
      this.lastDegraded = true;
      return {
        status: 'degraded',
        providerId: this.selection.fallback.id,
        model: this.selection.fallback.model,
        degraded: true,
        budget: report,
        failureReason: failureReason ?? toProviderFailure(error, this.selection.fallback.id).reason,
      };
    }
  }

  private stoppedResult(
    controls: ExecutionOptions,
    budget: RuntimeBudgetReport,
    origin: { readonly id: string; readonly model: string } = this.selection.primary,
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
