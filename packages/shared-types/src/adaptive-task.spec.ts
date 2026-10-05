import { describe, expect, it } from 'vitest';
import {
  ADAPTIVE_TASK_LIMITS,
  TASK_REWRITE_LIMITS,
  isAdaptiveTaskDraft,
  isTaskRewrite,
  type AdaptiveTaskDraft,
  type TaskRewrite,
} from './adaptive-task';

const draft = (): AdaptiveTaskDraft => ({
  operation: 'SHRINK_TASK',
  sessionId: 's1',
  sourceTaskId: 't1',
  conceptId: 'c1',
  sourceEstimatedMinutes: 8,
  estimatedMinutes: 2,
  focus: { source: 'concept-key-point', index: 0, text: 'BST order is preserved.' },
  requiresConfirmation: true,
});

describe('adaptive task draft contract', () => {
  it('accepts a bounded, confirmation-required draft after JSON round-trip', () => {
    expect(isAdaptiveTaskDraft(JSON.parse(JSON.stringify(draft())))).toBe(true);
    expect(
      isAdaptiveTaskDraft({
        ...draft(),
        focus: { source: 'material-sentence', text: '树的顺序保持不变。' },
      }),
    ).toBe(true);
  });
  it.each([
    null,
    [],
    'text',
    new Date(),
    { ...draft(), operation: 'SPLIT_TASK' },
    { ...draft(), requiresConfirmation: false },
    { ...draft(), estimatedMinutes: Infinity },
    { ...draft(), sourceEstimatedMinutes: NaN },
    { ...draft(), estimatedMinutes: 0 },
    { ...draft(), estimatedMinutes: 6 },
    { ...draft(), sourceEstimatedMinutes: 2 },
    { ...draft(), sessionId: '' },
    { ...draft(), sourceTaskId: ' ' },
    { ...draft(), conceptId: 'x'.repeat(ADAPTIVE_TASK_LIMITS.idCharacters + 1) },
    { ...draft(), extra: undefined },
    { ...draft(), execute: () => {} },
    { ...draft(), focus: { source: 'model', text: 'invented' } },
    { ...draft(), focus: { source: 'concept-key-point', index: -1, text: 'point' } },
    { ...draft(), focus: { source: 'concept-key-point', index: 0.5, text: 'point' } },
    {
      ...draft(),
      focus: { source: 'concept-key-point', index: ADAPTIVE_TASK_LIMITS.keyPoints, text: 'point' },
    },
    { ...draft(), focus: { source: 'material-sentence', index: 0, text: 'point' } },
    { ...draft(), focus: { source: 'material-sentence', text: ' ' } },
    {
      ...draft(),
      focus: {
        source: 'material-sentence',
        text: 'x'.repeat(ADAPTIVE_TASK_LIMITS.focusCharacters + 1),
      },
    },
  ])('rejects malformed or unbounded data %#', (value) => {
    expect(isAdaptiveTaskDraft(value)).toBe(false);
  });
  it('bounds Unicode by code points, without silently clipping the grounding evidence', () => {
    const text = '😀'.repeat(ADAPTIVE_TASK_LIMITS.focusCharacters);
    expect(isAdaptiveTaskDraft({ ...draft(), focus: { source: 'material-sentence', text } })).toBe(
      true,
    );
    expect(
      isAdaptiveTaskDraft({
        ...draft(),
        focus: { source: 'material-sentence', text: text + '😀' },
      }),
    ).toBe(false);
  });
  it('rejects accessors without running them, inherited records and symbol metadata', () => {
    let reads = 0;
    const accessor = {
      ...draft(),
      get sessionId() {
        reads += 1;
        return 's1';
      },
    };
    expect(isAdaptiveTaskDraft(accessor)).toBe(false);
    expect(reads).toBe(0);
    // Eight own data properties on a non-`Object.prototype` prototype: unlike a prototype-only
    // object, which is also empty, this can only be rejected by the prototype rule itself.
    expect(isAdaptiveTaskDraft(Object.assign(Object.create({}), draft()))).toBe(false);
    expect(isAdaptiveTaskDraft({ ...draft(), [Symbol('metadata')]: 'secret' })).toBe(false);
  });
});

const rewrite = (): TaskRewrite => ({
  action: 'MICRO_START',
  taskId: 't1',
  steps: [
    {
      text: 'Remove the root and write down what happens to the left subtree.',
      estimatedMinutes: 2,
    },
  ],
  estimatedMinutes: 2,
  sourceEstimatedMinutes: 8,
});

describe('task rewrite contract', () => {
  it('accepts a narrower rewrite after JSON round-trip', () => {
    expect(isTaskRewrite(JSON.parse(JSON.stringify(rewrite())))).toBe(true);
    expect(
      isTaskRewrite({
        ...rewrite(),
        action: 'SIMPLIFY',
        steps: [
          { text: 'first', estimatedMinutes: 2 },
          { text: 'second', estimatedMinutes: 3 },
        ],
        estimatedMinutes: 5,
      }),
    ).toBe(true);
  });

  it.each([
    null,
    [],
    'text',
    new Date(),
    { ...rewrite(), action: 'BREAK' },
    { ...rewrite(), action: 'micro_start' },
    { ...rewrite(), taskId: '' },
    { ...rewrite(), taskId: ' ' },
    { ...rewrite(), taskId: 'x'.repeat(ADAPTIVE_TASK_LIMITS.idCharacters + 1) },
    { ...rewrite(), steps: [] },
    { ...rewrite(), steps: 'not a list' },
    { ...rewrite(), steps: ['not a step object'] },
    { ...rewrite(), steps: [{ text: 'step' }] },
    { ...rewrite(), steps: [{ text: '', estimatedMinutes: 2 }] },
    { ...rewrite(), steps: [{ text: ' ', estimatedMinutes: 2 }] },
    {
      ...rewrite(),
      steps: [{ text: 'x'.repeat(TASK_REWRITE_LIMITS.stepCharacters + 1), estimatedMinutes: 2 }],
    },
    { ...rewrite(), steps: [{ text: 'step', estimatedMinutes: 0 }] },
    { ...rewrite(), steps: [{ text: 'step', estimatedMinutes: 6 }] },
    {
      ...rewrite(),
      steps: Array.from({ length: TASK_REWRITE_LIMITS.steps + 1 }, () => ({
        text: 'step',
        estimatedMinutes: 1,
      })),
      estimatedMinutes: TASK_REWRITE_LIMITS.steps + 1,
    },
    // The total has to be the steps', not a number that happens to sit beside them.
    { ...rewrite(), estimatedMinutes: 1 },
    { ...rewrite(), estimatedMinutes: 3 },
    { ...rewrite(), estimatedMinutes: 1.5 },
    // Not narrower than the task it replaces, so there is nothing for it to rewrite.
    { ...rewrite(), sourceEstimatedMinutes: 2 },
    { ...rewrite(), sourceEstimatedMinutes: 8, estimatedMinutes: 8 },
    { ...rewrite(), sourceEstimatedMinutes: NaN },
    { ...rewrite(), extra: undefined },
    { ...rewrite(), execute: () => {} },
  ])('rejects %p', (value) => {
    expect(isTaskRewrite(value)).toBe(false);
  });

  it('rejects accessors without running them and inherited records', () => {
    let reads = 0;
    const accessor = {
      ...rewrite(),
      get taskId() {
        reads += 1;
        return 't1';
      },
    };
    expect(isTaskRewrite(accessor)).toBe(false);
    expect(reads).toBe(0);
    expect(isTaskRewrite(Object.assign(Object.create({}), rewrite()))).toBe(false);
  });
});
