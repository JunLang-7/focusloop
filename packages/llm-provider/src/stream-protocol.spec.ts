import { afterEach, expect, it, vi } from 'vitest';
import type {
  CompletionRequest,
  CompletionResult,
  RuntimeRequestData,
} from '@focusloop/shared-types';
import { AgentRuntime } from './runtime';
import { DeepSeekProvider } from './deepseek-provider';
import { MockAIProvider } from './mock-provider';
import type { ExecutableAIProvider } from './execution';
import type { ProviderStreamEvent } from './streaming';

const enc = new TextEncoder();
const delta = (text: string, model = 'actual') =>
  `data: ${JSON.stringify({ model, choices: [{ delta: { content: text } }] })}\n\n`;
const end = 'data: [DONE]\n\n';
const data: RuntimeRequestData = {
  skill: 'fixture',
  schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
  contextBudget: 100,
  tokenBudget: 8,
};
function fixture(raw?: string, status = 200) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel,
  });
  const fetchImpl = vi.fn<typeof fetch>(
    async () => new Response(body, { status, headers: { 'content-type': 'text/event-stream' } }),
  );
  if (raw !== undefined) {
    controller.enqueue(enc.encode(raw));
    controller.close();
  }
  const primary = new DeepSeekProvider({ apiKey: 'synthetic', fetchImpl });
  const fallback = new MockAIProvider();
  const runtime = new AgentRuntime({ primary, fallback });
  return { controller, cancel, fetchImpl, primary, fallback, runtime };
}
async function tick() {
  for (let n = 0; n < 30; n++) await Promise.resolve();
}
afterEach(() => vi.useRealTimers());

