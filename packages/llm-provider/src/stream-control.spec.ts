import { afterEach, expect, it, vi } from 'vitest';
import { controlledStream } from './stream-control';
import { ExecutionAbortError, RuntimeDeadlineError } from './execution';
const tick = async () => {
  for (let n = 0; n < 20; n++) await Promise.resolve();
};
afterEach(() => vi.useRealTimers());

it('unconsumed/returned iterators create no provider work, timers or listeners', async () => {
  vi.useFakeTimers();
  const factory = vi.fn(async function* () {
    yield 1;
  });
  const signal = new AbortController().signal;
  const add = vi.spyOn(signal, 'addEventListener');
  const source = controlledStream(factory, { signal, deadlineMs: Date.now() + 10 }, 'fixture');
  await source.return(undefined);
  expect(factory).not.toHaveBeenCalled();
  expect(add).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it('success removes its owned abort listener and deadline timer', async () => {
  vi.useFakeTimers();
  const signal = new AbortController().signal;
  const remove = vi.spyOn(signal, 'removeEventListener');
  const source = controlledStream(
    async function* () {
      yield 1;
    },
    { signal, deadlineMs: Date.now() + 10 },
    'fixture',
  );
  await source.next();
  await source.next();
  expect(remove).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it('long deadlines rearm without Node clamping them to 1ms', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const source = controlledStream(
    async function* (linked) {
      signal = linked;
      yield 1;
    },
    { deadlineMs: Date.now() + 2147483650 },
    'fixture',
  );
  await source.next();
  await vi.advanceTimersByTimeAsync(2147483647);
  expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(3);
  expect(signal?.aborted).toBe(true);
  await expect(source.next()).rejects.toBeInstanceOf(RuntimeDeadlineError);
  expect(vi.getTimerCount()).toBe(0);
});
it('pre-cancellation and invalid deadlines prevent factory invocation', async () => {
  const controller = new AbortController();
  controller.abort();
  const factory = vi.fn(async function* () {
    yield 1;
  });
  await expect(
    controlledStream(factory, { signal: controller.signal }, 'fixture').next(),
  ).rejects.toBeInstanceOf(ExecutionAbortError);
  await expect(
    controlledStream(factory, { deadlineMs: Infinity }, 'fixture').next(),
  ).rejects.toBeInstanceOf(RangeError);
  expect(factory).not.toHaveBeenCalled();
});
it('queued next calls remain ordered but return does not queue behind a non-cooperative next', async () => {
  let reject!: (error: unknown) => void;
  const pending = new Promise<void>((_resolve, fail) => {
    reject = fail;
  });
  let signal: AbortSignal | undefined;
  const source = controlledStream(
    async function* (linked) {
      signal = linked;
      await pending;
      yield 1;
    },
    undefined,
    'fixture',
  );
  const first = source.next().catch((error: unknown) => error);
  const queued = source.next();
  await tick();
  expect(await source.return(undefined)).toEqual({ done: true, value: undefined });
  expect(signal?.aborted).toBe(true);
  expect(await first).toBeInstanceOf(ExecutionAbortError);
  expect(await queued).toEqual({ done: true, value: undefined });
  // A late rejection from non-cooperative work must be observed, not become unhandled.
  reject(new Error('late fixture failure'));
  await tick();
});
it('generator failure releases owned timers/listeners', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const source = controlledStream(
    async function* () {
      yield 1;
      throw new Error('fixture');
    },
    { signal: controller.signal, deadlineMs: Date.now() + 10 },
    'fixture',
  );
  await source.next();
  await expect(source.next()).rejects.toThrow('fixture');
  expect(remove).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it('concurrent consumers cannot race provider next calls', async () => {
  const source = controlledStream(
    async function* () {
      yield 1;
      yield 2;
    },
    undefined,
    'fixture',
  );
  expect(await Promise.all([source.next(), source.next(), source.next()])).toEqual([
    { done: false, value: 1 },
    { done: false, value: 2 },
    { done: true, value: undefined },
  ]);
});
