import { describe, expect, it, vi } from 'vitest';
import { MockAIProvider } from './mock-provider';
import { DeepSeekProvider } from './deepseek-provider';
import { ProviderError } from './errors';
import { completeWithFallback, createProviderSelection } from './registry';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('MockAIProvider', () => {
  const provider = new MockAIProvider();

  it('is offline and therefore always available', () => {
    expect(provider.offline).toBe(true);
    expect(provider.id).toBe('mock');
  });

  it('is deterministic for the same request', async () => {
    const request = { prompt: 'explain red-black trees' };
    const [a, b] = await Promise.all([provider.complete(request), provider.complete(request)]);
    expect(a.text).toBe(b.text);
  });

  it('separates different prompts', async () => {
    const a = await provider.complete({ prompt: 'alpha' });
    const b = await provider.complete({ prompt: 'beta' });
    expect(a.text).not.toBe(b.text);
  });

  it('takes the system prompt into account', async () => {
    const a = await provider.complete({ prompt: 'same', system: 'A' });
    const b = await provider.complete({ prompt: 'same', system: 'B' });
    expect(a.text).not.toBe(b.text);
  });

  it('always returns non-empty text and zero synthetic latency', async () => {
    const result = await provider.complete({ prompt: 'anything' });
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.latencyMs).toBe(0);
    expect(result.providerId).toBe('mock');
  });
});

describe('DeepSeekProvider configuration', () => {
  it('rejects a missing API key', () => {
    expect(() => new DeepSeekProvider({ apiKey: '' })).toThrow(ProviderError);
  });

  it('is never constructed from the environment without a key', () => {
    expect(DeepSeekProvider.fromEnvironment({})).toBeNull();
    expect(DeepSeekProvider.fromEnvironment({ FOCUSLOOP_DEEPSEEK_API_KEY: '   ' })).toBeNull();
  });

  it('is constructed when the environment supplies a key', () => {
    const provider = DeepSeekProvider.fromEnvironment({
      FOCUSLOOP_DEEPSEEK_API_KEY: 'test-key',
    });
    expect(provider).not.toBeNull();
    expect(provider?.offline).toBe(false);
    expect(provider?.model).toBe('deepseek-chat');
  });
});

describe('DeepSeekProvider requests', () => {
  it('returns the completion text and model on success', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ model: 'deepseek-chat', choices: [{ message: { content: 'hello' } }] }),
    );
    const provider = new DeepSeekProvider({
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await provider.complete({ prompt: 'hi' });
    expect(result.text).toBe('hello');
    expect(result.model).toBe('deepseek-chat');
    expect(result.providerId).toBe('deepseek');
  });

  it('sends the key in the authorization header and never in the body', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
    );
    const provider = new DeepSeekProvider({
      apiKey: 'secret-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await provider.complete({ prompt: 'hi' });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer secret-key');
    expect(String(init.body)).not.toContain('secret-key');
  });

  it('maps 401 to unauthorized without leaking the key', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'nope' }, 401));
    const provider = new DeepSeekProvider({
      apiKey: 'secret-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(provider.complete({ prompt: 'hi' })).rejects.toMatchObject({
      reason: 'unauthorized',
    });
    try {
      await provider.complete({ prompt: 'hi' });
    } catch (error) {
      expect((error as Error).message).not.toContain('secret-key');
    }
  });

  it('maps 429 to rate-limited', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 429));
    const provider = new DeepSeekProvider({
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(provider.complete({ prompt: 'hi' })).rejects.toMatchObject({
      reason: 'rate-limited',
    });
  });

  it('treats an empty completion as a bad response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: '' } }] }));
    const provider = new DeepSeekProvider({
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(provider.complete({ prompt: 'hi' })).rejects.toMatchObject({
      reason: 'bad-response',
    });
  });

  it('maps a network TypeError to offline', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const provider = new DeepSeekProvider({
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(provider.complete({ prompt: 'hi' })).rejects.toMatchObject({ reason: 'offline' });
  });

  it('maps an abort to timeout', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    const provider = new DeepSeekProvider({
      apiKey: 'k',
      timeoutMs: 5,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(provider.complete({ prompt: 'hi' })).rejects.toMatchObject({ reason: 'timeout' });
  });
});

describe('degraded mode', () => {
  it('uses the mock provider when no primary is configured', async () => {
    const selection = createProviderSelection(null);
    const result = await completeWithFallback(selection, { prompt: 'x' });
    expect(result.degraded).toBe(false);
    expect(result.providerId).toBe('mock');
  });

  it('falls back to the mock provider when the primary fails', async () => {
    const failing = {
      id: 'deepseek',
      model: 'deepseek-chat',
      offline: false,
      complete: async () => {
        throw new ProviderError('offline', 'deepseek', 'no network');
      },
    };
    const selection = createProviderSelection(failing);
    const result = await completeWithFallback(selection, { prompt: 'x' });
    expect(result.degraded).toBe(true);
    expect(result.providerId).toBe('mock');
    expect(result.failure?.reason).toBe('offline');
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('never throws when the primary fails in an unexpected way', async () => {
    const failing = {
      id: 'deepseek',
      model: 'deepseek-chat',
      offline: false,
      complete: async () => {
        throw 'not-an-error';
      },
    };
    const result = await completeWithFallback(createProviderSelection(failing), { prompt: 'x' });
    expect(result.degraded).toBe(true);
    expect(result.failure?.reason).toBe('bad-response');
  });
});
