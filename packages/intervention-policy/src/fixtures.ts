import type { Intervention, LearningEvent, MicroTask } from '@focusloop/shared-types';
import { createInitialState, type StateEngineState } from '@focusloop/learning-state';

export const T0 = '2026-01-01T00:00:00.000Z';

export function at(offsetMs: number): string {
  return new Date(Date.parse(T0) + offsetMs).toISOString();
}

export function engineWith(patch: Partial<StateEngineState> = {}): StateEngineState {
  return { ...createInitialState(T0), ...patch };
}

export function eventWith(
  type: LearningEvent['type'],
  atIso: string,
  payload: Record<string, unknown> = {},
): LearningEvent {
  return {
    id: `${type}:${atIso}`,
    sessionId: 'session-1',
    at: atIso,
    type,
    source: 'user',
    payload,
  } as LearningEvent;
}

export function interventionWith(
  shownAt: string,
  action: Intervention['action'] = 'HINT',
): Intervention {
  return {
    id: `intervention-${shownAt}`,
    sessionId: 'session-1',
    at: shownAt,
    state: 'CONFUSED',
    action,
    reason: 'fixture',
    shownAt,
  };
}

export function taskWith(overrides: Partial<MicroTask> = {}): MicroTask {
  return {
    id: 't1',
    courseId: 'course-1',
    conceptId: 'c1',
    title: 'Read one',
    instructions: 'Read it',
    kind: 'read',
    estimatedMinutes: 5,
    order: 0,
    ...overrides,
  };
}
