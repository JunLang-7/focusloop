import { describe, expect, it, vi } from 'vitest';
import type {
  CompletionRequest,
  CompletionResult,
  RuntimeRequestData,
} from '@focusloop/shared-types';
import { AgentRuntime } from './runtime';
import { completeWithFallback } from './registry';
import { ProviderError } from './errors';
import { DeepSeekProvider } from './deepseek-provider';
import type { ExecutableAIProvider } from './execution';

const data = (): RuntimeRequestData => ({
  skill: 'synthetic',
  contextBudget: 20,
  tokenBudget: 8,
  schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
});
const response = (text = '{"answer":"ok"}'): CompletionResult => ({
  text,
  providerId: 'fake',
  model: 'fake',
  latencyMs: 0,
});
function provider(complete: ExecutableAIProvider['complete']): ExecutableAIProvider {
  return { id: 'fake', model: 'fake', offline: true, complete };
}
const paths = ['text', 'stream', 'structured', 'structured-stream'] as const;
async function call(
  path: (typeof paths)[number],
  runtime: AgentRuntime,
  request: CompletionRequest,
  budgets = data(),
) {
  if (path === 'text') return runtime.completeText(request, { budgets });
  if (path === 'stream') {
    const chunks: string[] = [];
    for await (const chunk of runtime.streamText(request, { budgets })) chunks.push(chunk);
    return chunks;
  }
  return path === 'structured'
    ? runtime.executeStructured(budgets, request)
    : runtime.executeStructuredViaStream(budgets, request);
}

