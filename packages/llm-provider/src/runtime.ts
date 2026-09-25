import type {
  CompletionRequest,
  RuntimeRequestData,
  RuntimeSchema,
  StructuredRuntimeResult,
} from '@focusloop/shared-types';
import { validateRuntimeSchema } from '@focusloop/shared-types';
import type { CompleteWithFallbackResult, ProviderSelection } from './registry';
import { completeWithFallback, toProviderFailure } from './registry';
import { ProviderError } from './errors';

/**
 * In-process controls for one runtime call.
 *
 * Deliberately **not** in `@focusloop/shared-types`: an `AbortSignal` cannot
 * cross the IPC boundary the renderer/main split depends on, and it must never
 * enter a shared contract or a persistence layer. Callers in this process pass
 * it; nothing serialises it.
 */
export interface RuntimeExecutionOptions {
  readonly signal?: AbortSignal;
}

export interface StructuredExecuteOptions extends RuntimeExecutionOptions {
  /**
   * Invoked at most once, only with a value that passed schema validation.
   * An aborted or expired call never reaches it — that is the "no late commit"
   * rule the AG9 conformance suite pins down.
   */
  readonly commit?: (value: unknown) => void;
}

class RuntimeAbortError extends Error {
  override readonly name = 'RuntimeAbortError';
}

function isAbort(error: unknown): boolean {
  return (
    error instanceof RuntimeAbortError || (error instanceof Error && error.name === 'AbortError')
  );
}

/** Fresh read every call — TS control-flow narrowing must not freeze `aborted`. */
function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted;
}

/**
 * Rejects as soon as `signal` aborts; the underlying promise keeps running
 * (providers do not take a signal today) but its result is dropped.
 */
function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.reject(new RuntimeAbortError('aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(new RuntimeAbortError('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function raceDeadline<T>(promise: Promise<T>, deadlineMs?: number): Promise<T> {
  if (deadlineMs === undefined) return promise;
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) {
    return Promise.reject(new ProviderError('timeout', 'runtime', 'deadline already passed'));
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new ProviderError('timeout', 'runtime', 'deadline exceeded'));
    }, remaining);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * The AgentRuntime façade: the one door between agent skills and providers.
 *
 * Two output modes, defined separately because streaming and strict schema
 * validation do not mix:
 *
 * - **Text** (`completeText`) — plain completion with the existing
 *   primary→mock fallback. Used by the Tutor and enrich today.
 * - **Structured** (`executeStructured`) — the complete response is parsed and
 *   validated **once** against `RuntimeRequestData.schema`. Only a validated
 *   value may be committed. On schema failure the primary is retried **once**;
 *   a second failure (or a provider error) degrades to the mock fallback and
 *   reports why. A stream or structured call that is abandoned or aborted
 *   halfway never commits.
 *
 * Timeout, 401, rate limit and bad JSON keep the existing
 * `ProviderFailureReason` classification via `toProviderFailure`.
 */
export class AgentRuntime {
  private lastDegraded = false;

  public constructor(private readonly selection: ProviderSelection) {}

  /** True after the most recent call failed over to the fallback provider. */
  get degraded(): boolean {
    return this.lastDegraded;
  }

  /** Deterministic default: the mock provider, or the configured primary. */
  get primary(): ProviderSelection['primary'] {
    return this.selection.primary;
  }

  /**
   * Plain text completion behind the façade (same contract as
   * `completeWithFallback`, plus abort/deadline).
   */
  async completeText(
    request: CompletionRequest,
    options?: RuntimeExecutionOptions & { readonly deadlineMs?: number },
  ): Promise<CompleteWithFallbackResult> {
    if (isSignalAborted(options?.signal)) {
      this.lastDegraded = false;
      throw new RuntimeAbortError('aborted');
    }
    try {
      const result = await raceAbort(
        raceDeadline(completeWithFallback(this.selection, request), options?.deadlineMs),
        options?.signal,
      );
      this.lastDegraded = result.degraded;
      return result;
    } catch (error) {
      if (isAbort(error)) throw error;
      // completeWithFallback already swallows provider errors; this path is for deadline.
      const failure = toProviderFailure(error, this.selection.primary.id);
      const fallback = await this.selection.fallback.complete(request);
      this.lastDegraded = true;
      return { ...fallback, degraded: true, failure };
    }
  }

