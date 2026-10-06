import {
  ADAPTIVE_TASK_LIMITS,
  AGENT_CONTEXT_LIMITS,
  isAdaptiveTaskDraft,
  type AdaptiveTaskDraft,
  type AdaptiveTaskFocus,
  type AgentContext,
} from '@focusloop/shared-types';

export type ShrinkDraftRefusal =
  | 'missing-context'
  | 'missing-task'
  | 'missing-concept'
  | 'unsupported-task-kind'
  | 'invalid-estimate'
  | 'already-small'
  | 'no-grounded-focus';
export type ShrinkDraftResult =
  | { readonly status: 'suggested'; readonly draft: AdaptiveTaskDraft }
  | { readonly status: 'unavailable'; readonly reason: ShrinkDraftRefusal };

/** Pure offline suggestions: no writes, confirmation, provider calls or execution. */
export function buildShrinkDraft(context: AgentContext | null): ShrinkDraftResult {
  const unavailable = (reason: ShrinkDraftRefusal): ShrinkDraftResult => ({
    status: 'unavailable',
    reason,
  });
  if (context === null || !identifier(context.session.sessionId))
    return unavailable('missing-context');
  if (!identifier(context.task.taskId) || context.task.kind === null)
    return unavailable('missing-task');
  if (!identifier(context.concept.conceptId)) return unavailable('missing-concept');
  // Shrinking a scored quiz into prose would change its assessment semantics, not merely its scope.
  if (context.task.kind !== 'read' && context.task.kind !== 'practice')
    return unavailable('unsupported-task-kind');
  const before = context.task.estimatedMinutes;
  if (typeof before !== 'number' || !Number.isFinite(before) || before <= 0)
    return unavailable('invalid-estimate');
  if (before <= ADAPTIVE_TASK_LIMITS.minMinutes) return unavailable('already-small');
  const focus = groundedFocus(context);
  if (focus === null) return unavailable('no-grounded-focus');
  return {
    status: 'suggested',
    draft: {
      operation: 'SHRINK_TASK',
      sessionId: context.session.sessionId,
      sourceTaskId: context.task.taskId,
      conceptId: context.concept.conceptId,
      sourceEstimatedMinutes: before,
      estimatedMinutes:
        before > ADAPTIVE_TASK_LIMITS.preferredShrinkMinutes
          ? ADAPTIVE_TASK_LIMITS.preferredShrinkMinutes
          : ADAPTIVE_TASK_LIMITS.minMinutes,
      focus,
      requiresConfirmation: true,
    },
  };
}

/** Verify draft provenance against the supplied context; not execution authorization. */
export function matchesShrinkContext(value: unknown, context: AgentContext | null): boolean {
  if (
    !isAdaptiveTaskDraft(value) ||
    context === null ||
    buildShrinkDraft(context).status !== 'suggested'
  )
    return false;
  if (
    value.sessionId !== context.session.sessionId ||
    value.sourceTaskId !== context.task.taskId ||
    value.conceptId !== context.concept.conceptId ||
    value.sourceEstimatedMinutes !== context.task.estimatedMinutes
  )
    return false;
  const text =
    value.focus.source === 'concept-key-point'
      ? focusText(context.concept.keyPoints[value.focus.index], context)
      : materialSentence(context);
  return text !== null && text === value.focus.text;
}

function identifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= ADAPTIVE_TASK_LIMITS.idCharacters * 2 &&
    value === value.trim() &&
    [...value].length <= ADAPTIVE_TASK_LIMITS.idCharacters
  );
}

function focusText(value: unknown, context: AgentContext): string | null {
  if (typeof value !== 'string' || value.length > ADAPTIVE_TASK_LIMITS.focusCharacters * 2)
    return null;
  const text = value.trim();
  if (text.length === 0 || [...text].length > ADAPTIVE_TASK_LIMITS.focusCharacters) return null;
  // Merely reprinting the existing goal with a smaller timer is not a scope change.
  for (const original of [context.task.title, context.task.instructions]) {
    // Do not normalize arbitrarily large source instructions just to compare a bounded snippet.
    if (
      original !== null &&
      original.length <= ADAPTIVE_TASK_LIMITS.focusCharacters * 2 &&
      text === original.trim()
    )
      return null;
  }
  return text;
}

export function materialSentence(context: AgentContext): string | null {
  const text = context.material.text;
  if (
    text.length > AGENT_CONTEXT_LIMITS.materialCharacters * 2 ||
    [...text].length > AGENT_CONTEXT_LIMITS.materialCharacters
  )
    return null;
  // A bounded, anchored lexical extraction, not a model's semantic summary. Preserve the evidence.
  // Chinese sentence terminators do not require spaces; ASCII dots within numbers do not end a sentence.
  const sentence = /^[\s\S]*?(?:[.!?](?=\s|$)|[。！？])/u.exec(text.trim())?.[0];
  return focusText(sentence, context);
}

function groundedFocus(context: AgentContext): AdaptiveTaskFocus | null {
  const points = context.concept.keyPoints.slice(0, ADAPTIVE_TASK_LIMITS.keyPoints);
  for (let index = 0; index < points.length; index += 1) {
    const text = focusText(points[index], context);
    if (text !== null) return { source: 'concept-key-point', index, text };
  }
  const text = materialSentence(context);
  return text === null ? null : { source: 'material-sentence', text };
}

/**
 * The grounded texts a split can be made of, in the order the course lists them.
 *
 * One focus point is a shrink; several are a split, and each one has to pass the same grounding check
 * a single focus does — a step that merely reprints the task's own goal is not a smaller step. A
 * concept with nothing grounded returns nothing, so a caller cannot split what it cannot ground.
 */
export function groundedSplitTexts(context: AgentContext | null): readonly string[] {
  if (context === null) return [];
  const texts: string[] = [];
  for (const point of context.concept.keyPoints.slice(0, ADAPTIVE_TASK_LIMITS.keyPoints)) {
    const text = focusText(point, context);
    if (text !== null) texts.push(text);
  }
  return texts;
}
