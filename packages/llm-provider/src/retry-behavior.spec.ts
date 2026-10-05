import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type {
  CompletionRequest,
  CompletionResult,
  ProviderFailureReason,
  RuntimeRequestData,
} from '@focusloop/shared-types';
import { AgentRuntime } from './runtime';
import { completeWithFallback } from './registry';
import { ProviderError } from './errors';
import { ExecutionAbortError, RuntimeDeadlineError, type ExecutableAIProvider } from './execution';
import type { ProviderStreamEvent } from './streaming';

/*
 * These cases deliberately describe the *policy* the runtime must obey and pass a plain literal
 * policy: on unchanged production code the extra constructor argument is ignored, so a missing
 * retry is a genuine behavioural failure rather than a missing-symbol import error.
 */
interface RetrySleepControls {
  readonly signal?: AbortSignal;
  readonly deadlineMs?: number;
}
interface PolicyLiteral {
  readonly maxTransportAttempts: number;
  readonly maxSchemaAttempts: number;
  readonly maxModelCalls: number;
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;
  readonly sleep: Mock<(ms: number, controls: RetrySleepControls) => Promise<void>>;
}

const policy = (overrides: Partial<PolicyLiteral> = {}): PolicyLiteral => ({
  maxTransportAttempts: 2,
  maxSchemaAttempts: 2,
  maxModelCalls: 4,
  baseBackoffMs: 10,
  maxBackoffMs: 40,
  sleep: vi.fn<(ms: number, controls: RetrySleepControls) => Promise<void>>(async () => undefined),
  ...overrides,
});

const request: CompletionRequest = { prompt: 'q', maxTokens: 4 };
const data: RuntimeRequestData = {
  skill: 'retry-fixture',
  contextBudget: 100,
  tokenBudget: 8,
  schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
};

type Outcome = ProviderFailureReason | { readonly text: string };

function scripted(
  id: string,
  outcomes: readonly Outcome[],
  options: { readonly streaming?: boolean } = {},
) {
  let cursor = 0;
  let callCount = 0;
  const next = (): Outcome => outcomes[Math.min(cursor, outcomes.length - 1)] ?? 'offline';
  const complete = vi.fn<ExecutableAIProvider['complete']>(async () => {
    callCount += 1;
    const outcome = next();
    cursor += 1;
    if (typeof outcome === 'string') throw new ProviderError(outcome, id, `${outcome} from ${id}`);
    return { text: outcome.text, providerId: id, model: `${id}-model`, latencyMs: 0 };
  });
  const provider: ExecutableAIProvider = { id, model: `${id}-model`, offline: false, complete };
  if (options.streaming === true) {
    provider.stream = async function* (): AsyncGenerator<ProviderStreamEvent> {
      callCount += 1;
      const outcome = next();
      cursor += 1;
      if (typeof outcome === 'string')
        throw new ProviderError(outcome, id, `${outcome} from ${id}`);
      const text = outcome.text;
      const result: CompletionResult = { text, providerId: id, model: `${id}-model`, latencyMs: 0 };
      yield { type: 'text', text, providerId: id, model: `${id}-model` };
      yield { type: 'complete', result };
    };
  }
  return { provider, complete, calls: (): number => callCount };
}

async function collect(source: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const part of source) text += part;
  return text;
}

afterEach(() => vi.useRealTimers());

