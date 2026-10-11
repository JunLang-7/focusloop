import { describe, expect, it } from 'vitest';
import { ProviderError, createProviderSelection } from '@focusloop/llm-provider';
import {
  ADAPTIVE_TASK_LIMITS,
  TUTOR_LIMITS,
  type AIProvider,
  type CompletionRequest,
} from '@focusloop/shared-types';
import { createTestEngine, type TestEngine } from './test-helpers';
import { DEMO_COURSE_ID } from './demo-course';
import { buildRescueGrounding } from './rescue-grounding';
import { acceptRescueSuggestion, buildRescueSuggestionPrompt } from './rescue-suggestion';

/**
 * The provider-backed HINT/EXAMPLE (#205): a generation pass over the rescue card that obeys the
 * rules the issue sets — offline means today's grounded card and no call; a valid line arrives
 * marked `model-generated`; an invalid or failed generation falls back to the grounded quote and
 * never an empty card; the call runs through the runtime's budgets, once; and the whole pass
 * writes nothing (display-only: steps, event log and stores untouched).
 */
function scriptedProvider(
  replies: readonly string[],
  options: { offline?: boolean; fail?: boolean } = {},
): AIProvider & { readonly prompts: string[] } {
  const prompts: string[] = [];
  let index = 0;
  return {
    id: 'scripted',
    model: 'scripted-1',
    offline: options.offline ?? false,
    prompts,
    complete: async (request: CompletionRequest) => {
      prompts.push(request.prompt);
      if (options.fail === true) throw new ProviderError('offline', 'scripted', 'no network');
      const text = replies[Math.min(index, replies.length - 1)] ?? '';
      index += 1;
      return { text, providerId: 'scripted', model: 'scripted-1', latencyMs: 1 };
    },
  };
}

/** An accepted HINT card — the state in which the card the learner reads actually exists. */
function withActiveRescue(
  provider: AIProvider,
  action: 'hint' | 'break' = 'hint',
): { ctx: TestEngine; sessionId: string; provider: AIProvider & { readonly prompts: string[] } } {
  const ctx = createTestEngine({ providers: createProviderSelection(provider) });
  const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
  ctx.engine.dispatch({
    sessionId: session.id,
    type: 'TASK_STARTED',
    source: 'user',
    payload: { taskId: 'rbt-t1' },
  });
  const asked = ctx.engine.dispatch({
    sessionId: session.id,
    type: 'HELP_REQUESTED',
    source: 'user',
    // `tired` is the single-dispatch path to BREAK the policy tests use; `went-wrong` reaches HINT.
    payload:
      action === 'hint'
        ? { reason: 'went-wrong', taskId: 'rbt-t1' }
        : { reason: 'tired', taskId: 'rbt-t1' },
  });
  if (action === 'break') {
    expect(asked.decision?.action).toBe('BREAK');
  }
  ctx.engine.resolveRescue({
    sessionId: session.id,
    interventionId: asked.interventionId!,
    resolution: 'accept',
  });
  return {
    ctx,
    sessionId: session.id,
    provider: provider as AIProvider & { readonly prompts: string[] },
  };
}

describe('the suggestion line is accepted only inside its bound (pure)', () => {
  it('marks a valid line model-generated and trims it', () => {
    expect(acceptRescueSuggestion('  Picture where an arrow at 3 o’clock lands.  ')).toEqual({
      source: 'model-generated',
      text: 'Picture where an arrow at 3 o’clock lands.',
    });
  });

  it('refuses empty, whitespace and over-bound lines — the fallback, never an empty card', () => {
    expect(acceptRescueSuggestion('')).toBeNull();
    expect(acceptRescueSuggestion('   \n  ')).toBeNull();
    expect(acceptRescueSuggestion('x'.repeat(ADAPTIVE_TASK_LIMITS.focusCharacters + 1))).toBeNull();
    expect(acceptRescueSuggestion('x'.repeat(ADAPTIVE_TASK_LIMITS.focusCharacters))).not.toBeNull();
  });
});

describe('the generation prompt carries what the docs say it carries, bounded (pure)', () => {
  it('anchors on the same grounding the offline card quotes, and fits the tutor input budget', () => {
    const ctx = createTestEngine();
    try {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      ctx.engine.dispatch({
        sessionId: session.id,
        type: 'TASK_STARTED',
        source: 'user',
        payload: { taskId: 'rbt-t1' },
      });
      const context = ctx.engine.getAgentContext().context;
      expect(context).not.toBeNull();
      const built = buildRescueSuggestionPrompt('HINT', context);
      expect(built).not.toBeNull();
      expect(built!.system.length + built!.prompt.length).toBeLessThanOrEqual(
        TUTOR_LIMITS.inputCharacters,
      );
      // Exactly what privacy.md will name: the same passage the offline card quotes, verbatim —
      // asked of production rather than hard-coded, so the docs' sentence tracks the code.
      const anchor = buildRescueGrounding('HINT', context!);
      expect(anchor).not.toBeNull();
      expect(built!.prompt).toContain(anchor!.text);
      expect(built!.prompt).toContain(context!.task.title ?? '');
    } finally {
      ctx.close();
    }
  });

  it('has nothing to build when the context has no grounding to anchor on', () => {
    expect(buildRescueSuggestionPrompt('HINT', null)).toBeNull();
  });
});

