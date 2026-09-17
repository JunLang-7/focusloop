import type { StateEngineState } from '@focusloop/learning-state';
import { evaluateTimeBasedState } from '@focusloop/learning-state';

export interface InterruptionThresholds {
  readonly tabLeftThresholdMs?: number;
  readonly idleThresholdMs?: number;
}

export type InterruptionKind = 'tab-left' | 'idle' | 'none';

export interface InterruptionStatus {
  readonly interrupted: boolean;
  readonly kind: InterruptionKind;
  readonly elapsedMs: number;
  readonly reason: string;
}

/**
 * Detection on a tick. Delegates to the state engine so the thresholds and the
 * rules live in exactly one place.
 */
export function detectInterruption(
  engineState: StateEngineState,
  now: string,
  thresholds: InterruptionThresholds = {},
): InterruptionStatus {
  const result = evaluateTimeBasedState(engineState, now, thresholds);
  const transition = result.transition;

  if (transition === null || transition.to !== 'INTERRUPTED') {
    return {
      interrupted: engineState.state === 'INTERRUPTED',
      kind: 'none',
      elapsedMs: interruptionElapsedMs(engineState, now),
      reason: engineState.state === 'INTERRUPTED' ? 'already interrupted' : 'no interruption',
    };
  }

  return {
    interrupted: true,
    kind: transition.eventType === 'TAB_LEFT' ? 'tab-left' : 'idle',
    elapsedMs: interruptionElapsedMs(engineState, now),
    reason: transition.reason,
  };
}

function interruptionElapsedMs(engineState: StateEngineState, now: string): number {
  const since = engineState.awaySince ?? engineState.idleSince;
  if (since === null) return 0;
  const delta = Date.parse(now) - Date.parse(since);
  return Number.isFinite(delta) && delta > 0 ? delta : 0;
}

/**
 * A resume card is only useful once the learner is interrupted and has not yet
 * answered the previous offer.
 */
export function shouldOfferResume(engineState: StateEngineState): boolean {
  return engineState.state === 'INTERRUPTED' && engineState.awaitingResume;
}

/** True while the learner is away from the task but not yet interrupted. */
export function isAwayOrIdle(engineState: StateEngineState): boolean {
  return engineState.awaySince !== null || engineState.idleSince !== null;
}
