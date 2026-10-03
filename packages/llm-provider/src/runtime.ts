import type {
  CompletionRequest,
  RuntimeRequestData,
  RuntimeSchema,
  StructuredRuntimeResult,
} from '@focusloop/shared-types';
import { validateRuntimeSchema } from '@focusloop/shared-types';
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
    options?: ExecutionOptions,
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
    const bounded: CompletionRequest = {
      ...request,
      maxTokens: Math.min(request.maxTokens ?? data.tokenBudget, data.tokenBudget),
    };
    let failureReason: string | undefined;
    let committing = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const raw = await withExecution(
          (signal) => this.selection.primary.complete(bounded, { signal }),
          controls,
          this.selection.primary.id,
        );
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
          };
        }
        failureReason = parsed.problems.join('; ');
      } catch (error) {
        // A caller's failed commit is not a provider failure: never retry/fallback and commit twice.
        if (committing) throw error;
        const stopped = this.stoppedResult(controls);
        if (stopped !== null) return stopped;
        failureReason = toProviderFailure(error, this.selection.primary.id).reason;
        break; // transport failures do not gain another retry in this slice
      }
    }
    return this.degradeStructured<T>(bounded, schema, controls, options, failureReason);
  }

  /**
   * Compatibility display fragments, NOT provider token streaming. The first chunk
   * arrives after full completion; real streaming is tracked separately in #144.
   * Cancellation ends the stream quietly; expiration between fragments rejects with the same
   * timeout the text API uses, so a caller is never handed a silently truncated story and a
   * caller that wants a committed value must use `executeStructured`. Nothing here commits.
   */
  async *streamText(
    request: CompletionRequest,
    options?: ExecutionOptions,
  ): AsyncGenerator<string> {
    let result: CompleteWithFallbackResult;
    try {
      result = await this.completeText(request, options);
    } catch (error) {
      if (isExecutionAbort(error)) return;
      throw error;
    }
    const chunkSize = 48;
    for (let index = 0; index < result.text.length; index += chunkSize) {
      try {
        assertExecutionActive(options, result.providerId);
      } catch (error) {
        this.lastDegraded = false;
        if (isExecutionAbort(error)) return;
        throw error;
      }
      yield result.text.slice(index, index + chunkSize);
    }
  }

  /**
   * Compatibility name: this was already one collected completion, not real streaming.
   * Share the validated path so cancellation, deadline, retry count and provenance
   * cannot drift between the two final-result entry points.
   */
  async executeStructuredViaStream<T>(
    data: RuntimeRequestData,
    request: CompletionRequest,
    options?: StructuredExecuteOptions,
  ): Promise<StructuredRuntimeResult<T>> {
    return this.executeStructured<T>(data, request, options);
  }

  private async degradeStructured<T>(
    request: CompletionRequest,
    schema: RuntimeSchema,
    controls: ExecutionOptions,
    options: StructuredExecuteOptions | undefined,
    failureReason: string | undefined,
  ): Promise<StructuredRuntimeResult<T>> {
    let committing = false;
    try {
      const raw = await withExecution(
        (signal) => this.selection.fallback.complete(request, { signal }),
        controls,
        this.selection.fallback.id,
      );
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
          ...(failureReason === undefined ? {} : { failureReason }),
        };
      }
      return {
        status: 'degraded',
        providerId: raw.providerId,
        model: raw.model,
        degraded: true,
        failureReason: failureReason ?? parsed.problems.join('; '),
      };
    } catch (error) {
      if (committing) throw error;
      const stopped = this.stoppedResult(controls);
      if (stopped !== null) return stopped;
      this.lastDegraded = true;
      return {
        status: 'degraded',
        providerId: this.selection.fallback.id,
        model: this.selection.fallback.model,
        degraded: true,
        failureReason: failureReason ?? toProviderFailure(error, this.selection.fallback.id).reason,
      };
    }
  }

  private stoppedResult(controls: ExecutionOptions): StructuredRuntimeResult<never> | null {
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
      providerId: this.selection.primary.id,
      model: this.selection.primary.model,
      degraded: false,
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
