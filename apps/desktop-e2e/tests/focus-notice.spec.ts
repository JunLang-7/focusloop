import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { hermeticEnv } from '../hermetic-env.mjs';
import type { FocusLoopApi } from '@focusloop/shared-types';

declare global {
  interface Window {
    focusloop: FocusLoopApi;
  }
}

const MAIN = resolve(__dirname, '..', '..', 'desktop', 'dist', 'main', 'main.cjs');

/**
 * A touch boundary is not an overlap.
 *
 * The task is laid out to end exactly where the notice begins, so the two boxes meet at a fractional
 * coordinate. After `scrollIntoViewIfNeeded` the fractional scroll offset puts one a hundredth of a
 * pixel past the other — 0.09px at 800x700, with the 15px scrollbars this test forces — which is not
 * something a learner can see and not something float comparison can decide. One pixel is the
 * tolerance: a real overlap is orders of magnitude larger, so this cannot hide one.
 */
const TOUCH_TOLERANCE = 1;

/** The actual task and its action, not merely the notice, must remain usable. */
async function taskIsUnobstructed(page: Page): Promise<void> {
  await page.locator('.focus-task--active').scrollIntoViewIfNeeded();
  await page.getByTestId('complete-task').scrollIntoViewIfNeeded();
  /*
   * Named before it is measured. A null box below would otherwise surface as arithmetic on null,
   * which says nothing about what was wrong; a task that is not on screen now fails saying so, and
   * the geometry assertions keep their meaning because they still run against real boxes.
   */
  await expect(page.locator('.focus-task--active')).toBeVisible();
  const task = await page.locator('.focus-task--active').boundingBox();
  const action = await page.getByTestId('complete-task').boundingBox();
  const notice = await page.getByTestId('focus-notice').boundingBox();
  const simulator =
    (await page.locator('.simulator').count()) > 0
      ? await page.locator('.simulator').boundingBox()
      : null;
  expect(task).not.toBeNull();
  expect(action).not.toBeNull();
  expect(notice).not.toBeNull();
  expect(task!.y + task!.height).toBeLessThanOrEqual(notice!.y + TOUCH_TOLERANCE);
  expect(action!.y + action!.height).toBeLessThanOrEqual(notice!.y + TOUCH_TOLERANCE);
  expect(notice!.y + notice!.height).toBeLessThanOrEqual(
    (simulator?.y ?? page.viewportSize()!.height) + TOUCH_TOLERANCE,
  );
  await expect(page.getByTestId('complete-task')).toBeInViewport();
}

