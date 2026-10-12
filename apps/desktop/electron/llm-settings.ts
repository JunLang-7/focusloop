import { rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_PROVIDER_CONFIGS,
  MODEL_API_KEY_MAX_LENGTH,
  parseModelSelection,
  parseProviderConfig,
  parseProviderConnection,
  type ActiveModelSelection,
  type LlmSettings,
  type ProviderConfig,
  type ProviderStatus,
  type SaveProviderRequest,
  type TestModelResult,
  type ProviderConnection,
  type DiscoverModelsRequest,
  type DiscoverModelsResult,
} from '@focusloop/shared-types';
import {
  OpenAICompatibleProvider,
  ProviderError,
  createProviderSelection,
  fetchModelList,
  type ProviderSelection,
} from '@focusloop/llm-provider';
import { canStoreModelKey, clearProviderKey, readProviderKey, storeProviderKey } from './model-key';

const META_KEY = 'llm_settings';
interface SettingsStore {
  getMeta(key: string): string | null;
  setMeta(key: string, value: string): void;
}
interface SavedSettings {
  readonly providers: readonly ProviderConfig[];
  readonly active: ActiveModelSelection | null;
}
export interface LlmManagerOptions {
  readonly env?: Record<string, string | undefined>;
  readonly fetchImpl?: typeof fetch;
}

/** Main-process owner of configuration, scoped secrets and explicit model selection. */
export class LlmSettingsManager {
  private settings: SavedSettings;
  private readonly verified = new Map<string, Set<string>>();
  private readonly generations = new Map<string, number>();
  private testing = false;
  private readonly env: Record<string, string | undefined>;

  constructor(
    private readonly store: SettingsStore,
    private readonly directory: string,
    private readonly options: LlmManagerOptions = {},
  ) {
    this.env = { ...(options.env ?? process.env) };
    // Development-only replacement: the previous single-key surface is intentionally discarded.
    rmSync(join(directory, 'model-key.bin'), { force: true });
    this.settings = this.load();
  }

  private load(): SavedSettings {
    const saved = this.store.getMeta(META_KEY);
    if (saved !== null) {
      try {
        const raw = JSON.parse(saved) as SavedSettings;
        if (!Array.isArray(raw.providers) || raw.providers.length > 32)
          throw new Error('Invalid settings');
        const providers = raw.providers.map(parseProviderConfig);
        if (new Set(providers.map((p) => p.id)).size !== providers.length)
          throw new Error('Duplicate provider');
        const active = raw.active === null ? null : parseModelSelection(raw.active);
        if (
          active !== null &&
          !providers.some(
            (p) =>
              p.id === active.providerConfigId && p.models.some((m) => m.id === active.modelId),
          )
        )
          throw new Error('Unavailable model');
        return { providers, active };
      } catch {
        /* Invalid local settings never cause a network call or prevent startup. */
      }
    }
    const providers = DEFAULT_PROVIDER_CONFIGS.map(parseProviderConfig);
    const configured = providers.find((p) => this.environmentKey(p) !== null);
    return {
      providers,
      active: configured
        ? { providerConfigId: configured.id, modelId: configured.models[0]!.id }
        : null,
    };
  }

