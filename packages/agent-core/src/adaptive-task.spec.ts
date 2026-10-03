import { describe, expect, it } from 'vitest';
import type { AgentContext } from '@focusloop/shared-types';
import { isAdaptiveTaskDraft } from '@focusloop/shared-types';
import { buildShrinkDraft, matchesShrinkContext } from './adaptive-task';

function context(): AgentContext {
  return {
    session: {
      sessionId: 's1',
      startedAt: '2026-01-01T00:00:00.000Z',
      elapsedMs: 0,
      completedTasks: 0,
      totalTasks: 3,
    },
    concept: {
      conceptId: 'c1',
      title: 'BST rotation',
      summary: 'A rotation preserves order.',
      keyPoints: ['Compare the order of three nodes.', 'Check the left subtree.'],
    },
    task: {
      taskId: 't1',
      title: 'Understand all rotations',
      instructions: 'Read the whole section and explain rotations.',
      kind: 'read',
      estimatedMinutes: 8,
      step: 1,
      totalSteps: 3,
    },
    material: {
      materialId: 'm1',
      title: 'Trees',
      heading: 'Rotation',
      text: 'The order stays the same. Then inspect the subtree.',
      truncated: false,
    },
    learningState: 'CONFUSED',
    recentEvents: [],
    checkpoint: null,
  };
}

