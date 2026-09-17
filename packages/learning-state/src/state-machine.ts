import type { LearningEvent, LearningState, StateTransition } from '@focusloop/shared-types';
import type { StateEngineConfig } from './config';
import { resolveStateEngineConfig } from './config';

/**
 * Everything the engine remembers between events. Deliberately a plain,
 * serialisable value object: it can be persisted, replayed and asserted on.
 */
export interface StateEngineState {
  readonly state: LearningState;
  /** When the current `state` was entered. */
  readonly since: string;
  readonly lastEventAt: string;
  readonly currentTaskId: string | null;
  readonly lastActiveTaskId: string | null;
  readonly taskStartedAt: string | null;
  readonly completedTaskIds: readonly string[];
  readonly consecutiveIncorrect: number;
  /** ISO timestamps of recent HELP_REQUESTED events. */
  readonly recentHelpRequests: readonly string[];
  /** Set while the learner is away from the learning tab. */
  readonly awaySince: string | null;
  /** Set while the learner is idle. */
  readonly idleSince: string | null;
  /** True once a resume card has been offered and not yet resolved. */
  readonly awaitingResume: boolean;
  readonly transitionCount: number;
  /** Bounded ring of seen event ids (duplicate / race protection). */
  readonly recentEventIds: readonly string[];
}

export interface StateEngineResult {
  readonly state: StateEngineState;
  readonly transition: StateTransition | null;
  /** True when the event was already applied and was therefore ignored. */
  readonly duplicate: boolean;
}

export function createInitialState(at: string): StateEngineState {
  return {
    state: 'READY',
    since: at,
    lastEventAt: at,
    currentTaskId: null,
    lastActiveTaskId: null,
    taskStartedAt: null,
    completedTaskIds: [],
    consecutiveIncorrect: 0,
    recentHelpRequests: [],
    awaySince: null,
    idleSince: null,
    awaitingResume: false,
    transitionCount: 0,
    recentEventIds: [],
  };
}

function transitionTo(
  state: StateEngineState,
  to: LearningState,
  at: string,
  event: LearningEvent,
  reason: string,
): StateEngineResult {
  if (to === state.state) {
    return { state: { ...state, lastEventAt: at }, transition: null, duplicate: false };
  }
  return {
    state: {
      ...state,
      state: to,
      since: at,
      lastEventAt: at,
      transitionCount: state.transitionCount + 1,
    },
    transition: {
      from: state.state,
      to,
      at,
      eventId: event.id,
      eventType: event.type,
      reason,
    },
    duplicate: false,
  };
}

function withState(
  state: StateEngineState,
  at: string,
  patch: Partial<StateEngineState>,
): StateEngineState {
  return { ...state, ...patch, lastEventAt: at };
}

