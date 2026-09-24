import { describe, expect, it } from 'vitest';
import { start } from './focus-timer';
import { FocusTimerService } from './focus-timer.service';

describe('FocusTimerService', () => {
  it('keeps an active commitment when the focus page is recreated', () => {
    const service = new FocusTimerService();

    service.sync('session-1', 'task-1', 0);
    service.set(start(service.state(), 0));

    // A route change destroys FocusPage, but the root service is still alive.
    service.sync('session-1', 'task-1', 1_000);

    expect(service.state()).toMatchObject({
      phase: 'active',
      remainingMs: 179_000,
      endAtMs: 180_000,
    });
  });

  it('drops the local commitment when the session or task changes', () => {
    const service = new FocusTimerService();

    service.sync('session-1', 'task-1', 0);
    service.set(start(service.state(), 0));
    service.sync('session-2', 'task-1', 1_000);

    expect(service.state().phase).toBe('ready');
  });
});