  /**
   * Final structured result: validated once, retried once on schema failure,
   * then degraded. `commit` runs only for a validated value.
   */
  async executeStructured<T>(
    data: RuntimeRequestData,
    request: CompletionRequest,
    options?: StructuredExecuteOptions,
  ): Promise<StructuredRuntimeResult<T>> {
    const schema = data.schema;
    if (schema === undefined) {
      throw new Error('executeStructured requires RuntimeRequestData.schema');
    }

    if (isSignalAborted(options?.signal)) {
      this.lastDegraded = false;
      return abortedResult(this.selection);
    }
    if (data.deadlineMs !== undefined && Date.now() > data.deadlineMs) {
      this.lastDegraded = false;
      return {
        status: 'expired',
        providerId: this.selection.primary.id,
        model: this.selection.primary.model,
        degraded: false,
      };
    }

    const bounded: CompletionRequest = {
      ...request,
      maxTokens: Math.min(request.maxTokens ?? data.tokenBudget, data.tokenBudget),
    };

    let failureReason: string | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const raw = await raceAbort(
          raceDeadline(this.selection.primary.complete(bounded), data.deadlineMs),
          options?.signal,
        );
        const parsed = parseSchema(raw.text, schema);
        if (parsed.ok) {
          this.lastDegraded = false;
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
        if (isAbort(error)) {
          this.lastDegraded = false;
          return abortedResult(this.selection);
        }
        const failure = toProviderFailure(error, this.selection.primary.id);
        failureReason = failure.reason;
        break; // timeout / 401 / rate limit → degrade, no third try
      }
    }

    // Degrade: mock fallback, still validated before any commit.
    try {
      if (isSignalAborted(options?.signal)) {
        this.lastDegraded = false;
        return abortedResult(this.selection);
      }
      const raw = await raceAbort(this.selection.fallback.complete(bounded), options?.signal);
      const parsed = parseSchema(raw.text, schema);
      this.lastDegraded = true;
      if (parsed.ok) {
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
      if (isAbort(error)) {
        this.lastDegraded = false;
        return abortedResult(this.selection);
      }
      this.lastDegraded = true;
      const failure = toProviderFailure(error, this.selection.fallback.id);
      return {
        status: 'degraded',
        providerId: this.selection.fallback.id,
        model: this.selection.fallback.model,
        degraded: true,
        failureReason: failureReason ?? failure.reason,
      };
    }
  }

  /**
   * Incremental text for display.
   *
   * The provider call is a **single completion**; this splits the finished text so a caller can
   * render progressively. It is not provider token streaming: the first chunk arrives only once the
   * whole completion has, so time-to-first-chunk here is time-to-completion, and a caller that
   * measures it as though it were a token stream is measuring the wrong thing. Real streaming needs
   * providers that expose it (AG9), and that is the interface to keep for it.
   *
   * Cancelling (abort) or abandoning the iterator stops the chunks; there is no commit on this path —
   * a caller that wants a committed result must use `executeStructured`.
   */
  async *streamText(
    request: CompletionRequest,
    options?: RuntimeExecutionOptions & { readonly deadlineMs?: number },
  ): AsyncGenerator<string> {
    const result = await this.completeOnce(request, options);
    if (result === null) return;

    const chunkSize = 48;
    for (let index = 0; index < result.text.length; index += chunkSize) {
      if (isSignalAborted(options?.signal)) return;
      yield result.text.slice(index, index + chunkSize);
    }
  }