describe('retryable transport failures retry the same provider within the attempt limit', () => {
  it('retries a timeout once and keeps the primary identity', async () => {
    const primary = scripted('primary', ['timeout', { text: 'recovered' }]);
    const fallback = scripted('fallback', [{ text: 'local' }]);
    const retry = policy();
    const result = await new AgentRuntime(
      { primary: primary.provider, fallback: fallback.provider },
      { retry },
    ).completeText(request);
    expect(result).toMatchObject({ text: 'recovered', providerId: 'primary', degraded: false });
    expect(primary.calls()).toBe(2);
    expect(fallback.calls()).toBe(0);
    expect(retry.sleep).toHaveBeenCalledTimes(1);
    expect(retry.sleep).toHaveBeenCalledWith(10, expect.anything());
  });

  it('backs off exponentially for a rate-limited provider and caps the delay', async () => {
    const primary = scripted('primary', ['rate-limited', 'rate-limited', { text: 'ok' }]);
    const fallback = scripted('fallback', [{ text: 'local' }]);
    const retry = policy({ maxTransportAttempts: 3, baseBackoffMs: 10, maxBackoffMs: 15 });
    const result = await new AgentRuntime(
      { primary: primary.provider, fallback: fallback.provider },
      { retry },
    ).completeText(request);
    expect(primary.calls()).toBe(3);
    expect(fallback.calls()).toBe(0);
    expect(result.attempts).toBe(3);
    expect(retry.sleep.mock.calls.map(([ms]) => ms)).toEqual([10, 15]);
  });

  it('does not retry a bad response, because it is a deterministic contract violation', async () => {
    const primary = scripted('primary', ['bad-response', { text: 'ignored' }]);
    const fallback = scripted('fallback', [{ text: 'local' }]);
    const runtime = new AgentRuntime(
      { primary: primary.provider, fallback: fallback.provider },
      { retry: policy() },
    );
    const result = await runtime.completeText(request);
    expect(primary.calls()).toBe(1);
    expect(fallback.calls()).toBe(1);
    expect(result).toMatchObject({ text: 'local', degraded: true, providerId: 'fallback' });
    expect(result.failures).toEqual([
      expect.objectContaining({ reason: 'bad-response', providerId: 'primary' }),
    ]);
  });
});

describe('terminal configuration failures never get a retry or a backoff sleep', () => {
  it.each(['unauthorized', 'not-configured'] as const)(
    '%s goes straight to fallback',
    async (reason) => {
      const primary = scripted('primary', [reason, { text: 'ignored' }]);
      const fallback = scripted('fallback', [{ text: 'local' }]);
      const retry = policy();
      const result = await new AgentRuntime(
        { primary: primary.provider, fallback: fallback.provider },
        { retry },
      ).completeText(request);
      expect(primary.calls()).toBe(1);
      expect(fallback.calls()).toBe(1);
      expect(retry.sleep).not.toHaveBeenCalled();
      expect(result).toMatchObject({ degraded: true, text: 'local' });
      expect(result.attempts).toBe(2);
    },
  );
});

