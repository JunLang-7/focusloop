import { describe, expect, it, vi } from 'vitest';
import type {
  AIProvider,
  CompletionRequest,
  CompletionResult,
  RuntimeRequestData,
  RuntimeSchema,
} from '@focusloop/shared-types';
import { ProviderError } from './errors';
import { MockAIProvider } from './mock-provider';
import { AgentRuntime, createProviderSelection } from './index';

const SCHEMA: RuntimeSchema = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    confident: { type: 'boolean' },
  },
  required: ['answer'],
};

function data(overrides: Partial<RuntimeRequestData> = {}): RuntimeRequestData {
  return {
    skill: 'tutor',
    schema: SCHEMA,
    contextBudget: 4000,
    tokenBudget: 512,
    ...overrides,
  };
}

function request(prompt = 'q'): CompletionRequest {
  return { prompt, maxTokens: 128 };
}

function textProvider(
  id: string,
  text: string | (() => string),
  options: { offline?: boolean } = {},
): AIProvider {
  return {
    id,
    model: `${id}-model`,
    offline: options.offline ?? false,
    async complete(): Promise<CompletionResult> {
      return {
        text: typeof text === 'function' ? text() : text,
        providerId: id,
        model: `${id}-model`,
        latencyMs: 1,
      };
    },
  };
}

function failingProvider(id: string, error: ProviderError): AIProvider {
  return {
    id,
    model: `${id}-model`,
    offline: false,
    async complete(): Promise<CompletionResult> {
      throw error;
    },
  };
}

const VALID_JSON = JSON.stringify({ answer: 'because rotations', confident: true });

describe('AgentRuntime structured conformance', () => {
  it('success: validates once and commits exactly one value', async () => {
    const commit = vi.fn();
    const runtime = new AgentRuntime(createProviderSelection(textProvider('primary', VALID_JSON)));

    const result = await runtime.executeStructured(data(), request(), { commit });

    expect(result).toMatchObject({ status: 'ok', degraded: false, providerId: 'primary' });
    expect(result.value).toEqual({ answer: 'because rotations', confident: true });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(runtime.degraded).toBe(false);
  });

  it('malformed JSON: retries the primary once, then degrades to fallback', async () => {
    let calls = 0;
    const primary: AIProvider = {
      id: 'primary',
      model: 'primary-model',
      offline: false,
      async complete() {
        calls += 1;
        return { text: 'not-json', providerId: 'primary', model: 'primary-model', latencyMs: 1 };
      },
    };
    const commit = vi.fn();
    const runtime = new AgentRuntime({
      primary,
      fallback: textProvider('mock', VALID_JSON),
    });

    const result = await runtime.executeStructured(data(), request(), { commit });

    expect(calls).toBe(2); // retry once
    expect(result.status).toBe('degraded');
    expect(result.degraded).toBe(true);
    expect(result.value).toEqual({ answer: 'because rotations', confident: true });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(runtime.degraded).toBe(true);
  });

  it('timeout: degrades to fallback without committing invalid data', async () => {
    const commit = vi.fn();
    const selection = {
      primary: failingProvider('primary', new ProviderError('timeout', 'primary', 'too slow')),
      fallback: textProvider('mock', VALID_JSON),
    };
    const runtime = new AgentRuntime(selection);

    const result = await runtime.executeStructured(data(), request(), { commit });

    expect(result.status).toBe('degraded');
    expect(result.failureReason).toBe('timeout');
    expect(result.providerId).toBe('mock');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(runtime.degraded).toBe(true);
  });

  it('401 unauthorized degrades to fallback', async () => {
    const commit = vi.fn();
    const runtime = new AgentRuntime({
      primary: failingProvider('primary', new ProviderError('unauthorized', 'primary', 'nope')),
      fallback: textProvider('mock', VALID_JSON),
    });

    const result = await runtime.executeStructured(data(), request(), { commit });

    expect(result.status).toBe('degraded');
    expect(result.failureReason).toBe('unauthorized');
    expect(commit).toHaveBeenCalled();
  });

  it('rate limit degrades to fallback', async () => {
    const runtime = new AgentRuntime({
      primary: failingProvider('primary', new ProviderError('rate-limited', 'primary', '429')),
      fallback: textProvider('mock', VALID_JSON),
    });

    const result = await runtime.executeStructured(data(), request());

    expect(result.status).toBe('degraded');
    expect(result.failureReason).toBe('rate-limited');
  });

  it('abort mid-flight: nothing is committed, status is aborted', async () => {
    const commit = vi.fn();
    const controller = new AbortController();
    let release!: (value: CompletionResult) => void;
    const slow = new Promise<CompletionResult>((resolve) => {
      release = resolve;
    });
    const primary: AIProvider = {
      id: 'primary',
      model: 'primary-model',
      offline: false,
      complete: () => slow,
    };
    const runtime = new AgentRuntime({ primary, fallback: textProvider('mock', VALID_JSON) });

    const promise = runtime.executeStructured(data(), request(), {
      commit,
      signal: controller.signal,
    });
    controller.abort();
    release({
      text: VALID_JSON,
      providerId: 'primary',
      model: 'primary-model',
      latencyMs: 1,
    });

    const result = await promise;
    expect(result.status).toBe('aborted');
    expect(result.value).toBeUndefined();
    expect(commit).not.toHaveBeenCalled();
    expect(runtime.degraded).toBe(false);
  });

  it('abort before start never calls the provider', async () => {
    const complete = vi.fn();
    const primary: AIProvider = {
      id: 'primary',
      model: 'm',
      offline: false,
      complete: complete as unknown as AIProvider['complete'],
    };
    const runtime = new AgentRuntime({ primary, fallback: textProvider('mock', VALID_JSON) });
    const controller = new AbortController();
    controller.abort();

    const result = await runtime.executeStructured(data(), request(), {
      signal: controller.signal,
      commit: () => expect.unreachable('must not commit'),
    });

    expect(result.status).toBe('aborted');
    expect(complete).not.toHaveBeenCalled();
  });

  it('expired deadline refuses to start', async () => {
    const runtime = new AgentRuntime({
      primary: textProvider('primary', VALID_JSON),
      fallback: textProvider('mock', VALID_JSON),
    });

    const result = await runtime.executeStructured(data({ deadlineMs: Date.now() - 1 }), request());

    expect(result.status).toBe('expired');
  });
});