describe('one runtime budget boundary', () => {
  for (const path of paths) {
    it(`${path}: rejects over-budget system + prompt before any provider work`, async () => {
      const primary = vi.fn<ExecutableAIProvider['complete']>(async () => response());
      const fallback = vi.fn<ExecutableAIProvider['complete']>(async () => response());
      const runtime = new AgentRuntime({
        primary: provider(primary),
        fallback: provider(fallback),
      });
      const request = { system: 's'.repeat(10), prompt: 'current question' };
      await expect(call(path, runtime, request)).rejects.toMatchObject({
        code: 'context-budget-exceeded',
      });
      expect(primary).not.toHaveBeenCalled();
      expect(fallback).not.toHaveBeenCalled();
      expect(request.prompt).toBe('current question');
    });
    it(`${path}: preserves the question/schema and the stricter caller cap at equality`, async () => {
      const primary = vi.fn<ExecutableAIProvider['complete']>(async () => response());
      const runtime = new AgentRuntime({
        primary: provider(primary),
        fallback: provider(async () => response()),
      });
      const request = { system: 's'.repeat(19), prompt: 'q', maxTokens: 3 };
      await call(path, runtime, request);
      expect(primary.mock.calls[0]?.[0]).toEqual(request);
      expect(request.maxTokens).toBe(3);
    });
    for (const [field, invalids] of [
      ['contextBudget', [undefined, null, -1, NaN, Infinity, 1.5]],
      ['tokenBudget', [undefined, null, 0, -1, NaN, Infinity, 1.5]],
    ] as const) {
      it.each(invalids)(`${path}: rejects invalid ${field}=%s without fallback`, async (bad) => {
        const primary = vi.fn<ExecutableAIProvider['complete']>(async () => response());
        const fallback = vi.fn<ExecutableAIProvider['complete']>(async () => response());
        const runtime = new AgentRuntime({
          primary: provider(primary),
          fallback: provider(fallback),
        });
        // Deliberately malformed data arriving at the public boundary.
        const budgets = { ...data(), [field]: bad } as unknown as RuntimeRequestData;
        await expect(call(path, runtime, { prompt: 'q' }, budgets)).rejects.toBeInstanceOf(
          RangeError,
        );
        expect(primary).not.toHaveBeenCalled();
        expect(fallback).not.toHaveBeenCalled();
      });
    }
    it.each([0, -1, NaN, Infinity, 1.5])(
      `${path}: invalid maxTokens=%s cannot be masked by a smaller runtime cap`,
      async (maxTokens) => {
        const primary = vi.fn<ExecutableAIProvider['complete']>(async () => response());
        const fallback = vi.fn<ExecutableAIProvider['complete']>(async () => response());
        const runtime = new AgentRuntime({
          primary: provider(primary),
          fallback: provider(fallback),
        });
        await expect(call(path, runtime, { prompt: 'q', maxTokens })).rejects.toBeInstanceOf(
          RangeError,
        );
        expect(primary).not.toHaveBeenCalled();
        expect(fallback).not.toHaveBeenCalled();
      },
    );
  }
  for (const method of ['executeStructured', 'executeStructuredViaStream'] as const) {
    it(`${method}: primary, schema retry and fallback share an immutable bounded snapshot`, async () => {
      const seen: CompletionRequest[] = [];
      const complete = async (request: CompletionRequest) => {
        seen.push(request);
        Reflect.set(request, 'maxTokens', 999);
        return response('invalid JSON');
      };
      const fallback = async (request: CompletionRequest) => {
        seen.push(request);
        return response();
      };
      const runtime = new AgentRuntime({
        primary: provider(complete),
        fallback: provider(fallback),
      });
      const request = { prompt: 'q', maxTokens: 100, seed: 1, temperature: 0.3 };
      const commit = vi.fn();
      const result = await runtime[method](data(), request, { commit });
      expect(result.status).toBe('degraded');
      expect(commit).toHaveBeenCalledTimes(1);
      expect(seen).toHaveLength(3);
      for (const sent of seen) {
        expect(sent).toEqual({ ...request, maxTokens: 8 });
        expect(Object.isFrozen(sent)).toBe(true);
      }
      expect(seen[0]).toBe(seen[1]);
      expect(seen[1]).toBe(seen[2]);
      expect(request.maxTokens).toBe(100);
    });
  }
  it('stream completion exposes final numeric budget metadata without committing text fragments', async () => {
    const runtime = new AgentRuntime({
      primary: provider(async () => response('fragment')),
      fallback: provider(async () => response()),
    });
    const iterator = runtime.streamText({ prompt: 'q' }, { budgets: data() });
    expect(await iterator.next()).toEqual({ done: false, value: 'fragment' });
    expect(await iterator.next()).toMatchObject({
      done: true,
      value: { effectiveMaxTokens: 8, inputCharacters: 1 },
    });
  });
  it('cancellation after the last fragment does not produce a successful final report', async () => {
    const controller = new AbortController();
    const runtime = new AgentRuntime({
      primary: provider(async () => response('fragment')),
      fallback: provider(async () => response()),
    });
    const iterator = runtime.streamText(
      { prompt: 'q' },
      { budgets: data(), signal: controller.signal },
    );
    await iterator.next();
    controller.abort();
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
  });
  it('registry text fallback also receives the same bounded snapshot', async () => {
    const seen: CompletionRequest[] = [];
    const primary = provider(async (request) => {
      seen.push(request);
      Reflect.set(request, 'maxTokens', 999);
      throw new ProviderError('offline', 'fake', 'offline');
    });
    const fallback = provider(async (request) => {
      seen.push(request);
      return response();
    });
    await completeWithFallback(
      { primary, fallback },
      { prompt: 'q', maxTokens: 100 },
      { budgets: data() },
    );
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[1]?.maxTokens).toBe(8);
  });
  it('reports UTF-16 input characters separately from caps and provider-reported token usage', async () => {
    const runtime = new AgentRuntime({
      primary: provider(async () => ({
        ...response(),
        usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
      })),
      fallback: provider(async () => response()),
    });
    const result = await runtime.completeText(
      { system: '😀', prompt: '中', maxTokens: 3 },
      { budgets: data() },
    );
    expect(result).toMatchObject({
      budget: {
        contextBudget: 20,
        tokenBudget: 8,
        callerMaxTokens: 3,
        effectiveMaxTokens: 3,
        inputCharacters: 3,
        characterUnit: 'utf16-code-units',
        usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
      },
    });
    expect(JSON.stringify(result.budget)).not.toContain('😀');
  });
  it('allows a zero-character budget only for an empty input and supplies a missing caller cap', async () => {
    const primary = vi.fn<ExecutableAIProvider['complete']>(async () => response());
    const runtime = new AgentRuntime({
      primary: provider(primary),
      fallback: provider(async () => response()),
    });
    await runtime.completeText(
      { system: '', prompt: '' },
      { budgets: { contextBudget: 0, tokenBudget: 1 } },
    );
    expect(primary.mock.calls[0]?.[0]).toEqual({ system: '', prompt: '', maxTokens: 1 });
  });
  it('legacy text calls have explicit finite defaults without widening an existing caller cap', async () => {
    const primary = vi.fn<ExecutableAIProvider['complete']>(async () => response());
    const runtime = new AgentRuntime({
      primary: provider(primary),
      fallback: provider(async () => response()),
    });
    const result = await runtime.completeText({ prompt: 'q', maxTokens: 2048 });
    expect(result).toMatchObject({
      budget: { contextBudget: 16384, tokenBudget: 4096, effectiveMaxTokens: 2048 },
    });
    expect(primary.mock.calls[0]?.[0]?.maxTokens).toBe(2048);
  });
  it('does not invent actual token counts for the offline fallback', async () => {
    const runtime = new AgentRuntime({
      primary: provider(async () => {
        throw new ProviderError('offline', 'fake', 'offline');
      }),
      fallback: provider(async () => response()),
    });
    const result = await runtime.executeStructured(data(), { prompt: 'q', maxTokens: 2 });
    expect(result).toMatchObject({
      status: 'degraded',
      budget: { effectiveMaxTokens: 2, inputCharacters: 1 },
    });
    expect(result.budget?.usage).toBeUndefined();
  });
  it('a provider-reported output overshoot cannot be committed as a valid structured answer', async () => {
    const commit = vi.fn();
    const runtime = new AgentRuntime({
      primary: provider(async () => ({ ...response(), usage: { outputTokens: 9 } })),
      fallback: provider(async () => response('{"answer":"fallback"}')),
    });
    const result = await runtime.executeStructured(data(), { prompt: 'q' }, { commit });
    expect(result.status).toBe('degraded');
    expect(result.value).toEqual({ answer: 'fallback' });
    expect(commit).toHaveBeenCalledExactlyOnceWith({ answer: 'fallback' });
  });
  it.each([null, {}, { contextBudget: 20 }, { tokenBudget: 8 }])(
    'a supplied malformed or partial text budget cannot silently use defaults %#',
    async (bad) => {
      const primary = vi.fn<ExecutableAIProvider['complete']>(async () => response());
      const runtime = new AgentRuntime({
        primary: provider(primary),
        fallback: provider(async () => response()),
      });
      await expect(
        runtime.completeText({ prompt: 'q' }, { budgets: bad as unknown as RuntimeRequestData }),
      ).rejects.toBeInstanceOf(RangeError);
      expect(primary).not.toHaveBeenCalled();
    },
  );
  it('sanitizes partial usage and drops opaque provider metadata without inventing totals', async () => {
    const runtime = new AgentRuntime({
      primary: provider(async () => ({
        ...response(),
        opaque: 'private-provider-field',
        usage: {
          inputTokens: 5,
          outputTokens: NaN,
          totalTokens: -1,
          secret: 'private-usage-field',
        },
      })),
      fallback: provider(async () => response()),
    });
    const result = await runtime.completeText({ prompt: 'q' });
    expect(result.usage).toEqual({ inputTokens: 5 });
    expect(result.budget.usage).toEqual({ inputTokens: 5 });
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('fallback token overshoot never commits, even when its JSON validates', async () => {
    const commit = vi.fn();
    const runtime = new AgentRuntime({
      primary: provider(async () => {
        throw new ProviderError('offline', 'fake', 'offline');
      }),
      fallback: provider(async () => ({ ...response(), usage: { outputTokens: 9 } })),
    });
    const result = await runtime.executeStructured(data(), { prompt: 'q' }, { commit });
    expect(result.status).toBe('degraded');
    expect(result.value).toBeUndefined();
    expect(commit).not.toHaveBeenCalled();
  });
  it('text provider overshoot degrades instead of returning an over-cap answer', async () => {
    const runtime = new AgentRuntime({
      primary: provider(async () => ({ ...response('over cap'), usage: { outputTokens: 9 } })),
      fallback: provider(async () => response('fallback')),
    });
    const result = await runtime.completeText({ prompt: 'q' }, { budgets: data() });
    expect(result).toMatchObject({
      text: 'fallback',
      degraded: true,
      failure: { reason: 'bad-response' },
    });
  });
  it('caller mutations during work cannot widen the fallback snapshot', async () => {
    const request = { prompt: 'q', maxTokens: 3 };
    const budgets = { contextBudget: 20, tokenBudget: 8 };
    const fallback = vi.fn<ExecutableAIProvider['complete']>(async () => response());
    const runtime = new AgentRuntime({
      primary: provider(async () => {
        request.prompt = 'changed question';
        request.maxTokens = 999;
        budgets.tokenBudget = 999;
        throw new ProviderError('offline', 'fake', 'offline');
      }),
      fallback: provider(fallback),
    });
    const result = await runtime.completeText(request, { budgets });
    expect(fallback.mock.calls[0]?.[0]).toEqual({ prompt: 'q', maxTokens: 3 });
    expect(result.budget).toMatchObject({
      tokenBudget: 8,
      effectiveMaxTokens: 3,
      inputCharacters: 1,
    });
  });
  it('over-budget errors expose counts, never the private question', async () => {
    const runtime = new AgentRuntime({
      primary: provider(async () => response()),
      fallback: provider(async () => response()),
    });
    const error: unknown = await runtime
      .completeText(
        { prompt: 'private question' },
        { budgets: { contextBudget: 1, tokenBudget: 1 } },
      )
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: 'context-budget-exceeded',
      report: { inputCharacters: 16 },
    });
    expect(JSON.stringify(error)).not.toContain('private');
  });
  it('does not coerce malformed request text or unsafe integer caps into valid requests', async () => {
    const primary = vi.fn<ExecutableAIProvider['complete']>(async () => response());
    const runtime = new AgentRuntime({
      primary: provider(primary),
      fallback: provider(async () => response()),
    });
    await expect(
      runtime.completeText({ prompt: null } as unknown as CompletionRequest),
    ).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(
      runtime.completeText({ prompt: 'q', system: 7 } as unknown as CompletionRequest),
    ).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(
      runtime.completeText({ prompt: 'q', maxTokens: Number.MAX_SAFE_INTEGER + 1 }),
    ).rejects.toMatchObject({ code: 'invalid-max-tokens' });
    await expect(
      runtime.completeText(
        { prompt: 'q' },
        { budgets: { contextBudget: Number.MAX_SAFE_INTEGER + 1, tokenBudget: 8 } },
      ),
    ).rejects.toMatchObject({ code: 'invalid-context-budget' });
    expect(primary).not.toHaveBeenCalled();
  });
  it('DeepSeek ignores invalid usage metadata without rejecting otherwise valid text', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'ok' } }],
            usage: { prompt_tokens: -1, completion_tokens: '2', total_tokens: 1.5 },
          }),
          { status: 200 },
        ),
    );
    const adapter = new DeepSeekProvider({ apiKey: 'synthetic', fetchImpl });
    const result = await adapter.complete({ prompt: 'q' });
    expect(result.text).toBe('ok');
    expect(result.usage).toBeUndefined();
  });
  it('DeepSeek exposes valid reported usage without treating character lengths as tokens', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '中' } }],
            usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
          }),
          { status: 200 },
        ),
    );
    const provider = new DeepSeekProvider({ apiKey: 'synthetic', fetchImpl });
    const result = await provider.complete({ prompt: 'q', maxTokens: 2 });
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 1, totalTokens: 11 });
  });
});
