import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AIProvider,
  CompletionRequest,
  CompletionResult,
  RuntimeRequestData,
} from '@focusloop/shared-types';
import { AgentRuntime, type RuntimeExecutionOptions } from './runtime';
import { DeepSeekProvider } from './deepseek-provider';
import { ProviderError } from './errors';
import { ExecutionAbortError, isExecutionAbort, RuntimeDeadlineError } from './execution';
import { completeWithFallback } from './registry';

const valid = {
  text: '{"answer":"local step"}',
  providerId: 'test',
  model: 'test-model',
  latencyMs: 0,
};
const request: CompletionRequest = { prompt: 'current task' };
const data: RuntimeRequestData = {
  skill: 'test',
  schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
  contextBudget: 100,
  tokenBudget: 50,
};

function provider(
  complete: (
    request: CompletionRequest,
    options?: RuntimeExecutionOptions,
  ) => Promise<CompletionResult>,
): AIProvider {
  return { id: 'test', model: 'test-model', offline: true, complete };
}

function deferred() {
  let release!: (value: CompletionResult) => void;
  const promise = new Promise<CompletionResult>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const structuredMethods = ['executeStructured', 'executeStructuredViaStream'] as const;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('runtime cancellation and total deadline', () => {
  it('forwards cancellation to provider work without launching a fallback on a late rejection', async () => {
    let seen: AbortSignal | undefined;
    let reject!: (error: Error) => void;
    const primary = provider((_request, options) => {
      seen = options?.signal;
      return new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise;
      });
    });
    const fallback = vi.fn(async () => valid);
    const controller = new AbortController();
    const runtime = new AgentRuntime({ primary, fallback: provider(fallback) });
    const result = runtime
      .completeText(request, { signal: controller.signal })
      .catch((error: unknown) => error);
    controller.abort();
    reject(new ProviderError('offline', 'test', 'late network failure'));
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(seen?.aborted).toBe(true);
    await Promise.resolve();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('cancels fallback work after a provider-local timeout', async () => {
    let seen: AbortSignal | undefined;
    const pending = deferred();
    const controller = new AbortController();
    const runtime = new AgentRuntime({
      primary: provider(async () => {
        throw new ProviderError('timeout', 'test', 'provider timeout');
      }),
      fallback: provider((_request, options) => {
        seen = options?.signal;
        return pending.promise;
      }),
    });
    const result = runtime
      .completeText(request, { signal: controller.signal })
      .catch((error: unknown) => error);
    await vi.waitFor(() => expect(seen).toBeDefined());
    controller.abort();
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(seen?.aborted).toBe(true);
    pending.release(valid);
  });

  it('a deadline at now starts neither the primary nor fallback', async () => {
    vi.useFakeTimers();
    const primary = vi.fn(async () => valid);
    const fallback = vi.fn(async () => valid);
    const runtime = new AgentRuntime({ primary: provider(primary), fallback: provider(fallback) });
    const result = runtime
      .completeText(request, { deadlineMs: Date.now() })
      .catch((error: unknown) => error);
    expect(await result).toMatchObject({ reason: 'timeout' });
    expect(primary).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('expiration aborts a non-cooperative primary and does not launch fallback', async () => {
    vi.useFakeTimers();
    const pending = deferred();
    let seen: AbortSignal | undefined;
    const fallback = vi.fn(async () => valid);
    const runtime = new AgentRuntime({
      primary: provider((_request, options) => {
        seen = options?.signal;
        return pending.promise;
      }),
      fallback: provider(fallback),
    });
    const result = runtime
      .completeText(request, { deadlineMs: Date.now() + 10 })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);
    expect(await result).toMatchObject({ reason: 'timeout' });
    expect(seen?.aborted).toBe(true);
    pending.release(valid);
    await Promise.resolve();
    expect(fallback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  for (const method of structuredMethods) {
    it(`${method}: expiration during fallback never commits a late value`, async () => {
      vi.useFakeTimers();
      const pending = deferred();
      let seen: AbortSignal | undefined;
      const fallback = vi.fn((_request: CompletionRequest, options?: RuntimeExecutionOptions) => {
        seen = options?.signal;
        return pending.promise;
      });
      const commit = vi.fn();
      const runtime = new AgentRuntime(
        {
          primary: provider(async () => {
            throw new ProviderError('timeout', 'test', 'local timeout');
          }),
          fallback: provider(fallback),
        },
        // This case measures the deadline crossing *inside* the fallback, so it pins one transport
        // attempt to keep the fallback reachable; retry/deadline interplay lives in retry-behavior.
        { retry: { maxTransportAttempts: 1 } },
      );
      const result = runtime[method]({ ...data, deadlineMs: Date.now() + 10 }, request, { commit });
      await vi.advanceTimersByTimeAsync(0);
      expect(fallback).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10);
      pending.release(valid);
      expect(await result).toMatchObject({ status: 'expired', degraded: false });
      expect(seen?.aborted).toBe(true);
      expect(commit).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it(`${method}: no schema retry or fallback starts after the deadline`, async () => {
      vi.useFakeTimers();
      const deadlineMs = Date.now() + 10;
      const primary = vi.fn(async () => {
        vi.setSystemTime(deadlineMs);
        return { ...valid, text: 'invalid JSON' };
      });
      const fallback = vi.fn(async () => valid);
      const runtime = new AgentRuntime({
        primary: provider(primary),
        fallback: provider(fallback),
      });
      const result = await runtime[method]({ ...data, deadlineMs }, request);
      expect(result.status).toBe('expired');
      expect(primary).toHaveBeenCalledTimes(1);
      expect(fallback).not.toHaveBeenCalled();
    });

    it(`${method}: a signal aborted as the response completes prevents commit`, async () => {
      const controller = new AbortController();
      const commit = vi.fn();
      const fallback = vi.fn(async () => valid);
      const runtime = new AgentRuntime({
        primary: provider(async () => {
          controller.abort();
          return valid;
        }),
        fallback: provider(fallback),
      });
      expect(
        await runtime[method](data, request, { signal: controller.signal, commit }),
      ).toMatchObject({ status: 'aborted' });
      expect(commit).not.toHaveBeenCalled();
      expect(fallback).not.toHaveBeenCalled();
    });
  }

  it('pre-aborted registry calls do no provider work', async () => {
    const controller = new AbortController();
    controller.abort();
    const primary = vi.fn(async () => valid);
    const fallback = vi.fn(async () => valid);
    // The process-local optional argument must not enter CompletionRequest/shared data.
    const complete: (
      selection: { primary: AIProvider; fallback: AIProvider },
      request: CompletionRequest,
      options?: RuntimeExecutionOptions,
    ) => Promise<CompletionResult> = completeWithFallback;
    const result = await complete(
      { primary: provider(primary), fallback: provider(fallback) },
      request,
      { signal: controller.signal },
    ).catch((error: unknown) => error);
    expect(result).toMatchObject({ name: 'AbortError' });
    expect(primary).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });
});

describe('DeepSeek transport cancellation', () => {
  it('pre-aborted calls never fetch', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => new Response('{"choices":[{"message":{"content":"ok"}}]}'));
    const adapter = new DeepSeekProvider({ apiKey: 'synthetic-key', fetchImpl });
    const complete: (
      request: CompletionRequest,
      options?: RuntimeExecutionOptions,
    ) => Promise<CompletionResult> = adapter.complete.bind(adapter);
    expect(
      await complete(request, { signal: controller.signal }).catch((error: unknown) => error),
    ).toMatchObject({ name: 'AbortError' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('caller cancellation reaches response body consumption and releases controls', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    let seen: AbortSignal | undefined;
    let bodyStarted = false;
    const fetchImpl: typeof fetch = async (_url, init) => {
      seen = init?.signal ?? undefined;
      return {
        ok: true,
        json: () => {
          bodyStarted = true;
          return new Promise((_resolve, reject) => {
            seen?.addEventListener(
              'abort',
              () => reject(new DOMException('aborted', 'AbortError')),
              { once: true },
            );
          });
        },
      } as Response;
    };
    const adapter = new DeepSeekProvider({ apiKey: 'synthetic-key', fetchImpl });
    const complete: (
      request: CompletionRequest,
      options?: RuntimeExecutionOptions,
    ) => Promise<CompletionResult> = adapter.complete.bind(adapter);
    const result = complete(request, { signal: controller.signal }).catch(
      (error: unknown) => error,
    );
    await Promise.resolve();
    expect(bodyStarted).toBe(true);
    controller.abort();
    // Must settle on cancellation without advancing to the provider's 20-second timeout.
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(seen?.aborted).toBe(true);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('a provider that aborts its own transport is a provider failure', () => {
  /*
   * The caller's signal is untouched here: this is an adapter bounding its own work, not the
   * learner cancelling. It used to be classified as `AbortError`, which skipped the fallback and
   * left `streamText` emitting no chunks at all - the opposite of "it always resolves".
   */
  const selfAbort = (): Promise<CompletionResult> =>
    Promise.reject(new DOMException('adapter budget exhausted', 'AbortError'));

  it('degrades completeText to the deterministic fallback', async () => {
    const fallback = vi.fn(async () => valid);
    const runtime = new AgentRuntime({
      primary: provider(selfAbort),
      fallback: provider(fallback),
    });
    const result = await runtime.completeText(request);
    expect(result.degraded).toBe(true);
    expect(result.failure).not.toBeNull();
    expect(result.text).toBe(valid.text);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('reports a degraded structured result rather than an aborted one', async () => {
    const fallback = vi.fn(async () => valid);
    const runtime = new AgentRuntime({
      primary: provider(selfAbort),
      fallback: provider(fallback),
    });
    const result = await runtime.executeStructured(data, request);
    expect(result).toMatchObject({ status: 'degraded', degraded: true });
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('still classifies deliberate cancellation and the deadline by class, not by name', () => {
    expect(isExecutionAbort(new ExecutionAbortError())).toBe(true);
    expect(new RuntimeDeadlineError('test')).toBeInstanceOf(ProviderError);
  });
});

describe('expiration on the text paths', () => {
  it('rejects when the deadline passes during the fallback instead of returning it', async () => {
    vi.useFakeTimers();
    const pending = deferred();
    let seen: AbortSignal | undefined;
    const runtime = new AgentRuntime(
      {
        primary: provider(async () => {
          throw new ProviderError('offline', 'test', 'offline');
        }),
        fallback: provider((_request, options) => {
          seen = options?.signal;
          return pending.promise;
        }),
      },
      // As above: the fallback must start, so the primary is not given a transport retry here.
      { retry: { maxTransportAttempts: 1 } },
    );
    const result = runtime
      .completeText(request, { deadlineMs: Date.now() + 10 })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toBeDefined();
    await vi.advanceTimersByTimeAsync(10);
    expect(await result).toBeInstanceOf(RuntimeDeadlineError);
    expect(seen?.aborted).toBe(true);
    pending.release(valid);
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects between fragments instead of truncating the story quietly', async () => {
    vi.useFakeTimers();
    const long = { ...valid, text: 'x'.repeat(150) };
    const runtime = new AgentRuntime({
      primary: provider(async () => long),
      fallback: provider(async () => valid),
    });
    const chunks: string[] = [];
    const iterate = (async () => {
      for await (const chunk of runtime.streamText(request, { deadlineMs: Date.now() + 5 })) {
        chunks.push(chunk);
        await vi.advanceTimersByTimeAsync(5);
      }
    })().catch((error: unknown) => error);
    expect(await iterate).toBeInstanceOf(RuntimeDeadlineError);
    expect(chunks).toHaveLength(1);
  });
});
