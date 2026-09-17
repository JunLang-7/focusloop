/**
 * Design review capture. Walks the golden path so the dashboard has real data,
 * then writes PNGs of every screen in both languages.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';

const DESKTOP_MAIN = resolve(import.meta.dirname, '..', 'desktop', 'dist', 'main', 'main.cjs');
// Deliberately outside the repository: screenshots are a review aid, not source.
const OUT = resolve(import.meta.dirname, '..', '..', '..', 'demo-ui-review');

mkdirSync(OUT, { recursive: true });
const userDataDir = mkdtempSync(join(tmpdir(), 'focusloop-ui-'));

const app = await electron.launch({
  args: [DESKTOP_MAIN, `--user-data-dir=${userDataDir}`],
  env: { ...process.env, FOCUSLOOP_DEV: '1' },
});

// Viewport shots, not fullPage: a fullPage capture renders the fixed simulator bar
// at the bottom of the stitched image and makes it look like it overlaps content.
const shot = (window, name) => window.screenshot({ path: join(OUT, `${name}.png`) });

try {
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.setViewportSize({ width: 1280, height: 1000 });
  await window.getByRole('heading', { name: 'Keep your learning continuous' }).waitFor();
  await shot(window, '01-home');

  // Build up some real activity so the charts are not empty.
  await window.getByTestId('course-card').first().getByTestId('start-session').click();
  await window.getByTestId('start-task').first().click();
  await window.getByTestId('task-title').waitFor();
  await window.waitForTimeout(300);
  await shot(window, '01b-focus-active-en');

  await window.getByTestId('complete-task').click();
  await window.getByTestId('sim-overload').click();
  await window.locator('.agent').waitFor();
  await window.waitForTimeout(300);
  await shot(window, '01c-focus-agent-en');
  await window.locator('.agent').getByRole('button', { name: 'Not now' }).click();
  await window.getByTestId('sim-distraction').click();
  await window.waitForTimeout(300);
  await window.getByTestId('sim-return').click();
  await window.getByTestId('resume-continue').waitFor();
  await window.waitForTimeout(400);
  await shot(window, '01d-resume-card-en');
  await window.getByTestId('resume-continue').click();
  await window.waitForTimeout(400);

  await window.getByRole('link', { name: 'Dashboard' }).click();
  await window.getByTestId('insights-total').waitFor();
  await window.waitForTimeout(500);
  await shot(window, '02-dashboard-week-en');

  // The window section is above the fold; this is the technical tail below it.
  await window.locator('.content').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await window.waitForTimeout(400);
  await shot(window, '02b-dashboard-lower-en');
  await window.locator('.content').evaluate((el) => el.scrollTo(0, 0));

  // A different window, to check the controls and the empty state.
  await window.getByTestId('range-today').click();
  await window.waitForTimeout(400);
  await shot(window, '03-dashboard-today-en');
  await window.getByTestId('range-session').click();
  await window.waitForTimeout(400);
  await shot(window, '04-dashboard-session-en');

  // Chinese, to check the legend and heatmap do not overflow.
  await window.getByTestId('locale-zh').click();
  await window.getByTestId('range-week').click();
  await window.waitForTimeout(500);
  await shot(window, '05-dashboard-week-zh');

  await window.getByRole('link', { name: '首页' }).click();
  await window.waitForTimeout(300);
  await shot(window, '06-home-zh');

  await window.getByRole('link', { name: '专注会话' }).click();
  await window.waitForTimeout(400);
  await shot(window, '07-focus-zh');

  // ---- Light theme -------------------------------------------------------
  await window.getByTestId('theme-light').click();
  await window.getByRole('link', { name: '数据面板' }).click();
  await window.getByTestId('range-week').click();
  await window.waitForTimeout(500);
  await shot(window, '08-dashboard-light-zh');

  await window.getByTestId('locale-en').click();
  await window.waitForTimeout(400);
  await shot(window, '09-dashboard-light-en');

  await window.getByRole('link', { name: 'Home' }).click();
  await window.waitForTimeout(400);
  await shot(window, '10-home-light-en');

  await window.getByRole('link', { name: 'Focus Session' }).click();
  await window.waitForTimeout(400);
  await shot(window, '11-focus-light-en');

  // A window wider than the demo ever uses. Proves the content column stops growing
  // and centres instead of stretching every card across the screen.
  await window.setViewportSize({ width: 1680, height: 1000 });
  await window.getByRole('link', { name: 'Dashboard' }).click();
  await window.getByTestId('range-week').click();
  await window.waitForTimeout(500);
  await shot(window, '12-dashboard-wide-light-en');

  await window.getByRole('link', { name: 'Home' }).click();
  await window.waitForTimeout(400);
  await shot(window, '13-home-wide-light-en');

  // The narrowest window the main process allows (minWidth 960). Four stat cards and a
  // two-panel chart row are the tightest this layout ever gets.
  await window.setViewportSize({ width: 960, height: 900 });
  await window.getByRole('link', { name: 'Dashboard' }).click();
  await window.getByTestId('range-week').click();
  await window.waitForTimeout(500);
  await shot(window, '14-dashboard-min-width-light-en');

  const banners = await window.locator('.banner--error').count();
  const theme = await window.evaluate(() => document.documentElement.dataset.theme);
  process.stdout.write(`\nCAPTURED 18 screens, theme=${theme}, error banners: ${banners}\n`);
} finally {
  await app.close();
  rmSync(userDataDir, { recursive: true, force: true });
}