  private environmentKey(provider: ProviderConnection): string | null {
    // A preset's environment key must never be sent to a user-edited URL.
    const preset = DEFAULT_PROVIDER_CONFIGS.find(
      (p) => p.id === provider.id && p.kind === provider.kind && p.baseUrl === provider.baseUrl,
    );
    if (!preset) return null;
    return this.env[`FOCUSLOOP_${provider.kind.toUpperCase()}_API_KEY`]?.trim() || null;
  }
  private credential(provider: ProviderConnection): {
    key: string | null;
    source: ProviderStatus['keySource'];
    stored: boolean;
  } {
    const stored = readProviderKey(this.directory, provider.id, provider.baseUrl);
    const environment = this.environmentKey(provider);
    return {
      key: environment ?? stored,
      source: environment ? 'environment' : stored ? 'stored' : 'none',
      stored: stored !== null,
    };
  }
  snapshot(): LlmSettings {
    return {
      providers: this.settings.providers.map((p) => {
        const key = this.credential(p);
        return {
          ...p,
          keySource: key.source,
          hasStoredKey: key.stored,
          verifiedModels: [...(this.verified.get(p.id) ?? [])],
        };
      }),
      active: this.settings.active,
      canStore: canStoreModelKey(),
    };
  }
  private commit(settings: SavedSettings): void {
    this.store.setMeta(META_KEY, JSON.stringify(settings));
    this.settings = settings;
  }
  private invalidate(id: string): void {
    this.verified.delete(id);
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
  }
  private provider(id: string): ProviderConfig {
    const provider = this.settings.providers.find((p) => p.id === id);
    if (!provider) throw new Error('Provider does not exist');
    return provider;
  }
  save(request: SaveProviderRequest): LlmSettings {
    const provider = parseProviderConfig(request.provider);
    const previous = this.settings.providers.find((p) => p.id === provider.id);
    if (!previous && this.settings.providers.length >= 32) throw new Error('Too many providers');
    if (request.apiKey !== undefined) {
      if (
        typeof request.apiKey !== 'string' ||
        !request.apiKey.trim() ||
        request.apiKey.length > MODEL_API_KEY_MAX_LENGTH ||
        /[\r\n]/.test(request.apiKey)
      )
        throw new Error('Invalid API key');
      storeProviderKey(this.directory, provider.id, provider.baseUrl, request.apiKey);
    }
    const providers = previous
      ? this.settings.providers.map((p) => (p.id === provider.id ? provider : p))
      : [...this.settings.providers, provider];
    let active = this.settings.active;
    if (
      active?.providerConfigId === provider.id &&
      (!provider.models.some((m) => m.id === active?.modelId) ||
        this.credential(provider).key === null)
    )
      active = null;
    this.commit({ providers, active });
    this.invalidate(provider.id);
    if (previous && previous.baseUrl !== provider.baseUrl)
      clearProviderKey(this.directory, previous.id, previous.baseUrl);
    return this.snapshot();
  }
  remove(id: string): LlmSettings {
    const provider = this.provider(id);
    clearProviderKey(this.directory, provider.id, provider.baseUrl);
    this.commit({
      providers: this.settings.providers.filter((p) => p.id !== id),
      active: this.settings.active?.providerConfigId === id ? null : this.settings.active,
    });
    this.invalidate(id);
    return this.snapshot();
  }
  clearKey(id: string): LlmSettings {
    const provider = this.provider(id);
    clearProviderKey(this.directory, id, provider.baseUrl);
    const active =
      this.settings.active?.providerConfigId === id && !this.environmentKey(provider)
        ? null
        : this.settings.active;
    this.commit({ ...this.settings, active });
    this.invalidate(id);
    return this.snapshot();
  }
  select(selection: ActiveModelSelection | null): LlmSettings {
    if (selection !== null) this.build(parseModelSelection(selection));
    this.commit({ ...this.settings, active: selection });
    return this.snapshot();
  }
  selection(): ProviderSelection {
    if (this.settings.active === null) return createProviderSelection();
    try {
      return createProviderSelection(this.build(this.settings.active));
    } catch {
      return createProviderSelection();
    }
  }
  activeSource(): ProviderStatus['keySource'] {
    return this.settings.active
      ? this.credential(this.provider(this.settings.active.providerConfigId)).source
      : 'none';
  }
  private build(selection: ActiveModelSelection): OpenAICompatibleProvider {
    const provider = this.provider(selection.providerConfigId);
    const model = provider.models.find((m) => m.id === selection.modelId);
    if (!model) throw new Error('Model does not exist');
    const key = this.credential(provider).key;
    if (!key) throw new ProviderError('not-configured', provider.id, 'Configure an API key first');
    return new OpenAICompatibleProvider({
      providerId: provider.id,
      model: model.id,
      baseUrl: provider.baseUrl,
      apiKey: key,
      capabilities: model,
      ...(this.options.fetchImpl === undefined ? {} : { fetchImpl: this.options.fetchImpl }),
    });
  }
  async discover(request: DiscoverModelsRequest): Promise<DiscoverModelsResult> {
    if (this.testing) return { ok: false, reason: 'busy' };
    const provider = parseProviderConnection(request.provider);
    const key =
      request.apiKey === undefined ? this.credential(provider).key : request.apiKey.trim();
    if (!key) return { ok: false, reason: 'not-configured' };
    if (key.length > MODEL_API_KEY_MAX_LENGTH || /[\r\n]/.test(key))
      throw new Error('Invalid API key');
    this.testing = true;
    try {
      const models = await fetchModelList({
        providerId: provider.id,
        baseUrl: provider.baseUrl,
        apiKey: key,
        ...(this.options.fetchImpl === undefined ? {} : { fetchImpl: this.options.fetchImpl }),
      });
      const configured = this.settings.providers.find(
        (p) => p.id === provider.id && p.baseUrl === provider.baseUrl,
      );
      return {
        ok: true,
        models: models.map((model) => configured?.models.find((m) => m.id === model.id) ?? model),
      };
    } catch (error) {
      return { ok: false, reason: error instanceof ProviderError ? error.reason : 'bad-response' };
    } finally {
      this.testing = false;
    }
  }
  async test(selection: ActiveModelSelection): Promise<TestModelResult> {
    if (this.testing) return { ok: false, reason: 'busy' };
    this.testing = true;
    const generation = this.generations.get(selection.providerConfigId) ?? 0;
    try {
      // No runtime/fallback, no learner material and only one bounded request.
      const result = await this.build(selection).complete({
        prompt: 'Reply with OK.',
        maxTokens: 64,
      });
      if ((this.generations.get(selection.providerConfigId) ?? 0) === generation) {
        const models = this.verified.get(selection.providerConfigId) ?? new Set<string>();
        models.add(selection.modelId);
        this.verified.set(selection.providerConfigId, models);
      }
      return { ok: true, latencyMs: result.latencyMs };
    } catch (error) {
      if ((this.generations.get(selection.providerConfigId) ?? 0) === generation)
        this.verified.get(selection.providerConfigId)?.delete(selection.modelId);
      return { ok: false, reason: error instanceof ProviderError ? error.reason : 'bad-response' };
    } finally {
      this.testing = false;
    }
  }
  reset(): void {
    this.commit({ providers: DEFAULT_PROVIDER_CONFIGS.map(parseProviderConfig), active: null });
    for (const id of this.generations.keys()) this.invalidate(id);
    this.verified.clear();
  }
}