describe('cancellation and the absolute deadline bound retries', () => {
  it('never starts another call after the caller cancels during backoff', async () => {
    const controller = new AbortController();
    const primary = scripted('primary', ['timeout', { text: 'must not happen' }]);
    const fallback = scripted('fallback', [{ text: 'local' }]);
    const retry = policy({
      sleep: vi.fn<(ms: number, controls: RetrySleepControls) => Promise<void>>(async () => {
        controller.abort();
      }),
    });
    const runtime = new AgentRuntime(
      { primary: primary.provider, fallback: fallback.provider },
      { retry },
    );
    const error: unknown = await runtime
      .completeText(request, { signal: controller.signal })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ExecutionAbortError);
    expect(primary.calls()).toBe(1);
    expect(fallback.calls()).toBe(0);
  });

  it('does not sleep when the backoff would cross the absolute deadline', async () => {
    const primary = scripted('primary', ['timeout', { text: 'must not happen' }]);
    const fallback = scripted('fallback', [{ text: 'local' }]);
    const retry = policy();
    const runtime = new AgentRuntime(
      { primary: primary.provider, fallback: fallback.provider },
      { retry },
    );
    const error: unknown = await runtime
      .completeText(request, { deadlineMs: Date.now() + 5 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RuntimeDeadlineError);
    expect(retry.sleep).not.toHaveBeenCalled();
    expect(primary.calls()).toBe(1);
    expect(fallback.calls()).toBe(0);
  });

  it('stops with expiration when the deadline passes during a started backoff', async () => {
    vi.useFakeTimers();
    const primary = scripted('primary', ['timeout', { text: 'must not happen' }]);
    const fallback = scripted('fallback', [{ text: 'local' }]);
    // The delay itself fits inside the deadline, so the pause starts and then overshoots it.
    const retry = policy({
      sleep: vi.fn<(ms: number, controls: RetrySleepControls) => Promise<void>>(async (ms) => {
        vi.setSystemTime(Date.now() + ms * 10);
      }),
    });
    const runtime = new AgentRuntime(
      { primary: primary.provider, fallback: fallback.provider },
      { retry },
    );
    const error: unknown = await runtime
      .completeText(request, { deadlineMs: Date.now() + 50 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RuntimeDeadlineError);
    expect(retry.sleep).toHaveBeenCalledTimes(1);
    expect(primary.calls()).toBe(1);
    expect(fallback.calls()).toBe(0);
  });
});

describe('exhaustion and the combined bound keep exactly one required local fallback', () => {
  it('reports exhaustion after retrying the primary and calling the local fallback once', async () => {
    const primary = scripted('primary', ['offline']);
    const fallback = scripted('fallback', ['offline']);
    const retry = policy({ maxTransportAttempts: 2, maxModelCalls: 3 });
    const runtime = new AgentRuntime(
      { primary: primary.provider, fallback: fallback.provider },
      { retry },
    );
    const error: unknown = await runtime.completeText(request).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderError);
    expect(primary.calls()).toBe(2);
    expect(fallback.calls()).toBe(1);
    expect(retry.sleep).toHaveBeenCalledTimes(1);
  });

  it('forwards provenance for every failed attempt without inventing a provider', async () => {
    const primary = scripted('primary', ['timeout', 'rate-limited']);
    const fallback = scripted('fallback', [{ text: 'local' }]);
    const result = await new AgentRuntime(
      { primary: primary.provider, fallback: fallback.provider },
      { retry: policy() },
    ).completeText(request);
    expect(result.attempts).toBe(3);
    expect(result.failures.map((failure) => [failure.providerId, failure.reason])).toEqual([
      ['primary', 'timeout'],
      ['primary', 'rate-limited'],
    ]);
    expect(JSON.stringify(result)).not.toContain('sleep');
  });

  it('the registry entry point takes the same policy and retries the primary', async () => {
    const primary = scripted('primary', ['offline', { text: 'recovered' }]);
    const fallback = scripted('fallback', [{ text: 'local' }]);
    const result = await completeWithFallback(
      { primary: primary.provider, fallback: fallback.provider },
      request,
      undefined,
      policy(),
    );
    expect(result).toMatchObject({ text: 'recovered', attempts: 2, degraded: false });
    expect(fallback.calls()).toBe(0);
  });
});

