import { normalizeLlmBaseUrl, type ModelDefinition } from '@focusloop/shared-types';
import { ProviderError } from './errors';
import { RuntimeDeadlineError, withExecution } from './execution';

/** Opt-in OpenAI-compatible /models discovery. No credential persistence or fallback. */
export async function fetchModelList(options: {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<readonly ModelDefinition[]> {
  const baseUrl = normalizeLlmBaseUrl(options.baseUrl);
  const transport = options.fetchImpl ?? globalThis.fetch;
  try {
    return await withExecution(
      async (signal) => {
        const response = await transport(`${baseUrl}/models`, {
          headers: { authorization: `Bearer ${options.apiKey}`, accept: 'application/json' },
          redirect: 'error',
          signal,
        });
        if (!response.ok) {
          const reason =
            response.status === 401 || response.status === 403
              ? 'unauthorized'
              : response.status === 429
                ? 'rate-limited'
                : 'bad-response';
          throw new ProviderError(reason, options.providerId, 'Model discovery failed');
        }
        const raw: unknown = await response.json();
        if (
          raw === null ||
          typeof raw !== 'object' ||
          !('data' in raw) ||
          !Array.isArray(raw.data) ||
          raw.data.length > 4096
        )
          throw new ProviderError('bad-response', options.providerId, 'Invalid model list');
        const models = new Map<string, ModelDefinition>();
        for (const item of raw.data) {
          if (item === null || typeof item !== 'object') continue;
          const record = item as Record<string, unknown>;
          const id = record['id'];
          if (
            typeof id !== 'string' ||
            !id.trim() ||
            id.length > 200 ||
            [...id].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
          )
            continue;
          const displayName = record['display_name'];
          models.set(id.trim(), {
            id: id.trim(),
            displayName:
              typeof displayName === 'string' && displayName.trim() && displayName.length <= 200
                ? displayName.trim()
                : id.trim(),
          });
          if (models.size >= 512) break;
        }
        return [...models.values()];
      },
      { deadlineMs: Date.now() + 20_000 },
      options.providerId,
    );
  } catch (error) {
    if (error instanceof RuntimeDeadlineError)
      throw new ProviderError('timeout', options.providerId, 'Model discovery timed out');
    if (error instanceof ProviderError) throw error;
    if (error instanceof TypeError)
      throw new ProviderError(
        'offline',
        options.providerId,
        'Model discovery endpoint unreachable',
      );
    throw new ProviderError('bad-response', options.providerId, 'Invalid model discovery response');
  }
}
