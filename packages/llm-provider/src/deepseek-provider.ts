import type { CompletionRequest, CompletionResult } from '@focusloop/shared-types';
import { ProviderError } from './errors';
import { readCompletionUsage } from './budgets';
import { controlledStream } from './stream-control';
import { MAX_STREAM_OUTPUT_CHARACTERS, sseData, type ProviderStreamEvent } from './streaming';
import {
  isExecutionAbort,
  validateExecutionOptions,
  RuntimeDeadlineError,
  withExecution,
  type ExecutableAIProvider,
  type ProviderExecutionOptions,
} from './execution';

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
  readonly usage?: {
    readonly prompt_tokens?: unknown;
    readonly completion_tokens?: unknown;
    readonly total_tokens?: unknown;
  };
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
 * single request is transmitted. Provider failures may degrade through the registry
 * while runtime time remains; deliberate cancellation never launches fallback.
 */
export class DeepSeekProvider implements ExecutableAIProvider {
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
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 0) {
      throw new RangeError('timeoutMs must be a finite non-negative duration');
    }
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

  async complete(
    request: CompletionRequest,
    options?: ProviderExecutionOptions,
  ): Promise<CompletionResult> {
    validateExecutionOptions(options);
    try {
      return await withExecution(
        (signal) => this.fetchCompletion(request, signal),
        {
          ...options,
          deadlineMs: Math.min(options?.deadlineMs ?? Infinity, Date.now() + this.timeoutMs),
        },
        this.id,
      );
    } catch (error) {
      if (
        error instanceof RuntimeDeadlineError &&
        options?.deadlineMs !== undefined &&
        Date.now() >= options.deadlineMs
      )
        throw error;
      if (error instanceof RuntimeDeadlineError) {
        throw new ProviderError('timeout', this.id, `DeepSeek timed out after ${this.timeoutMs}ms`);
      }
      if (isExecutionAbort(error) && options?.signal?.aborted) throw error;
      if (error instanceof ProviderError) throw error;
      if (isExecutionAbort(error)) {
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
    }
  }

  /** Real SSE transport; lifetime timeout also runs while the consumer is paused. */
  stream(
    request: CompletionRequest,
    options?: ProviderExecutionOptions,
  ): AsyncGenerator<ProviderStreamEvent> {
    validateExecutionOptions(options);
    const deadlineMs = Math.min(options?.deadlineMs ?? Infinity, Date.now() + this.timeoutMs);
    const source = controlledStream(
      (signal) => this.fetchStream(request, signal, deadlineMs),
      { ...options, deadlineMs },
      this.id,
      (event) => event.type === 'complete',
    );
    const normalize = (error: unknown): never => {
      if (options?.signal?.aborted && isExecutionAbort(error)) throw error;
      if (
        error instanceof RuntimeDeadlineError &&
        options?.deadlineMs !== undefined &&
        Date.now() >= options.deadlineMs
      )
        throw error;
      if (error instanceof RuntimeDeadlineError || isExecutionAbort(error))
        throw new ProviderError('timeout', this.id, 'DeepSeek stream timed out');
      if (error instanceof ProviderError) throw error;
      if (error instanceof TypeError)
        throw new ProviderError('offline', this.id, 'DeepSeek stream transport interrupted');
      throw new ProviderError('bad-response', this.id, 'Malformed DeepSeek stream');
    };
    return {
      async next() {
        try {
          return await source.next();
        } catch (error) {
          return normalize(error);
        }
      },
      return: (value) => source.return(value),
      throw: (error) => source.throw(error),
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  private async *fetchStream(
    request: CompletionRequest,
    signal: AbortSignal,
    deadlineMs: number,
  ): AsyncGenerator<ProviderStreamEvent> {
    const started = this.now();
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (request.system) messages.push({ role: 'system', content: request.system });
    messages.push({ role: 'user', content: request.prompt });
    const response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.seed === undefined ? {} : { seed: request.seed }),
      }),
      signal,
    });
    if (
      !response.ok ||
      !response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream') ||
      response.body === null
    ) {
      void response.body?.cancel().catch(() => undefined);
      throw new ProviderError(
        response.ok ? 'bad-response' : mapStatusToReason(response.status),
        this.id,
        'DeepSeek stream response unavailable',
      );
    }
    const reader = response.body.getReader();
    const cancel = (): void => {
      void reader.cancel().catch(() => undefined);
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    let text = '';
    let model = this.model;
    let seen = false;
    let usage: CompletionResult['usage'];
    try {
      for await (const payload of sseData(reader, this.id, { signal, deadlineMs })) {
        if (payload === '') continue;
        if (payload === '[DONE]') {
          if (text.length === 0)
            throw new ProviderError('bad-response', this.id, 'Empty DeepSeek stream');
          yield {
            type: 'complete',
            result: {
              text,
              providerId: this.id,
              model,
              latencyMs: this.now() - started,
              ...(usage === undefined ? {} : { usage }),
            },
          };
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch {
          throw new ProviderError('bad-response', this.id, 'Malformed SSE JSON');
        }
        if (parsed === null || typeof parsed !== 'object')
          throw new ProviderError('bad-response', this.id, 'Invalid SSE record');
        const record = parsed as Record<string, unknown>;
        if (
          !Array.isArray(record['choices']) ||
          record['choices'].length > 1 ||
          record['error'] !== undefined
        )
          throw new ProviderError('bad-response', this.id, 'Invalid SSE choices');
        if (record['model'] !== undefined) {
          if (
            typeof record['model'] !== 'string' ||
            record['model'].length === 0 ||
            (seen && model !== record['model'])
          )
            throw new ProviderError('bad-response', this.id, 'Stream model changed');
          model = record['model'];
        }
        if (record['usage'] !== null && typeof record['usage'] === 'object') {
          const counters = record['usage'] as Record<string, unknown>;
          const next = readCompletionUsage({
            inputTokens: counters['prompt_tokens'],
            outputTokens: counters['completion_tokens'],
            totalTokens: counters['total_tokens'],
          });
          if (next !== undefined) usage = { ...usage, ...next };
          if (
            usage?.outputTokens !== undefined &&
            request.maxTokens !== undefined &&
            usage.outputTokens > request.maxTokens
          )
            throw new ProviderError(
              'bad-response',
              this.id,
              'Stream reported output beyond token cap',
            );
        }
        const choice: unknown = record['choices'][0];
        if (choice === undefined) continue;
        if (choice === null || typeof choice !== 'object')
          throw new ProviderError('bad-response', this.id, 'Invalid SSE choice');
        const fields = choice as Record<string, unknown>;
        if (
          fields['finish_reason'] !== null &&
          fields['finish_reason'] !== undefined &&
          fields['finish_reason'] !== 'stop'
        )
          throw new ProviderError('bad-response', this.id, 'Stream did not finish normally');
        const delta: unknown = fields['delta'];
        if ((delta === null || delta === undefined) && fields['finish_reason'] === 'stop') continue;
        if (delta === null || typeof delta !== 'object')
          throw new ProviderError('bad-response', this.id, 'Invalid SSE delta');
        const part: unknown = (delta as Record<string, unknown>)['content'];
        if (part === null || part === undefined) continue;
        if (typeof part !== 'string')
          throw new ProviderError('bad-response', this.id, 'Invalid stream text');
        if (text.length + part.length > MAX_STREAM_OUTPUT_CHARACTERS)
          throw new ProviderError(
            'bad-response',
            this.id,
            'Stream output character limit exceeded',
          );
        if (part.length > 0) {
          text += part;
          seen = true;
          yield { type: 'text', text: part, providerId: this.id, model };
        }
      }
      throw new ProviderError('bad-response', this.id, 'DeepSeek stream ended without DONE');
    } finally {
      signal.removeEventListener('abort', cancel);
      // Abort/read failure/DONE/abandon all take ownership of cancel + lock release.
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  private async fetchCompletion(
    request: CompletionRequest,
    signal: AbortSignal,
  ): Promise<CompletionResult> {
    const started = this.now();

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (request.system) messages.push({ role: 'system', content: request.system });
    messages.push({ role: 'user', content: request.prompt });

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
      signal,
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

    const usage = readCompletionUsage({
      inputTokens: body.usage?.prompt_tokens,
      outputTokens: body.usage?.completion_tokens,
      totalTokens: body.usage?.total_tokens,
    });
    return {
      text,
      ...(usage === undefined ? {} : { usage }),
      providerId: this.id,
      model: body.model ?? this.model,
      latencyMs: this.now() - started,
    };
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
