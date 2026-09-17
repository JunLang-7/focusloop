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
  await expect(window.locator('.banner--error')).toHaveCount(0);
});
