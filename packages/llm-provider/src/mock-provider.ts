import { createHash } from 'node:crypto';
import type { CompletionRequest, CompletionResult } from '@focusloop/shared-types';
import { controlledStream } from './stream-control';
import type { ExecutableAIProvider, ProviderExecutionOptions } from './execution';
import type { ProviderStreamEvent } from './streaming';

const OPENINGS = [
  'Start from the smallest possible step.',
  'Name the idea in your own words first.',
  'Compare it with something you already know.',
  'Work one concrete example end to end.',
] as const;

const CLOSINGS = [
  'Write down the one thing that is still unclear.',
  'Try the next micro task while the idea is fresh.',
  'Pause here if your working memory feels full.',
  'Say the next step out loud before you start it.',
] as const;

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Picks an entry from a list that cannot be empty.
 *
 * The parameter is a non-empty tuple rather than `readonly string[]` on purpose. It used to be the latter
 * while promising a `string`, and an empty list made it return `undefined` — `byte % 0` is `NaN`, so the
 * index came out `undefined` and an `?? values[0]!` covered the hole instead of closing it (#6).
 *
 * With this type the empty case cannot be written down: a caller holding a `string[]` fails to compile, and
 * the assertion is gone because `values[0]` really is a `string` for a tuple known to hold one.
 */
function pick(values: readonly [string, ...string[]], hex: string, offset: number): string {
  const byte = parseInt(hex.slice(offset * 2, offset * 2 + 2), 16);
  const index = Number.isNaN(byte) ? 0 : byte % values.length;
  // `noUncheckedIndexedAccess` makes a computed index `string | undefined`, so the first entry is the
  // fallback — and the tuple type is what guarantees there is one.
  return values[index] ?? values[0];
}

export interface MockAIProviderOptions {
  readonly id?: string;
  readonly model?: string;
}

/**
 * Deterministic, offline provider.
 *
 * This is the default provider and the degraded-mode fallback: the whole
 * golden path must work with no network and no credentials. Given the same
 * request it always returns the same text — which makes it usable as a
 * fixture generator in tests.
 */
export class MockAIProvider implements ExecutableAIProvider {
  readonly id: string;
  readonly model: string;
  readonly offline = true;

  constructor(options: MockAIProviderOptions = {}) {
    this.id = options.id ?? 'mock';
    this.model = options.model ?? 'focusloop-mock-v1';
  }

  /** Deterministic offline display fixture, not model tokenization or network streaming. */
  stream(
    request: CompletionRequest,
    options?: ProviderExecutionOptions,
  ): AsyncGenerator<ProviderStreamEvent> {
    return controlledStream(
      async function* (this: MockAIProvider): AsyncGenerator<ProviderStreamEvent> {
        const raw = await this.complete(request);
        const points = Array.from(raw.text);
        for (let index = 0; index < points.length; index += 48)
          yield {
            type: 'text',
            text: points.slice(index, index + 48).join(''),
            providerId: this.id,
            model: this.model,
          };
        yield { type: 'complete', result: raw };
      }.bind(this),
      options,
      this.id,
      (event) => event.type === 'complete',
    );
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const hex = digest(`${request.system ?? ''}\u0000${request.prompt}`);
    const opening = pick(OPENINGS, hex, 0);
    const closing = pick(CLOSINGS, hex, 1);
    const marker = hex.slice(0, 8);
    const text = `${opening} ${closing} [mock:${marker}]`;

    return {
      text,
      providerId: this.id,
      model: this.model,
      latencyMs: 0,
    };
  }
}
