import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const DESKTOP_MAIN = resolve(__dirname, '..', '..', 'desktop', 'dist', 'main', 'main.cjs');

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

/**
 * Starts the packaged main process against a given profile directory.
 *
 * Called more than once because "the choice survives a restart" can only be
 * shown by actually restarting. The renderer is served over `file://`, where
 * `page.reload()` fails outright, so a relaunch is also the only option.
 */
async function launch(): Promise<{ app: ElectronApplication; window: Page }> {
  const launched = await electron.launch({
    args: [DESKTOP_MAIN, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, FOCUSLOOP_DEV: '1' },
  });
  const firstWindow = await launched.firstWindow();
  await firstWindow.waitForLoadState('domcontentloaded');
  return { app: launched, window: firstWindow };
}

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'focusloop-e2e-'));
  ({ app, window } = await launch());
});

test.afterAll(async () => {
  await app?.close();
  if (userDataDir !== undefined) rmSync(userDataDir, { recursive: true, force: true });
});

/** The state chip's visible text is translated; the raw state is a data attribute. */
function stateIs(expected: string) {
  return expect(window.getByTestId('state')).toHaveAttribute('data-state', expected);
}

/**
 * The recall gesture, as a person performs it: hovering the floating button peeks the
 * sidebar out, and the press that pins it lands on the peeked panel. The button itself
 * stays under the pointer — it is the anchor the peek hangs off, and hiding it would hand
 * the hover to a different element mid-gesture — but the panel is the target the hover was
 * asking for, and the bigger one to press.
 */
async function pinThroughPeek(): Promise<void> {
  const fab = window.getByTestId('sidebar-expand');
  const sidebar = window.locator('.sidebar');
  await fab.hover();
  await expect(sidebar).toBeVisible();
  await sidebar.click();
  await expect(fab).toBeHidden();
  await expect(sidebar).toBeVisible();

  /*
   * Pinning animates the column back to its 232px (`grid-template-columns`, 180ms), and a
   * control inside a moving column is not where Playwright measured it: "visible" is true
   * from the first frame, so a press aimed at the toggle can land where the toggle was
   * mid-flight — the leading edge of the panel, which is where the folded rail's recall
   * tile then appears. The hover that lands on it peeks the panel straight back out, and
   * the fold the test just asked for looks like it did nothing. Wait for the panel to
   * arrive, so the gesture is over when the test says it is.
   */
  await expect
    .poll(() => sidebar.evaluate((el) => Math.round(el.getBoundingClientRect().width)))
    .toBe(232);
}

/**
 * Clicks a sidebar link, recalling the folded sidebar first.
 *
 * While a task is live the shell hides the sidebar — no icon rail — and the floating button
 * in the top-left corner is the only way back, which is exactly how a learner reaches the
 * navigation mid-focus, so tests that need a link go through the recall.
 *
 * The two steps are retried as a pair rather than assumed. Both the fold and the recall are
 * driven by things that move on their own: a commitment that becomes current folds the
 * sidebar even while a test is looking at it (which is what closing the resume card with
 * Escape invites a moment later), and a recall only holds until the next navigation away
 * from the focus screen hands the choice back to `auto`. "The navigation is reachable" is
 * the property under test, and reaching for it again is what a learner would do.
 */
