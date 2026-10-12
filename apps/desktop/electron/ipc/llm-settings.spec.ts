import { describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDER_CONFIGS, IPC_CHANNELS } from '@focusloop/shared-types';
import { payload } from './payloads';
import {
  IpcValidationError,
  parseSaveProvider,
  parseSelectModel,
  parseProviderId,
  parseTestModel,
  parseDiscoverModels,
} from './validate';

const provider = DEFAULT_PROVIDER_CONFIGS[0]!;
describe('LLM IPC boundary', () => {
  it('round-trips every new preload payload', () => {
    const saved = { provider, apiKey: 'key' };
    expect(parseSaveProvider(IPC_CHANNELS.saveLlmProvider, payload.saveLlmProvider(saved))).toEqual(
      saved,
    );
    expect(
      parseProviderId(
        IPC_CHANNELS.removeLlmProvider,
        payload.providerId({ providerConfigId: provider.id }),
      ),
    ).toEqual({ providerConfigId: provider.id });
    expect(
      parseProviderId(
        IPC_CHANNELS.clearLlmProviderKey,
        payload.providerId({ providerConfigId: provider.id }),
      ),
    ).toEqual({ providerConfigId: provider.id });
    const connection = {
      provider: { id: provider.id, kind: provider.kind, baseUrl: provider.baseUrl },
      apiKey: 'key',
    };
    expect(
      parseDiscoverModels(IPC_CHANNELS.discoverLlmModels, payload.discoverLlmModels(connection)),
    ).toEqual(connection);
    const selection = { providerConfigId: 'deepseek', modelId: 'deepseek-chat' };
    expect(parseTestModel(IPC_CHANNELS.testLlmModel, payload.testLlmModel(selection))).toEqual(
      selection,
    );
    expect(
      parseSelectModel(IPC_CHANNELS.selectLlmModel, payload.selectLlmModel({ selection })),
    ).toEqual({ selection });
    expect(
      parseSelectModel(IPC_CHANNELS.selectLlmModel, payload.selectLlmModel({ selection: null })),
    ).toEqual({ selection: null });
  });
  it.each(['', ' ', 'x'.repeat(513), 'key\nheader', 123, null])(
    'rejects malformed keys without echoing secrets',
    (apiKey) => {
      expect(() => parseSaveProvider('test', { provider, apiKey })).toThrow(IpcValidationError);
      expect(() => parseDiscoverModels('test', { provider, apiKey })).toThrow(IpcValidationError);
    },
  );
  it('drops unknown fields and validates selections', () => {
    const result = parseSaveProvider('test', {
      provider: { ...provider, apiKey: 'SECRET' },
      unexpected: true,
    });
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(() => parseSelectModel('test', {})).toThrow(IpcValidationError);
    expect(() => parseProviderId('test', { providerConfigId: '../escape' })).toThrow(
      IpcValidationError,
    );
    expect(() => parseTestModel('test', { providerConfigId: 'deepseek', modelId: '' })).toThrow(
      IpcValidationError,
    );
  });
});
