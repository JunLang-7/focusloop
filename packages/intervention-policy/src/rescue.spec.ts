import { describe, expect, it } from 'vitest';
import type { InterventionDecision, LearningEvent, RescueAction } from '@focusloop/shared-types';
import { buildRescuePlan, buildRescueView, evaluateRescueSuccess } from './rescue';

const T0 = '2026-01-01T00:00:00.000Z';
const at = (ms: number): string => new Date(Date.parse(T0) + ms).toISOString();
function decision(action: RescueAction): InterventionDecision {
  return {
    action,
    state: 'CONFUSED',
    reason: { key: 'reason.stuck.went-wrong', params: {} },
    confidence: 1,
    estimatedMinutes: 2,
  };
}
function event(
  id: string,
  type: LearningEvent['type'],
  when: string,
  taskId = 'task-1',
  sessionId = 'session-1',
): LearningEvent {
  return { id, type, at: when, sessionId, source: 'user', payload: { taskId } } as LearningEvent;
}
const plan = buildRescuePlan(decision('HINT'), {
  interventionId: 'i1',
  sessionId: 'session-1',
  taskId: 'task-1',
})!;

describe('AG2 rescue plans', () => {
  it.each([
    ['MICRO_START', 1, 5],
    ['SIMPLIFY', 3, 3],
    ['HINT', 2, 2],
    ['EXAMPLE', 2, 4],
    ['BREAK', 2, 5],
  ] as const)('builds a bounded %s plan', (action, steps, minutes) => {
    const result = buildRescuePlan(decision(action), {
      interventionId: 'i1',
      sessionId: 's1',
      taskId: 't1',
    });
    expect(result).toMatchObject({
      action,
      estimatedMinutes: minutes,
      source: 'deterministic-local',
    });
    expect(result?.steps).toHaveLength(steps);
  });
  it('omits non-rescue actions and refuses unusable identifiers', () => {
    expect(
      buildRescuePlan({ interventionId: 'i1', sessionId: 's1', action: 'QUESTION' }),
    ).toBeNull();
    expect(buildRescuePlan({ interventionId: '', sessionId: 's1', action: 'HINT' })).toBeNull();
    expect(buildRescuePlan({ interventionId: 'i1', sessionId: '', action: 'HINT' })).toBeNull();
    expect(
      buildRescuePlan({
        interventionId: '',
        sessionId: 's1',
        action: 'HINT',
        intervention: { id: 'embedded', sessionId: 'embedded-session', action: 'HINT' },
      }),
    ).toBeNull();
    expect(
      buildRescuePlan({
        intervention: { id: 'embedded', sessionId: 'embedded-session', action: 'HINT' },
      }),
    ).toMatchObject({ interventionId: 'embedded', sessionId: 'embedded-session' });
    expect(
      buildRescuePlan({ interventionId: 'i1', sessionId: 's1', taskId: '', action: 'HINT' }),
    ).toBeNull();
  });
  it('resolves action from the decision and embedded intervention, and rejects an empty task', () => {
    expect(
      buildRescuePlan({
        interventionId: 'i1',
        sessionId: 's1',
        decision: decision('BREAK'),
      })?.action,
    ).toBe('BREAK');
    expect(
      buildRescuePlan({ intervention: { id: 'i2', sessionId: 's2', action: 'EXAMPLE' } })?.action,
    ).toBe('EXAMPLE');
    expect(
      buildRescuePlan({ interventionId: 'i1', sessionId: 's1', taskId: '', action: 'HINT' }),
    ).toBeNull();
  });
  it('reveals the plan only after acceptance', () => {
    const seed = { interventionId: 'i1', sessionId: 's1', taskId: 't1' };
    expect(buildRescueView(decision('HINT'), seed, 'offered').plan).toBeNull();
    expect(buildRescueView(decision('HINT'), seed, 'active').plan?.action).toBe('HINT');
  });
});

