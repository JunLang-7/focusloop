import type { AIProvider, CompletionRequest, CompletionResult } from '@focusloop/shared-types';
import { ProviderError } from './errors';

export interface DeepSeekProviderOptions {
  /**
   * API key. MUST be supplied by the caller from a secret store or environment
   * variable. It is never read from, or written to, the repository.
   */
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /** Injectable for tests — defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

interface DeepSeekChatResponse {
  readonly model?: string;
  readonly choices?: ReadonlyArray<{
    readonly message?: { readonly content?: string | null };
  }>;
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Optional real provider. Local-first is preserved: FocusLoop only reaches the
 * network when the user explicitly configures a key, and only the text of the
 * single request is transmitted. Failure always degrades to the mock provider.
 */
export class DeepSeekProvider implements AIProvider {
  readonly id = 'deepseek';
  readonly model: string;
  readonly offline = false;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(options: DeepSeekProviderOptions) {
    const apiKey = options.apiKey?.trim();
    if (!apiKey) {
      throw new ProviderError('not-configured', 'deepseek', 'DeepSeek API key is missing');
    }
    this.apiKey = apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.baseUrl = trimTrailingSlashes(options.baseUrl ?? DEFAULT_BASE_URL);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? (() => Date.now());
    if (typeof this.fetchImpl !== 'function') {
      throw new ProviderError('offline', 'deepseek', 'No fetch implementation available');
    }
  }

  static fromEnvironment(
    env: Record<string, string | undefined> = process.env,
    overrides: Partial<Omit<DeepSeekProviderOptions, 'apiKey'>> = {},
  ): DeepSeekProvider | null {
    const apiKey = env['FOCUSLOOP_DEEPSEEK_API_KEY']?.trim();
    if (!apiKey) return null;
    return new DeepSeekProvider({ apiKey, ...overrides });
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const started = this.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (request.system) messages.push({ role: 'system', content: request.system });
    messages.push({ role: 'user', content: request.prompt });

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.seed === undefined ? {} : { seed: request.seed }),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ProviderError(
          mapStatusToReason(response.status),
          this.id,
          `DeepSeek request failed with status ${response.status}`,
        );
      }

      const body = (await response.json()) as DeepSeekChatResponse;
      const text = body.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || text.length === 0) {
        throw new ProviderError('bad-response', this.id, 'DeepSeek returned an empty completion');
      }

      return {
        text,
        providerId: this.id,
        model: body.model ?? this.model,
        latencyMs: this.now() - started,
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ProviderError('timeout', this.id, `DeepSeek timed out after ${this.timeoutMs}ms`);
      }
      if (error instanceof TypeError) {
        throw new ProviderError('offline', this.id, 'DeepSeek is unreachable (network error)');
      }
      throw new ProviderError(
        'bad-response',
        this.id,
        error instanceof Error ? error.message : 'Unknown DeepSeek failure',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

function mapStatusToReason(status: number): 'unauthorized' | 'rate-limited' | 'bad-response' {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate-limited';
  return 'bad-response';
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') {
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
}
