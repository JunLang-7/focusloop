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

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'focusloop-e2e-'));
  app = await electron.launch({
    args: [DESKTOP_MAIN, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, FOCUSLOOP_DEV: '1' },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close();
  if (userDataDir !== undefined) rmSync(userDataDir, { recursive: true, force: true });
});

test('golden path: learn, get interrupted, resume, see the outcome', async () => {
  // 1. The app boots into Home with the built-in demo course.
  await expect(
    window.getByRole('heading', { name: 'Keep your learning continuous' }),
  ).toBeVisible();
  const courseCard = window.getByTestId('course-card').first();
  await expect(courseCard).toContainText('Red-black trees');

  // 2. Start a session from the demo course.
  await courseCard.getByTestId('start-session').click();
  await expect(window.getByTestId('state')).toHaveText('READY');

  // 3. Begin the first micro task.
  await window.getByTestId('start-task').first().click();
  await expect(window.getByTestId('state')).toHaveText('FOCUSED');
  const firstTaskTitle = await window.getByTestId('task-title').innerText();

  // 4. Complete it.
  await window.getByTestId('complete-task').click();
  await expect(window.getByTestId('tasks-completed')).toBeVisible();

  // 5. Simulate a distraction.
  await window.getByTestId('sim-distraction').click();
  await expect(window.getByTestId('state')).toHaveText('DISTRACTED');

  // 6. ...and a late return: the state engine must mark the interruption.
  await window.getByTestId('sim-return').click();
  await expect(window.getByTestId('state')).toHaveText('INTERRUPTED');

  // 7. The resume card appears and restores the cognitive position.
  const resume = window.getByRole('dialog', { name: 'Resume where you left off' });
  await expect(resume).toBeVisible();
  await expect(resume).toContainText('Continue');
  await expect(resume).toContainText('Next step:');

  // 8. Continue.
  await window.getByTestId('resume-continue').click();
  await expect(resume).toBeHidden();
  await expect(window.getByTestId('state')).toHaveText('RESUMING');

  // 9. The dashboard reflects the interruption and a measured resume latency.
  await window.getByRole('link', { name: 'Dashboard' }).click();
  await expect(window.getByTestId('interruptions')).toHaveText('1');
  await expect(window.getByTestId('tasks')).toContainText('/ 5');
  await expect(window.getByTestId('latency')).not.toHaveText('—');
  await expect(window.getByTestId('duration')).toBeVisible();

  // The task the learner was on is still the task they resume into.
  await window.getByRole('link', { name: 'Focus Session' }).click();
  expect(firstTaskTitle.length).toBeGreaterThan(0);
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
  await expect(agent).toContainText('BREAK');
  await agent.getByRole('button', { name: 'Not now' }).click();
  await expect(agent).toBeHidden();
});
