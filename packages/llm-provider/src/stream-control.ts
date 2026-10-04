import {
  assertExecutionActive,
  ExecutionAbortError,
  RuntimeDeadlineError,
  type ExecutionOptions,
} from './execution';

/** Owns the entire iterator lifetime, including idle consumer pauses and a pending next(). */
export function controlledStream<T, R = void>(
  factory: (signal: AbortSignal) => AsyncGenerator<T, R, unknown>,
  options: ExecutionOptions | undefined,
  providerId: string,
  isFinal?: (value: T) => boolean,
): AsyncGenerator<T, R | undefined, unknown> {
  const controls = { signal: options?.signal, deadlineMs: options?.deadlineMs };
  const controller = new AbortController();
  let source: AsyncGenerator<T, R, unknown> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let terminal: unknown;
  let rejectStopped!: (error: unknown) => void;
  const stopped = new Promise<never>((_resolve, reject) => {
    rejectStopped = reject;
  });
  // A deadline/abort can arrive while nobody is waiting for next().
  void stopped.catch(() => undefined);
  const finish = (error?: unknown, completed = false): void => {
    if (closed) return;
    closed = true;
    terminal = error;
    if (timer !== undefined) clearTimeout(timer);
    controls.signal?.removeEventListener('abort', onAbort);
    rejectStopped(error ?? new ExecutionAbortError());
    controller.abort(error ?? new ExecutionAbortError());
    if (!completed && source !== undefined) {
      // A non-cooperative generator can queue return() behind a hung next(). Do not wait for it.
      // Its late failure is observed; cooperative work is released by the signal immediately.
      try {
        void source.return(undefined as R).catch(() => undefined);
      } catch {
        /* best effort */
      }
    }
  };
  const onAbort = (): void => finish(new ExecutionAbortError());
  const arm = (): void => {
    if (controls.deadlineMs === undefined) return;
    const remaining = controls.deadlineMs - Date.now();
    if (remaining <= 0) {
      finish(new RuntimeDeadlineError(providerId));
      return;
    }
    timer = setTimeout(arm, Math.min(remaining, 2_147_483_647));
  };
  // Serialise next() calls, but return()/abort must not sit behind that queue.
  let queue: Promise<unknown> = Promise.resolve();
  return {
    next() {
      const next = async (): Promise<IteratorResult<T, R | undefined>> => {
        if (closed) {
          if (terminal !== undefined) throw terminal;
          return { done: true, value: undefined };
        }
        try {
          assertExecutionActive(controls, providerId);
          if (source === undefined) {
            controls.signal?.addEventListener('abort', onAbort, { once: true });
            arm();
            assertExecutionActive(controls, providerId);
            source = factory(controller.signal);
          }
          const value = await Promise.race([Promise.resolve().then(() => source!.next()), stopped]);
          assertExecutionActive(controls, providerId);
          if (closed) throw terminal ?? new ExecutionAbortError();
          if (value.done) finish(undefined, true);
          else if (isFinal?.(value.value)) finish();
          return value;
        } catch (error) {
          finish(error);
          throw error;
        }
      };
      const pending = queue.then(next, next);
      queue = pending.catch(() => undefined);
      return pending;
    },
    async return(value) {
      finish();
      terminal = undefined;
      return { done: true, value: await value };
    },
    throw(error) {
      finish(error);
      return Promise.reject(error);
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}
