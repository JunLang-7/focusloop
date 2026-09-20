import { describe, expect, it } from 'vitest';
import type { Intervention, LearningEvent } from '@focusloop/shared-types';
import { DOMAIN_MESSAGE_KEYS, STUCK_REASONS } from '@focusloop/shared-types';
import {
  ACTION_FOR_STUCK_REASON,
  createIntervention,
  decideIntervention,
  type DecideInterventionInput,
} from './policy';
import { resolvePolicyConfig, type InterventionPolicyConfig } from './config';
import { at, engineWith, eventWith, interventionWith, T0, taskWith } from './fixtures';

function decide(
  patch: Partial<DecideInterventionInput> = {},
  config: Partial<InterventionPolicyConfig> = {},
) {
  return decideIntervention(
    {
      engineState: engineWith(),
      recentEvents: [],
      shownInterventions: [],
      currentTask: null,
      now: T0,
      ...patch,
    },
    config,
  );
}

describe('intervention policy — the learner asks for help (AG2)', () => {
  const asked = (payload: Record<string, unknown>, atIso = T0): LearningEvent[] => [
    eventWith('HELP_REQUESTED', atIso, payload),
  ];

  it('answers a request that lands inside the cooldown', () => {
    /*
     * The cooldown exists to stop the agent speaking up unasked. A request is the opposite of that, and
     * this fails if the request handling is ever moved below the cooldown: with an intervention shown a
     * second earlier, the cooldown would return NO_ACTION first.
     */
    const decision = decide({
      engineState: engineWith({ state: 'FOCUSED', currentTaskId: 't1' }),
      recentEvents: asked({ taskId: 't1', reason: 'too-big' }),
      shownInterventions: [interventionWith(at(-1_000))],
      now: T0,
    });

    expect(decision.action).toBe('SIMPLIFY');
    expect(decision.reason.key).toBe('reason.stuck.too-big');
  });

  it.each([
    ['cannot-start', 'MICRO_START'],
    ['do-not-understand', 'EXAMPLE'],
    ['too-big', 'SIMPLIFY'],
    ['went-wrong', 'HINT'],
    ['cannot-recall', 'HINT'],
    ['tired', 'BREAK'],
  ])('answers %s with %s', (reason, action) => {
    const decision = decide({
      engineState: engineWith({ state: 'FOCUSED', currentTaskId: 't1' }),
      recentEvents: asked({ reason }),
      now: T0,
    });

    expect(decision.action).toBe(action);
  });

  /**
   * The whole table, both halves of every row.
   *
   * The premise of the feature is that what happens next *and* what the learner is told depend on the
   * kind of stuck. Asserting the action alone leaves the wording unpinned: swapping two reasons that
   * share an action — `went-wrong` and `cannot-recall` both land on HINT — would show the learner the
   * wrong explanation with every test still green.
   *
   * `STUCK_REASONS` is the list the picker offers, so a reason that is in the vocabulary and missing
   * from a table is a failure here rather than a NO_ACTION the learner discovers.
   *
   * Two things about this test are worth knowing before changing it. The reason key is asserted as a
   * *literal*, which is what gives it teeth. The action is compared against `ACTION_FOR_STUCK_REASON`,
   * which is the table the policy itself reads — so on its own that half is a tautology that can never
   * fail, and the action side of the table is pinned by the hard-coded pairs in the `it.each` above.
   * That test is not redundant with this one; do not delete it.
   */
  it.each([...STUCK_REASONS])('answers %s with its own action and its own words', (reason) => {
    const decision = decide({
      engineState: engineWith({ state: 'FOCUSED', currentTaskId: 't1' }),
      recentEvents: asked({ reason }),
      now: T0,
    });

    expect(decision).toMatchObject({
      action: ACTION_FOR_STUCK_REASON[reason],
      reason: { key: `reason.stuck.${reason}` },
    });
  });

  it('marks the answer with the request it is answering', () => {
    /*
     * The record that makes "has this been answered" a fact rather than a guess. Without it the only
     * evidence is a timestamp, and a timestamp cannot tell an answer from anything else shown in the
     * same millisecond.
     */
    const decision = decide({
      engineState: engineWith({ state: 'FOCUSED', currentTaskId: 't1' }),
      recentEvents: asked({ reason: 'tired' }),
      now: T0,
    });

    expect(decision.answersRequestId).toBe(`HELP_REQUESTED:${T0}`);
  });

  it('does not answer the same request twice', () => {
    // An intervention is persisted as an intervention, not as an event, so the request stays the most
    // recent event after it has been answered. Without the "already answered" test this answers on
    // every tick, for ever.
    const decision = decide({
      engineState: engineWith({ state: 'FOCUSED', currentTaskId: 't1' }),
      recentEvents: asked({ reason: 'tired' }),
      shownInterventions: [interventionWith(T0, 'BREAK', `HELP_REQUESTED:${T0}`)],
      now: at(1_000),
    });

    expect(decision.action).toBe('NO_ACTION');
  });

  it('still answers a request that shares its millisecond with something unrelated', () => {
    /*
     * The defect the id exists to remove. Answering a request happens inside the same dispatch that
     * wrote it, and anything else shown in that dispatch carries the same timestamp — so a comparison
     * on `shownAt` reads the request as already answered and the learner's press is met with silence.
     * An intervention that does not record this request cannot have been its answer.
     */
    const decision = decide({
      engineState: engineWith({ state: 'FOCUSED', currentTaskId: 't1' }),
      recentEvents: asked({ reason: 'tired' }),
      shownInterventions: [interventionWith(T0, 'HINT')],
      now: T0,
    });

    expect(decision.action).toBe('BREAK');
    expect(decision.reason.key).toBe('reason.stuck.tired');
  });

  it('does not treat an answer to a different request as an answer to this one', () => {
    // Two presses, one answer: the second press is still owed an answer of its own.
    const decision = decide({
      engineState: engineWith({ state: 'FOCUSED', currentTaskId: 't1' }),
      recentEvents: asked({ reason: 'tired' }),
      shownInterventions: [interventionWith(T0, 'BREAK', `HELP_REQUESTED:${at(-5_000)}`)],
      now: at(1_000),
    });

    expect(decision.action).toBe('BREAK');
  });

  it('falls back to the state rules when no reason was given', () => {
    // "They did not say" is not one of the reasons. CONFUSED with two wrong answers has a rule of its
    // own, and that rule has to be what answers.
    const decision = decide({
      engineState: engineWith({ state: 'CONFUSED', consecutiveIncorrect: 2, currentTaskId: 't1' }),
      recentEvents: asked({ taskId: 't1' }),
      now: T0,
    });

    expect(decision.action).toBe('EXAMPLE');
    expect(decision.reason.key).toBe('reason.confused.example');
  });

  it('ignores a reason it does not recognise', () => {
    // Events are read back out of the store. A hand-edited row must not be able to name a reason this
    // build has never heard of and get an action for it.
    const decision = decide({
      engineState: engineWith({ state: 'FOCUSED', currentTaskId: 't1' }),
      recentEvents: asked({ reason: 'cannot_start' }),
      now: T0,
    });

    expect(decision.action).toBe('NO_ACTION');
  });

  it('is still bounded by the session budget', () => {
    // Asking is not a way around the thing that stops the agent becoming the distraction.
    const decision = decide(
      {
        engineState: engineWith({ state: 'FOCUSED', currentTaskId: 't1' }),
        recentEvents: asked({ reason: 'tired' }),
        shownInterventions: [interventionWith(at(-60_000))],
        now: T0,
      },
      { maxInterventionsPerSession: 1 },
    );

    expect(decision.action).toBe('NO_ACTION');
    expect(decision.reason.key).toBe('reason.budget');
  });
});

