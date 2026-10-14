import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { hermeticEnv } from '../hermetic-env.mjs';
import { fireDemoEvent } from '../demo-events.mjs';
import { closeElectronApp } from '../support/close-electron-app';
import type { FocusLoopApi } from '@focusloop/shared-types';

declare global {
  interface Window {
    focusloop: FocusLoopApi;
  }
  // The same bridge, declared as a global variable as well as a `Window` property: a spec whose own
  // file is called `window` cannot say `window.focusloop` (it would be the Playwright page), and
  // `globalThis` only sees top-level `var`s. So reaching the bridge from such a spec means
  // `globalThis.focusloop`.
  var focusloop: FocusLoopApi;
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

/**
 * The actual task and its action, not merely the notice, must remain usable.
 *
 * Nothing here scrolls first, and that is the whole point of the check. It used to call
 * `scrollIntoViewIfNeeded` on the step and on its action before measuring, which scrolled the step out
 * from under the notice and then asserted that it was not under the notice — so the app could stop doing
 * its own lifting and this test would still be green, which is exactly what happened: with a notice up,
 * the stage's last row sat 48px behind the notice's top edge on a 1140x767 window, and the only thing that
 * ever agreed otherwise was the assertion's own scrolling.
 *
 * What the learner's app now has to guarantee on its own is that the step's own controls are clear of the
 * notice the moment it arrives, wherever the stage happened to be scrolled.
 */
async function taskIsUnobstructed(page: Page): Promise<void> {
  /*
   * Named before it is measured. A null box below would otherwise surface as arithmetic on null,
   * which says nothing about what was wrong; a task that is not on screen now fails saying so, and
   * the geometry assertions keep their meaning because they still run against real boxes.
   */
  await expect(page.locator('.focus-task--active')).toBeVisible();
  /*
   * Polled, not read once: the lift happens in a resize observer callback, so the geometry settles a frame
   * after the notice arrives, and the notice itself animates in whenever its slot changes — a box measured
   * mid-arrival is up to 12px below the one the learner ends up looking at. All three bounds are polled
   * together, so this waits for the geometry to settle rather than for a number of milliseconds, and the
   * assertions below then state what settled.
   */
  await expect
    .poll(async () => {
      const task = await page.locator('.focus-task--active').boundingBox();
      const action = await page.getByTestId('complete-task').boundingBox();
      const notice = await page.getByTestId('focus-notice').boundingBox();
      if (task === null || action === null || notice === null) return Number.POSITIVE_INFINITY;
      return Math.round(
        Math.max(
          task.y + task.height - notice.y,
          action.y + action.height - notice.y,
          notice.y + notice.height - page.viewportSize()!.height,
        ),
      );
    })
    .toBeLessThanOrEqual(TOUCH_TOLERANCE);
  const task = await page.locator('.focus-task--active').boundingBox();
  const action = await page.getByTestId('complete-task').boundingBox();
  const notice = await page.getByTestId('focus-notice').boundingBox();
  expect(task).not.toBeNull();
  expect(action).not.toBeNull();
  expect(notice).not.toBeNull();
  expect(task!.y + task!.height).toBeLessThanOrEqual(notice!.y + TOUCH_TOLERANCE);
  expect(action!.y + action!.height).toBeLessThanOrEqual(notice!.y + TOUCH_TOLERANCE);
  /*
   * The notice is the bottom-most thing on the screen. It used to be cleared against a developer bar
   * pinned to the bottom edge, and with that bar gone the edge itself is the bound — which is the
   * stricter statement anyway: nothing may be pushed out of the window to make room for the notice.
   */
  expect(notice!.y + notice!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height + TOUCH_TOLERANCE,
  );
  await expect(page.getByTestId('complete-task')).toBeInViewport();
}

/**
 * The plan is the bottom of the stage too, and the card used to be measured only against the step.
 *
 * With the sheet open its rows are the lowest thing on the screen, so they are what has to clear the
 * notice; with it closed the trigger is. `plan.y + plan.height` is whichever of the two is lower,
 * because the panel is inside the section, so one measurement covers both states.
 */
async function planIsClearOfNotice(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const plan = await page.locator('.focus-plan').boundingBox();
      const notice = await page.getByTestId('focus-notice').boundingBox();
      if (plan === null || notice === null) return Number.POSITIVE_INFINITY;
      return Math.round(plan.y + plan.height - notice.y);
    })
    .toBeLessThanOrEqual(TOUCH_TOLERANCE);
}