function isTaskId(payload: Record<string, unknown> | { taskId?: string }): string | null {
  const value = (payload as { taskId?: unknown }).taskId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function withinWindow(timestamps: readonly string[], nowMs: number, windowMs: number): string[] {
  return timestamps.filter((ts) => {
    const ms = Date.parse(ts);
    return Number.isFinite(ms) && nowMs - ms <= windowMs;
  });
}

/**
 * The state engine's only entry point: a pure reducer.
 *
 * It never calls an LLM, never reads the clock implicitly (the event carries
 * `at`) and never mutates its input.
 */
export function reduceState(
  previous: StateEngineState,
  event: LearningEvent,
  configOverrides: Partial<StateEngineConfig> = {},
): StateEngineResult {
  const config = resolveStateEngineConfig(configOverrides);
  const at = event.at;
  const nowMs = Date.parse(at);

  if (previous.recentEventIds.includes(event.id)) {
    return { state: previous, transition: null, duplicate: true };
  }

  const seen = [...previous.recentEventIds, event.id].slice(-config.dedupeWindowSize);
  const base: StateEngineState = { ...previous, recentEventIds: seen };

  const apply = (
    to: LearningState,
    reason: string,
    patch: Partial<StateEngineState> = {},
  ): StateEngineResult => {
    const patched = withState(base, at, patch);
    return transitionTo(patched, to, at, event, reason);
  };

  const stay = (patch: Partial<StateEngineState> = {}): StateEngineResult => ({
    state: withState(base, at, patch),
    transition: null,
    duplicate: false,
  });

  switch (event.type) {
    case 'SESSION_STARTED':
      return apply('READY', 'session started', {
        currentTaskId: null,
        lastActiveTaskId: null,
        taskStartedAt: null,
        completedTaskIds: [],
        consecutiveIncorrect: 0,
        recentHelpRequests: [],
        awaySince: null,
        idleSince: null,
        awaitingResume: false,
      });

    case 'TASK_STARTED': {
      const taskId = isTaskId(event.payload);
      if (taskId === null) return stay();
      return apply('FOCUSED', 'task started', {
        currentTaskId: taskId,
        lastActiveTaskId: taskId,
        taskStartedAt: at,
        awaitingResume: false,
      });
    }

    case 'TASK_COMPLETED': {
      const taskId = isTaskId(event.payload);
      if (taskId === null) return stay();
      const completed = previous.completedTaskIds.includes(taskId)
        ? previous.completedTaskIds
        : [...previous.completedTaskIds, taskId];
      return apply('FOCUSED', 'task completed', {
        completedTaskIds: completed,
        currentTaskId: previous.currentTaskId === taskId ? null : previous.currentTaskId,
        taskStartedAt: null,
        consecutiveIncorrect: 0,
        awaySince: null,
        idleSince: null,
        awaitingResume: false,
      });
    }

    case 'HELP_REQUESTED': {
      const recent = withinWindow(
        [...previous.recentHelpRequests, at],
        nowMs,
        config.helpRequestWindowMs,
      );
      if (recent.length >= config.helpRequestOverloadThreshold) {
        return apply('OVERLOADED', `${recent.length} help requests within window`, {
          recentHelpRequests: recent,
        });
      }
      return apply('CONFUSED', 'help requested', { recentHelpRequests: recent });
    }

    case 'QUIZ_INCORRECT': {
      const consecutive = previous.consecutiveIncorrect + 1;
      if (consecutive >= config.consecutiveIncorrectThreshold) {
        return apply('CONFUSED', `${consecutive} consecutive incorrect answers`, {
          consecutiveIncorrect: consecutive,
        });
      }
      return stay({ consecutiveIncorrect: consecutive });
    }

    case 'QUIZ_CORRECT':
      return apply('FOCUSED', 'quiz answered correctly', { consecutiveIncorrect: 0 });

    case 'TAB_LEFT':
      return apply('DISTRACTED', 'left the learning tab', {
        awaySince: at,
        awaitingResume: false,
      });

    case 'TAB_RETURNED': {
      const awayMs = event.payload.awayMs;
      if (awayMs >= config.tabLeftThresholdMs) {
        return apply('INTERRUPTED', `away for ${awayMs}ms`, {
          awaySince: null,
          awaitingResume: true,
        });
      }
      const restored: LearningState = previous.currentTaskId !== null ? 'FOCUSED' : 'READY';
      return apply(restored, 'returned within threshold', {
        awaySince: null,
        idleSince: null,
      });
    }

    case 'IDLE_STARTED':
      return apply('DISTRACTED', 'idle started', { idleSince: at });

    case 'IDLE_ENDED': {
      const idleMs = event.payload.idleMs;
      if (idleMs >= config.idleThresholdMs) {
        return apply('INTERRUPTED', `idle for ${idleMs}ms`, {
          idleSince: null,
          awaySince: null,
          awaitingResume: true,
        });
      }
      const restored: LearningState = previous.currentTaskId !== null ? 'FOCUSED' : 'READY';
      return apply(restored, 'idle ended within threshold', { idleSince: null });
    }

    case 'RESUME_REQUESTED':
      return apply('RESUMING', 'resume accepted', { awaitingResume: false });

    case 'RESUME_DISMISSED': {
      const restored: LearningState = previous.currentTaskId !== null ? 'FOCUSED' : 'READY';
      return apply(restored, 'resume dismissed', { awaitingResume: false });
    }

    case 'SESSION_ENDED':
      return apply('READY', 'session ended', {
        currentTaskId: null,
        taskStartedAt: null,
        awaySince: null,
        idleSince: null,
        awaitingResume: false,
      });

    default: {
      const exhaustive: never = event;
      return stay({ lastEventAt: (exhaustive as LearningEvent).at });
    }
  }
}

/**
 * Time-based evaluation. Called by the host on a tick (and by tests directly)
 * because pure reducers cannot observe the passage of time on their own.
 */
export function evaluateTimeBasedState(
  previous: StateEngineState,
  now: string,
  configOverrides: Partial<StateEngineConfig> = {},
): StateEngineResult {
  const config = resolveStateEngineConfig(configOverrides);
  const nowMs = Date.parse(now);

  const awaySinceMs = previous.awaySince === null ? null : Date.parse(previous.awaySince);
  const idleSinceMs = previous.idleSince === null ? null : Date.parse(previous.idleSince);

  const awayElapsed =
    awaySinceMs !== null && Number.isFinite(awaySinceMs) ? nowMs - awaySinceMs : 0;
  const idleElapsed =
    idleSinceMs !== null && Number.isFinite(idleSinceMs) ? nowMs - idleSinceMs : 0;

  const toInterrupted =
    awayElapsed >= config.tabLeftThresholdMs || idleElapsed >= config.idleThresholdMs;

  if (toInterrupted && previous.state !== 'INTERRUPTED' && previous.state !== 'RESUMING') {
    const reason =
      awayElapsed >= config.tabLeftThresholdMs
        ? `away for ${awayElapsed}ms`
        : `idle for ${idleElapsed}ms`;
    return {
      state: {
        ...previous,
        state: 'INTERRUPTED',
        since: now,
        lastEventAt: now,
        awaitingResume: true,
        transitionCount: previous.transitionCount + 1,
      },
      transition: {
        from: previous.state,
        to: 'INTERRUPTED',
        at: now,
        eventId: `time-eval:${now}`,
        eventType: awayElapsed >= config.tabLeftThresholdMs ? 'TAB_LEFT' : 'IDLE_STARTED',
        reason,
      },
      duplicate: false,
    };
  }

  const readyElapsed = nowMs - Date.parse(previous.since);
  if (
    (previous.state === 'READY' || previous.state === 'RESUMING') &&
    Number.isFinite(readyElapsed) &&
    readyElapsed >= config.initiationFrictionThresholdMs &&
    previous.currentTaskId === null
  ) {
    return {
      state: {
        ...previous,
        state: 'INITIATION_FRICTION',
        since: now,
        lastEventAt: now,
        transitionCount: previous.transitionCount + 1,
      },
      transition: {
        from: previous.state,
        to: 'INITIATION_FRICTION',
        at: now,
        eventId: `time-eval:${now}`,
        eventType: 'IDLE_STARTED',
        reason: `no task started within ${readyElapsed}ms`,
      },
      duplicate: false,
    };
  }

  return { state: previous, transition: null, duplicate: false };
}
