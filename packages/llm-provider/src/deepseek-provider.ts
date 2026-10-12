import {
  OpenAICompatibleProvider,
  type OpenAICompatibleProviderOptions,
} from './openai-compatible-provider';

export interface DeepSeekProviderOptions extends Pick<
  OpenAICompatibleProviderOptions,
  'apiKey' | 'timeoutMs' | 'fetchImpl' | 'now'
> {
  readonly model?: string;
  readonly baseUrl?: string;
}

/** DeepSeek preset over the shared Chat Completions transport. */
export class DeepSeekProvider extends OpenAICompatibleProvider {
  constructor(options: DeepSeekProviderOptions) {
    super({
      ...options,
      providerId: 'deepseek',
      model: options.model ?? 'deepseek-chat',
      baseUrl: options.baseUrl ?? 'https://api.deepseek.com/v1',
    });
  }

  static fromEnvironment(
    env: Record<string, string | undefined> = process.env,
    overrides: Partial<Omit<DeepSeekProviderOptions, 'apiKey'>> = {},
  ): DeepSeekProvider | null {
    const apiKey = env['FOCUSLOOP_DEEPSEEK_API_KEY']?.trim();
    return apiKey ? new DeepSeekProvider({ apiKey, ...overrides }) : null;
  }
}