describe('offline SHRINK_TASK drafts', () => {
  it('suggests one grounded key point and reduces the budget without mutating input', () => {
    const input = context();
    const before = JSON.stringify(input);
    const result = buildShrinkDraft(input);
    expect(result).toMatchObject({
      status: 'suggested',
      draft: {
        operation: 'SHRINK_TASK',
        sessionId: 's1',
        sourceTaskId: 't1',
        conceptId: 'c1',
        sourceEstimatedMinutes: 8,
        estimatedMinutes: 2,
        requiresConfirmation: true,
        focus: { source: 'concept-key-point', index: 0, text: 'Compare the order of three nodes.' },
      },
    });
    if (result.status !== 'suggested') throw new Error('Expected suggestion');
    expect(isAdaptiveTaskDraft(result.draft)).toBe(true);
    expect(matchesShrinkContext(result.draft, input)).toBe(true);
    expect(buildShrinkDraft(input)).toEqual(result);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('uses only a complete first material sentence when key points are absent', () => {
    const input = context();
    const result = buildShrinkDraft({ ...input, concept: { ...input.concept, keyPoints: [] } });
    expect(result).toMatchObject({
      status: 'suggested',
      draft: { focus: { source: 'material-sentence', text: 'The order stays the same.' } },
    });
  });
  it.each(['左旋保持二叉搜索树的顺序。后面是另一个目标。', '先比较三个结点！然后看子树。'])(
    'handles Chinese sentence boundaries without English scaffolding',
    (text) => {
      const input = context();
      const result = buildShrinkDraft({
        ...input,
        concept: { ...input.concept, keyPoints: [] },
        material: { ...input.material, text },
      });
      expect(result.status).toBe('suggested');
      if (result.status !== 'suggested') throw new Error('Expected suggestion');
      expect(result.draft.focus.text).toBe(text.slice(0, text.search(/[。！]/) + 1));
    },
  );
  it.each([1.5, 2, 3, 8])(
    'keeps the adapted estimate strictly shorter for source %s',
    (estimatedMinutes) => {
      const input = context();
      const result = buildShrinkDraft({ ...input, task: { ...input.task, estimatedMinutes } });
      expect(result.status).toBe('suggested');
      if (result.status !== 'suggested') throw new Error('Expected suggestion');
      expect(result.draft.estimatedMinutes).toBeGreaterThanOrEqual(1);
      expect(result.draft.estimatedMinutes).toBeLessThan(estimatedMinutes);
    },
  );
  it('refuses unavailable or unsuitable context rather than inventing content', () => {
    const input = context();
    expect(buildShrinkDraft(null)).toEqual({ status: 'unavailable', reason: 'missing-context' });
    expect(buildShrinkDraft({ ...input, task: { ...input.task, taskId: null } })).toEqual({
      status: 'unavailable',
      reason: 'missing-task',
    });
    expect(buildShrinkDraft({ ...input, concept: { ...input.concept, conceptId: null } })).toEqual({
      status: 'unavailable',
      reason: 'missing-concept',
    });
    expect(buildShrinkDraft({ ...input, task: { ...input.task, estimatedMinutes: NaN } })).toEqual({
      status: 'unavailable',
      reason: 'invalid-estimate',
    });
    expect(buildShrinkDraft({ ...input, task: { ...input.task, estimatedMinutes: 1 } })).toEqual({
      status: 'unavailable',
      reason: 'already-small',
    });
    expect(
      buildShrinkDraft({
        ...input,
        concept: { ...input.concept, keyPoints: [] },
        material: { ...input.material, text: '', truncated: true },
      }),
    ).toEqual({ status: 'unavailable', reason: 'no-grounded-focus' });
  });
  it('does not change quiz semantics or merely shorten the original goal timer', () => {
    const input = context();
    expect(buildShrinkDraft({ ...input, task: { ...input.task, kind: 'quiz' } })).toEqual({
      status: 'unavailable',
      reason: 'unsupported-task-kind',
    });
    expect(
      buildShrinkDraft({
        ...input,
        concept: { ...input.concept, keyPoints: [input.task.instructions!] },
        material: { ...input.material, text: '' },
      }),
    ).toEqual({ status: 'unavailable', reason: 'no-grounded-focus' });
  });
  it('extracts a complete sentence from a truncated excerpt without breaking decimal points', () => {
    const input = context();
    const result = buildShrinkDraft({
      ...input,
      concept: { ...input.concept, keyPoints: [] },
      material: {
        ...input.material,
        text: 'The cost is 0.5 units. Incomplete next sentence',
        truncated: true,
      },
    });
    expect(result).toMatchObject({
      status: 'suggested',
      draft: { focus: { text: 'The cost is 0.5 units.' } },
    });
  });
  it('refuses oversized context evidence instead of making an unbounded extraction', () => {
    const input = context();
    const result = buildShrinkDraft({
      ...input,
      concept: { ...input.concept, keyPoints: [] },
      material: { ...input.material, text: 'x'.repeat(1201) + '.' },
    });
    expect(result).toEqual({ status: 'unavailable', reason: 'no-grounded-focus' });
  });
  it('does not use an incomplete truncated excerpt, clip a huge point or search unbounded point lists', () => {
    const input = context();
    const material = {
      ...input.material,
      text: 'Incomplete evidence with no final punctuation',
      truncated: true,
    };
    expect(
      buildShrinkDraft({ ...input, concept: { ...input.concept, keyPoints: [] }, material }),
    ).toEqual({ status: 'unavailable', reason: 'no-grounded-focus' });
    expect(
      buildShrinkDraft({
        ...input,
        concept: {
          ...input.concept,
          keyPoints: Array(6).fill('x'.repeat(601)).concat('hidden point'),
        },
        material,
      }),
    ).toEqual({ status: 'unavailable', reason: 'no-grounded-focus' });
  });
  it('does not copy task instructions, event/checkpoint metadata or material identifiers into the draft', () => {
    const input = context();
    const extended: AgentContext & { privateField: string } = {
      ...input,
      privateField: 'secret',
      task: { ...input.task, instructions: 'private-raw-instructions' },
      material: { ...input.material, materialId: 'private-material-id' },
      recentEvents: [
        {
          type: 'HELP_REQUESTED',
          at: '2026-01-01T00:00:00.000Z',
          source: 'user',
          payload: { taskId: 'private-event-task' },
        },
      ],
      checkpoint: {
        conceptTitle: 'private-checkpoint-title',
        goal: 'private-checkpoint-goal',
        mastered: [],
        unresolved: [],
        currentTaskTitle: 'private-checkpoint-task',
        currentStep: 1,
        frictionState: 'CONFUSED',
        nextBestAction: { key: 'action.read.summarise', params: {} },
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    };
    const result = buildShrinkDraft(extended);
    expect(result.status).toBe('suggested');
    const serialized = JSON.stringify(result);
    for (const secret of [
      'private-raw-instructions',
      'private-material-id',
      'private-event-task',
      'private-checkpoint',
      'privateField',
      'secret',
    ])
      expect(serialized).not.toContain(secret);
  });
  it('does not confuse shape validation with grounding or authorization', () => {
    const input = context();
    const result = buildShrinkDraft(input);
    if (result.status !== 'suggested') throw new Error('Expected suggestion');
    expect(
      matchesShrinkContext(
        { ...result.draft, focus: { ...result.draft.focus, text: 'Invented task goal.' } },
        input,
      ),
    ).toBe(false);
    expect(
      matchesShrinkContext(result.draft, {
        ...input,
        session: { ...input.session, sessionId: 's2' },
      }),
    ).toBe(false);
    expect(
      matchesShrinkContext(result.draft, {
        ...input,
        task: { ...input.task, estimatedMinutes: 3 },
      }),
    ).toBe(false);
    expect(
      matchesShrinkContext(result.draft, {
        ...input,
        concept: { ...input.concept, conceptId: 'c2' },
      }),
    ).toBe(false);
    expect(
      matchesShrinkContext(result.draft, { ...input, task: { ...input.task, taskId: 't2' } }),
    ).toBe(false);
    expect(matchesShrinkContext(result.draft, null)).toBe(false);
  });
});
