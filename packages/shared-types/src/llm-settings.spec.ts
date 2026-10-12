import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROVIDER_CONFIGS,
  normalizeLlmBaseUrl,
  parseModelSelection,
  parseProviderConfig,
} from './llm-settings';

describe('provider configuration boundary', () => {
  it('normalizes root and versioned addresses without doubling /v1', () => {
    expect(normalizeLlmBaseUrl(' https://api.deepseek.com/// ')).toBe(
      'https://api.deepseek.com/v1',
    );
    expect(normalizeLlmBaseUrl('https://example.com/prefix/v1/')).toBe(
      'https://example.com/prefix/v1',
    );
    expect(normalizeLlmBaseUrl('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080/v1');
    expect(normalizeLlmBaseUrl('http://[::1]:8080/v1')).toBe('http://[::1]:8080/v1');
  });
  it.each([
    'http://remote.example/v1',
    'file:///secret',
    'https://user:SECRET@example.com',
    'https://example.com/v1?key=SECRET',
    'https://example.com/v1#SECRET',
    'https://example.com/v1/chat/completions',
    'invalid',
  ])('rejects unsafe or endpoint URLs without echoing input', (url) => {
    try {
      normalizeLlmBaseUrl(url);
      throw new Error('accepted');
    } catch (error) {
      expect((error as Error).message).not.toContain('SECRET');
      expect((error as Error).message).not.toBe('accepted');
    }
  });
  it('keeps only allowlisted metadata, never embedded keys', () => {
    const config = parseProviderConfig({
      ...DEFAULT_PROVIDER_CONFIGS[0],
      apiKey: 'SECRET',
      models: [{ id: 'org/model', displayName: 'Model', apiKey: 'SECRET' }],
    });
    expect(JSON.stringify(config)).not.toContain('SECRET');
    expect(
      parseModelSelection({ providerConfigId: config.id, modelId: 'org/model', apiKey: 'SECRET' }),
    ).toEqual({ providerConfigId: config.id, modelId: 'org/model' });
  });
  it.each([
    { id: '../escape' },
    { name: '' },
    { kind: 'anthropic' },
    { models: [] },
    { models: Array.from({ length: 33 }, (_, i) => ({ id: `${i}`, displayName: `${i}` })) },
    {
      models: [
        { id: 'same', displayName: 'A' },
        { id: 'same', displayName: 'B' },
      ],
    },
    { models: [{ id: 'model', displayName: 'Model', maxOutputTokens: 0 }] },
    { models: [{ id: 'model', displayName: 'Model', tokenParameter: 'unbounded' }] },
    { models: [{ id: 'model', displayName: 'Model', supportsSeed: 'yes' }] },
  ])('rejects malformed configurations', (overrides) => {
    expect(() => parseProviderConfig({ ...DEFAULT_PROVIDER_CONFIGS[0], ...overrides })).toThrow();
  });
});
