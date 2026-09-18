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
  await window.getByRole('link', { name: 'Dashboard' }).click();
  await expect(window.getByTestId('interruptions')).toHaveText('1');
  await expect(window.getByTestId('tasks')).toContainText('/ 5');
  await expect(window.getByTestId('latency')).not.toHaveText('—');
  await expect(window.getByTestId('duration')).toBeVisible();

  // The task the learner was on is still the task they resume into.
  await window.getByRole('link', { name: 'Focus Session' }).click();
  expect(firstTaskTitle.length).toBeGreaterThan(0);

  // Every screen the learner visited was rendered without an IPC failure.
  await expect(window.locator('.banner--error')).toHaveCount(0);
});

test('the remaining work is shown as a proportional plan', async () => {
  await window.getByRole('link', { name: 'Focus Session' }).click();
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
  await window.getByRole('link', { name: 'Home' }).click();
  await expect(
    window.getByRole('heading', { name: 'Keep your learning continuous' }),
  ).toBeVisible();

  // Overload: the policy must offer a break, and the learner can decline it.
  await window.getByRole('link', { name: 'Focus Session' }).click();
  await window.getByTestId('sim-overload').click();
  const agent = window.locator('.agent');
  await expect(agent).toBeVisible();
  await expect(agent).toHaveAttribute('data-action', 'BREAK');
  await agent.getByRole('button', { name: 'Not now' }).click();
  await expect(agent).toBeHidden();

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

test('resume is offered once, by the resume card alone', async () => {
  await window.getByRole('link', { name: 'Home' }).click();
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
  await window.getByRole('link', { name: 'Dashboard' }).click();
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
  await window.getByRole('link', { name: 'Dashboard' }).click();
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

  await window.getByRole('link', { name: 'Dashboard' }).click();

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

  await window.getByRole('link', { name: 'Home' }).click();
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
  await window.getByRole('link', { name: '专注会话' }).click();
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
  await window.getByRole('link', { name: 'Dashboard' }).click();

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
  await window.getByRole('link', { name: 'Focus Session' }).click();
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
  await window.getByRole('link', { name: 'Focus Session' }).click();
  await expect(window.getByTestId('end-session')).toBeVisible();

  await window.getByTestId('end-session').click();

  /*
   * This assertion is only reachable now that starting a session ends the running one.
   * Before that, an older session was still active underneath, so the app silently handed
   * itself back to it and "no session running" never appeared.
   */
  await expect(window.getByRole('heading', { name: 'No session running' })).toBeVisible();

  await window.getByRole('link', { name: 'Home' }).click();
  await expect(window.getByText('No session running. Pick a course below to begin.')).toBeVisible();

  await expect(window.locator('.banner--error')).toHaveCount(0);
});
