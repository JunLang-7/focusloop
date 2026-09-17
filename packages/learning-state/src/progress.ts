import type { SessionProgress } from '@focusloop/shared-types';

export interface ProgressInput {
  readonly sessionId: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly totalTasks: number;
  readonly completedTaskIds: readonly string[];
  /** "Now" — injected so this stays pure and deterministic. */
  readonly now: string;
}

export function computeSessionProgress(input: ProgressInput): SessionProgress {
  const startMs = Date.parse(input.startedAt);
  const endMs = input.endedAt ? Date.parse(input.endedAt) : Date.parse(input.now);
  const elapsedMs =
    Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0;
  const total = Math.max(0, input.totalTasks);
  const completed = Math.min(total, input.completedTaskIds.length);
  return {
    sessionId: input.sessionId,
    totalTasks: total,
    completedTasks: completed,
    completionRatio: total === 0 ? 0 : completed / total,
    elapsedMs,
  };
}
