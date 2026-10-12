import { describe, expect, it, vi } from 'vitest';
import { fetchModelList } from './model-discovery';
const connection = {
  providerId: 'custom',
  baseUrl: 'https://gateway.example/prefix/v1',
  apiKey: 'SECRET',
};
describe('model discovery', () => {
  it('fetches a normalized endpoint and exposes only model metadata', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: 'model-a', display_name: 'Model A', apiKey: 'SECRET' },
              { id: 'model-a' },
              { id: 'model-b' },
              { id: '' },
              { id: 3 },
            ],
          }),
        ),
    );
    expect(await fetchModelList({ ...connection, fetchImpl })).toEqual([
      { id: 'model-a', displayName: 'model-a' },
      { id: 'model-b', displayName: 'model-b' },
    ]);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://gateway.example/prefix/v1/models');
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      redirect: 'error',
      headers: { authorization: 'Bearer SECRET' },
    });
  });
  it.each([
    [401, 'unauthorized'],
    [429, 'rate-limited'],
    [404, 'bad-response'],
  ] as const)(
    'classifies status %s without fallback or response-body leakage',
    async (status, reason) => {
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response('SECRET', { status }));
      await expect(fetchModelList({ ...connection, fetchImpl })).rejects.toMatchObject({
        reason,
        message: 'Model discovery failed',
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );
  it.each([null, {}, { data: {} }, { data: Array(4097).fill({ id: 'model' }) }])(
    'rejects malformed/unbounded lists',
    async (data) => {
      await expect(
        fetchModelList({
          ...connection,
          fetchImpl: async () => new Response(JSON.stringify(data)),
        }),
      ).rejects.toMatchObject({ reason: 'bad-response' });
    },
  );
  it('permits empty lists for manual model entry and bounds the picker', async () => {
    expect(
      await fetchModelList({ ...connection, fetchImpl: async () => new Response('{"data":[]}') }),
    ).toEqual([]);
    const models = await fetchModelList({
      ...connection,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ data: Array.from({ length: 600 }, (_, i) => ({ id: `model-${i}` })) }),
        ),
    });
    expect(models).toHaveLength(512);
  });
});
