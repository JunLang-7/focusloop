import type { AIProvider, CompletionRequest, CompletionResult } from '@focusloop/shared-types';
import { ProviderError } from './errors';

/** Process-local only: never put these controls in shared request data or IPC. */
export interface ProviderExecutionOptions {
  readonly signal?: AbortSignal;
}

/** Optional controls preserve compatibility with existing one-argument providers. */
export interface ExecutableAIProvider extends AIProvider {
  complete(
    request: CompletionRequest,
    options?: ProviderExecutionOptions,
  ): Promise<CompletionResult>;
}

export interface ExecutionOptions extends ProviderExecutionOptions {
  /** Absolute epoch-ms deadline for the entire operation, not a fresh timeout per attempt. */
  readonly deadlineMs?: number;
}

/** Deliberate cancellation is not a provider failure and must never trigger fallback. */
export class ExecutionAbortError extends Error {
  override readonly name = 'AbortError';
  constructor() {
    super('generation cancelled');
  }
}

/** Distinct from a provider-local timeout, which may still allow fallback. */
export class RuntimeDeadlineError extends ProviderError {
  constructor(providerId: string) {
    super('timeout', providerId, 'runtime deadline exceeded');
  }
}

export function isExecutionAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function validateExecutionOptions(options?: ExecutionOptions): void {
  if (options?.deadlineMs !== undefined && !Number.isFinite(options.deadlineMs)) {
    throw new RangeError('deadlineMs must be a finite absolute timestamp');
  }
}

/** Check at start, after await, and immediately before a result/commit is accepted. */
export function assertExecutionActive(
  options: ExecutionOptions | undefined,
  providerId: string,
): void {
  validateExecutionOptions(options);
  if (options?.signal?.aborted) throw new ExecutionAbortError();
  if (options?.deadlineMs !== undefined && Date.now() >= options.deadlineMs) {
    throw new RuntimeDeadlineError(providerId);
  }
}

/**
 * Forward a linked signal to cooperative work and race non-cooperative work too.
 * The task's rejection is always observed, even after the caller has stopped waiting.
 * Timers/listeners are released on every exit, including synchronous provider throws.
 */
export async function withExecution<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: ExecutionOptions | undefined,
  providerId: string,
): Promise<T> {
  assertExecutionActive(options, providerId);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      const stop = (error: unknown): void => {
        // Preserve the actual failure while releasing outstanding transport/body work.
        reject(error);
        controller.abort(error);
      };
      onAbort = () => stop(new ExecutionAbortError());
      options?.signal?.addEventListener('abort', onAbort, { once: true });
      const armDeadline = (): void => {
        if (options?.deadlineMs === undefined) return;
        const remaining = options.deadlineMs - Date.now();
        if (remaining <= 0) {
          stop(new RuntimeDeadlineError(providerId));
          return;
        }
        // Node clamps larger delays to 1ms; re-arm long deadlines instead of expiring early.
        timer = setTimeout(armDeadline, Math.min(remaining, 2_147_483_647));
      };
      armDeadline();
      try {
        assertExecutionActive(options, providerId);
        operation(controller.signal).then(
          (value) => {
            try {
              assertExecutionActive(options, providerId);
              resolve(value);
            } catch (error) {
              stop(error);
            }
          },
          (error: unknown) => {
            try {
              assertExecutionActive(options, providerId);
              stop(error);
            } catch (stopped) {
              stop(stopped);
            }
          },
        );
      } catch (error) {
        stop(error);
      }
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined) options?.signal?.removeEventListener('abort', onAbort);
  }
}
