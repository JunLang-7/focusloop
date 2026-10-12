/** Non-secret provider configuration. Credentials never appear in these snapshots. */
export type LlmProviderKind = 'deepseek' | 'openai' | 'openai-compatible';

export interface ModelDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly maxOutputTokens?: number;
  readonly tokenParameter?: 'max_tokens' | 'max_completion_tokens';
  readonly supportsTemperature?: boolean;
  readonly supportsSeed?: boolean;
}

export interface ProviderConfig {
  readonly id: string;
  readonly name: string;
  readonly kind: LlmProviderKind;
  /** API base, including its version/prefix; never a completions endpoint. */
  readonly baseUrl: string;
  readonly models: readonly ModelDefinition[];
}

export interface ActiveModelSelection {
  readonly providerConfigId: string;
  readonly modelId: string;
}

export interface ProviderStatus extends ProviderConfig {
  readonly keySource: 'environment' | 'stored' | 'none';
  readonly hasStoredKey: boolean;
  /** Only explicitly tested models, in this process; configuration is not authentication. */
  readonly verifiedModels: readonly string[];
}

export interface LlmSettings {
  readonly providers: readonly ProviderStatus[];
  /** null explicitly selects local-only mode. */
  readonly active: ActiveModelSelection | null;
  readonly canStore: boolean;
}

export interface SaveProviderRequest {
  readonly provider: ProviderConfig;
  /** Absent keeps a credential for the same URL; changing URL never reuses it. */
  readonly apiKey?: string;
}
export interface ProviderIdRequest {
  readonly providerConfigId: string;
}
export interface SelectModelRequest {
  readonly selection: ActiveModelSelection | null;
}
export type TestModelRequest = ActiveModelSelection;

export type ProviderConnection = Pick<ProviderConfig, 'id' | 'kind' | 'baseUrl'>;
export interface DiscoverModelsRequest {
  readonly provider: ProviderConnection;
  readonly apiKey?: string;
}
export type DiscoverModelsResult =
  | { readonly ok: true; readonly models: readonly ModelDefinition[] }
  | { readonly ok: false; readonly reason: NonNullable<TestModelResult['reason']> };
export interface TestModelResult {
  readonly ok: boolean;
  readonly reason?:
    | 'not-configured'
    | 'offline'
    | 'timeout'
    | 'unauthorized'
    | 'rate-limited'
    | 'bad-response'
    | 'busy';
  readonly latencyMs?: number;
}

export const DEFAULT_PROVIDER_CONFIGS: readonly ProviderConfig[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: [
      { id: 'deepseek-chat', displayName: 'DeepSeek Chat' },
      {
        id: 'deepseek-reasoner',
        displayName: 'DeepSeek Reasoner',
        supportsTemperature: false,
        supportsSeed: false,
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      {
        id: 'gpt-4.1-mini',
        displayName: 'GPT-4.1 mini',
        tokenParameter: 'max_completion_tokens',
        supportsSeed: false,
      },
      {
        id: 'gpt-4.1',
        displayName: 'GPT-4.1',
        tokenParameter: 'max_completion_tokens',
        supportsSeed: false,
      },
      { id: 'gpt-4o', displayName: 'GPT-4o', tokenParameter: 'max_completion_tokens' },
    ],
  },
];

/** One convention across presets, the form, credential identity and the adapter. */
export function normalizeLlmBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Invalid API base URL');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    throw new Error('API base URL requires HTTPS (HTTP is allowed only on loopback)');
  if (url.username || url.password || url.search || url.hash)
    throw new Error('API base URL cannot contain credentials, query parameters or a fragment');
  let path = url.pathname.replace(/\/+$/, '');
  if (/\/(chat\/completions|responses|models)$/.test(path))
    throw new Error('Enter the API base URL, not an endpoint');
  if (path === '') path = '/v1';
  return `${url.origin}${path}`;
}

/** Bounded, allowlisted validation used at IPC and when loading persisted settings. */
export function parseProviderConfig(value: unknown): ProviderConfig {
  const record = object(value);
  const id = text(record['id'], 80);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) throw new Error('Invalid provider ID');
  const name = text(record['name'], 100);
  const kind = record['kind'];
  if (kind !== 'deepseek' && kind !== 'openai' && kind !== 'openai-compatible')
    throw new Error('Invalid provider kind');
  if ((id === 'deepseek' && kind !== 'deepseek') || (id === 'openai' && kind !== 'openai'))
    throw new Error('Reserved provider ID');
  const baseUrl = normalizeLlmBaseUrl(text(record['baseUrl'], 2048));
  const source = record['models'];
  if (!Array.isArray(source) || source.length < 1 || source.length > 32)
    throw new Error('Configure between 1 and 32 models');
  const models = source.map((value): ModelDefinition => {
    const model = object(value);
    const id = text(model['id'], 200);
    const displayName = text(model['displayName'], 200);
    const max = model['maxOutputTokens'];
    if (
      max !== undefined &&
      (typeof max !== 'number' || !Number.isInteger(max) || max < 1 || max > 1_000_000)
    )
      throw new Error('Invalid model output limit');
    const token = model['tokenParameter'];
    if (token !== undefined && token !== 'max_tokens' && token !== 'max_completion_tokens')
      throw new Error('Invalid token parameter');
    for (const key of ['supportsTemperature', 'supportsSeed']) {
      if (model[key] !== undefined && typeof model[key] !== 'boolean')
        throw new Error('Invalid model capability');
    }
    return {
      id,
      displayName,
      ...(max === undefined ? {} : { maxOutputTokens: max as number }),
      ...(token === undefined ? {} : { tokenParameter: token }),
      ...(model['supportsTemperature'] === undefined
        ? {}
        : { supportsTemperature: model['supportsTemperature'] as boolean }),
      ...(model['supportsSeed'] === undefined
        ? {}
        : { supportsSeed: model['supportsSeed'] as boolean }),
    };
  });
  if (new Set(models.map((model) => model.id)).size !== models.length)
    throw new Error('Duplicate model ID');
  return { id, name, kind, baseUrl, models };
}

/** Discovery can precede model configuration; only connection identity is required. */
export function parseProviderConnection(value: unknown): ProviderConnection {
  const record = object(value);
  const provider = parseProviderConfig({
    ...record,
    name: 'Connection',
    models: [{ id: 'discovery', displayName: 'Discovery' }],
  });
  return { id: provider.id, kind: provider.kind, baseUrl: provider.baseUrl };
}

/** Validates a provider/model pair without consulting configuration or credentials. */
export function parseModelSelection(value: unknown): ActiveModelSelection {
  const record = object(value);
  return {
    providerConfigId: text(record['providerConfigId'], 80),
    modelId: text(record['modelId'], 200),
  };
}
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected an object');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    throw new Error('Invalid configuration field');
  return value.trim();
}
