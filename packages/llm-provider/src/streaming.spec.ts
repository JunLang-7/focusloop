import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompletionResult, RuntimeRequestData } from '@focusloop/shared-types';
import { AgentRuntime } from './runtime';
import { DeepSeekProvider } from './deepseek-provider';
import { MockAIProvider } from './mock-provider';
import { ProviderError } from './errors';
import type { ExecutableAIProvider } from './execution';

const encode = new TextEncoder();
const frame = (text: string) =>
  `data: ${JSON.stringify({ model: 'actual-model', choices: [{ delta: { content: text } }] })}\r\n\r\n`;
const done = 'data: [DONE]\n\n';
const result = (text: string): CompletionResult => ({
  text,
  providerId: 'fake',
  model: 'fake-model',
  latencyMs: 0,
});
const data: RuntimeRequestData = {
  skill: 'fixture',
  contextBudget: 100,
  tokenBudget: 8,
  schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
};
function transport() {
  let body!: ReadableStreamDefaultController<Uint8Array>;
  let signal: AbortSignal | undefined;
  const cancel = vi.fn();
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        body = controller;
      },
      cancel,
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
  const fetchImpl = vi.fn<typeof fetch>(async (_url, options) => {
    signal = options?.signal ?? undefined;
    return response;
  });
  const adapter = new DeepSeekProvider({ apiKey: 'synthetic', fetchImpl });
  return { adapter, body, cancel, response, fetchImpl, signal: () => signal };
}
function ready(raw: string) {
  const t = transport();
  t.body.enqueue(encode.encode(raw));
  t.body.close();
  return t;
}
function runtime(primary: ExecutableAIProvider) {
  const fallback = new MockAIProvider();
  return { runtime: new AgentRuntime({ primary, fallback }), fallback };
}
async function tick() {
  for (let n = 0; n < 30; n++) await Promise.resolve();
}
async function collect(source: AsyncIterable<string>) {
  let text = '';
  for await (const part of source) text += part;
  return text;
}
afterEach(() => vi.useRealTimers());

