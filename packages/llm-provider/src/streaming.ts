import type {
  CompletionRequest,
  CompletionResult,
  RuntimeBudgetReport,
} from '@focusloop/shared-types';
import { completionBudget } from './budgets';
import { ProviderError } from './errors';
import {
  assertExecutionActive,
  withExecution,
  type ExecutableAIProvider,
  type ExecutionOptions,
  type ProviderExecutionOptions,
} from './execution';
import { controlledStream } from './stream-control';

/** Process-local iterable contract, separate from serializable shared request data. */
export type ProviderStreamEvent =
  | {
      readonly type: 'text';
      readonly text: string;
      readonly providerId: string;
      readonly model: string;
    }
  | { readonly type: 'complete'; readonly result: CompletionResult };
export interface StreamingProvider extends ExecutableAIProvider {
  stream(
    request: CompletionRequest,
    options?: ProviderExecutionOptions,
  ): AsyncIterable<ProviderStreamEvent>;
}
export const MAX_STREAM_OUTPUT_CHARACTERS = 65_536;
export const MAX_SSE_FRAME_BYTES = 65_536;
export function outputLimit(value: number = MAX_STREAM_OUTPUT_CHARACTERS): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_STREAM_OUTPUT_CHARACTERS)
    throw new RangeError('maxOutputCharacters must be a positive safe integer within 65536');
  return value;
}
/** A failed stream after accepted text cannot be replaced by another answer. */
export class StreamInterruptedError extends ProviderError {
  constructor(
    providerId: string,
    readonly model: string,
    error: unknown,
  ) {
    super(
      error instanceof ProviderError ? error.reason : 'bad-response',
      providerId,
      'Provider stream interrupted after text',
    );
  }
}

/** Completion-only adapters remain supported, honestly labelled collected by Runtime. */
async function* collected(
  provider: ExecutableAIProvider,
  request: CompletionRequest,
  signal: AbortSignal,
  maxCharacters: number,
  report: RuntimeBudgetReport,
): AsyncGenerator<ProviderStreamEvent> {
  const raw = await withExecution(
    (child) => provider.complete(request, { signal: child }),
    { signal },
    provider.id,
  );
  completionBudget(report, raw);
  if (typeof raw.text !== 'string' || raw.text.length > maxCharacters)
    throw new ProviderError(
      'bad-response',
      provider.id,
      'Collected output exceeds stream assembly limit',
    );
  // This compatibility fragmenter is NOT network/token streaming.
  const points = Array.from(raw.text);
  for (let index = 0; index < points.length; index += 48)
    yield {
      type: 'text',
      text: points.slice(index, index + 48).join(''),
      providerId: raw.providerId,
      model: raw.model,
    };
  yield { type: 'complete', result: raw };
}

/** Bounded assembly and protocol validation shared by display and structured stream paths. */
export function providerStream(
  provider: ExecutableAIProvider,
  request: CompletionRequest,
  report: RuntimeBudgetReport,
  controls: ExecutionOptions | undefined,
  maxCharacters: number,
): AsyncGenerator<ProviderStreamEvent> {
  const limit = outputLimit(maxCharacters);
  return controlledStream(
    async function* (signal) {
      let text = '';
      let model = provider.model;
      let final: CompletionResult | undefined;
      let seen = false;
      try {
        const source =
          provider.stream === undefined
            ? collected(provider, request, signal, limit, report)
            : provider.stream(request, { signal, deadlineMs: controls?.deadlineMs });
        for await (const event of source) {
          assertExecutionActive({ signal }, provider.id);
          if (final !== undefined)
            throw new ProviderError('bad-response', provider.id, 'Frames after final completion');
          if (event.type === 'text') {
            if (
              event.providerId !== provider.id ||
              typeof event.model !== 'string' ||
              event.model.length === 0 ||
              (seen && model !== event.model) ||
              typeof event.text !== 'string'
            )
              throw new ProviderError(
                'bad-response',
                provider.id,
                'Invalid stream provenance/text',
              );
            model = event.model;
            if (event.text.length === 0) continue;
            if (text.length + event.text.length > limit)
              throw new ProviderError(
                'bad-response',
                provider.id,
                'Stream output character limit exceeded',
              );
            text += event.text;
            seen = true;
            yield event;
          } else if (event.type === 'complete') {
            const raw = event.result;
            if (
              raw.providerId !== provider.id ||
              raw.text !== text ||
              raw.text.length === 0 ||
              (seen && raw.model !== model)
            )
              throw new ProviderError(
                'bad-response',
                provider.id,
                'Final stream result does not match assembly',
              );
            completionBudget(report, raw);
            final = raw;
          } else throw new ProviderError('bad-response', provider.id, 'Unknown stream event');
        }
        if (final === undefined)
          throw new ProviderError(
            'bad-response',
            provider.id,
            'Stream ended without final completion',
          );
        assertExecutionActive({ signal }, provider.id);
        // Only after EOF of the provider iterable, not merely seeing a terminal event.
        yield { type: 'complete', result: final };
      } catch (error) {
        if (seen) throw new StreamInterruptedError(provider.id, model, error);
        throw error;
      }
    },
    controls,
    provider.id,
    (event) => event.type === 'complete',
  );
}

/** Byte-delimited SSE parser: split UTF-8/CRLF safe and bounded even for unterminated comments. */
export async function* sseData(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  providerId: string,
  controls?: ExecutionOptions,
): AsyncGenerator<string> {
  let line: number[] = [];
  let data: string[] = [];
  let frameBytes = 0;
  let skipLF = false;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const endLine = (): string | undefined => {
    let value: string;
    try {
      value = decoder.decode(Uint8Array.from(line));
    } catch {
      throw new ProviderError('bad-response', providerId, 'Invalid SSE UTF-8');
    }
    line = [];
    if (value === '') {
      const payload = data.length > 0 ? data.join('\n') : undefined;
      data = [];
      frameBytes = 0;
      return payload;
    }
    if (value === 'data') data.push('');
    else if (value.startsWith('data:')) data.push(value.slice(value[5] === ' ' ? 6 : 5));
    return undefined;
  };
  for (;;) {
    assertExecutionActive(controls, providerId);
    const next = await reader.read();
    assertExecutionActive(controls, providerId);
    if (next.done) {
      if (line.length > 0) {
        const payload = endLine();
        if (payload !== undefined) yield payload;
      }
      if (data.length > 0) yield data.join('\n');
      return;
    }
    let scanned = 0;
    for (const byte of next.value) {
      if (scanned++ % 4096 === 0) assertExecutionActive(controls, providerId);
      if (skipLF && byte === 10) {
        skipLF = false;
        continue;
      }
      skipLF = false;
      frameBytes += 1;
      if (frameBytes > MAX_SSE_FRAME_BYTES)
        throw new ProviderError('bad-response', providerId, 'SSE frame limit exceeded');
      if (byte === 10 || byte === 13) {
        skipLF = byte === 13;
        const payload = endLine();
        if (payload !== undefined) yield payload;
      } else line.push(byte);
    }
  }
}
