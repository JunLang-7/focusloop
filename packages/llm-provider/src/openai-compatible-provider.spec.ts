import { describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider } from './openai-compatible-provider';

function success() {
  return new Response(
    JSON.stringify({ model: 'actual-model', choices: [{ message: { content: 'OK' } }] }),
    { headers: { 'content-type': 'application/json' } },
  );
}
describe('OpenAI-compatible adapter', () => {
  it('sends the chosen model and canonical gateway endpoint, with no redirects', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => success());
    const provider = new OpenAICompatibleProvider({
      providerId: 'mimo-gateway',
      model: 'mimo-v2.6-flash',
      apiKey: 'SECRET',
      baseUrl: 'https://gateway.example/prefix/v1/',
      fetchImpl,
    });
    const result = await provider.complete({ prompt: 'hi' });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://gateway.example/prefix/v1/chat/completions');
    expect(init?.redirect).toBe('error');
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'mimo-v2.6-flash' });
    expect(String(init?.body)).not.toContain('SECRET');
    expect(result).toMatchObject({ providerId: 'mimo-gateway', model: 'actual-model', text: 'OK' });
  });
  it('respects capability flags and output limits', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => success());
    const provider = new OpenAICompatibleProvider({
      providerId: 'openai',
      model: 'model',
      apiKey: 'key',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl,
      capabilities: {
        tokenParameter: 'max_completion_tokens',
        maxOutputTokens: 128,
        supportsTemperature: false,
        supportsSeed: false,
      },
    });
    await provider.complete({ prompt: 'hi', maxTokens: 1000, temperature: 0, seed: 42 });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.max_completion_tokens).toBe(128);
    expect(body.max_tokens).toBeUndefined();
    expect(body.seed).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });
  it('streams with the selected provider identity through the same transport', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        }),
    );
    const provider = new OpenAICompatibleProvider({
      providerId: 'custom',
      model: 'my-model',
      apiKey: 'key',
      baseUrl: 'http://localhost:8080/v1',
      fetchImpl,
    });
    const events = [];
    for await (const event of provider.stream({ prompt: 'hi' })) events.push(event);
    expect(events[0]).toMatchObject({
      type: 'text',
      providerId: 'custom',
      model: 'my-model',
      text: 'OK',
    });
    expect(events[1]).toMatchObject({
      type: 'complete',
      result: { providerId: 'custom', model: 'my-model' },
    });
    expect(fetchImpl.mock.calls[0]?.[1]?.redirect).toBe('error');
  });
  it('does not expose raw errors or response bodies containing secrets', async () => {
    const provider = new OpenAICompatibleProvider({
      providerId: 'custom',
      model: 'model',
      apiKey: 'SECRET',
      baseUrl: 'https://example.com/v1',
      fetchImpl: async () => {
        throw new Error('SECRET leaked by transport');
      },
    });
    await expect(provider.complete({ prompt: 'hi' })).rejects.toMatchObject({
      message: 'Invalid provider response',
      reason: 'bad-response',
      providerId: 'custom',
    });
  });
});