describe('real provider streaming regression', () => {
  it('yields first text before body completion and sends stream:true with the bounded cap', async () => {
    const t = transport();
    const r = runtime(t.adapter).runtime;
    const stream = r.streamText(
      { prompt: 'q', maxTokens: 99 },
      { budgets: { contextBudget: 10, tokenBudget: 8 } },
    );
    let first: IteratorResult<string, unknown> | undefined;
    const pending = stream.next().then((value) => {
      first = value;
    });
    t.body.enqueue(encode.encode(frame('hello')));
    try {
      await tick();
      expect(first).toMatchObject({ done: false, value: 'hello' });
      const wire = JSON.parse(String(t.fetchImpl.mock.calls[0]?.[1]?.body)) as Record<
        string,
        unknown
      >;
      expect(wire).toMatchObject({ stream: true, max_tokens: 8 });
    } finally {
      t.body.close();
      await pending;
      await stream.return(undefined);
    }
  });
  it('assembles byte-split UTF-8 and CRLF, comments/empty frames, usage and DONE', async () => {
    const t = transport();
    const stream = runtime(t.adapter).runtime.streamText({ prompt: 'q' });
    const output = collect(stream);
    for (const byte of encode.encode(
      ': ping\r\n\r\ndata:\n\n' +
        frame('中😀') +
        'data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}\n\n' +
        done,
    ))
      t.body.enqueue(Uint8Array.of(byte));
    t.body.close();
    expect(await output).toBe('中😀');
    expect(t.response.body?.locked).toBe(false);
  });
  it.each([
    'data: not-json\n\n',
    'data: {}\n\n',
    'data: {"choices":[{"delta":{"content":3}}]}\n\n',
    'data: ' + 'x'.repeat(65537),
    'data: {"choices":[]}\n\n',
  ])('pre-text malformed/incomplete primary degrades without leaking payload %#', async (raw) => {
    const t = ready(raw);
    const { runtime: r, fallback } = runtime(t.adapter);
    expect(await collect(r.streamText({ prompt: 'q' }))).toBe(
      (await fallback.complete({ prompt: 'q' })).text,
    );
    expect(r.degraded).toBe(true);
    expect(t.response.body?.locked).toBe(false);
  });
  it.each([
    '',
    'data: not-json\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
    'data: {"choices":[],"usage":{"completion_tokens":9}}\n\n' + done,
  ])('post-text failure never splices in fallback %#', async (tail) => {
    const t = ready(frame('first') + tail);
    const fallback = new MockAIProvider();
    const spy = vi.spyOn(fallback, 'complete');
    const r = new AgentRuntime({ primary: t.adapter, fallback });
    const stream = r.streamText({ prompt: 'q' }, { budgets: data });
    expect(await stream.next()).toMatchObject({ value: 'first', done: false });
    await expect(stream.next()).rejects.toBeInstanceOf(ProviderError);
    expect(spy).not.toHaveBeenCalled();
  });
  it('abandoning a pending next releases fetch/reader without waiting for its next chunk', async () => {
    const t = transport();
    const stream = runtime(t.adapter).runtime.streamText({ prompt: 'q' });
    const pending = stream.next().catch((error: unknown) => error);
    await tick();
    const closing = stream.return(undefined);
    await tick();
    try {
      expect(t.signal()?.aborted).toBe(true);
      expect(t.cancel).toHaveBeenCalledTimes(1);
    } finally {
      if (!t.signal()?.aborted) t.body.close();
      await pending;
      await closing;
    }
    expect(t.response.body?.locked).toBe(false);
  });
  it('caller abort while paused after a fragment releases resources without another next', async () => {
    const t = transport();
    const controller = new AbortController();
    const stream = runtime(t.adapter).runtime.streamText(
      { prompt: 'q' },
      { signal: controller.signal },
    );
    t.body.enqueue(encode.encode(frame('first')));
    await stream.next();
    controller.abort();
    await tick();
    expect(t.signal()?.aborted).toBe(true);
    expect(t.cancel).toHaveBeenCalledTimes(1);
    expect(await stream.next()).toEqual({ done: true, value: undefined });
    expect(t.response.body?.locked).toBe(false);
  });
  it('absolute deadline expires during an idle consumer pause and never completes/commits', async () => {
    vi.useFakeTimers();
    const t = transport();
    const deadlineMs = Date.now() + 10;
    const stream = runtime(t.adapter).runtime.streamText({ prompt: 'q' }, { deadlineMs });
    t.body.enqueue(encode.encode(frame('first')));
    await stream.next();
    await vi.advanceTimersByTimeAsync(10);
    expect(t.signal()?.aborted).toBe(true);
    await expect(stream.next()).rejects.toMatchObject({ reason: 'timeout' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('structured partial JSON cannot commit and is not retried/fallen back after interruption', async () => {
    const t = ready(frame('{"answer":"looks complete"}'));
    const fallback = new MockAIProvider();
    const spy = vi.spyOn(fallback, 'complete');
    const commit = vi.fn();
    const r = new AgentRuntime({ primary: t.adapter, fallback });
    const outcome = await r.executeStructuredViaStream(data, { prompt: 'q' }, { commit });
    expect(outcome.value).toBeUndefined();
    expect(commit).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });
  it('structured completion validates only after DONE and commits once', async () => {
    const t = transport();
    const commit = vi.fn();
    const pending = runtime(t.adapter).runtime.executeStructuredViaStream<{ answer: string }>(
      data,
      { prompt: 'q' },
      { commit },
    );
    t.body.enqueue(encode.encode(frame('{"answer":"ok"}')));
    await tick();
    expect(commit).not.toHaveBeenCalled();
    t.body.enqueue(encode.encode(done));
    t.body.close();
    expect(await pending).toMatchObject({
      status: 'ok',
      value: { answer: 'ok' },
      providerId: 'deepseek',
      model: 'actual-model',
    });
    expect(commit).toHaveBeenCalledTimes(1);
  });
  it('structured pre-text failure may use a complete-only compatible fallback, with accurate origin', async () => {
    const t = ready('data: invalid\n\n');
    const fallback: ExecutableAIProvider = {
      id: 'fake',
      model: 'fake-model',
      offline: true,
      complete: vi.fn(async () => result('{"answer":"local"}')),
    };
    const outcome = await new AgentRuntime({
      primary: t.adapter,
      fallback,
    }).executeStructuredViaStream(data, { prompt: 'q' });
    expect(outcome).toMatchObject({
      status: 'degraded',
      value: { answer: 'local' },
      providerId: 'fake',
    });
  });
  it('offline stream is deterministic and real adapters do not use complete()', async () => {
    const t = ready(frame('ok') + done);
    const spy = vi.spyOn(t.adapter, 'complete');
    expect(await collect(runtime(t.adapter).runtime.streamText({ prompt: 'q' }))).toBe('ok');
    expect(spy).not.toHaveBeenCalled();
    const mock = new MockAIProvider();
    const r = runtime(mock).runtime;
    expect(await collect(r.streamText({ prompt: 'same' }))).toBe(
      (await mock.complete({ prompt: 'same' })).text,
    );
  });
});
