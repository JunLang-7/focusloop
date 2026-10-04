import type {
  CompletionRequest,
  CompletionResult,
  CompletionUsage,
  RuntimeBudgetReport,
  RuntimeBudgets,
} from '@focusloop/shared-types';
import { ProviderError } from './errors';
import type { ExecutionOptions } from './execution';

/** Finite compatibility defaults: above Tutor's existing 4k-character / 2048-token limits. */
export const DEFAULT_RUNTIME_BUDGETS: RuntimeBudgets = Object.freeze({
  contextBudget: 16_384,
  tokenBudget: 4096,
});

export interface BudgetExecutionOptions extends ExecutionOptions {
  /** Omission uses explicit defaults; a supplied budget must contain both valid fields. */
  readonly budgets?: RuntimeBudgets;
}

export type RuntimeBudgetErrorCode =
  | 'invalid-context-budget'
  | 'invalid-token-budget'
  | 'invalid-max-tokens'
  | 'invalid-request'
  | 'context-budget-exceeded';

/** Invalid caller input is terminal, not a provider failure or a fallback trigger. */
export class RuntimeBudgetError extends RangeError {
  override readonly name = 'RuntimeBudgetError';
  constructor(
    readonly code: RuntimeBudgetErrorCode,
    readonly report?: RuntimeBudgetReport,
  ) {
    super(`Runtime budget rejected: ${code}`);
  }
}

/** Validate once, preserve the entire question/system text, and snapshot the same cap for all attempts. */
export function prepareBudget(
  request: CompletionRequest,
  budgets: RuntimeBudgets = DEFAULT_RUNTIME_BUDGETS,
): { readonly request: CompletionRequest; readonly report: RuntimeBudgetReport } {
  if (budgets === null || typeof budgets !== 'object')
    throw new RuntimeBudgetError('invalid-context-budget');
  if (request === null || typeof request !== 'object')
    throw new RuntimeBudgetError('invalid-request');
  if (!Number.isSafeInteger(budgets.contextBudget) || budgets.contextBudget < 0)
    throw new RuntimeBudgetError('invalid-context-budget');
  if (!Number.isSafeInteger(budgets.tokenBudget) || budgets.tokenBudget <= 0)
    throw new RuntimeBudgetError('invalid-token-budget');
  if (
    request.maxTokens !== undefined &&
    (!Number.isSafeInteger(request.maxTokens) || request.maxTokens <= 0)
  )
    throw new RuntimeBudgetError('invalid-max-tokens');
  if (
    typeof request.prompt !== 'string' ||
    (request.system !== undefined && typeof request.system !== 'string')
  )
    throw new RuntimeBudgetError('invalid-request');
  const effectiveMaxTokens = Math.min(
    request.maxTokens ?? budgets.tokenBudget,
    budgets.tokenBudget,
  );
  const report: RuntimeBudgetReport = Object.freeze({
    contextBudget: budgets.contextBudget,
    tokenBudget: budgets.tokenBudget,
    ...(request.maxTokens === undefined ? {} : { callerMaxTokens: request.maxTokens }),
    effectiveMaxTokens,
    inputCharacters: (request.system?.length ?? 0) + request.prompt.length,
    characterUnit: 'utf16-code-units',
  });
  if (report.inputCharacters > budgets.contextBudget)
    throw new RuntimeBudgetError('context-budget-exceeded', report);
  return {
    report,
    request: Object.freeze({
      prompt: request.prompt,
      ...(request.system === undefined ? {} : { system: request.system }),
      maxTokens: effectiveMaxTokens,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.seed === undefined ? {} : { seed: request.seed }),
    }),
  };
}

/** Accept only known, non-negative integer counters; do not guess missing usage or copy extra metadata. */
export function readCompletionUsage(value: unknown): CompletionUsage | undefined {
  if (value === undefined || value === null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {};
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens'] as const) {
    const count = record[key];
    if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) usage[key] = count;
  }
  return Object.keys(usage).length === 0 ? undefined : Object.freeze(usage);
}

/** Report only the chosen response's valid counters. A reported overshoot is a provider failure. */
export function completionBudget(
  report: RuntimeBudgetReport,
  result: CompletionResult,
): RuntimeBudgetReport {
  const usage = readCompletionUsage(result.usage);
  if (usage?.outputTokens !== undefined && usage.outputTokens > report.effectiveMaxTokens)
    throw new ProviderError(
      'bad-response',
      result.providerId,
      'Provider reported output beyond the requested token cap',
    );
  return usage === undefined ? report : Object.freeze({ ...report, usage });
}
