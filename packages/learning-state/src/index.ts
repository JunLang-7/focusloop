/**
 * The state engine.
 *
 * `reduceState` folds one event into the learner's current state; `evaluateTimeBasedState` answers
 * the question a pure reducer cannot — what the passage of time means — and is called on a tick.
 * Both are pure and take their clock, which is what makes every transition an ordinary test.
 */

export * from './config';
export * from './state-machine';
export * from './progress';
