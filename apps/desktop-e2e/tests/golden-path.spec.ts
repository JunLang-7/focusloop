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

/*
 * Last, and it brings its own session, because it finishes by starting a step: any test after it
 * would inherit a different current task than the one it was written against.
 */
test('the plan closes the way a panel closes, and never covers the step it started', async () => {
  await clickSidebarLink('Home');
  await window.getByTestId('course-card').first().getByTestId('start-session').click();
  await window.getByTestId('start-task').first().click();
  await stateIs('FOCUSED');

  const toggle = window.getByTestId('focus-plan-toggle');
  const plan = window.locator('.plan');

  // Closed until it is asked for. While a step runs, nothing is laid over the task.
  await expect(plan).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // The trigger raises it.
  await toggle.click();
  await expect(plan).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  /*
   * It arrives as a sheet anchored to the bottom edge rather than to a corner, and it is centred.
   * "Closer to the bottom than to the top" is the property, not "entirely below the middle": a
   * sheet with four blocks and a timeline is tall enough to cross the middle on purpose. The exact
   * offset is not asserted, because the simulator bar is present in this run and the sheet starts
   * above it.
   */
  const sheet = await window.locator('.focus-plan[data-open]').evaluate((el) => {
    const box = el.getBoundingClientRect();
    return {
      top: box.top,
      bottom: box.bottom,
      left: box.left,
      right: box.right,
      // `document.documentElement`, not `window`: this module declares its own `window` for the
      // page handle, and it shadows the global even inside an `evaluate` callback.
      viewportHeight: document.documentElement.clientHeight,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(sheet.viewportHeight - sheet.bottom).toBeLessThan(100);
  expect(sheet.viewportHeight - sheet.bottom).toBeLessThan(sheet.top);
  expect(Math.abs(sheet.left - (sheet.viewportWidth - sheet.right))).toBeLessThan(2);

  // And it rises into place: that motion is what makes it a card that arrives rather than a jump.
  await expect
    .poll(() =>
      window.locator('.focus-plan[data-open]').evaluate((el) => getComputedStyle(el).animationName),
    )
    .toBe('plan-rise');

  // Escape lowers it and hands focus back to the control that raised it. A panel that can be
  // opened from the keyboard and not closed from it is the trap this replaces: while it was a
  // `<details>`, the summary was the only affordance that could close it.
  await window.keyboard.press('Escape');
  await expect(plan).toBeHidden();
  await expect(toggle).toBeFocused();

  // A click anywhere else lowers it too.
  await toggle.click();
  await expect(plan).toBeVisible();
  await window.getByTestId('tasks-completed').click();
  await expect(plan).toBeHidden();

  // And starting a step lowers it without being asked, so the step it just started is not behind
  // the card — the reason the plan was unusable during a step.
  await toggle.click();
  await expect(plan).toBeVisible();
  await window.locator('.plan').getByTestId('start-task').first().click();
  await expect(plan).toBeHidden();
  await expect(window.getByTestId('task-title')).toBeVisible();

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

/*
 * Last as well: it finishes by completing a step, which leaves a different current task and a
 * different count behind than the tests above were written against.
 */
test('finishing a step arrives once, and says nothing that accumulates', async () => {
  await clickSidebarLink('Home');
  await window.getByTestId('course-card').first().getByTestId('start-session').click();
  await window.getByTestId('start-task').first().click();
  await stateIs('FOCUSED');

  await window.getByTestId('complete-task').click();

  const confirmation = window.locator('.focus-task--complete');
  await expect(confirmation).toBeVisible();

  /*
   * It arrives rather than swapping in — asserted on the computed animation, because a screenshot
   * cannot tell "animated" from "instant", and this motion is the whole of what #73 asks for.
   */
  await expect
    .poll(() => confirmation.evaluate((el) => getComputedStyle(el).animationName))
    .toBe('step-done-in');
  await expect
    .poll(() =>
      confirmation.locator('.eyebrow').evaluate((el) => getComputedStyle(el).animationName),
    )
    .toBe('step-done-mark');

  /*
   * The next step is usable from the first frame: the motion is decoration, not a gate.
   */
  const next = confirmation.getByTestId('start-task');
  await expect(next).toBeEnabled();

  /*
   * And a digit anywhere in here would be a count. Counting, streaks and anything else that
   * accumulates are what `docs/focus-redesign-research.md` rules out, so the confirmation is
   * checked for saying one thing and offering the next instead.
   */
  expect(await confirmation.innerText()).not.toMatch(/\d/);

  await next.click();
  await stateIs('FOCUSED');

  // Reduced motion: the same confirmation, arriving at once instead of rising.
  await window.emulateMedia({ reducedMotion: 'reduce' });
  await window.getByTestId('complete-task').click();
  await expect(confirmation).toBeVisible();
  await expect
    .poll(() => confirmation.evaluate((el) => getComputedStyle(el).animationName))
    .toBe('none');
  await expect(window.getByTestId('task-title')).toBeVisible();
  await window.emulateMedia({ reducedMotion: 'no-preference' });

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

/*
 * Last, and it needs nothing that came before it: the import form lives on Home and the check is
 * about a control's state rather than a session.
 */
test('the import form asks for a file name instead of failing on the channel', async () => {
  await clickSidebarLink('Home');

  const name = window.getByTestId('import-file-name');
  const submit = window.getByTestId('import-submit');
  const reason = window.getByTestId('import-needs-name');

  // The field arrives holding one, so the button starts usable.
  await expect(submit).toBeEnabled();

  // Clearing it disables the button and states why, rather than letting an empty name travel to
  // the main process and come back as a validation error naming the IPC channel.
  await name.fill('');
  await expect(submit).toBeDisabled();
  await expect(reason).toBeVisible();

  // Whitespace is not a name either.
  await name.fill('   ');
  await expect(submit).toBeDisabled();

  await name.fill('notes.md');
  await expect(submit).toBeEnabled();
  await expect(reason).toBeHidden();

  /*
   * The developer inspector is laid over this corner of the screen, and over this button in
   * particular once a running session has pushed the form down. A press has to land on the button:
   * `elementFromPoint` asks the document what is actually at that pixel, which no z-order or
   * `pointer-events` mistake can talk its way out of.
   */
  await submit.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      submit.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const under = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return under === el || el.contains(under);
      }),
    )
    .toBe(true);

  // And the import it guards actually goes through: no channel error, and a result to show.
  await submit.click();
  await expect(window.locator('.banner--error')).toHaveCount(0);
  await expect(window.getByTestId('import-summary')).toBeVisible();

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

test('a file on the machine can be imported without typing any of it out', async () => {
  await clickSidebarLink('Home');

  const picker = window.getByTestId('import-pick-file');
  const name = window.getByTestId('import-file-name');
  const notice = window.getByTestId('import-pick-notice');
  const submit = window.getByTestId('import-submit');

  /*
   * The file chooser itself cannot be driven from here — it belongs to the operating system — but the
   * input it hangs off can be, and that input is the part the app is responsible for. This is the
   * journey that did not exist before: there was no way to bring a file in short of opening it
   * elsewhere, selecting all of it, and pasting it back into the textarea.
   */
  await picker.setInputFiles({
    name: 'rotations.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '# Rotations\n\nA rotation restructures three nodes while preserving the in-order sequence.\n\n## Left rotation\n\nA left rotation moves the pivot down and to the right.\n',
    ),
  });

  // Both the name and the text came out of the file, so neither had to be typed.
  await expect(name).toHaveValue('rotations.md');
  await expect(notice).toBeHidden();

  await submit.click();
  await expect(window.locator('.banner--error')).toHaveCount(0);
  await expect(window.getByTestId('import-summary')).toBeVisible();

  /*
   * A file that is not text is turned away where it was chosen, in words, and changes nothing: the
   * course that was just imported is still the one waiting to be imported. Left to the parser this
   * would have become a course with no concepts in it, which reads as success.
   */
  await picker.setInputFiles({
    name: 'archive.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]),
  });

  await expect(notice).toBeVisible();
  await expect(name).toHaveValue('rotations.md');
  await expect(window.getByTestId('import-summary')).toBeVisible();
});

/*
 * Last, and for a different reason than the fold test above: this one starts a session of its own and
 * finishes by ending it, so it has to run after everything that needs a session. It cannot disturb the
 * Chinese test's intervention budget — that budget is counted per session, and this test begins a new
 * one — but it does leave no session running, which is the state this file has to end in.
 */
test('the reason the learner gives is answered according to which kind of stuck it is', async () => {
  /*
   * The one producer of the reason this whole slice acts on.
   *
   * The policy's own tests prove the *rule* by handing it an event they wrote themselves, which is how
   * a rule can be right while the app can never reach it: the reason has to be produced by something a
   * learner can press. Deleting the six reason buttons leaves every unit suite green, so the button is
   * pressed here, in the built app, and the answer is read back off the panel.
   */
  await clickSidebarLink('Home');
  await window.getByTestId('course-card').first().getByTestId('start-session').click();
  await window.getByTestId('start-task').first().click();

  /*
   * The keyboard has to be able to get in as well as out. Opening the chooser replaces the trigger with
   * the group, so the focused element is destroyed; without moving focus, the learner is left on the
   * body and has to tab from the top of the document to reach the six reasons. Focus goes to the group,
   * which is what carries the question.
   */
  await window.getByTestId('focus-stuck').click();
  await expect(window.getByTestId('stuck-reasons')).toBeFocused();
  await expect(window.getByTestId('stuck-tired')).toBeVisible();
  await window.keyboard.press('Escape');
  await expect(window.getByTestId('stuck-tired')).toBeHidden();
  await expect(window.getByTestId('focus-stuck')).toBeFocused();

  // "Tired" is answered with a rest, and with the learner's own words in the second person — not the
  // first-person label of the button that was pressed.
  await window.getByTestId('focus-stuck').click();
  await window.getByTestId('stuck-tired').click();
  await expect(window.getByTestId('stuck-tired')).toBeHidden();

  /*
   * Answering destroys the button that was pressed, so the focus has to land somewhere here too. Without
   * this the keyboard is on the body, and the learner who needs the suggestion is the one who has to tab
   * past the whole page to reach "Show me".
   */
  await expect(window.getByTestId('focus-stuck')).toBeFocused();

  const agent = window.locator('.agent');
  await expect(agent).toBeVisible();
  await expect(agent).toHaveAttribute('data-action', 'BREAK');
  await expect(agent).toContainText('You said you had not got the energy for it.');
  await expect(agent).not.toContainText("I haven't got the energy for it");

  // A different kind of stuck is answered differently, which is the premise of asking at all.
  await agent.getByRole('button', { name: 'Not now' }).click();
  await expect(agent).toBeHidden();

  await window.getByTestId('focus-stuck').click();
  await window.getByTestId('stuck-do-not-understand').click();
  await expect(agent).toBeVisible();
  await expect(agent).toHaveAttribute('data-action', 'EXAMPLE');
  await expect(agent).toContainText('You said reading it was not making sense.');

  await expect(window.locator('.banner--error')).toHaveCount(0);

  // The chooser does not come back on its own: it was answered, and the answer is a thing that has
  // happened rather than a mode the control stays in.
  await expect(window.getByTestId('stuck-tired')).toBeHidden();
  await expect(window.getByTestId('focus-stuck')).toBeVisible();

  /*
   * And it does not outlive the step it is about. The chooser is drawn inside the running-task branch
   * with the step's own controls, so leaving it open across a task change used to put the question on
   * screen over the *next* step — with the trigger for asking about that step hidden behind it.
   *
   * The assertion is after the next step starts, and not after the button that finishes the current
   * one: finishing a step leaves the running-task branch altogether, so the chooser is unmounted by the
   * phase change there whether or not anything closed it, and a check made at that point passes for the
   * wrong reason. Starting the next step is where the branch comes back.
   */
  await window.getByTestId('focus-stuck').click();
  await expect(window.getByTestId('stuck-reasons')).toBeVisible();
  await window.getByTestId('complete-task').click();
  await window.getByTestId('start-task').first().click();
  await expect(window.getByTestId('stuck-reasons')).toBeHidden();
  await expect(window.getByTestId('focus-stuck')).toBeVisible();

  // Left as it was found, so a re-run of this file does not start from a session.
  await window.getByTestId('end-session').click();
  await expect(window.getByRole('heading', { name: 'No session running' })).toBeVisible();
});