test('the bottom slot carries the return card and nothing else, and the step clears it', async ({
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

    /*
     * An expired commitment is not a notice any more.
     *
     * It used to be one of the three things this slot could carry. The control row already answers it —
     * the primary button turns into "+1 minute" for exactly this phase — so the strip was a second
     * surface saying what the button under the clock already said, over the step the learner was reading.
     * What has to be true instead is that the offer is *there*, on the control that owns it, and that
     * nothing appears over the step.
     */
    await page.clock.fastForward(180_250);
    await expect(page.locator('.focus-workspace')).toHaveAttribute('data-phase', 'expired');
    await expect(notice).toHaveCount(0);
    // The primary control is the offer; the quiet "+1 minute" beside it is always there.
    const expiredPrimary = page.locator('.focus-controls .btn--primary', { hasText: '+1 minute' });
    await expect(expiredPrimary).toBeVisible();
    await page.screenshot({ path: info.outputPath('time-up.png') });

    await expiredPrimary.click();
    await expect(page.locator('.focus-workspace')).toHaveAttribute('data-phase', 'active');
    await expect(notice).toHaveCount(0);

    // Asking for help is answered in the step that asked, and the slot stays empty.
    await page.getByTestId('focus-stuck').click();
    await page.getByTestId('stuck-too-big').click();
    await expect(page.getByTestId('agent-offered')).toBeVisible();
    await expect(notice).toHaveCount(0);
    await expect(page.getByTestId('focus-notice-body')).toHaveCount(0);
    /*
     * In the control row rather than over it: the suggestion is one more item of the row, so the box grows
     * by its height instead of the suggestion landing on top of the buttons. That is the assertion — the
     * card's box is inside the row's, and the row's own controls are still on screen.
     */
    const offered = await page.getByTestId('agent-offered').boundingBox();
    const controls = await page.locator('.focus-controls').boundingBox();
    expect(offered).not.toBeNull();
    expect(controls).not.toBeNull();
    expect(offered!.y).toBeGreaterThanOrEqual(controls!.y);
    expect(offered!.y + offered!.height).toBeLessThanOrEqual(
      controls!.y + controls!.height + TOUCH_TOLERANCE,
    );
    await expect(page.getByTestId('complete-task')).toBeInViewport();
    await expect(page.getByTestId('focus-stuck')).toBeInViewport();
    await page.screenshot({ path: info.outputPath('stuck.png') });

    /*
     * Rendering it in the step must not resolve anything. It did not before this moved: the offer is the
     * main process's, and a surface that shows it is not a surface that answers it.
     */
    const offerId = await page.evaluate(async () => {
      const session = await window.focusloop.getCurrentSession();
      return (await window.focusloop.getPendingRescue(session!.session.id))?.interventionId;
    });
    await fireDemoEvent(page, 'success');
    expect(
      await page.evaluate(async () => {
        const session = await window.focusloop.getCurrentSession();
        return (await window.focusloop.getPendingRescue(session!.session.id))?.interventionId;
      }),
    ).toBe(offerId);
    await expect(page.getByTestId('agent-offered')).toBeVisible();

    // A resume takes the slot, without consuming the offer the step is still showing.
    await fireDemoEvent(page, 'distraction');
    await fireDemoEvent(page, 'return');
    await expect(notice).toHaveAttribute('data-notice', 'resume');
    await expect(page.getByTestId('agent-offered')).toBeVisible();

    // The card is foldable, and a fold is remembered per session rather than per mount.
    await toggle.focus();
    await page.keyboard.press('Escape');
    await expect(notice).toHaveAttribute('data-folded', 'true');
    await expect(toggle).toBeFocused();
    await expect(page.getByTestId('focus-notice-body')).toHaveCount(0);
    await toggle.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('resume-continue')).toBeVisible();
    await taskIsUnobstructed(page);
    await expect(page.getByTestId('resume-continue')).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath('resume.png') });
    /*
     * The pending suggestion is answered before the size loop below, because it is part of the *step* now
     * and the loop measures the two boxes against each other. 800x700 with the return card up is the size
     * the stylesheet's own comment calls the one where the card and the step cannot both have the room
     * they want, and the step is the one that yields: with a suggestion in its control row there is no
     * scroll position that shows both the whole box and the whole card, and the box's top is what goes.
     * The suggestion's own geometry is asserted above, where it is inside the row and the row's controls
     * are still on screen.
     */
    await page
      .getByTestId('agent-offered')
      .getByRole('button', { name: 'Not now', exact: true })
      .click();
    await expect(page.getByTestId('agent-offered')).toHaveCount(0);
    /*
     * The plan is the bottom of the stage too, and the card used to be measured only against the step:
     * the trigger sat behind the notice and opening the sheet put every row of it under the card, so the
     * press looked like it had done nothing. Measured with the suggestion dismissed, because with it in
     * the control row the step alone is taller than the stage and it is the step that keeps the room.
     *
     * Opening the sheet moves the stage's floor without resizing the card, so the lift has to follow the
     * press as well as the card's height.
     */
    await taskIsUnobstructed(page);
    await planIsClearOfNotice(page);
    await page.getByTestId('focus-plan-toggle').click();
    await expect(page.getByTestId('plan-block').first()).toBeVisible();
    await planIsClearOfNotice(page);
    await page.getByTestId('focus-plan-toggle').click();
    await expect(page.getByTestId('plan-block')).toHaveCount(0);
    await taskIsUnobstructed(page);

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
      /*
       * 800x700 is narrower than the app's own minimum window, and it is measured with the classically
       * thick scrollbars above, so it is the one size where the card and the step genuinely cannot both
       * have the room they want. The stylesheet answers that by making the card the one that yields (it
       * drops the prose that restates the step it already names, and tightens its own footer), which is
       * what keeps this assertion — the step, title included, above the card — satisfiable here.
       */
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
    /*
     * The card's first control. It used to be Continue, and the check-in now sits above the actions —
     * the box is what the notice is asking for, and the footer's decision comes after it in reading
     * order as well as in the DOM. What this asserts is unchanged: Tab inside the notice reaches the
     * card rather than escaping to the page behind it.
     */
    await expect(page.getByTestId('recall-input')).toBeFocused();
    /*
     * The same way in the step has, on the card: words the learner already has somewhere else, without
     * retyping them. Only that it is there and pressable — pressing it opens the operating system's file
     * dialog, which a test cannot drive.
     */
    await expect(page.getByTestId('recall-attach')).toBeVisible();
    await expect(page.getByTestId('recall-attach')).toBeEnabled();
    await expect(page.getByTestId('recall-source-note')).toHaveCount(0);
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
    await expect(page.getByTestId('resume-continue')).toBeVisible();
    await page.getByTestId('resume-continue').click();

    /*
     * Answering the card empties the slot, which used to be impossible: the resume decision fell through
     * to the agent's offer in the same strip, so the learner answered "where was I" and was immediately
     * asked something else. The offer is in the step and stays there.
     */
    await expect(notice).toHaveCount(0);
    // The card removed the button that had focus, and the notice it lived in is gone with it: the
    // keyboard is handed to the stage rather than left on `<body>`, where Tab restarts at the document.
    await expect(page.locator('.focus-stage')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.closest('.focus-stage') !== null))
      .toBe(true);

    // Accepting from the step keeps the whole lifecycle: offered → accepted → plan → continue.
    await page.getByTestId('focus-stuck').click();
    await page.getByTestId('stuck-too-big').click();
    await page
      .getByTestId('agent-offered')
      .getByRole('button', { name: 'Try this', exact: true })
      .click();
    await expect(page.getByTestId('agent-accepted')).toHaveAttribute('data-action', 'SIMPLIFY');
    await expect(page.locator('.focus-workspace')).toHaveAttribute('data-phase', 'active');
    await page
      .getByTestId('agent-accepted')
      .getByRole('button', { name: 'Continue', exact: true })
      .click();
    await expect(page.getByTestId('agent-accepted')).toHaveCount(0);

    /*
     * BREAK is the one action that pauses the live clock, and it still does, from the same place. The
     * reason is asked for where it always was — the six buttons in the control row, which is what the
     * notice's own three choices were a second copy of.
     */
    await page.getByTestId('focus-stuck').click();
    await page.getByTestId('stuck-tired').click();
    await page
      .getByTestId('agent-offered')
      .getByRole('button', { name: 'Try this', exact: true })
      .click();
    await expect(page.getByTestId('agent-accepted')).toHaveAttribute('data-action', 'BREAK');
    await expect(page.locator('.focus-workspace')).toHaveAttribute('data-phase', 'paused');
    await page
      .getByTestId('agent-accepted')
      .getByRole('button', { name: 'Continue', exact: true })
      .click();
    await expect(page.locator('.focus-workspace')).toHaveAttribute('data-phase', 'active');

    // Reduced motion covers the slot and its expanded contents.
    await fireDemoEvent(page, 'distraction');
    await fireDemoEvent(page, 'return');
    await expect(notice).toHaveAttribute('data-notice', 'resume');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await notice.evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
    expect(
      await page
        .getByTestId('focus-notice-body')
        .evaluate((node) => getComputedStyle(node).animationName),
    ).toBe('none');
    await expect(page.locator('.banner--error')).toHaveCount(0);

    // A new session starts unfolded, rather than inheriting the previous session's fold.
    await toggle.click();
    await expect(notice).toHaveAttribute('data-folded', 'true');
    await page.getByTestId('end-session').click();
    await page.evaluate(() => {
      location.hash = '#/home';
    });
    await page.getByTestId('course-card').first().getByTestId('start-session').click();
    await page.getByTestId('start-task').first().click();
    await fireDemoEvent(page, 'distraction');
    await fireDemoEvent(page, 'return');
    await expect(notice).toHaveAttribute('data-folded', 'false');
    await taskIsUnobstructed(page);
  } finally {
    await closeElectronApp(app);
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
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
    await fireDemoEvent(page, 'distraction');
    await fireDemoEvent(page, 'return');

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
    await closeElectronApp(app);
    // The same patience the first test's cleanup keeps: Windows holds the profile open for a moment
    // after the window closes, and a plain `rmSync` there is an EPERM that fails a passing test.
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
});
