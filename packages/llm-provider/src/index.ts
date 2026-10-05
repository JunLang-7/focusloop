/**
 * The provider adapter.
 *
 * Offline by default: the mock provider is a required part of the system, and the remote adapter is
 * only constructed when a key is supplied. The registry is what decides between them, so no caller
 * has to know whether a network is available.
 *
 * `AgentRuntime` is the façade skills call: serialisable request data, in-process
 * abort/timeout options, text vs structured output modes.
 */

export * from './errors';
export * from './mock-provider';
export * from './deepseek-provider';
export * from './registry';
export * from './runtime';
export type { ProviderStreamEvent, StreamingProvider } from './streaming';
export {
  MAX_STREAM_OUTPUT_CHARACTERS,
  MAX_SSE_FRAME_BYTES,
  StreamInterruptedError,
} from './streaming';
export { DEFAULT_RUNTIME_BUDGETS, RuntimeBudgetError } from './budgets';
export type { BudgetExecutionOptions, RuntimeBudgetErrorCode } from './budgets';
export {
  backoffDelay,
  classifyFailure,
  createAttemptLedger,
  DEFAULT_RETRY_POLICY,
  primaryCallLimit,
  resolveRetryPolicy,
  RETRYABLE_FAILURE_REASONS,
  TERMINAL_FAILURE_REASONS,
} from './retry-policy';
export type {
  AttemptLedger,
  FailureClassification,
  RetryPolicy,
  RetrySleep,
  RetrySleepControls,
} from './retry-policy';
export type { ExecutableAIProvider, ProviderExecutionOptions } from './execution';
/**
 * The cancellation/deadline vocabulary, so a caller can classify an outcome without string-matching
 * `error.name`: `ExecutionAbortError` is the learner's own cancellation, `RuntimeDeadlineError` is
 * the runtime deadline, and everything else is a provider failure that may still degrade.
 */
export { ExecutionAbortError, isExecutionAbort, RuntimeDeadlineError } from './execution';
export type { ExecutionOptions } from './execution';