test('one bottom slot preserves pending choices, priority, keyboard access and the task', async ({
  browserName: _browserName,
}, info) => {
  const profile = mkdtempSync(join(tmpdir(), 'focusloop-notice-'));
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${profile}`],
    env: hermeticEnv(),
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.clock.install();
    await page.getByTestId('course-card').first().getByTestId('start-session').click();
    await page.getByTestId('start-task').first().click();
    const notice = page.getByTestId('focus-notice');
    const toggle = page.getByTestId('focus-notice-toggle');

    /*
     * The renderer arms its 250ms timer interval only after its TASK_STARTED dispatch has answered,
     * and a fake clock fires the timers that already exist. Jumping before that lands is a silent
     * no-op — nothing ticks, the commitment never expires, the notice never appears — and which side
     * of the race the run lands on is what made this test environment-dependent (#152). So the clock
     * is jumped only once the timer is demonstrably ticking under it.
     */
    const clock = page.locator('.focus-clock__value');
    await expect(page.locator('.focus-task--active')).toBeVisible();
    await expect
      .poll(
        async () => {
          const shown = await clock.textContent();
          await page.clock.runFor(1_000);
          return (await clock.textContent()) !== shown;
        },
        { message: 'the renderer timer never ticked, so the clock jump would be a no-op' },
      )
      .toBe(true);

    // The three-minute commitment expires without changing main-process time or policy.
    await page.clock.fastForward(180_250);
    await expect(notice).toHaveAttribute('data-notice', 'time-up');
    await taskIsUnobstructed(page);
    await page.screenshot({ path: info.outputPath('time-up.png') });

    await toggle.focus();
    await page.keyboard.press('Escape');
    await expect(notice).toHaveAttribute('data-folded', 'true');
    await expect(toggle).toBeFocused();
    await expect(page.getByTestId('focus-notice-body')).toHaveCount(0);

    // Help wins over an expired timer, but a new notice must not undo a manual fold.
    await page.getByTestId('focus-stuck').click();
    await page.getByTestId('stuck-too-big').click();
    await expect(notice).toHaveAttribute('data-notice', 'help');
    await expect(notice).toHaveAttribute('data-folded', 'true');
    await toggle.click();
    await expect(page.getByTestId('agent-offered')).toBeVisible();
    await taskIsUnobstructed(page);
    await page.screenshot({ path: info.outputPath('stuck.png') });

    // Folding sends no dismissal. A subsequent evaluation still has the same offer.
    const offerId = await page.evaluate(async () => {
      const session = await window.focusloop.getCurrentSession();
      return (await window.focusloop.getPendingRescue(session!.session.id))?.interventionId;
    });
    await toggle.click();
    await page.getByTestId('sim-success').click();
    await expect(notice).toHaveAttribute('data-folded', 'true');
    expect(
      await page.evaluate(async () => {
        const session = await window.focusloop.getCurrentSession();
        return (await window.focusloop.getPendingRescue(session!.session.id))?.interventionId;
      }),
    ).toBe(offerId);

    // A resume wins over help and time up without consuming either lower-priority candidate.
    await page.getByTestId('sim-distraction').click();
    await page.getByTestId('sim-return').click();
    await expect(notice).toHaveAttribute('data-notice', 'resume');
    await expect(notice).toHaveAttribute('data-folded', 'true');
    await toggle.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('resume-continue')).toBeVisible();
    await taskIsUnobstructed(page);
    await expect(page.getByTestId('resume-continue')).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath('resume.png') });
    // CI macOS uses space-consuming scrollbars, unlike this developer machine's
    // overlay scrollbars. Exercise that width loss explicitly, not only by OS label.
    const classicScrollbars = await page.addStyleTag({
      content: `
      .content::-webkit-scrollbar,
      .focus-stage::-webkit-scrollbar,
      .focus-notice__body::-webkit-scrollbar { width: 15px; height: 15px; }
    `,
    });
    try {
      for (const viewport of [
        { width: 1024, height: 768 },
        { width: 800, height: 700 },
      ]) {
        await page.setViewportSize(viewport);
        await taskIsUnobstructed(page);
        await expect(page.getByTestId('task-title')).toBeInViewport({ ratio: 1 });
        await expect(page.getByTestId('resume-continue')).toBeInViewport({ ratio: 1 });
      }
    } finally {
      // Never leave 15px scrollbars behind for the assertions that follow this block.
      await classicScrollbars.evaluate((node) => node.parentNode?.removeChild(node));
      await page.setViewportSize({ width: 1280, height: 900 });
    }

    await toggle.focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('resume-continue')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(toggle).toBeFocused();
    // Going to another route and back does not forget the session's presentation choice.
    await page.evaluate(() => {
      location.hash = '#/dashboard';
    });
    await expect(page.getByTestId('focus-notice')).toHaveCount(0);
    await page.evaluate(() => {
      location.hash = '#/focus';
    });
    await expect(notice).toHaveAttribute('data-folded', 'true');
    await toggle.click();
    await page.getByTestId('resume-continue').click();
    await expect(notice).toHaveAttribute('data-notice', 'help');
    // The card removed the button that had focus; the keyboard stays inside the notice.
    await expect(toggle).toBeFocused();

    // Continue uses MICRO_START, preserving the task and restarting the expired clock.
    await page.getByTestId('notice-continue').click();
    await expect(page.getByTestId('agent-accepted')).toHaveAttribute('data-action', 'MICRO_START');
    await expect(page.locator('.focus-workspace')).toHaveAttribute('data-phase', 'active');
    await page
      .getByTestId('agent-accepted')
      .getByRole('button', { name: 'Continue', exact: true })
      .click();
    await expect(notice).toHaveCount(0);

    await page.getByTestId('focus-stuck').click();
    await page.getByTestId('stuck-too-big').click();
    await page.getByTestId('notice-simplify').click();
    await expect(page.getByTestId('agent-accepted')).toHaveAttribute('data-action', 'SIMPLIFY');
    // The button that was pressed removes itself, and this surface is non-modal: the keyboard must
    // stay inside the notice instead of falling to `<body>`, where the next Tab restarts at the top.
    await expect(toggle).toBeFocused();
    await page
      .getByTestId('agent-accepted')
      .getByRole('button', { name: 'Continue', exact: true })
      .click();
    await expect(notice).toHaveCount(0);

    await page.getByTestId('focus-stuck').click();
    await page.getByTestId('stuck-cannot-start').click();
    await page.getByTestId('notice-break').click();
    await expect(page.getByTestId('agent-accepted')).toHaveAttribute('data-action', 'BREAK');
    await expect(page.locator('.focus-workspace')).toHaveAttribute('data-phase', 'paused');
    await page
      .getByTestId('agent-accepted')
      .getByRole('button', { name: 'Continue', exact: true })
      .click();
    await expect(page.locator('.focus-workspace')).toHaveAttribute('data-phase', 'active');

    // Reduced motion covers both the sheet and its expanded contents.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByTestId('focus-stuck').click();
    await page.getByTestId('stuck-too-big').click();
    expect(await notice.evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
    expect(
      await page
        .getByTestId('focus-notice-body')
        .evaluate((node) => getComputedStyle(node).animationName),
    ).toBe('none');
    await expect(page.locator('.banner--error')).toHaveCount(0);

    // A new session starts unfolded, rather than inheriting the previous session's fold.
    await toggle.click();
    await page.getByTestId('end-session').click();
    await page.evaluate(() => {
      location.hash = '#/home';
    });
    await page.getByTestId('course-card').first().getByTestId('start-session').click();
    await page.getByTestId('start-task').first().click();
    await page.getByTestId('focus-stuck').click();
    await page.getByTestId('stuck-too-big').click();
    await expect(notice).toHaveAttribute('data-folded', 'false');

    // Exercise the no-simulator CSS branch, without pretending this is a packaged-prod test.
    await page.locator('fl-simulator-bar').evaluate((node) => node.remove());
    await expect(page.locator('.simulator')).toHaveCount(0);
    await taskIsUnobstructed(page);
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

test('other routes keep the modal resume card, trap and all', async () => {
  /*
   * Moving the focus-screen test to this surface's non-modal contract removed the modal card's only
   * end-to-end exercise, and the doc still claimed the card was retained on other routes. It is:
   * `/dashboard` with a pending checkpoint is exactly the state that renders it, and the trap and
   * Escape-dismiss it owns there are asserted here rather than assumed.
   */
  const profile = mkdtempSync(join(tmpdir(), 'focusloop-notice-modal-'));
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${profile}`],
    env: hermeticEnv(),
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByTestId('course-card').first().getByTestId('start-session').click();
    await page.getByTestId('start-task').first().click();
    await page.getByTestId('sim-distraction').click();
    await page.getByTestId('sim-return').click();

    await page.evaluate(() => {
      location.hash = '#/dashboard';
    });
    const dialog = page.getByRole('dialog', { name: 'Resume where you left off' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(page.getByTestId('focus-notice')).toHaveCount(0);

    const focusIsInsideDialog = (): Promise<boolean> =>
      page.evaluate(() => document.activeElement?.closest('[role=dialog]') !== null);
    await expect.poll(focusIsInsideDialog).toBe(true);
    for (let index = 0; index < 6; index += 1) await page.keyboard.press('Tab');
    await expect.poll(focusIsInsideDialog).toBe(true);
    for (let index = 0; index < 4; index += 1) await page.keyboard.press('Shift+Tab');
    await expect.poll(focusIsInsideDialog).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('.banner--error')).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
