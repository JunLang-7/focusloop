/**
 * Runtime monitor. Launches the app, walks the screens a reviewer walks, and reports what the
 * renderer logged, threw, or failed to load.
 *
 * Separate from `capture-ui.mjs` on purpose: that one exists to produce pictures, this one to
 * produce a verdict, and the two fail for different reasons. The walk is the same shape as the
 * golden path so that the screens it inspects are the screens a learner actually reaches.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';

const DESKTOP_MAIN = resolve(import.meta.dirname, '..', 'desktop', 'dist', 'main', 'main.cjs');
const userDataDir = mkdtempSync(join(tmpdir(), 'focusloop-monitor-'));

/** Noise the app makes on purpose, or that the host makes on its behalf. */
const IGNORE = [/Autofill\./, /[Dd]ev[Tt]ools/, /GPU stall/, /Electron Security Warning/];

const findings = [];
const record = (kind, text) => {
  const line = String(text).replace(/\s+/g, ' ').trim();
  if (line.length === 0 || IGNORE.some((pattern) => pattern.test(line))) return;
  findings.push(`${kind.padEnd(9)} ${line.slice(0, 240)}`);
};

const app = await electron.launch({
  args: [DESKTOP_MAIN, `--user-data-dir=${userDataDir}`],
  env: { ...process.env, FOCUSLOOP_DEV: '1' },
});

try {
  const window = await app.firstWindow();
  window.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      record(`console.${message.type()}`, message.text());
    }
  });
  window.on('pageerror', (error) => record('pageerror', error.message));
  window.on('requestfailed', (request) =>
    record('request', `${request.url()} — ${request.failure()?.errorText ?? 'unknown'}`),
  );

  /** Runs a step, and keeps going afterwards: one broken screen must not hide the next one. */
  async function when(label, run) {
    try {
      await run();
      findings.push(`ok        ${label}`);
    } catch (error) {
      findings.push(`FAILED    ${label} — ${String(error.message).split('\n')[0].slice(0, 200)}`);
    }
  }

  /**
   * Clicks a sidebar link, recalling the folded sidebar first.
   *
   * While a task is live the shell hides the sidebar entirely and the floating button is the only
   * way back — so the link is not merely behind something, it is absent from the accessibility
   * tree and a role query cannot find it. A peek, by contrast, is only out of the grid, and pinning
   * it is harmless. Retried as a pair, because both the fold and the recall are driven by state
   * that moves on its own.
   */
  async function clickSidebarLink(name) {
    const sidebar = window.locator('.sidebar');
    let lastError;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const folded = await sidebar.evaluate((el) => {
          const style = getComputedStyle(el);
          return style.visibility === 'hidden' || style.position === 'fixed';
        });
        if (folded) {
          await window.getByTestId('sidebar-expand').hover();
          await sidebar.click();
          await window.waitForTimeout(260);
        }
        await sidebar.getByRole('link', { name }).click({ timeout: 2_000 });
        await window.waitForTimeout(250);
        return;
      } catch (error) {
        lastError = error;
        await window.waitForTimeout(400);
      }
    }
    throw lastError;
  }

  await window.setViewportSize({ width: 1280, height: 1000 });
  /*
   * No reload to "catch boot from the start": this renderer is loaded over a custom protocol that
   * aborts a reload (`net::ERR_ABORTED`, frame detached). The listeners above are attached on the
   * first window, which arrives before the document is parsed, so boot is inside the window being
   * monitored anyway.
   */
  await window.waitForLoadState('domcontentloaded');

  await when('Home renders', () =>
    window.getByRole('heading', { name: 'Keep your learning continuous' }).waitFor(),
  );

  await when('Home can take a file from the machine', async () => {
    const pickers = await window.locator('input[type=file]').count();
    record('note', `input[type=file] on Home: ${pickers}`);
  });

  await when('a session starts', async () => {
    await window.getByTestId('course-card').first().getByTestId('start-session').click();
    await window.getByTestId('start-task').first().click();
    await window.getByTestId('task-title').waitFor();
  });

  await when('nothing is laid over the step until the plan is asked for', async () => {
    /*
     * The property is the CLOSED one: while a step runs, nothing sits over it.
     *
     * An earlier version of this check compared the OPEN sheet's box against the step's and
     * reported an overlap. That was the check being wrong, not the sheet — a bottom sheet is fixed
     * to the edge and overlaps whatever is behind it by construction, and the learner is the one
     * who asked for it. Overlap while open is the point of opening it; measured that way, every
     * overlay ever written is a defect.
     */
    if ((await window.locator('.focus-plan__panel').count()) > 0) {
      throw new Error('the plan was on screen before anyone asked for it');
    }
  });

  await when('the plan rises from the bottom edge and closes on Escape', async () => {
    await window.getByTestId('focus-plan-toggle').click();
    const panel = window.locator('.focus-plan__panel');
    await panel.waitFor();
    const sheet = await window.locator('.focus-plan[data-open]').boundingBox();
    if (sheet === null) throw new Error('the open sheet has no box');
    const gap =
      (await window.evaluate(() => document.documentElement.clientHeight)) -
      (sheet.y + sheet.height);
    if (gap > 100) throw new Error(`the sheet is ${Math.round(gap)}px off the bottom edge`);
    await window.keyboard.press('Escape');
    await panel.waitFor({ state: 'detached', timeout: 3_000 });
  });

  await when('a completed step arrives and settles', async () => {
    await window.getByTestId('complete-task').click();
    await window.waitForTimeout(600);
  });

  await when('an interruption arrives and is dismissed', async () => {
    await window.getByTestId('sim-overload').click();
    await window.locator('.agent').waitFor();
    await window.locator('.agent').getByRole('button', { name: 'Not now' }).click();
  });

  await when('a resume card arrives and is accepted', async () => {
    await window.getByTestId('sim-distraction').click();
    await window.waitForTimeout(300);
    await window.getByTestId('sim-return').click();
    await window.getByTestId('resume-continue').waitFor();
    await window.getByTestId('resume-continue').click();
    await window.waitForTimeout(400);
  });

  await when('the dashboard is reachable mid-session', async () => {
    await clickSidebarLink('Dashboard');
    await window.getByTestId('insights-total').waitFor();
    await window.waitForTimeout(400);
  });

  await when('the dashboard keeps its internals to itself', async () => {
    // The bridge finds its port asynchronously, so the address can be absent on the first frame.
    // Probing before it settles would report "nothing leaked" for the wrong reason.
    await window.waitForTimeout(1_500);
    const bridgeText = await window.locator('body').innerText();
    const leaked = [/ws:\/\//.test(bridgeText), /127\.0\.0\.1:\d{4,5}/.test(bridgeText)];
    record('note', `dashboard shows a socket address: ${leaked[0]}; a host:port: ${leaked[1]}`);
    const rawEvents = (bridgeText.match(/[A-Z]{2,}(_[A-Z]+)+/g) ?? []).slice(0, 6);
    record('note', `dashboard raw event names: ${rawEvents.join(', ') || 'none'}`);
  });

  await when('the technical tail renders', async () => {
    await window.locator('.content').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await window.waitForTimeout(400);
  });
} finally {
  await app.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

const problems = findings.filter((line) => !line.startsWith('ok'));
process.stdout.write(`${findings.join('\n')}\n\n${problems.length} finding(s)\n`);
process.exitCode = problems.some((line) => line.startsWith('FAILED')) ? 1 : 0;