describe('AgentRuntime stream', () => {
  it('streams text in chunks and stays cancellable', async () => {
    const runtime = new AgentRuntime(createProviderSelection(new MockAIProvider()));
    const controller = new AbortController();
    const chunks: string[] = [];
    for await (const chunk of runtime.streamText(
      { prompt: 'stream me' },
      {
        signal: controller.signal,
      },
    )) {
      chunks.push(chunk);
      if (chunks.length === 1) controller.abort();
    }
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.length).toBeGreaterThan(0);
  });

  it('schema failure via stream: retry once, then degrade with visible reason', async () => {
    let calls = 0;
    const primary: AIProvider = {
      id: 'primary',
      model: 'primary-model',
      offline: false,
      async complete() {
        calls += 1;
        return {
          text: '{"answer": 42}',
          providerId: 'primary',
          model: 'primary-model',
          latencyMs: 1,
        };
      },
    };
    const commit = vi.fn();
    const runtime = new AgentRuntime({
      primary,
      fallback: textProvider('mock', VALID_JSON),
    });

    const result = await runtime.executeStructuredViaStream(data(), request(), { commit });

    expect(calls).toBe(2);
    expect(result.status).toBe('degraded');
    expect(result.degraded).toBe(true);
    expect(result.failureReason).toContain('answer');
    expect(result.value).toEqual({ answer: 'because rotations', confident: true });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('cancelling a stream stops the chunks', async () => {
    const controller = new AbortController();
    const runtime = new AgentRuntime(createProviderSelection(new MockAIProvider()));

    const chunks: string[] = [];
    for await (const chunk of runtime.streamText({ prompt: 'x' }, { signal: controller.signal })) {
      chunks.push(chunk);
      controller.abort();
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(runtime.degraded).toBe(false);
  });

  /*
   * The previous version of this test created a `commit` mock and never passed it to the runtime, so
   * `expect(commit).not.toHaveBeenCalled()` was true by construction — an assertion that could not
   * fail. Here the hook is attached, so a commit that ran before validation would be visible.
   */
  it('an aborted structured call never commits', async () => {
    const commit = vi.fn();
    const controller = new AbortController();
    const runtime = new AgentRuntime(createProviderSelection(new MockAIProvider()));

    controller.abort();
    const result = await runtime.executeStructuredViaStream(data(), request(), {
      signal: controller.signal,
      commit,
    });

    expect(result).toMatchObject({ status: 'aborted', degraded: false });
    expect(result.value).toBeUndefined();
    expect(commit).not.toHaveBeenCalled();
  });

  it('a fallback answer is reported as degraded, not as the primary model', async () => {
    const commit = vi.fn();
    const runtime = new AgentRuntime({
      primary: failingProvider('primary', new ProviderError('timeout', 'primary', 'too slow')),
      fallback: textProvider('mock', VALID_JSON),
    });

    const result = await runtime.executeStructuredViaStream(data(), request(), { commit });

    /*
     * The mock produced this value. Reporting `providerId: primary` with `degraded: false` credits the
     * model with the fallback's text — the "true about the wrong thing" defect the other paths already
     * avoid by reading provenance off the completion result rather than off `this.selection.primary`.
     */
    expect(result).toMatchObject({
      status: 'degraded',
      degraded: true,
      providerId: 'mock',
      model: 'mock-model',
    });
    expect(result.value).toEqual({ answer: 'because rotations', confident: true });
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

describe('AgentRuntime completeText', () => {
  it('keeps primary→mock fallback classification', async () => {
    const runtime = new AgentRuntime({
      primary: failingProvider('primary', new ProviderError('bad-response', 'primary', 'oops')),
      fallback: new MockAIProvider(),
    });

    const result = await runtime.completeText(request());
    expect(result.degraded).toBe(true);
    expect(result.failure?.reason).toBe('bad-response');
    expect(result.providerId).toBe('mock');
    expect(runtime.degraded).toBe(true);
  });

  it('reports healthy when primary succeeds', async () => {
    const runtime = new AgentRuntime(createProviderSelection(textProvider('primary', 'hello')));
    const result = await runtime.completeText(request());
    expect(result.degraded).toBe(false);
    expect(result.text).toBe('hello');
    expect(runtime.degraded).toBe(false);
  });
});

describe('validateRuntimeSchema', () => {
  it('rejects wrong types and unknown keys', async () => {
    const { validateRuntimeSchema } = await import('@focusloop/shared-types');
    expect(validateRuntimeSchema({ answer: 1 }, SCHEMA)).toContain(
      'property "answer" must be string',
    );
    expect(validateRuntimeSchema({ answer: 'x', extra: 1 }, SCHEMA)).toContain(
      'unexpected property "extra"',
    );
    expect(validateRuntimeSchema({}, SCHEMA)).toContain('missing required property "answer"');
    expect(validateRuntimeSchema({ answer: 'ok' }, SCHEMA)).toEqual([]);
  });
});
