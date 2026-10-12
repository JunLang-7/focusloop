import type { SessionProgress } from '@focusloop/shared-types';

export interface ProgressInput {
  readonly sessionId: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly totalTasks: number;
  readonly completedTaskIds: readonly string[];
  /**
   * Time actually spent, when the caller can witness it.
   *
   * The default is the window the session spanned (`startedAt` → `endedAt` or `now`), which is the
   * honest answer for a caller that has nothing else. It is the wrong answer for a session that was
   * left open: the window keeps running while the app is closed, so this is where a fortnight of
   * "study" came from. A caller holding the event log passes the time the app can stand behind
   * instead (`recordedSessionMs` in agent-core), and that value is used as it stands.
   */
  readonly elapsedMs?: number;
  /** "Now" — injected so this stays pure and deterministic. */
  readonly now: string;
}

export function computeSessionProgress(input: ProgressInput): SessionProgress {
  const startMs = Date.parse(input.startedAt);
  const endMs = input.endedAt ? Date.parse(input.endedAt) : Date.parse(input.now);
  const spannedMs =
    Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0;
  const elapsedMs = input.elapsedMs ?? spannedMs;
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