it('detailed events expose accurate model, caps, selected usage and no opaque data', async () => {
  const t = fixture(
    delta('ok') +
      'data: {"model":"actual","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7,"opaque":"private"}}\n\n' +
      end,
  );
  const events = [];
  for await (const event of t.runtime.streamEvents({ prompt: 'q' }, { budgets: data }))
    events.push(event);
  expect(events[0]).toMatchObject({
    type: 'text',
    text: 'ok',
    providerId: 'deepseek',
    model: 'actual',
    degraded: false,
    mode: 'provider',
  });
  expect(events[1]).toMatchObject({
    type: 'complete',
    result: {
      model: 'actual',
      budget: {
        inputCharacters: 1,
        effectiveMaxTokens: 8,
        usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
      },
    },
  });
  expect(JSON.stringify(events)).not.toContain('private');
});
it.each([401, 403, 429, 500])(
  'HTTP %i fails before text and records fallback origin/reason',
  async (status) => {
    const t = fixture(undefined, status);
    const events = [];
    for await (const event of t.runtime.streamEvents({ prompt: 'q' })) events.push(event);
    expect(t.cancel).toHaveBeenCalledOnce();
    expect(events[0]).toMatchObject({ providerId: 'mock', degraded: true });
    expect(events.at(-1)).toMatchObject({
      type: 'complete',
      result: {
        failure: {
          reason:
            status === 429 ? 'rate-limited' : status === 500 ? 'bad-response' : 'unauthorized',
          providerId: 'deepseek',
        },
      },
    });
  },
);
it.each([0, -1, NaN, Infinity, 65537])(
  'invalid accumulation guard %s rejects before fetch',
  async (limit) => {
    const t = fixture();
    expect(() => t.runtime.streamText({ prompt: 'q' }, { maxOutputCharacters: limit })).toThrow(
      RangeError,
    );
    expect(t.fetchImpl).not.toHaveBeenCalled();
  },
);
it('accumulation guard rejects the crossing fragment before yielding it', async () => {
  const t = fixture(delta('aa') + delta('bb') + end);
  const fallback = vi.spyOn(t.fallback, 'complete');
  const stream = t.runtime.streamText({ prompt: 'q' }, { maxOutputCharacters: 3 });
  expect(await stream.next()).toMatchObject({ value: 'aa' });
  await expect(stream.next()).rejects.toMatchObject({ reason: 'bad-response' });
  expect(fallback).not.toHaveBeenCalled();
});
it('many individually small frames cannot exceed the total assembly ceiling', async () => {
  const t = fixture(Array.from({ length: 17 }, () => delta('x'.repeat(4000))).join('') + end);
  let count = 0;
  await expect(
    (async () => {
      for await (const chunk of t.runtime.streamText({ prompt: 'q' })) count += chunk.length;
    })(),
  ).rejects.toMatchObject({ reason: 'bad-response' });
  expect(count).toBe(64000);
});
it('malformed UTF-8 is a bad response, not an offline/network failure', async () => {
  const t = fixture();
  t.controller.enqueue(Uint8Array.from([100, 97, 116, 97, 58, 32, 255, 10, 10]));
  t.controller.close();
  await expect(t.primary.stream({ prompt: 'q' }).next()).rejects.toMatchObject({
    reason: 'bad-response',
  });
});
it('multiline data, role-only delta and DONE without a final newline are accepted', async () => {
  const t = fixture(
    'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n' +
      'data: {"choices":\ndata: [{"delta":{"content":"ok"}}]}\n\n' +
      'data: [DONE]',
  );
  let text = '';
  for await (const part of t.runtime.streamText({ prompt: 'q' })) text += part;
  expect(text).toBe('ok');
});
it('model changes after first text cannot silently change provenance', async () => {
  const t = fixture(delta('first') + delta('second', 'different') + end);
  const stream = t.runtime.streamText({ prompt: 'q' });
  await stream.next();
  await expect(stream.next()).rejects.toMatchObject({ reason: 'bad-response' });
});
it('a success event releases timers/readers even if the consumer never requests EOF', async () => {
  vi.useFakeTimers();
  const t = fixture(delta('ok') + end);
  const stream = t.runtime.streamEvents({ prompt: 'q' }, { deadlineMs: Date.now() + 100 });
  await stream.next();
  expect(await stream.next()).toMatchObject({ value: { type: 'complete' } });
  await tick();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(101);
  expect(await stream.next()).toMatchObject({ done: true });
});
it('structured stream cancellation retains actual model and never commits a syntactically complete prefix', async () => {
  const t = fixture();
  const abort = new AbortController();
  const commit = vi.fn();
  const pending = t.runtime.executeStructuredViaStream(
    data,
    { prompt: 'q' },
    { signal: abort.signal, commit },
  );
  t.controller.enqueue(enc.encode(delta('{"answer":"ok"}')));
  await tick();
  abort.abort();
  expect(await pending).toMatchObject({
    status: 'aborted',
    providerId: 'deepseek',
    model: 'actual',
    degraded: false,
  });
  expect(commit).not.toHaveBeenCalled();
  expect(t.cancel).toHaveBeenCalledOnce();
});
it('structured stream absolute expiration never commits or falls back', async () => {
  vi.useFakeTimers();
  const t = fixture();
  const commit = vi.fn();
  const fallback = vi.spyOn(t.fallback, 'complete');
  const pending = t.runtime.executeStructuredViaStream(
    { ...data, deadlineMs: Date.now() + 10 },
    { prompt: 'q' },
    { commit },
  );
  t.controller.enqueue(enc.encode(delta('{"answer":"ok"}')));
  await vi.advanceTimersByTimeAsync(10);
  expect(await pending).toMatchObject({ status: 'expired', degraded: false });
  expect(commit).not.toHaveBeenCalled();
  expect(fallback).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it('one schema retry then validated fallback use the identical bounded request', async () => {
  const seen: CompletionRequest[] = [];
  const provider = (id: string, text: string): ExecutableAIProvider => ({
    id,
    model: 'fixture',
    offline: true,
    complete: vi.fn(),
    async *stream(request) {
      seen.push(request);
      const raw: CompletionResult = { text, providerId: id, model: 'fixture', latencyMs: 0 };
      yield { type: 'text', text, providerId: id, model: 'fixture' };
      yield { type: 'complete', result: raw };
    },
  });
  const commit = vi.fn();
  const r = new AgentRuntime({
    primary: provider('primary', '{}'),
    fallback: provider('fallback', '{"answer":"local"}'),
  });
  expect(
    await r.executeStructuredViaStream(
      data,
      { system: 'schema', prompt: 'whole question', maxTokens: 3, seed: 7, temperature: 0 },
      { commit },
    ),
  ).toMatchObject({ status: 'degraded', value: { answer: 'local' }, providerId: 'fallback' });
  expect(seen).toHaveLength(3);
  expect(seen.every((request) => request === seen[0] && Object.isFrozen(request))).toBe(true);
  expect(seen[0]).toEqual({
    system: 'schema',
    prompt: 'whole question',
    maxTokens: 3,
    seed: 7,
    temperature: 0,
  });
  expect(commit).toHaveBeenCalledOnce();
});
it('a failed caller commit propagates without stream retry/fallback or duplicate commit', async () => {
  const t = fixture(delta('{"answer":"ok"}') + end);
  const commit = vi.fn(() => {
    throw new Error('caller failure');
  });
  const fallback = vi.spyOn(t.fallback, 'complete');
  await expect(
    t.runtime.executeStructuredViaStream(data, { prompt: 'q' }, { commit }),
  ).rejects.toThrow('caller failure');
  expect(commit).toHaveBeenCalledOnce();
  expect(t.fetchImpl).toHaveBeenCalledOnce();
  expect(fallback).not.toHaveBeenCalled();
});
it.each(['mismatch', 'after-final'])(
  'invalid provider terminal protocol %s is not accepted',
  async (kind) => {
    const primary: ExecutableAIProvider = {
      id: 'fake',
      model: 'fake-model',
      offline: true,
      complete: vi.fn(),
      async *stream(): AsyncGenerator<ProviderStreamEvent> {
        yield { type: 'text', text: 'first', providerId: 'fake', model: 'fake-model' };
        yield {
          type: 'complete',
          result: {
            text: kind === 'mismatch' ? 'other' : 'first',
            providerId: 'fake',
            model: 'fake-model',
            latencyMs: 0,
          },
        };
        if (kind === 'after-final')
          yield { type: 'text', text: 'unexpected', providerId: 'fake', model: 'fake-model' };
      },
    };
    const stream = new AgentRuntime({ primary, fallback: new MockAIProvider() }).streamText({
      prompt: 'q',
    });
    await stream.next();
    await expect(stream.next()).rejects.toMatchObject({ reason: 'bad-response' });
  },
);
it('direct adapter receives an absolute deadline even in a fast comment-only parser loop', async () => {
  vi.useFakeTimers();
  const start = Date.now();
  let reads = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      reads++;
      vi.setSystemTime(start + reads);
      c.enqueue(enc.encode(': ping\n\n'));
    },
  });
  const primary = new DeepSeekProvider({
    apiKey: 'synthetic',
    fetchImpl: vi.fn<typeof fetch>(
      async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    ),
  });
  await expect(
    primary.stream({ prompt: 'q' }, { deadlineMs: start + 5 }).next(),
  ).rejects.toMatchObject({ reason: 'timeout' });
  expect(reads).toBeLessThan(10);
  expect(body.locked).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
