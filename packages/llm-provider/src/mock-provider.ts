import { createHash } from 'node:crypto';
import type { AIProvider, CompletionRequest, CompletionResult } from '@focusloop/shared-types';

const OPENINGS = [
  'Start from the smallest possible step.',
  'Name the idea in your own words first.',
  'Compare it with something you already know.',
  'Work one concrete example end to end.',
];

const CLOSINGS = [
  'Write down the one thing that is still unclear.',
  'Try the next micro task while the idea is fresh.',
  'Pause here if your working memory feels full.',
  'Say the next step out loud before you start it.',
];

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function pick(values: readonly string[], hex: string, offset: number): string {
  const byte = parseInt(hex.slice(offset * 2, offset * 2 + 2), 16);
  const index = Number.isNaN(byte) ? 0 : byte % values.length;
  return values[index] ?? values[0]!;
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
export class MockAIProvider implements AIProvider {
  readonly id: string;
  readonly model: string;
  readonly offline = true;

  constructor(options: MockAIProviderOptions = {}) {
    this.id = options.id ?? 'mock';
    this.model = options.model ?? 'focusloop-mock-v1';
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