describe('intervention policy — quiet by default', () => {
  it('does nothing while the learner is focused', () => {
    const decision = decide({ engineState: engineWith({ state: 'FOCUSED', currentTaskId: 't1' }) });
    expect(decision.action).toBe('NO_ACTION');
  });

  it('does nothing in the initial READY state', () => {
    expect(decide().action).toBe('NO_ACTION');
  });

  it('does nothing while the learner is merely distracted', () => {
    const decision = decide({
      engineState: engineWith({ state: 'DISTRACTED', awaySince: T0 }),
      now: at(1_000),
    });
    expect(decision.action).toBe('NO_ACTION');
    expect(decision.reason.key).toBe('reason.distracted');
  });

  it('does nothing while resuming', () => {
    expect(decide({ engineState: engineWith({ state: 'RESUMING' }) }).action).toBe('NO_ACTION');
  });

  it('never returns an action without a reason', () => {
    const states = [
      'READY',
      'FOCUSED',
      'DISTRACTED',
      'CONFUSED',
      'OVERLOADED',
      'INTERRUPTED',
      'INITIATION_FRICTION',
      'RESUMING',
    ] as const;
    for (const state of states) {
      const decision = decide({ engineState: engineWith({ state }) });
      expect(DOMAIN_MESSAGE_KEYS).toContain(decision.reason.key);
      expect(decision.confidence).toBeGreaterThanOrEqual(0);
      expect(decision.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('intervention policy — state driven actions', () => {
  it('offers RESUME when the learner is back from an interruption', () => {
    const decision = decide({
      engineState: engineWith({ state: 'INTERRUPTED', awaitingResume: true }),
    });
    expect(decision).toMatchObject({ action: 'RESUME', confidence: 1 });
  });

  it('offers BREAK when overloaded', () => {
    const decision = decide({ engineState: engineWith({ state: 'OVERLOADED' }) });
    expect(decision.action).toBe('BREAK');
    expect(decision.estimatedMinutes).toBe(5);
  });

  it('offers HINT when confused after a single failure', () => {
    const decision = decide({
      engineState: engineWith({ state: 'CONFUSED', consecutiveIncorrect: 1 }),
    });
    expect(decision.action).toBe('HINT');
  });

  it('escalates to EXAMPLE after repeated failures', () => {
    const decision = decide({
      engineState: engineWith({ state: 'CONFUSED', consecutiveIncorrect: 2 }),
    });
    expect(decision.action).toBe('EXAMPLE');
  });

  it('offers MICRO_START when the learner cannot begin', () => {
    const decision = decide({ engineState: engineWith({ state: 'INITIATION_FRICTION' }) });
    expect(decision.action).toBe('MICRO_START');
  });

  it('asks a self-explanation question after one wrong answer', () => {
    const decision = decide({
      engineState: engineWith({ state: 'FOCUSED', consecutiveIncorrect: 1, currentTaskId: 't1' }),
      currentTask: taskWith(),
      now: at(60_000),
    });
    expect(decision.action).toBe('QUESTION');
  });

  it('suggests SIMPLIFY when a task runs far past its estimate', () => {
    const decision = decide({
      engineState: engineWith({ state: 'FOCUSED', currentTaskId: 't1', taskStartedAt: T0 }),
      currentTask: taskWith({ estimatedMinutes: 5 }),
      now: at(15 * 60_000),
    });
    expect(decision.action).toBe('SIMPLIFY');
    expect(decision.reason.key).toBe('reason.simplify');
  });

  it('does not SIMPLIFY inside the estimate', () => {
    const decision = decide({
      engineState: engineWith({ state: 'FOCUSED', currentTaskId: 't1', taskStartedAt: T0 }),
      currentTask: taskWith({ estimatedMinutes: 5 }),
      now: at(6 * 60_000),
    });
    expect(decision.action).toBe('NO_ACTION');
  });
});

describe('intervention policy — anti-nagging', () => {
  it('stays quiet inside the cooldown window', () => {
    const decision = decide({
      engineState: engineWith({ state: 'CONFUSED' }),
      shownInterventions: [interventionWith(at(10_000))],
      now: at(30_000),
    });
    expect(decision.action).toBe('NO_ACTION');
    expect(decision.reason.key).toBe('reason.cooldown');
  });

  it('acts again once the cooldown has passed', () => {
    const decision = decide({
      engineState: engineWith({ state: 'CONFUSED' }),
      shownInterventions: [interventionWith(at(10_000))],
      now: at(200_000),
    });
    expect(decision.action).toBe('HINT');
  });

  it('still offers RESUME inside the cooldown — it is the one that matters', () => {
    const decision = decide({
      engineState: engineWith({ state: 'INTERRUPTED', awaitingResume: true }),
      shownInterventions: [interventionWith(at(10_000))],
      now: at(20_000),
    });
    expect(decision.action).toBe('RESUME');
  });

  it('stops entirely once the session budget is spent', () => {
    const shownInterventions: Intervention[] = Array.from({ length: 12 }, (_, index) =>
      interventionWith(at(index * 200_000)),
    );
    const decision = decide({
      engineState: engineWith({ state: 'CONFUSED' }),
      shownInterventions,
      now: at(12 * 200_000),
    });
    expect(decision.action).toBe('NO_ACTION');
    expect(decision.reason.key).toBe('reason.budget');
  });

  it('backs off after a dismissed resume', () => {
    const decision = decide({
      engineState: engineWith({ state: 'CONFUSED' }),
      recentEvents: [eventWith('RESUME_DISMISSED', at(10_000), { checkpointId: 'cp1' })],
      now: at(30_000),
    });
    expect(decision.action).toBe('NO_ACTION');
    expect(decision.reason.key).toBe('reason.resume.dismissed');
  });

  it('answers a reasoned request made inside the dismissed-resume back-off', () => {
    /*
     * The back-off is a rule against the agent speaking *unasked*, so it does not apply to a press —
     * the same argument the cooldown above it was already fixed for. Left below the request, this
     * returned NO_ACTION: the learner saw nothing at all, and two minutes later the reason they gave
     * was answered with the reason from a request they had made in the meantime. Dismissing a resume
     * card and then saying why you are stuck is an ordinary pair of actions, not a corner.
     */
    const decision = decide({
      engineState: engineWith({ state: 'CONFUSED', currentTaskId: 't1' }),
      recentEvents: [
        eventWith('RESUME_DISMISSED', at(-20_000), { checkpointId: 'cp1' }),
        eventWith('HELP_REQUESTED', T0, { taskId: 't1', reason: 'tired' }),
      ],
      now: T0,
    });

    expect(decision.action).toBe('BREAK');
    expect(decision.reason.key).toBe('reason.stuck.tired');
  });

  it('still applies the dismissed-resume back-off to a request with no reason', () => {
    // The other half of the same rule: with nothing stated there is no reason to break the silence, so
    // the back-off stands and the state rules are not consulted either.
    const decision = decide({
      engineState: engineWith({ state: 'CONFUSED', currentTaskId: 't1' }),
      recentEvents: [
        eventWith('RESUME_DISMISSED', at(-20_000), { checkpointId: 'cp1' }),
        eventWith('HELP_REQUESTED', T0, { taskId: 't1' }),
      ],
      now: T0,
    });

    expect(decision.action).toBe('NO_ACTION');
    expect(decision.reason.key).toBe('reason.resume.dismissed');
  });

  it('re-offers resume even if an earlier card was dismissed', () => {
    const decision = decide({
      engineState: engineWith({ state: 'INTERRUPTED', awaitingResume: true }),
      recentEvents: [eventWith('RESUME_DISMISSED', at(10_000), { checkpointId: 'cp1' })],
      now: at(30_000),
    });
    expect(decision.action).toBe('RESUME');
  });

  it('forgets the dismissal once the cooldown elapses', () => {
    const decision = decide({
      engineState: engineWith({ state: 'CONFUSED' }),
      recentEvents: [eventWith('RESUME_DISMISSED', at(10_000), { checkpointId: 'cp1' })],
      now: at(200_000),
    });
    expect(decision.action).toBe('HINT');
  });
});

describe('intervention policy — determinism and configuration', () => {
  it('is deterministic for the same input', () => {
    const input: DecideInterventionInput = {
      engineState: engineWith({ state: 'CONFUSED', consecutiveIncorrect: 2 }),
      recentEvents: [],
      shownInterventions: [],
      currentTask: taskWith(),
      now: at(1_000),
    };
    expect(decideIntervention(input)).toEqual(decideIntervention(input));
  });

  it('honours custom thresholds', () => {
    const input: DecideInterventionInput = {
      engineState: engineWith({ state: 'FOCUSED', currentTaskId: 't1', taskStartedAt: T0 }),
      recentEvents: [],
      shownInterventions: [],
      currentTask: taskWith({ estimatedMinutes: 5 }),
      now: at(8 * 60_000),
    };
    expect(decideIntervention(input).action).toBe('NO_ACTION');
    expect(decideIntervention(input, { simplifyAfterRatio: 1 }).action).toBe('SIMPLIFY');
  });

  it('rejects invalid configuration', () => {
    expect(() => resolvePolicyConfig({ cooldownMs: -1 })).toThrow(RangeError);
    expect(() => resolvePolicyConfig({ simplifyAfterRatio: Number.NaN })).toThrow(RangeError);
  });
});

describe('createIntervention', () => {
  it('turns a decision into a persisted record', () => {
    const record = createIntervention(
      { id: 'i1', sessionId: 's1', at: T0 },
      {
        action: 'HINT',
        state: 'CONFUSED',
        reason: { key: 'reason.confused.hint', params: {} },
        confidence: 0.7,
        estimatedMinutes: 2,
      },
    );
    expect(record).toEqual({
      id: 'i1',
      sessionId: 's1',
      at: T0,
      state: 'CONFUSED',
      action: 'HINT',
      reason: { key: 'reason.confused.hint', params: {} },
      shownAt: T0,
    });
  });
});