describe('provider-backed suggestions on the rescue card (#205)', () => {
  it('offline is the floor: today’s grounded card and not one call made', async () => {
    const provider = scriptedProvider(['never sent'], { offline: true });
    const { ctx, sessionId } = withActiveRescue(provider);
    try {
      const grounded = ctx.engine.getPendingRescue(sessionId);
      expect(grounded?.plan?.grounding?.source).toBe('concept-summary');

      expect(await ctx.engine.suggestRescueText(sessionId)).toBeNull();
      expect(provider.prompts).toEqual([]);

      const after = ctx.engine.getPendingRescue(sessionId);
      expect(after?.plan?.grounding).toEqual(grounded?.plan?.grounding);
    } finally {
      ctx.close();
    }
  });

  it('a valid line replaces the quote, labelled model-generated — one budgeted call, no writes', async () => {
    const provider = scriptedProvider(['Picture where an arrow at 3 o’clock lands.']);
    const { ctx, sessionId } = withActiveRescue(provider);
    try {
      const grounded = ctx.engine.getPendingRescue(sessionId);
      const events = ctx.engine.listEvents(sessionId).length;
      const interventions = ctx.store.listInterventions(sessionId).length;
      const outcomes = ctx.store.listOutcomes(sessionId).length;

      const suggested = await ctx.engine.suggestRescueText(sessionId);
      expect(suggested?.plan?.grounding).toEqual({
        source: 'model-generated',
        text: 'Picture where an arrow at 3 o’clock lands.',
      });
      // Exactly one provider call: the pass is a call, not a loop over reads.
      expect(provider.prompts).toHaveLength(1);
      // Display-only: the deterministic plan is byte-identical apart from the grounding field.
      expect(suggested?.plan?.steps).toEqual(grounded?.plan?.steps);
      expect(suggested?.plan?.source).toBe('deterministic-local');
      expect(suggested?.phase).toBe('active');

      // Nothing anywhere was written by generation.
      expect(ctx.engine.listEvents(sessionId)).toHaveLength(events);
      expect(ctx.store.listInterventions(sessionId)).toHaveLength(interventions);
      expect(ctx.store.listOutcomes(sessionId)).toHaveLength(outcomes);
      expect(ctx.store.listLearnerPreferences(sessionId)).toEqual([]);
    } finally {
      ctx.close();
    }
  });

  it.each([
    ['empty', ''],
    ['over-bound', 'x'.repeat(ADAPTIVE_TASK_LIMITS.focusCharacters + 1)],
  ])('a %s reply falls back to the grounded quote, never an empty card', async (_name, reply) => {
    const provider = scriptedProvider([reply]);
    const { ctx, sessionId } = withActiveRescue(provider);
    try {
      expect(await ctx.engine.suggestRescueText(sessionId)).toBeNull();
      expect(provider.prompts).toHaveLength(1);
      const after = ctx.engine.getPendingRescue(sessionId);
      expect(after?.plan?.grounding?.source).toBe('concept-summary');
      expect(after?.plan?.grounding?.text.length ?? 0).toBeGreaterThan(0);
    } finally {
      ctx.close();
    }
  });

  it('a provider failure falls back the same way — the degraded call changes nothing on screen', async () => {
    const provider = scriptedProvider([], { fail: true });
    const { ctx, sessionId } = withActiveRescue(provider);
    try {
      expect(await ctx.engine.suggestRescueText(sessionId)).toBeNull();
      // The provider was called (the runtime may retry within its own budget) — what matters is
      // that the failure path shows nothing: the card stays grounded.
      expect(provider.prompts.length).toBeGreaterThan(0);
      expect(ctx.engine.getPendingRescue(sessionId)?.plan?.grounding?.source).toBe(
        'concept-summary',
      );
    } finally {
      ctx.close();
    }
  });

  it('offers nothing to generate before acceptance, and never asks about a non-HINT card', async () => {
    const provider = scriptedProvider(['should not be sent']);
    const { ctx, sessionId } = withActiveRescue(provider, 'break');
    try {
      // The active card here is BREAK: no line to write, so no call is made.
      expect(ctx.engine.getPendingRescue(sessionId)?.plan?.action).toBe('BREAK');
      expect(await ctx.engine.suggestRescueText(sessionId)).toBeNull();
      expect(provider.prompts).toEqual([]);
    } finally {
      ctx.close();
    }
  });
});
