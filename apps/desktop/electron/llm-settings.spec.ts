import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROVIDER_CONFIGS, type ProviderConfig } from '@focusloop/shared-types';
const keychain = vi.hoisted(() => ({ available: true }));
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => keychain.available,
    encryptString: (value: string) => Buffer.from(`v1:${Buffer.from(value).toString('base64')}`),
    decryptString: (buffer: Buffer) => {
      const text = buffer.toString();
      if (!text.startsWith('v1:')) throw new Error('bad');
      return Buffer.from(text.slice(3), 'base64').toString();
    },
  },
}));
const { LlmSettingsManager } = await import('./llm-settings');
const directories: string[] = [];
function setup(env: Record<string, string | undefined> = {}, fetchImpl?: typeof fetch) {
  const directory = mkdtempSync(join(tmpdir(), 'focusloop-llm-'));
  directories.push(directory);
  const values = new Map<string, string>();
  const store = {
    getMeta: (key: string) => values.get(key) ?? null,
    setMeta: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const options = { env, ...(fetchImpl === undefined ? {} : { fetchImpl }) };
  const manager = new LlmSettingsManager(store, directory, options);
  return {
    manager,
    directory,
    values,
    restart: () => new LlmSettingsManager(store, directory, options),
  };
}
const deepseek = DEFAULT_PROVIDER_CONFIGS[0]!;
const custom: ProviderConfig = {
  id: 'gateway',
  name: 'My Gateway',
  kind: 'openai-compatible',
  baseUrl: 'https://gateway.example/api/v1',
  models: [{ id: 'org/model', displayName: 'My model' }],
};
const selection = { providerConfigId: 'gateway', modelId: 'org/model' };
function response(status = 200) {
  return new Response(
    JSON.stringify(
      status === 200 ? { choices: [{ message: { content: 'OK' } }] } : { error: 'SECRET' },
    ),
    { status, headers: { 'content-type': 'application/json' } },
  );
}
afterEach(() => {
  keychain.available = true;
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('LLM configuration ownership', () => {
  it('starts offline with presets and no implicit requests', () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { manager } = setup({}, fetchImpl);
    expect(manager.snapshot().active).toBeNull();
    expect(manager.snapshot().providers.map((p) => p.id)).toEqual(['deepseek', 'openai']);
    expect(manager.selection().primary.offline).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('persists configuration and explicit selection, separately from credentials', () => {
    const { manager, restart, values, directory } = setup();
    manager.save({ provider: custom, apiKey: 'SECRET' });
    expect(manager.snapshot().active).toBeNull();
    manager.select(selection);
    const next = restart();
    expect(next.snapshot().active).toEqual(selection);
    expect(next.selection().primary).toMatchObject({
      id: 'gateway',
      model: 'org/model',
      offline: false,
    });
    expect(next.snapshot().providers.find((p) => p.id === 'gateway')).toMatchObject({
      keySource: 'stored',
      verifiedModels: [],
    });
    expect(JSON.stringify(next.snapshot())).not.toContain('SECRET');
    expect([...values.values()].join('')).not.toContain('SECRET');
    for (const file of readdirSync(directory))
      expect(readFileSync(join(directory, file)).includes('SECRET')).toBe(false);
  });
  it('retains configurations and explicit local-only mode across restart', () => {
    const { manager, restart } = setup({ FOCUSLOOP_DEEPSEEK_API_KEY: 'env' });
    expect(manager.selection().primary.id).toBe('deepseek');
    manager.select(null);
    expect(restart().selection().primary.offline).toBe(true);
    expect(restart().snapshot().providers[0]?.keySource).toBe('environment');
  });
  it('prefers environment credentials, but never sends them to an edited endpoint', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response());
    const { manager } = setup({ FOCUSLOOP_DEEPSEEK_API_KEY: 'ENV_SECRET' }, fetchImpl);
    manager.save({ provider: deepseek, apiKey: 'SAVED_SECRET' });
    expect(manager.activeSource()).toBe('environment');
    await manager.selection().primary.complete({ prompt: 'test' });
    expect((fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>)['authorization']).toBe(
      'Bearer ENV_SECRET',
    );
    manager.clearKey('deepseek');
    expect(manager.activeSource()).toBe('environment');
    manager.save({ provider: { ...deepseek, baseUrl: 'https://other.example/v1' } });
    expect(manager.snapshot().active).toBeNull();
    expect(manager.snapshot().providers[0]?.keySource).toBe('none');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('isolates multiple gateways and never reuses a key after changing URL', () => {
    const { manager, restart } = setup();
    manager.save({ provider: custom, apiKey: 'one' });
    manager.save({ provider: { ...custom, id: 'gateway2' }, apiKey: 'two' });
    manager.select(selection);
    manager.save({ provider: { ...custom, baseUrl: 'https://new.example/v1' } });
    expect(manager.snapshot().active).toBeNull();
    expect(manager.snapshot().providers.find((p) => p.id === 'gateway')?.keySource).toBe('none');
    expect(manager.snapshot().providers.find((p) => p.id === 'gateway2')?.keySource).toBe('stored');
    manager.save({ provider: custom });
    expect(
      restart()
        .snapshot()
        .providers.find((p) => p.id === 'gateway')?.keySource,
    ).toBe('none');
  });
  it('removing an active provider removes its key and switches to local', () => {
    const { manager, directory } = setup();
    manager.save({ provider: custom, apiKey: 'key' });
    manager.select(selection);
    manager.remove('gateway');
    expect(manager.selection().primary.offline).toBe(true);
    expect(manager.snapshot().providers.some((p) => p.id === 'gateway')).toBe(false);
    expect(readdirSync(directory)).toEqual([]);
  });
  it('clearing a key deactivates its model; missing models/keys cannot be selected', () => {
    const { manager } = setup();
    expect(() =>
      manager.select({ providerConfigId: 'deepseek', modelId: 'deepseek-chat' }),
    ).toThrow('API key');
    manager.save({ provider: custom, apiKey: 'key' });
    manager.select(selection);
    expect(() => manager.select({ ...selection, modelId: 'not-listed' })).toThrow('Model');
    manager.clearKey('gateway');
    expect(manager.snapshot().active).toBeNull();
    expect(manager.selection().primary.offline).toBe(true);
  });
  it('refuses insecure secret storage and leaves configuration unchanged', () => {
    const { manager, directory } = setup();
    keychain.available = false;
    expect(() => manager.save({ provider: custom, apiKey: 'SECRET' })).toThrow('unavailable');
    expect(manager.snapshot().providers).toHaveLength(2);
    expect(readdirSync(directory)).toEqual([]);
  });
  it('treats corrupt configuration as a local-first fresh setup', () => {
    const { values, restart } = setup();
    values.set('llm_settings', '{bad');
    expect(restart().selection().primary.offline).toBe(true);
    values.set(
      'llm_settings',
      JSON.stringify({ providers: [custom], active: { ...selection, modelId: 'missing' } }),
    );
    expect(restart().snapshot().active).toBeNull();
  });
  it('intentionally discards the old single-key file without migrating it', () => {
    const { directory, restart } = setup();
    writeFileSync(join(directory, 'model-key.bin'), 'old-key');
    expect(restart().selection().primary.offline).toBe(true);
    expect(readdirSync(directory)).toEqual([]);
  });
});

describe('model discovery before saving', () => {
  it('fetches models using a draft key without persisting secrets, configuration or selection', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ data: [{ id: 'org/model' }] })),
    );
    const { manager, values, directory } = setup({}, fetchImpl);
    expect(await manager.discover({ provider: custom, apiKey: 'SECRET' })).toEqual({
      ok: true,
      models: [{ id: 'org/model', displayName: 'org/model' }],
    });
    expect(values.size).toBe(0);
    expect(readdirSync(directory)).toEqual([]);
    expect(manager.snapshot().active).toBeNull();
    expect(manager.snapshot().providers).toHaveLength(2);
  });
  it('uses a saved key only for its exact endpoint and preserves configured capabilities', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ data: [{ id: 'deepseek-reasoner' }] })),
    );
    const { manager } = setup({}, fetchImpl);
    manager.save({ provider: deepseek, apiKey: 'key' });
    expect(await manager.discover({ provider: deepseek })).toMatchObject({
      ok: true,
      models: [{ id: 'deepseek-reasoner', supportsTemperature: false }],
    });
    expect(
      await manager.discover({
        provider: { ...deepseek, baseUrl: 'https://different.example/v1' },
      }),
    ).toEqual({ ok: false, reason: 'not-configured' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('explicit connection testing', () => {
  it('tests the selected model with a bounded fixed prompt, without activating it', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response());
    const { manager } = setup({}, fetchImpl);
    manager.save({ provider: custom, apiKey: 'key' });
    expect(await manager.test(selection)).toMatchObject({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://gateway.example/api/v1/chat/completions');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'org/model',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'Reply with OK.' }],
    });
    expect(manager.snapshot().active).toBeNull();
    expect(manager.snapshot().providers.find((p) => p.id === 'gateway')?.verifiedModels).toEqual([
      'org/model',
    ]);
    manager.save({ provider: custom });
    expect(manager.snapshot().providers.find((p) => p.id === 'gateway')?.verifiedModels).toEqual(
      [],
    );
  });
  it('never treats fallback as success, never returns response bodies or keys', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(401));
    const { manager } = setup({}, fetchImpl);
    manager.save({ provider: custom, apiKey: 'SECRET' });
    const result = await manager.test(selection);
    expect(result).toEqual({ ok: false, reason: 'unauthorized' });
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('reports an empty account as quota-exceeded, not as a malformed reply', async () => {
    // The reason the learner's own connection test exists: 402 is the account, and calling it
    // bad-response would send them to check the model ID and the compatibility options instead.
    const fetchImpl = vi.fn<typeof fetch>(async () => response(402));
    const { manager } = setup({}, fetchImpl);
    manager.save({ provider: custom, apiKey: 'SECRET' });
    const result = await manager.test(selection);
    expect(result).toEqual({ ok: false, reason: 'quota-exceeded' });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
  it('does not record stale verification when a configuration changes mid-test', async () => {
    let resolve!: (value: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { manager } = setup({}, fetchImpl);
    manager.save({ provider: custom, apiKey: 'key' });
    const pending = manager.test(selection);
    expect(await manager.test(selection)).toEqual({ ok: false, reason: 'busy' });
    manager.save({ provider: { ...custom, baseUrl: 'https://new.example/v1' }, apiKey: 'other' });
    resolve(response());
    await pending;
    expect(manager.snapshot().providers.find((p) => p.id === 'gateway')?.verifiedModels).toEqual(
      [],
    );
  });
});