describe('structured schema and transport retries share one combined bound', () => {
  it('retries an invalid schema with the same request and commits the fallback once', async () => {
    const primary = scripted('primary', [{ text: '{}' }]);
    const fallback = scripted('fallback', [{ text: '{"answer":"local"}' }]);
    const commit = vi.fn();
    const runtime = new AgentRuntime(
      { primary: primary.provider, fallback: fallback.provider },
      { retry: policy() },
    );
    const result = await runtime.executeStructured<{ answer: string }>(data, request, { commit });
    expect(result).toMatchObject({ status: 'degraded', value: { answer: 'local' }, attempts: 3 });
    expect(primary.calls()).toBe(2);
    expect(fallback.calls()).toBe(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('recovers a transport failure inside the structured path without the fallback', async () => {
    const primary = scripted('primary', ['timeout', { text: '{"answer":"primary"}' }]);
    const fallback = scripted('fallback', [{ text: '{"answer":"local"}' }]);
    const commit = vi.fn();
    const result = await new AgentRuntime(
      { primary: primary.provider, fallback: fallback.provider },
      { retry: policy() },
    ).executeStructured<{ answer: string }>(data, request, { commit });
    expect(result).toMatchObject({
      status: 'ok',
      value: { answer: 'primary' },
      attempts: 2,
      degraded: false,
    });
    expect(fallback.calls()).toBe(0);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('stops at the combined model-call bound even when nesting schema and transport retries', async () => {
    const primary = scripted('primary', ['timeout']);
    const fallback = scripted('fallback', ['timeout']);
    const runtime = new AgentRuntime(
      { primary: primary.provider, fallback: fallback.provider },
      { retry: policy({ maxTransportAttempts: 3, maxSchemaAttempts: 3, maxModelCalls: 4 }) },
    );
    const result = await runtime.executeStructured(data, request);
    expect(result).toMatchObject({ status: 'degraded', degraded: true });
    expect(result.value).toBeUndefined();
    expect(primary.calls() + fallback.calls()).toBe(4);
    expect(primary.calls()).toBeLessThanOrEqual(3);
    expect(fallback.calls()).toBeGreaterThanOrEqual(1);
  });
});

describe('streaming keeps the retry rules of the streaming contract', () => {
  it('retries a pre-text stream failure and then streams from the same provider', async () => {
    const primary = scripted('primary', ['offline', { text: 'streamed' }], { streaming: true });
    const fallback = scripted('fallback', [{ text: 'local' }]);
    const runtime = new AgentRuntime(
      { primary: primary.provider, fallback: fallback.provider },
      { retry: policy() },
    );
    expect(await collect(runtime.streamText(request))).toBe('streamed');
    expect(primary.calls()).toBe(2);
    expect(fallback.calls()).toBe(0);
  });

  it('never retries or falls back after text was emitted', async () => {
    let calls = 0;
    const primary: ExecutableAIProvider = {
      id: 'primary',
      model: 'primary-model',
      offline: false,
      complete: vi.fn(),
      async *stream(): AsyncGenerator<ProviderStreamEvent> {
        calls += 1;
        yield { type: 'text', text: 'first', providerId: 'primary', model: 'primary-model' };
        throw new ProviderError('offline', 'primary', 'dropped after text');
      },
    };
    const fallback = scripted('fallback', [{ text: 'local' }]);
    const runtime = new AgentRuntime({ primary, fallback: fallback.provider }, { retry: policy() });
    const stream = runtime.streamText(request);
    expect(await stream.next()).toMatchObject({ value: 'first' });
    await expect(stream.next()).rejects.toMatchObject({ reason: 'offline' });
    expect(calls).toBe(1);
    expect(fallback.calls()).toBe(0);
  });

  it('bounds a failing stream by the combined call budget before using the local fallback', async () => {
    const primary = scripted('primary', ['timeout'], { streaming: true });
    const fallback = scripted('fallback', [{ text: 'local' }]);
    const runtime = new AgentRuntime(
      { primary: primary.provider, fallback: fallback.provider },
      { retry: policy({ maxTransportAttempts: 2, maxModelCalls: 3 }) },
    );
    expect(await collect(runtime.streamText(request))).toBe('local');
    expect(primary.calls()).toBe(2);
    expect(fallback.calls()).toBe(1);
  });
});

describe('the offline golden path is unchanged by the retry policy', () => {
  it('the default policy never retries a healthy offline provider', async () => {
    const primary = scripted('primary', [{ text: 'offline answer' }]);
    const fallback = scripted('fallback', [{ text: 'local' }]);
    const runtime = new AgentRuntime({ primary: primary.provider, fallback: fallback.provider });
    const result = await runtime.completeText(request);
    expect(result).toMatchObject({ text: 'offline answer', attempts: 1, degraded: false });
    expect(result.failures).toEqual([]);
    expect(primary.calls()).toBe(1);
    expect(fallback.calls()).toBe(0);
  });
});