describe('AG2 rescue success evaluator', () => {
  it('counts Continue and same-task completion or quiz evidence in the open/closed window', () => {
    expect(
      evaluateRescueSuccess({
        plan,
        outcome: { accepted: true, dismissed: false, at: T0, continuedAt: at(300_000) },
        events: [],
        now: at(300_000),
      }).status,
    ).toBe('succeeded');
    for (const type of ['TASK_COMPLETED', 'QUIZ_CORRECT'] as const) {
      expect(
        evaluateRescueSuccess({
          plan,
          acceptedAt: T0,
          events: [event(type, type, at(1))],
          now: at(2),
        }).status,
      ).toBe('succeeded');
    }
    expect(
      evaluateRescueSuccess({
        plan,
        acceptedAt: T0,
        events: [event('edge', 'TASK_COMPLETED', at(300_000))],
        now: at(300_000),
      }).status,
    ).toBe('succeeded');
  });
  it('classifies repeat help before progress and deduplicates ids', () => {
    const duplicate = evaluateRescueSuccess({
      plan,
      acceptedAt: T0,
      events: [event('same', 'TASK_COMPLETED', at(1)), event('same', 'HELP_REQUESTED', at(2))],
      now: at(3),
    });
    expect(duplicate.status).toBe('succeeded');
    expect(duplicate.evidenceEventIds).toEqual(['same']);
    expect(duplicate.repeatedHelpEventIds).toEqual([]);
    const result = evaluateRescueSuccess({
      plan,
      acceptedAt: T0,
      events: [event('done', 'TASK_COMPLETED', at(1)), event('help', 'HELP_REQUESTED', at(2))],
      now: at(3),
    });
    expect(result.status).toBe('repeated-help');
    expect(
      evaluateRescueSuccess({
        plan,
        acceptedAt: T0,
        events: [event('help', 'HELP_REQUESTED', at(1))],
        now: at(2),
      }).status,
    ).toBe('repeated-help');
  });
  it('ignores cross-session, cross-task, duplicate and future events', () => {
    const events = [
      event('duplicate', 'TASK_COMPLETED', at(1), 'other'),
      event('duplicate', 'TASK_COMPLETED', at(1)),
      event('session', 'QUIZ_CORRECT', at(1), 'task-1', 'elsewhere'),
      event('future', 'TASK_COMPLETED', at(10)),
    ];
    expect(evaluateRescueSuccess({ plan, acceptedAt: T0, events, now: at(2) }).status).toBe(
      'pending',
    );
  });
  it('remains pending until the inclusive deadline, then expires; validates the window', () => {
    expect(
      evaluateRescueSuccess({ plan, acceptedAt: T0, events: [], now: at(299_999) }).status,
    ).toBe('pending');
    expect(
      evaluateRescueSuccess({ plan, acceptedAt: T0, events: [], now: at(300_000) }).status,
    ).toBe('expired');
    expect(() =>
      evaluateRescueSuccess({
        plan,
        acceptedAt: T0,
        events: [],
        now: at(1),
        rescueSuccessWindowMs: -1,
      }),
    ).toThrow(RangeError);
  });
  it('uses accepted outcome time, ignores invalid evidence and accepts untasked events for an untasked plan', () => {
    const untasked = buildRescuePlan(decision('HINT'), {
      interventionId: 'i2',
      sessionId: 'session-1',
    })!;
    expect(
      evaluateRescueSuccess({
        plan: untasked,
        outcome: { accepted: true, dismissed: false, at: T0 },
        events: [
          { ...event('other-task', 'TASK_COMPLETED', at(1)), payload: { taskId: 'task-1' } },
          { ...event('untasked', 'QUIZ_CORRECT', at(2)), payload: {} },
        ],
        now: at(3),
      }),
    ).toMatchObject({ status: 'succeeded', evidenceEventIds: ['untasked'] });
    expect(
      evaluateRescueSuccess({
        plan,
        outcome: { accepted: true, dismissed: true, at: T0 },
        events: [event('ignored', 'TASK_COMPLETED', at(1))],
        now: at(300_000),
      }),
    ).toMatchObject({ status: 'pending', evidenceEventIds: [] });
  });
});