  /**
   * One completion with the provenance its callers have to report.
   *
   * `completeWithFallback` may answer from the fallback provider, so identity and `degraded` come
   * from the result rather than from the primary: a caller that assumed the primary would credit the
   * mock's text to the model.
   *
   * Returns null when the signal was already aborted, or aborted mid-flight — a late result is
   * dropped rather than returned.
   */
  private async completeOnce(
    request: CompletionRequest,
    options?: RuntimeExecutionOptions & { readonly deadlineMs?: number },
  ): Promise<CompleteWithFallbackResult | null> {
    if (isSignalAborted(options?.signal)) return null;
    const result = await raceAbort(
      raceDeadline(completeWithFallback(this.selection, request), options?.deadlineMs),
      options?.signal,
    ).catch((error: unknown) => {
      if (isAbort(error)) return null;
      throw error;
    });
    if (result === null) return null;
    this.lastDegraded = result.degraded;
    return result;
  }

  /** Streamed text assembled, then validated once — retry once, then degrade. */
  async executeStructuredViaStream<T>(
    data: RuntimeRequestData,
    request: CompletionRequest,
    options?: StructuredExecuteOptions,
  ): Promise<StructuredRuntimeResult<T>> {
    const schema = data.schema;
    if (schema === undefined) {
      throw new Error('executeStructuredViaStream requires RuntimeRequestData.schema');
    }

    // One completion, not a re-collected stream: the provenance has to survive, and a stream of
    // chunks carries text only — which is how the fallback's answer got credited to the primary.
    const collect = async (): Promise<CompleteWithFallbackResult | null> =>
      this.completeOnce(request, {
        ...options,
        ...(data.deadlineMs === undefined ? {} : { deadlineMs: data.deadlineMs }),
      });

    if (isSignalAborted(options?.signal)) {
      this.lastDegraded = false;
      return abortedResult(this.selection);
    }

    let failureReason: string | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const collected = await collect();
        if (collected === null || isSignalAborted(options?.signal)) {
          this.lastDegraded = false;
          return abortedResult(this.selection);
        }
        const parsed = parseSchema(collected.text, schema);
        if (parsed.ok) {
          this.lastDegraded = collected.degraded;
          options?.commit?.(parsed.value);
          return {
            // A fallback answer that validates is `degraded`, not `ok`: the status has to say which
            // provider produced the value, or the caller reports the mock as the model.
            status: collected.degraded ? 'degraded' : 'ok',
            value: parsed.value as T,
            providerId: collected.providerId,
            model: collected.model,
            degraded: collected.degraded,
          };
        }
        failureReason = parsed.problems.join('; ');
      } catch (error) {
        if (isAbort(error)) {
          this.lastDegraded = false;
          return abortedResult(this.selection);
        }
        const failure = toProviderFailure(error, this.selection.primary.id);
        failureReason = failure.reason;
        break;
      }
    }

    // Degrade after one schema retry (or a provider error).
    return this.degradeStructured<T>(request, schema, options, failureReason);
  }

  private async degradeStructured<T>(
    request: CompletionRequest,
    schema: RuntimeSchema,
    options: StructuredExecuteOptions | undefined,
    failureReason: string | undefined,
  ): Promise<StructuredRuntimeResult<T>> {
    if (isSignalAborted(options?.signal)) {
      this.lastDegraded = false;
      return abortedResult(this.selection);
    }
    try {
      const raw = await raceAbort(this.selection.fallback.complete(request), options?.signal);
      const parsed = parseSchema(raw.text, schema);
      this.lastDegraded = true;
      if (parsed.ok) {
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
      if (isAbort(error)) {
        this.lastDegraded = false;
        return abortedResult(this.selection);
      }
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
}

function abortedResult(selection: ProviderSelection): StructuredRuntimeResult<never> {
  return {
    status: 'aborted',
    providerId: selection.primary.id,
    model: selection.primary.model,
    degraded: false,
  };
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
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value: parsed };
}
