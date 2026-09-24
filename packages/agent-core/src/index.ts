/**
 * The engine that owns a session.
 *
 * Composes the store, the state machine and the policy into the operations the application asks for
 * — start, dispatch an event, tick, dashboard, insights — and ships the demo course and the
 * deterministic micro-task generator the golden path depends on.
 */

export * from './demo-course';
export * from './micro-task-generator';
export * from './agent-context';
export * from './tutor';
export * from './tutor-ask';
export * from './dashboard';
export * from './insights';
export * from './engine';
/**
 * A supported in-memory harness (deterministic clock + sqlite `:memory:`), used
 * by the bridge and E2E suites. Kept in the public surface on purpose so tests
 * never have to re-implement it.
 */
export * from './test-helpers';
