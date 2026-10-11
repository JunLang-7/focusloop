/**
 * Design review capture. Walks the golden path so the dashboard has real data,
 * then writes PNGs of every screen in both languages.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';
import { hermeticEnv } from './hermetic-env.mjs';
import { fireDemoEvent } from './demo-events.mjs';

const DESKTOP_MAIN = resolve(import.meta.dirname, '..', 'desktop', 'dist', 'main', 'main.cjs');
// Deliberately outside the repository: screenshots are a review aid, not source.
const OUT = resolve(import.meta.dirname, '..', '..', '..', 'demo-ui-review');

mkdirSync(OUT, { recursive: true });
const userDataDir = mkdtempSync(join(tmpdir(), 'focusloop-ui-'));

const app = await electron.launch({
  args: [DESKTOP_MAIN, `--user-data-dir=${userDataDir}`],
  env: hermeticEnv(),
});

/*
 * Viewport shots, not fullPage: nothing is pinned to the bottom edge any more, but the shots are
 * still viewport-sized so every capture in this set frames the same region 鈥?a stitched full-page
 * image would make each screen a different height and the set impossible to compare.
 *
 * Two identical frames in a row, rather than one `screenshot()`. A single call returns whatever the
 * compositor had, which is not necessarily the frame that matches the DOM as it is now — switching
 * theme changes the styles the browser resolves long before the window is painted with them, which is
 * how every "dark" screenshot in this set could come out light with the theme read back as `dark`.
 * Chasing that with a sleep is a bet on a number; taking the shot twice is a condition.
 */
const shot = async (window, name) => {
  let previous = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const frame = await window.screenshot();
    if (previous !== null && frame.equals(previous)) {
      writeFileSync(join(OUT, `${name}.png`), frame);
      captured += 1;
      return;
    }
    previous = frame;
    await window.waitForTimeout(60);
  }
  // A screen that animates forever never settles; its last frame is still better than no file.
  unsettled += 1;
  captured += 1;
  writeFileSync(join(OUT, `${name}.png`), previous);
};

let unsettled = 0;
let captured = 0;

