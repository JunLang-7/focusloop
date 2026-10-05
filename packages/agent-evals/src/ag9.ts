import type {
  AIProvider,
  CompletionResult,
  RuntimeRequestData,
  RuntimeSchema,
} from '@focusloop/shared-types';
import {
  AgentRuntime,
  ProviderError,
  type StructuredExecuteOptions,
} from '@focusloop/llm-provider';
import type { JsonValue } from './scenario';

/*
 * The AG9 scenarios drive the production runtime with scripted providers, so what they assert is the
 * real failure contract rather than a description of it. Everything is synthetic: no network, no
 * credentials, and the pause before a transport retry is injected so a scenario can assert the exact
 * backoff instead of measuring a clock.
 *
 * `executeStructured` is the sharpest door to test, because it is the one that must never accept
 * prose as a validated value.
 */

const SCHEMA: RuntimeSchema = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
};

/** What a schema-valid answer looks like: the deterministic local step the learner can act on. */
const LOCAL_STEP = '{"answer":"local step"}';

/** Prose a model might return for a structured request. It cannot satisfy the schema. */
const PROSE = 'Take a breath, then do only the first step.';

const PRIMARY = 'deepseek';
const FALLBACK = 'mock';

/** The transient reasons the policy retries, plus the malformed answer only the schema retry covers. */
const FAILURES = [
  'offline',
  'timeout',
  'rate-limited',
  'unauthorized',
  'bad-response',
  'malformed',
] as const;

type ScriptedFailure = (typeof FAILURES)[number];

type Timing = 'none' | 'cancel-during-primary' | 'expired';

interface Ag9Spec {
  readonly failure: ScriptedFailure;
  /** `prose` makes the deterministic fallback itself unusable, which is the exhaustion case. */
  readonly fallback: 'valid' | 'prose';
  readonly timing: Timing;
  readonly maxAttemptsPerProvider?: number;
}

function readSpec(input: JsonValue): Ag9Spec {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('AG9 input must be an object');
  }
  const failure = input['failure'];
  if (typeof failure !== 'string' || !FAILURES.includes(failure as ScriptedFailure)) {
    throw new Error(`AG9 failure must be one of ${FAILURES.join(', ')}`);
  }
  const fallback = input['fallback'] ?? 'valid';
  if (fallback !== 'valid' && fallback !== 'prose') {
    throw new Error('AG9 fallback must be valid or prose');
  }
  const timing = input['timing'] ?? 'none';
  if (timing !== 'none' && timing !== 'cancel-during-primary' && timing !== 'expired') {
    throw new Error('AG9 timing must be none, cancel-during-primary or expired');
  }
  const limit = input['maxAttemptsPerProvider'];
  if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit))) {
    throw new Error('AG9 maxAttemptsPerProvider must be an integer');
  }
  return {
    failure: failure as ScriptedFailure,
    fallback,
    timing,
    ...(limit === undefined ? {} : { maxAttemptsPerProvider: limit }),
  };
}

function answer(text: string, providerId: string): CompletionResult {
  return { text, providerId, model: `${providerId}-model`, latencyMs: 0 };
}

interface CallCounts {
  primary: number;
  fallback: number;
}

/**
 * One AG9 scenario: a scripted failure, the runtime's response to it, and the observable cost.
 *
 * The output is JSON rather than a domain result on purpose: what a scenario may assert is the
 * contract — status, whether a validated value came back, whether it was committed, which provider
 * answered, why the primary was dropped, and how many attempts and pauses that took.
 */
export async function runAg9Scenario(input: JsonValue): Promise<JsonValue> {
  const spec = readSpec(input);
  const calls: CallCounts = { primary: 0, fallback: 0 };
  const pauses: number[] = [];
  let committed = false;
  const controller = new AbortController();

  const primary: AIProvider = {
    id: PRIMARY,
    model: `${PRIMARY}-model`,
    offline: false,
    async complete(): Promise<CompletionResult> {
      calls.primary += 1;
      if (spec.timing === 'cancel-during-primary') {
        // The learner cancels while the first call is in flight. The reason on the error is
        // deliberately a transient one: cancellation is classified by the stopped signal, and a
        // scenario that only passes because the reason was terminal would prove nothing.
        controller.abort();
        throw new ProviderError('offline', PRIMARY, 'cancelled in flight');
      }
      if (spec.failure === 'malformed') return answer(PROSE, PRIMARY);
      return Promise.reject(new ProviderError(spec.failure, PRIMARY, `synthetic ${spec.failure}`));
    },
  };

  const fallback: AIProvider = {
    id: FALLBACK,
    model: `${FALLBACK}-model`,
    offline: true,
    async complete(): Promise<CompletionResult> {
      calls.fallback += 1;
      return answer(spec.fallback === 'valid' ? LOCAL_STEP : PROSE, FALLBACK);
    },
  };

  const runtime = new AgentRuntime({ primary, fallback });
  const data: RuntimeRequestData = {
    skill: 'ag9',
    schema: SCHEMA,
    contextBudget: 400,
    tokenBudget: 64,
    // An already-passed deadline is the deterministic way to express "the caller ran out of time".
    ...(spec.timing === 'expired' ? { deadlineMs: Date.now() - 1 } : {}),
  };
  const options: StructuredExecuteOptions = {
    signal: controller.signal,
    retry: {
      // Injected: the exact backoff is asserted, not timed. A real timer here would make the
      // scenarios slow and the assertions about it unreliable.
      sleep: async (delayMs: number) => {
        pauses.push(delayMs);
      },
      ...(spec.maxAttemptsPerProvider === undefined
        ? {}
        : { maxTransportAttempts: spec.maxAttemptsPerProvider }),
    },
    commit: () => {
      committed = true;
    },
  };

  const result = await runtime.executeStructured<{ answer: string }>(
    data,
    { prompt: 'synthetic question', maxTokens: 16 },
    options,
  );

  const reason: string | null = result.failureReason ?? null;
  return {
    status: result.status,
    value: result.value === undefined ? null : { answer: result.value.answer },
    committed,
    providerId: result.providerId,
    degraded: result.degraded,
    failureReason: reason,
    primaryCalls: calls.primary,
    fallbackCalls: calls.fallback,
    pauses,
  };
}

/**
 * The scenario runner's executor form is synchronous, and the runtime is not. This pre-pass awaits
 * every scenario and returns the outputs the harness asserts against, which keeps the assertions
 * themselves free of clocks, I/O and promises.
 */
export async function buildAg9Outputs(
  scenarios: readonly { readonly id: string; readonly input: JsonValue }[],
): Promise<Record<string, JsonValue>> {
  const entries = await Promise.all(
    scenarios.map(async (scenario) => [scenario.id, await runAg9Scenario(scenario.input)] as const),
  );
  return Object.fromEntries(entries);
}
