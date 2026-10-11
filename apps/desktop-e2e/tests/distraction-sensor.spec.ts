import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { hermeticEnv } from '../hermetic-env.mjs';

const MAIN = resolve(__dirname, '..', '..', 'desktop', 'dist', 'main', 'main.cjs');

/**
 * #254: the app notices the learner leaving on its own.
 *
 * Before this, the only thing that could tell FocusLoop the learner had gone was the browser
 * extension — so on a machine without one the feature did nothing at all, and the developer bar's
 * buttons were the only way to demonstrate it. This launch turns the app's own sensor on (every
 * other spec runs with it off, for determinism) and takes the window away from itself the way the
 * learner does: by blurring it.
 *
 * The assertion is on the *event log*, not on the state chip. The chip is downstream of the state
 * engine's thresholds and of a tick, so asserting on it would make this test a second, weaker copy
 * of the interruption tests; what is new here is that an event with `source: 'system'` exists at all
 * when nobody sent it over the socket.
 */
test('the app records the window losing focus by itself', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'focusloop-sensor-'));
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${profile}`],
    env: { ...hermeticEnv(), FOCUSLOOP_DISTRACTION_SENSOR: '1' },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.getByTestId('course-card').first().getByTestId('start-session').click();
    await page.getByTestId('start-task').first().click();
    await expect(page.getByTestId('state')).toHaveAttribute('data-state', 'FOCUSED');

    /*
     * The window has to be genuinely in the foreground first, and that is a fact about the machine
     * rather than about the app: `win.blur()` on a window that was never focused reports nothing,
     * exactly as the sensor intends (a launch that opens behind another window is not the learner
     * leaving). macOS refuses to let an application take the foreground without user intent, so on a
     * runner where that happens there is nothing to observe and saying so is the honest outcome —
     * the alternative is a red suite that means "this OS would not focus a window", which the unit
     * tests already cover from the other side.
     */
    const focused = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window === undefined) return false;
      window.show();
      window.focus();
      return window.isFocused();
    });
    test.skip(
      !focused,
      'this machine would not give the window focus, so there is no absence to report',
    );

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.blur();
    });

    const systemLeaving = async (): Promise<number> =>
      page.evaluate(async () => {
        const snapshot = await globalThis.focusloop.getCurrentSession();
        if (snapshot === null) return 0;
        const events = await globalThis.focusloop.listEvents(snapshot.session.id);
        return events.filter((event) => event.type === 'TAB_LEFT' && event.source === 'system')
          .length;
      });

    await expect.poll(systemLeaving, { timeout: 20_000 }).toBeGreaterThan(0);

    // And the other direction: coming back is measured, not assumed, and lands as the same source.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.focus();
    });

    const systemReturning = async (): Promise<number> =>
      page.evaluate(async () => {
        const snapshot = await globalThis.focusloop.getCurrentSession();
        if (snapshot === null) return 0;
        const events = await globalThis.focusloop.listEvents(snapshot.session.id);
        return events.filter((event) => event.type === 'TAB_RETURNED' && event.source === 'system')
          .length;
      });

    await expect.poll(systemReturning, { timeout: 20_000 }).toBeGreaterThan(0);
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

test('a launch with the sensor off records no system observation at all', async () => {
  /*
   * The other half, and the one that keeps every other spec honest: with the switch off the app must
   * be exactly as blind as it was — no system-sourced events, whatever the machine's focus does while
   * the suite runs.
   */
  const profile = mkdtempSync(join(tmpdir(), 'focusloop-sensor-off-'));
  const app: ElectronApplication = await electron.launch({
    args: [MAIN, `--user-data-dir=${profile}`],
    env: hermeticEnv(),
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.getByTestId('course-card').first().getByTestId('start-session').click();
    await page.getByTestId('start-task').first().click();

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.blur();
    });

    // Long enough to cover several ticks: the sensor's window is the ticker, so a missing switch
    // would show up within one of them rather than eventually.
    await page.waitForTimeout(6_000);

    const systemEvents = await page.evaluate(async () => {
      const snapshot = await globalThis.focusloop.getCurrentSession();
      if (snapshot === null) return -1;
      const events = await globalThis.focusloop.listEvents(snapshot.session.id);
      /*
       * The sensor's own vocabulary, not every `source: 'system'` event: `SESSION_STARTED` is written
       * by the engine with that source too, so a filter on the source alone would count the very
       * event that began the session and fail for a reason unrelated to the switch.
       */
      const observed = new Set(['TAB_LEFT', 'TAB_RETURNED', 'IDLE_STARTED', 'IDLE_ENDED']);
      return events.filter((event) => event.source === 'system' && observed.has(event.type)).length;
    });
    expect(systemEvents).toBe(0);
    // And the session is still where it was: nothing observed, nothing changed.
    await expect(page.getByTestId('state')).toHaveAttribute('data-state', 'FOCUSED');
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