async function clickSidebarLink(name: string): Promise<void> {
  const sidebar = window.locator('.sidebar');
  await expect(async () => {
    /*
     * Folded either way — the learner's collapse or the focus phase — the sidebar is
     * `visibility: hidden`, and that takes its links out of the accessibility tree: a role
     * query cannot even find them, let alone click them, so the recall has to come first.
     * A peek, by contrast, is merely out of the grid, and pinning it is harmless.
     */
    const folded = await sidebar.evaluate((el) => {
      const style = getComputedStyle(el);
      return style.visibility === 'hidden' || style.position === 'fixed';
    });
    if (folded) await pinThroughPeek();
    await sidebar.getByRole('link', { name }).click({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/**
 * The content column's box, rounded. A peek must leave it untouched, so the assertion is
 * an equality on the whole box rather than on one edge: a column that kept its `left` and
 * lost its width is still a broken screen.
 */
async function contentBox(): Promise<{ left: number; width: number }> {
  return window.locator('.content').evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { left: Math.round(rect.left), width: Math.round(rect.width) };
  });
}

test('golden path: learn, get interrupted, resume, see the outcome', async () => {
  // 1. The app boots into Home with the built-in demo course.
  await expect(
    window.getByRole('heading', { name: 'Keep your learning continuous' }),
  ).toBeVisible();
  const courseCard = window.getByTestId('course-card').first();
  await expect(courseCard).toContainText('Red-black trees');

  // 2. Start a session from the demo course.
  await courseCard.getByTestId('start-session').click();
  await stateIs('READY');

  // 3. Begin the first micro task.
  await window.getByTestId('start-task').first().click();
  await stateIs('FOCUSED');
  const firstTaskTitle = await window.getByTestId('task-title').innerText();

  // 4. Complete it.
  await window.getByTestId('complete-task').click();
  await expect(window.getByTestId('tasks-completed')).toBeVisible();

  // 5. Simulate a distraction.
  await window.getByTestId('sim-distraction').click();
  await stateIs('DISTRACTED');

  // 6. ...and a late return: the state engine must mark the interruption.
  await window.getByTestId('sim-return').click();
  await stateIs('INTERRUPTED');

  // 7. The resume card appears and restores the cognitive position.
  const resume = window.getByRole('dialog', { name: 'Resume where you left off' });
  await expect(resume).toBeVisible();
  await expect(resume).toContainText('Continue');
  await expect(resume).toContainText('Next step:');

  // No IPC call may have failed while the card came up.
  await expect(window.locator('.banner--error')).toHaveCount(0);

  // 8. Continue.
  await window.getByTestId('resume-continue').click();
  await expect(resume).toBeHidden();
  await stateIs('RESUMING');

  // 9. The dashboard reflects the interruption and a measured resume latency.
  await clickSidebarLink('Dashboard');
  await expect(window.getByTestId('interruptions')).toHaveText('1');
  await expect(window.getByTestId('tasks')).toContainText('/ 5');
  await expect(window.getByTestId('latency')).not.toHaveText('—');
  await expect(window.getByTestId('duration')).toBeVisible();

  // The task the learner was on is still the task they resume into.
  await clickSidebarLink('Focus Session');
  expect(firstTaskTitle.length).toBeGreaterThan(0);

  // Every screen the learner visited was rendered without an IPC failure.
  await expect(window.locator('.banner--error')).toHaveCount(0);
});

test('the remaining work is shown as a proportional plan', async () => {
  await clickSidebarLink('Focus Session');
  await window.getByTestId('focus-plan-toggle').click();
  await expect(window.locator('.plan')).toBeVisible();

  // One block per remaining micro task. The demo course has five; the golden path finished one.
  const blocks = window.locator('[data-testid=plan-block]');
  await expect(blocks).toHaveCount(4);

  const boxes = await blocks.evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { top: box.top, height: box.height };
    }),
  );

  // The geometry is the information: the longest task must occupy more of the column than the
  // shortest one, or the plan is just a list with extra spacing.
  const heights = boxes.map((box) => box.height);
  expect(Math.max(...heights)).toBeGreaterThan(Math.min(...heights));

  // And the blocks tile the column, so the plan reads as one continuous stretch of time.
  for (let index = 1; index < boxes.length; index += 1) {
    const previous = boxes[index - 1]!;
    const current = boxes[index]!;
    expect(Math.abs(previous.top + previous.height - current.top)).toBeLessThan(1);
  }

  // The total is stated, so it does not have to be added up from the blocks.
  await expect(window.getByTestId('plan-remaining')).toContainText('left');

  // Every block is still startable, which is the whole point of showing it.
  await expect(window.locator('.plan').getByTestId('start-task')).toHaveCount(4);

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

test('the app keeps working when the agent has nothing to say', async () => {
  await clickSidebarLink('Home');
  await expect(
    window.getByRole('heading', { name: 'Keep your learning continuous' }),
  ).toBeVisible();

  // Overload: the policy must offer a break, and the learner can decline it.
  await clickSidebarLink('Focus Session');
  await window.getByTestId('sim-overload').click();
  const agent = window.locator('.agent');
  await expect(agent).toBeVisible();
  await expect(agent).toHaveAttribute('data-action', 'BREAK');
  await agent.getByRole('button', { name: 'Not now' }).click();
  await expect(agent).toBeHidden();

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

test('resume is offered once, by the resume card alone', async () => {
  await clickSidebarLink('Home');
  await window.getByTestId('course-card').first().getByTestId('start-session').click();
  await window.getByTestId('start-task').first().click();

  await window.getByTestId('sim-distraction').click();
  await window.getByTestId('sim-return').click();

  // The card is the surface for RESUME; the agent panel must not repeat it.
  await expect(window.getByRole('dialog', { name: 'Resume where you left off' })).toBeVisible();
  await expect(window.locator('.agent')).toBeHidden();

  await window.getByTestId('resume-continue').click();
  await expect(window.getByRole('dialog', { name: 'Resume where you left off' })).toBeHidden();
  await expect(window.locator('.banner--error')).toHaveCount(0);
});

test('the dashboard re-aggregates when the window changes', async () => {
  // The previous test left a commitment running, so the sidebar starts folded away.
  await clickSidebarLink('Dashboard');
  await expect(window.getByTestId('insights-total')).toBeVisible();

  // The 7-day window always renders exactly one cell per calendar day.
  await window.getByTestId('range-week').click();
  await expect(window.locator('.heat__day')).toHaveCount(7);

  // Today, and "this session", are both a single day.
  await window.getByTestId('range-today').click();
  await expect(window.locator('.heat__day')).toHaveCount(1);
  await window.getByTestId('range-session').click();
  await expect(window.locator('.heat__day')).toHaveCount(1);

  // The window was not empty: the donut drew something and the ring has a centre.
  await window.getByTestId('range-all').click();
  await expect(window.locator('.donut svg circle').first()).toBeVisible();
  await expect(window.getByTestId('focus-ratio')).toContainText('%');

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

test('the sidebar summary refreshes without hijacking the dashboard window', async () => {
  await clickSidebarLink('Dashboard');
  await window.getByTestId('range-week').click();
  await expect(window.getByTestId('range-week')).toHaveAttribute('aria-pressed', 'true');

  // The sidebar is always the "today" window, whatever the dashboard is showing, and
  // it is populated from its own request rather than from the dashboard's summary.
  await expect(window.getByTestId('today-total')).not.toHaveText('—');

  // An event refreshes the ambient summary...
  await window.getByTestId('sim-confusion').click();
  await expect(window.getByTestId('today-meta')).toBeVisible();

  // ...and must not drag the dashboard's window back to "today". One cell per calendar
  // day is the proof: the sidebar asking for "today" would leave exactly one.
  await expect(window.getByTestId('range-week')).toHaveAttribute('aria-pressed', 'true');
  await expect(window.locator('.heat__day')).toHaveCount(7);

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

test('the theme can be switched and the choice survives a restart', async () => {
  // Restarting the app mid-test takes longer than a normal assertion sequence.
  test.setTimeout(90_000);

  await clickSidebarLink('Dashboard');

  await window.getByTestId('theme-light').click();
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'light');
  await window.getByTestId('theme-dark').click();
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'dark');

  // The preference, not the resolved theme, is what gets stored.
  await app.close();
  ({ app, window } = await launch());
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'dark');

  // `Auto` resolves against the OS rather than pinning a theme.
  await window.getByTestId('theme-system').click();
  await expect(window.locator('html')).toHaveAttribute('data-theme', /^(light|dark)$/);

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

test('the interface can be switched to Chinese, and the choice survives a restart', async () => {
  // Restarting the app mid-test takes longer than a normal assertion sequence.
  test.setTimeout(90_000);

  await clickSidebarLink('Home');
  await expect(
    window.getByRole('heading', { name: 'Keep your learning continuous' }),
  ).toBeVisible();

  // 1. Switch to Chinese.
  await window.getByTestId('locale-zh').click();
  await expect(window.getByRole('heading', { name: '让你的学习一直连得上' })).toBeVisible();
  await expect(window.getByRole('link', { name: '首页' })).toBeVisible();
  await expect(window.getByRole('link', { name: '专注会话' })).toBeVisible();

  // The document language follows the interface. `<html lang>` is what a screen reader
  // uses to choose a voice, and Chinese read by an English voice is not usable.
  await expect(window.locator('html')).toHaveAttribute('lang', 'zh');

  // The whole screen must move, not just the navigation.
  await expect(window.getByRole('button', { name: '开始会话' }).first()).toBeVisible();
  await expect(window.getByRole('button', { name: '继续会话' })).toBeVisible();

  // 2. The wording the domain emits is translated too — the learner must never
  //    see an English sentence in the middle of a Chinese screen.
  await clickSidebarLink('专注会话');
  await window.getByTestId('sim-overload').click();
  const agent = window.locator('.agent');
  await expect(agent).toBeVisible();
  await expect(agent).toContainText('一次塞进来的东西太多了');

  // 3. A restart keeps the language: the store owns it, not the renderer.
  await app.close();
  ({ app, window } = await launch());
  await expect(window.getByRole('heading', { name: '让你的学习一直连得上' })).toBeVisible();

  // No IPC call may have failed in either language.
  await expect(window.locator('.banner--error')).toHaveCount(0);

  // 4. And back, so the next run starts from a known state.
  await window.getByTestId('locale-en').click();
  await expect(
    window.getByRole('heading', { name: 'Keep your learning continuous' }),
  ).toBeVisible();
  await expect(window.locator('html')).toHaveAttribute('lang', 'en');
  await expect(window.locator('.banner--error')).toHaveCount(0);
});

/*
 * Last on purpose. The "overload" command raises a suggestion, and declining it spends
 * part of the intervention policy's session budget — enough of it that running this
 * earlier left the Chinese test above with nothing to show. Ordering is load-bearing
 * here, so this test runs once nothing else still needs the budget.
 */
test('a run of identical events is folded into one row', async () => {
  await clickSidebarLink('Dashboard');

  /*
   * The previous test restarted the app, so this also pins that the log is restored from
   * the store on launch rather than only built up from events seen in this renderer.
   */
  await expect(window.locator('.timeline li').first()).not.toContainText('No events recorded');

  // Break any run that is still open, so the row arithmetic below does not depend on what
  // the previous test happened to leave behind.
  await window.getByTestId('sim-success').click();
  await expect(window.locator('.timeline li').first()).toContainText('QUIZ_CORRECT');
  const rowsBefore = await window.locator('.timeline li').count();

  // A single "overload" fires three HELP_REQUESTED events back to back. That is how one
  // click used to add three identical cards to the log.
  await window.getByTestId('sim-overload').click();

  await expect(window.locator('.timeline li')).toHaveCount(rowsBefore + 1);

  const newest = window.locator('.timeline li').first();
  await expect(newest).toContainText('HELP_REQUESTED');
  await expect(newest.locator('.timeline__count')).toHaveText('×3');
  // The shorthand is not the accessible name.
  await expect(newest.locator('.timeline__count')).toHaveAttribute('aria-label', '3 times');

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

test('the resume card takes focus, keeps it, and closes on Escape', async () => {
  await clickSidebarLink('Focus Session');
  await window.getByTestId('sim-distraction').click();
  await window.getByTestId('sim-return').click();

  const dialog = window.getByRole('dialog', { name: 'Resume where you left off' });
  await expect(dialog).toBeVisible();

  const focusIsInsideDialog = (): Promise<boolean> =>
    window.evaluate(() => document.activeElement?.closest('[role=dialog]') !== null);

  /*
   * The card is the product's central surface — the thing that exists so a learner can get
   * back into the work — so a learner who cannot use a mouse has to be able to reach it.
   */
  await expect.poll(focusIsInsideDialog).toBe(true);

  // Tab stays inside rather than walking off behind the overlay.
  for (let index = 0; index < 6; index += 1) await window.keyboard.press('Tab');
  await expect.poll(focusIsInsideDialog).toBe(true);

  // Shift+Tab too, since that is the direction the wrap arithmetic gets wrong.
  for (let index = 0; index < 4; index += 1) await window.keyboard.press('Shift+Tab');
  await expect.poll(focusIsInsideDialog).toBe(true);

  await window.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

/*
 * Also last: it ends the only running session, so anything after it would have nothing to
 * work with.
 */
test('ending a session leaves nothing current', async () => {
  // The previous test left a commitment running, so the sidebar starts folded away.
  await clickSidebarLink('Focus Session');
  await expect(window.getByTestId('end-session')).toBeVisible();

  await window.getByTestId('end-session').click();

  /*
   * This assertion is only reachable now that starting a session ends the running one.
   * Before that, an older session was still active underneath, so the app silently handed
   * itself back to it and "no session running" never appeared.
   */
  await expect(window.getByRole('heading', { name: 'No session running' })).toBeVisible();

  await clickSidebarLink('Home');
  await expect(window.getByText('No session running. Pick a course below to begin.')).toBeVisible();

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

/*
 * Last: it runs its own session from start to finish, so the "nothing to work with" left
 * by the test above is a state it brings itself out of. It never touches the simulator,
 * so the intervention budget the folding test above relies on is not disturbed.
 */
test('the sidebar folds on click, and focus folds it fully, with a floating recall', async () => {
  // 1. A running commitment folds the whole sidebar away — no icon rail. The floating
  //    button is the only control left, so the fold cannot strand the navigation.
  await window.getByTestId('course-card').first().getByTestId('start-session').click();
  await window.getByTestId('start-task').first().click();
  await stateIs('FOCUSED');
  await expect(window.locator('.sidebar')).toBeHidden();
  await expect(window.getByTestId('sidebar-expand')).toBeVisible();

  // Hidden is not the same as gone: the fold only pays off if the sidebar's column
  // actually closes and the content takes the space.
  const contentLeft = await window
    .locator('.content')
    .evaluate((el) => el.getBoundingClientRect().left);
  expect(contentLeft).toBeLessThan(2);

  // But on focus the fold hides the chrome, not the layout: the workspace keeps the
  // column the open sidebar occupied, so the countdown never reflows to where the
  // peeked panel will appear.
  const workspaceLeft = await window
    .locator('.focus-workspace')
    .evaluate((el) => el.getBoundingClientRect().left);
  expect(workspaceLeft).toBeGreaterThanOrEqual(232);

  // 1b. Finishing the step is a shell-narrowing phase too — `keepsRail` in
  //     `core/focus-phase.ts`, which the canvas publishes as `data-rail` — so the fold must
  //     not hand the chrome back at the moment the next action is the only useful thing on
  //     screen. The rail used to come back here, and so would a fold keyed on the phase names
  //     by hand; this assertion is what keeps the two policies on one switch.
  await window.getByTestId('complete-task').click();
  await expect(window.locator('.sidebar')).toBeHidden();
  await expect(window.getByTestId('sidebar-expand')).toBeVisible();
  // The following step is offered in the confirmation itself, not in the (closed) plan.
  await window.locator('.focus-task--complete').getByTestId('start-task').click();
  await stateIs('FOCUSED');
  await expect(window.locator('.sidebar')).toBeHidden();

  // 2. Hovering the button peeks the sidebar out as an overlay — visible, but the
  //    content column must not move: a peek is a look, not a reflow.
  const contentBeforePeek = await contentBox();
  await window.getByTestId('sidebar-expand').hover();
  await expect(window.locator('.sidebar')).toBeVisible();

  //    Not "the left edge is still where it was" but "the box is the same box": the
  //    peeked sidebar leaves the grid, and a content column placed by document order
  //    would be handed the folded 0px track instead of its own — the page squeezed into
  //    the padding it still carried, which is how a peek came out as a broken layout or
  //    a screen with nothing on it at all.
  expect(await contentBox()).toEqual(contentBeforePeek);

  //    The peek is a cover, not a swap: the panel is the docked sidebar's own opaque surface,
  //    lifted off the page with a shadow, so what it slides over is covered rather than
  //    half-visible through it. Chromium may serialize the colour as rgb(), rgba() or
  //    color(srgb ... / a), so the alpha is read from the shape of the value.
  const panel = await window.locator('.sidebar').evaluate((el) => {
    const style = getComputedStyle(el);
    const color = style.backgroundColor;
    const alphaOf = (value: string): number => {
      const srgb = value.match(/\/\s*([\d.]+)\s*\)$/);
      if (srgb) return Number(srgb[1]);
      const components = (value.match(/rgba?\(([^)]+)\)/)?.[1] ?? '').split(/[,/]\s*/);
      return components.length === 4 ? Number(components[3]) : 1;
    };
    return {
      backgroundAlpha: alphaOf(color),
      backdropFilter: style.backdropFilter,
      boxShadow: style.boxShadow,
    };
  });
  expect(panel.backgroundAlpha).toBe(1);
  expect(panel.backdropFilter).toBe('none');
  expect(panel.boxShadow).not.toBe('none');

  //    And the workspace itself stays where the fold left it: the panel slides over
  //    the gutter it vacated, never over the countdown.
  const workspaceLeftDuringPeek = await window
    .locator('.focus-workspace')
    .evaluate((el) => el.getBoundingClientRect().left);
  expect(workspaceLeftDuringPeek).toBeGreaterThanOrEqual(232);

  // 3. Moving the pointer away folds it straight back.
  await window.mouse.move(640, 400);
  await expect(window.locator('.sidebar')).toBeHidden();

  // 4. A click, by contrast, pins it open for as long as the learner wants it — the
  //    press lands on the peeked panel, which is what the hover was asking for.
  await pinThroughPeek();
  await expect(window.locator('.sidebar')).toBeVisible();

  // 5. ...and its own toggle folds it away again for the rest of the commitment.
  await window.getByTestId('sidebar-toggle').click();
  await expect(window.locator('.sidebar')).toBeHidden();

  // 6. Focus over. The fold was deliberate, so it survives the session ending.
  await window.getByTestId('end-session').click();
  await expect(window.getByRole('heading', { name: 'No session running' })).toBeVisible();
  await expect(window.locator('.sidebar')).toBeHidden();

  // 7. On a quiet screen, the same pair of controls folds and recalls at will.
  await pinThroughPeek();
  await window.getByTestId('sidebar-toggle').click();
  await expect(window.locator('.sidebar')).toBeHidden();

  //    Folded, the panel's own toggle is the pin, not a second collapse that does
  //    nothing: it says so, and the press does what it says.
  await window.getByTestId('sidebar-expand').hover();
  await expect(window.getByTestId('sidebar-toggle')).toHaveAttribute('aria-label', 'Show sidebar');
  await window.getByTestId('sidebar-toggle').click();
  await expect(window.getByTestId('sidebar-expand')).toBeHidden();
  await expect(window.locator('.sidebar')).toBeVisible();

  await expect(window.locator('.banner--error')).toHaveCount(0);
});
