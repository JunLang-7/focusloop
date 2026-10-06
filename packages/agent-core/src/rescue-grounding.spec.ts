import { describe, expect, it } from 'vitest';
import { ADAPTIVE_TASK_LIMITS, type AgentContext } from '@focusloop/shared-types';
import { buildRescueGrounding } from './rescue-grounding';

function context(overrides: {
  summary?: string | null;
  keyPoints?: readonly string[];
  materialText?: string;
  instructions?: string | null;
}): AgentContext {
  return {
    session: {
      sessionId: 's1',
      startedAt: '2026-10-05T00:00:00.000Z',
      elapsedMs: 0,
      completedTasks: 0,
      totalTasks: 3,
    },
    concept: {
      conceptId: 'k1',
      title: 'Rotations',
      summary: 'summary' in overrides ? overrides.summary! : 'A rotation restructures three nodes.',
      keyPoints: overrides.keyPoints ?? [
        'in-order traversal is sorted',
        'a rotation keeps the order',
      ],
    },
    task: {
      taskId: 't1',
      title: 'Read rotations',
      instructions: overrides.instructions ?? 'Read the section.',
      kind: 'read',
      estimatedMinutes: 6,
      step: 1,
      totalSteps: 3,
    },
    material: {
      materialId: 'm1',
      title: 'Notes',
      heading: 'Rotations',
      text: overrides.materialText ?? 'A left rotation lifts the right child. It keeps the order.',
      truncated: false,
    },
    learningState: 'CONFUSED',
    recentEvents: [],
    checkpoint: null,
  };
}

describe('buildRescueGrounding', () => {
  it('gives a HINT the idea of the concept rather than a piece of the answer', () => {
    expect(buildRescueGrounding('HINT', context({}))).toEqual({
      source: 'concept-summary',
      text: 'A rotation restructures three nodes.',
    });
  });

  it('falls back to the first key point when the concept has no summary', () => {
    expect(buildRescueGrounding('HINT', context({ summary: null }))).toEqual({
      source: 'concept-key-point',
      text: 'in-order traversal is sorted',
    });
  });

  it("gives an EXAMPLE a passage of the learner's own material", () => {
    expect(buildRescueGrounding('EXAMPLE', context({}))).toEqual({
      source: 'material-sentence',
      text: 'A left rotation lifts the right child.',
    });
  });

  it('gives an EXAMPLE a key point when there is no material', () => {
    expect(buildRescueGrounding('EXAMPLE', context({ materialText: '' }))).toEqual({
      source: 'concept-key-point',
      text: 'a rotation keeps the order',
    });
  });

  it('does not reprint the task as if it were help', () => {
    expect(
      buildRescueGrounding('HINT', context({ summary: 'Read the section.', keyPoints: [] })),
    ).toBeNull();
  });

  it('clips to the same bound the shrink drafts use', () => {
    const long = 'x'.repeat(ADAPTIVE_TASK_LIMITS.focusCharacters + 50);
    expect(buildRescueGrounding('HINT', context({ summary: long, keyPoints: [] }))).toBeNull();
  });

  it.each(['MICRO_START', 'SIMPLIFY', 'BREAK'] as const)('grounds nothing for %s', (action) => {
    expect(buildRescueGrounding(action, context({}))).toBeNull();
  });

  it('grounds nothing without a context', () => {
    expect(buildRescueGrounding('HINT', null)).toBeNull();
    expect(buildRescueGrounding('EXAMPLE', null)).toBeNull();
  });
});
