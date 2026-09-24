import { Injectable, signal } from '@angular/core';
import { createFocusTimer, tick, type FocusTimerState } from './focus-timer';

interface FocusTimerOwner {
  readonly sessionId: string;
  readonly taskId: string;
}

/**
 * Keeps the renderer-local focus commitment alive while the learner changes routes.
 *
 * The commitment is deliberately not a domain event or a persisted session field yet, but it must
 * outlive the lazy focus component: destroying that component on `/focus` navigation used to reset
 * an active timer to three minutes. This root service is the smallest boundary that preserves the
 * timer within one renderer lifetime, while `sync` drops it whenever the session or current task
 * changes. Domain state changes such as `HELP_REQUESTED` intentionally do not reset the commitment:
 * the focus page still owns that task and the agent response is rendered alongside it.
 */
@Injectable({ providedIn: 'root' })
export class FocusTimerService {
  readonly state = signal<FocusTimerState>(createFocusTimer());
  private owner: FocusTimerOwner | null = null;

  /** Reconcile the local commitment with the session currently published by the main process. */
  sync(sessionId: string | undefined, taskId: string | undefined, now: number): void {
    if (sessionId === undefined || taskId === undefined) {
      this.owner = null;
      this.state.set(createFocusTimer());
      return;
    }

    const nextOwner = { sessionId, taskId };
    if (
      this.owner === null ||
      this.owner.sessionId !== nextOwner.sessionId ||
      this.owner.taskId !== nextOwner.taskId
    ) {
      this.owner = nextOwner;
      this.state.set(createFocusTimer());
      return;
    }

    this.state.update((value) => tick(value, now));
  }

  /** Replace the local state after an explicit timer transition. */
  set(value: FocusTimerState): void {
    this.state.set(value);
  }

  /** Apply an explicit timer transition without exposing the signal to the page. */
  update(update: (value: FocusTimerState) => FocusTimerState): void {
    this.state.update(update);
  }
}