try {
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  /**
   * Walks to a sidebar link, recalling the sidebar first.
   *
   * While a commitment is running the shell hides the sidebar outright — no icon rail — and the
   * floating button in the top-left corner is the only way back, which is also how a learner reaches
   * the navigation mid-session. That is why this script stopped working: it went straight for the
   * links, and a link inside a `visibility: hidden` panel is not in the accessibility tree at all,
   * so the query could not find it, let alone press it. Every navigation here goes through this now,
   * so the fold cannot quietly break the next one either.
   *
   * Retried as a pair, because both the fold and the recall are driven by state that moves on its
   * own: a commitment that becomes current folds the sidebar even while this script is looking at
   * it, and a recall only holds until the next navigation away from the focus screen hands the
   * choice back to `auto`.
   */
  const goTo = async (name) => {
    const sidebar = window.locator('.sidebar');
    for (let attempt = 0; ; attempt += 1) {
      try {
        const folded = await sidebar.evaluate((el) => {
          const style = getComputedStyle(el);
          return style.visibility === 'hidden' || style.position === 'fixed';
        });
        if (folded) {
          await window.getByTestId('sidebar-expand').hover();
          /*
           * The brand block, not the middle of the column. A bare `click()` aims at the geometric
           * centre, and while the sidebar is peeking that point is the footer — the same defect #221
           * found in the suite, where the press landed on the language row, switched the interface to
           * Chinese and left every later English lookup timing out. `y: 30` is the inert title area in
           * both layouts, which is what makes it the safe place to press.
           */
          await sidebar.click({ position: { x: 116, y: 30 } });
          await window.waitForTimeout(260);
        }
        await sidebar.getByRole('link', { name }).click({ timeout: 2_000 });
        await window.waitForTimeout(300);
        return;
      } catch (error) {
        if (attempt >= 7) throw error;
        await window.waitForTimeout(400);
      }
    }
  };

  /**
   * Waits for a theme to actually reach the document.
   *
   * The control asks the main process to store the preference, so the click returns before the new
   * value is on `<html>`. Without this wait, the screenshot taken immediately afterwards races that
   * round trip — and only that one shot, which is how the first "dark" image in this set came out
   * light while every later one was dark.
   */
  const waitForTheme = async (theme) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const applied = await window.evaluate(() => document.documentElement.dataset.theme);
      if (applied === theme) return;
      await window.waitForTimeout(50);
    }
    throw new Error(`the theme never became ${theme}`);
  };

  await window.setViewportSize({ width: 1280, height: 1000 });
  await window.getByRole('heading', { name: 'Keep your learning continuous' }).waitFor();

  // Pin the theme before the first shot. The stored default is `system`, so without this
  // the "default" screenshots change with the OS setting and cannot be compared between
  // runs — which is what happened when Windows switched to its light schedule and the
  // same script produced dark images in the morning and light ones in the afternoon.
  await window.getByTestId('theme-dark').click();
  await waitForTheme('dark');
  /*
   * The attribute saying "dark" and the pixels being dark are two different claims, and a check that
   * waits on the attribute alone will happily report a pass while the window is still light. The
   * colour the browser actually resolved is recorded here and printed at the end, so the two can be
   * compared rather than assumed.
   */
  const darkBody = await window.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await shot(window, '01-home');

  // Build up some real activity so the charts are not empty.
  await window.getByTestId('course-card').first().getByTestId('start-session').click();
  await window.getByTestId('start-task').first().click();
  await window.getByTestId('task-title').waitFor();
  await window.waitForTimeout(300);
  await shot(window, '01b-focus-active-en');

  /*
   * The learner's own request, not the demo command, and that is the fix for a step that never worked:
   * a rescue view is only built when the decision answers a request (see `applyPolicy`), so `overload`
   * on its own records a BREAK and offers nothing on screen — the wait for `.agent` below sat out its
   * full timeout. The stuck control is also only on screen while a task is running, so this happens
   * before the task is completed rather than after.
   */
  await window.getByTestId('focus-stuck').click();
  await window.getByTestId('stuck-too-big').click();
  await window.locator('.agent').waitFor();
  await window.waitForTimeout(300);
  await shot(window, '01c-focus-agent-en');
  /*
   * Answered with the notice's own control rather than folded, and rather than the "Not now" this used
   * to click: inline, a BREAK offer renders only its accept button — "Not now" exists on the
   * non-inline panel — and folding the notice would hide the resume card the next step captures,
   * because the fold is remembered per session. Choosing "simplify" is what a learner does with a
   * step that is too big, and it leaves the screen showing the result.
   */
  await window.getByTestId('notice-simplify').click();
  await window.waitForTimeout(400);
  await fireDemoEvent(window, 'distraction');
  await window.waitForTimeout(300);
  await fireDemoEvent(window, 'return');
  await window.getByTestId('resume-continue').waitFor();
  await window.waitForTimeout(400);
  await shot(window, '01d-resume-card-en');
  await window.getByTestId('resume-continue').click();
  await window.waitForTimeout(400);
  // Now that the learner is back at work, finish the step: the dashboard below wants real activity.
  await window.getByTestId('complete-task').click();
  await window.waitForTimeout(200);

  await goTo('Dashboard');
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

  await goTo('首页');
  await window.waitForTimeout(300);
  await shot(window, '06-home-zh');

  await goTo('专注会话');
  await window.waitForTimeout(400);
  await shot(window, '07-focus-zh');

  // ---- Light theme -------------------------------------------------------
  await window.getByTestId('theme-light').click();
  await waitForTheme('light');
  await goTo('数据面板');
  await window.getByTestId('range-week').click();
  await window.waitForTimeout(500);
  await shot(window, '08-dashboard-light-zh');

  await window.getByTestId('locale-en').click();
  await window.waitForTimeout(400);
  await shot(window, '09-dashboard-light-en');

  await goTo('Home');
  await window.waitForTimeout(400);
  await shot(window, '10-home-light-en');

  await goTo('Focus Session');
  await window.waitForTimeout(400);
  await shot(window, '11-focus-light-en');

  // A window wider than the demo ever uses. Proves the content column stops growing
  // and centres instead of stretching every card across the screen.
  await window.setViewportSize({ width: 1680, height: 1000 });
  await goTo('Dashboard');
  await window.getByTestId('range-week').click();
  await window.waitForTimeout(500);
  await shot(window, '12-dashboard-wide-light-en');

  await goTo('Home');
  await window.waitForTimeout(400);
  await shot(window, '13-home-wide-light-en');

  // The narrowest window the main process allows (minWidth 960). Four stat cards and a
  // two-panel chart row are the tightest this layout ever gets.
  await window.setViewportSize({ width: 960, height: 900 });
  await goTo('Dashboard');
  await window.getByTestId('range-week').click();
  await window.waitForTimeout(500);
  await shot(window, '14-dashboard-min-width-light-en');

  const banners = await window.locator('.banner--error').count();
  const theme = await window.evaluate(() => document.documentElement.dataset.theme);
  const lightBody = await window.evaluate(() => getComputedStyle(document.body).backgroundColor);
  process.stdout.write(
    `\nCAPTURED ${String(captured)} files: ${String(captured - unsettled)} settled, ` +
      `${String(unsettled)} written from a frame that never settled\n` +
      `  error banners: ${String(banners)}\n` +
      `  theme=${theme} body=${lightBody}\n` +
      `  theme=dark body=${darkBody}\n`,
  );
} finally {
  await app.close();
  rmSync(userDataDir, { recursive: true, force: true });
}
