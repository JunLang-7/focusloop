import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CompletionRequest,
  CompletionResult,
  RuntimeRequestData,
} from '@focusloop/shared-types';
import { AgentRuntime } from './runtime';
import { ProviderError } from './errors';
import { DeepSeekProvider } from './deepseek-provider';
import { RuntimeDeadlineError, withExecution, type ExecutableAIProvider } from './execution';

const result: CompletionResult = {
  text: '{"answer":"next step"}',
  providerId: 'fake',
  model: 'fake',
  latencyMs: 0,
};
const request: CompletionRequest = { prompt: 'synthetic question' };
const data: RuntimeRequestData = {
  skill: 'test',
  schema: { type: 'object', properties: { answer: { type: 'string' } } },
  contextBudget: 100,
  tokenBudget: 10,
};
function provider(complete: ExecutableAIProvider['complete']): ExecutableAIProvider {
  return { id: 'fake', model: 'fake', offline: true, complete };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('execution resource ownership', () => {
  for (const exit of ['success', 'failure', 'abort', 'deadline'] as const) {
    it(`releases the caller listener and deadline timer on ${exit}`, async () => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const add = vi.spyOn(controller.signal, 'addEventListener');
      const remove = vi.spyOn(controller.signal, 'removeEventListener');
      let child: AbortSignal | undefined;
      const pending = withExecution(
        async (signal) => {
          child = signal;
          if (exit === 'success') return 'ok';
          if (exit === 'failure') throw new Error('synthetic failure');
          return new Promise<string>(() => {});
        },
        { signal: controller.signal, deadlineMs: Date.now() + 10 },
        'fake',
      ).catch((error: unknown) => error);
      if (exit === 'abort') controller.abort();
      if (exit === 'deadline') await vi.advanceTimersByTimeAsync(10);
      const settled = await pending;
      if (exit === 'success') expect(settled).toBe('ok');
      if (exit === 'failure') expect(settled).toMatchObject({ message: 'synthetic failure' });
      if (exit === 'abort') expect(settled).toMatchObject({ name: 'AbortError' });
      if (exit === 'deadline') expect(settled).toBeInstanceOf(RuntimeDeadlineError);
      expect(child?.aborted).toBe(exit !== 'success');
      expect(add).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]?.[1]);
      expect(vi.getTimerCount()).toBe(0);
    });
  }

  it('cleans up even when a provider throws synchronously', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    await expect(
      withExecution(
        () => {
          throw new Error('sync failure');
        },
        { signal: controller.signal, deadlineMs: Date.now() + 10 },
        'fake',
      ),
    ).rejects.toThrow('sync failure');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not turn a long deadline into Node's clamped 1ms timeout", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let child: AbortSignal | undefined;
    const pending = withExecution(
      (signal) => {
        child = signal;
        return new Promise(() => {});
      },
      { signal: controller.signal, deadlineMs: Date.now() + 2_147_483_648 },
      'fake',
    ).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1);
    expect(child?.aborted).toBe(false);
    controller.abort();
    expect(await pending).toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects non-finite deadlines before any work', async () => {
    const operation = vi.fn(async () => 'not called');
    for (const deadlineMs of [NaN, Infinity, -Infinity]) {
      await expect(withExecution(operation, { deadlineMs }, 'fake')).rejects.toThrow(RangeError);
    }
    expect(operation).not.toHaveBeenCalled();
  });
});

describe('final acceptance boundary', () => {
  for (const method of ['executeStructured', 'executeStructuredViaStream'] as const) {
    for (const boundary of ['cancel', 'expire'] as const) {
      it(`${method}: ${boundary} during validation prevents commit and fallback`, async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const deadlineMs = Date.now() + 10;
        const commit = vi.fn();
        const fallback = vi.fn(async () => result);
        const properties = new Proxy(data.schema!.properties, {
          ownKeys(target) {
            if (boundary === 'cancel') controller.abort();
            else vi.setSystemTime(deadlineMs);
            return Reflect.ownKeys(target);
          },
        });
        const runtime = new AgentRuntime({
          primary: provider(async () => result),
          fallback: provider(fallback),
        });
        const settled = await runtime[method](
          { ...data, deadlineMs, schema: { ...data.schema!, properties } },
          request,
          { signal: controller.signal, commit },
        );
        expect(settled.status).toBe(boundary === 'cancel' ? 'aborted' : 'expired');
        expect(commit).not.toHaveBeenCalled();
        expect(fallback).not.toHaveBeenCalled();
      });
    }

    it(`${method}: a failed commit is not retried as a provider failure`, async () => {
      const failure = new Error('caller write failed');
      const commit = vi.fn(() => {
        throw failure;
      });
      const fallback = vi.fn(async () => result);
      const runtime = new AgentRuntime({
        primary: provider(async () => result),
        fallback: provider(fallback),
      });
      await expect(runtime[method](data, request, { commit })).rejects.toBe(failure);
      expect(commit).toHaveBeenCalledTimes(1);
      expect(fallback).not.toHaveBeenCalled();
    });
  }

  it('a provider-local DeepSeek timeout degrades while runtime time remains', async () => {
    vi.useFakeTimers();
    let transport: AbortSignal | undefined;
    const fetchImpl: typeof fetch = (_url, init) => {
      transport = init?.signal ?? undefined;
      return new Promise(() => {});
    };
    const primary = new DeepSeekProvider({ apiKey: 'synthetic', fetchImpl, timeoutMs: 5 });
    const fallback = vi.fn(async () => result);
    // The subject is the provider-local timeout, so the primary is pinned to a single attempt:
    // with the production retry this failure would retry and then expire instead of degrading.
    const runtime = new AgentRuntime(
      { primary, fallback: provider(fallback) },
      { retry: { maxTransportAttempts: 1 } },
    );
    const pending = runtime.completeText(request, { deadlineMs: Date.now() + 20 });
    await vi.advanceTimersByTimeAsync(5);
    expect(await pending).toMatchObject({ degraded: true, failure: { reason: 'timeout' } });
    expect(transport?.aborted).toBe(true);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runtime expiration does not degrade after a later DeepSeek-local timeout', async () => {
    vi.useFakeTimers();
    let transport: AbortSignal | undefined;
    const fetchImpl: typeof fetch = (_url, init) => {
      transport = init?.signal ?? undefined;
      return new Promise(() => {});
    };
    const primary = new DeepSeekProvider({ apiKey: 'synthetic', fetchImpl, timeoutMs: 20 });
    const fallback = vi.fn(async () => result);
    const runtime = new AgentRuntime({ primary, fallback: provider(fallback) });
    const pending = runtime
      .completeText(request, { deadlineMs: Date.now() + 5 })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5);
    expect(await pending).toBeInstanceOf(RuntimeDeadlineError);
    expect(transport?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(20);
    expect(fallback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('structured fallback commit failures also propagate without another attempt', async () => {
    const commit = vi.fn(() => {
      throw new Error('caller failed');
    });
    const fallback = vi.fn(async () => result);
    const runtime = new AgentRuntime({
      primary: provider(async () => {
        throw new ProviderError('offline', 'fake', 'offline');
      }),
      fallback: provider(fallback),
    });
    await expect(runtime.executeStructured(data, request, { commit })).rejects.toThrow(
      'caller failed',
    );
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
