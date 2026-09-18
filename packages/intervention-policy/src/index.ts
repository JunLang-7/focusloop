/**
 * When to speak, and when to stay quiet.
 *
 * The policy turns a learner state, a budget and a set of cooldowns into at most one action — or
 * `NO_ACTION`, which is the common case — and records what came of the ones it took.
 */

export * from './config';
export * from './policy';
export * from './outcomes';
