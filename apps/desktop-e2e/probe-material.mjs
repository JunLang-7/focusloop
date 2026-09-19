/**
 * Feature probe for imported study material.
 *
 * The point is to exercise everything with real material in a real profile, and to keep going
 * after a step fails: a probe that stops at the first problem tells you about one problem.
 *
 *   node probe-material.mjs                          temporary profile, import + walk + shots
 *   node probe-material.mjs --import-only            temporary profile, import only
 *   node probe-material.mjs --profile=default        the profile the app really uses
 *
 * Screenshots land beside the repository, in demo-ui-review/probe, because they are a review aid
 * and not source.
 */
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';

const materialPath = process.argv
  .find((arg) => arg.startsWith('--material='))
  ?.slice('--material='.length);
if (materialPath === undefined) {
  process.stderr.write(
    'usage: node probe-material.mjs --material=<notes.md> [--profile=default]\n',
  );
  process.exit(2);
}
const CONTENT = readFileSync(materialPath, 'utf8');
/** The course is named after the document's first heading; the file name is the fallback. */
const TITLE = /^#\s+(.+)$/m.exec(CONTENT)?.[1]?.trim() ?? basename(materialPath);
const useDefaultProfile = process.argv.includes('--profile=default');
const importOnly = process.argv.includes('--import-only');

const DESKTOP_MAIN = resolve(import.meta.dirname, '..', 'desktop', 'dist', 'main', 'main.cjs');
const OUT = resolve(import.meta.dirname, '..', '..', '..', 'demo-ui-review', 'probe');
mkdirSync(OUT, { recursive: true });

const args = [DESKTOP_MAIN];
if (!useDefaultProfile)
  args.push(`--user-data-dir=${mkdtempSync(join(tmpdir(), 'focusloop-probe-'))}`);

const app = await electron.launch({ args, env: { ...process.env, FOCUSLOOP_DEV: '1' } });
const window = await app.firstWindow();
const findings = [];

const shot = (name) => window.screenshot({ path: join(OUT, `${name}.png`) });

/** Runs a step, records the outcome, and never lets one failure hide the rest. */
async function step(name, body) {
  try {
    const result = await body();
    findings.push(`ok   ${name}${result === undefined ? '' : ` -> ${result}`}`);
    return result;
  } catch (error) {
    findings.push(`FAIL ${name} -> ${String(error).split('\n')[0]}`);
    return undefined;
  }
}

try {
  await window.waitForLoadState('domcontentloaded');
  await window.setViewportSize({ width: 1280, height: 1000 });
  // Not `waitFor` on the Home heading: a profile that has been used before opens wherever it was
  // left, so the probe navigates rather than assuming. It also pins the language, because a stored
  // Chinese preference changes every label the steps below look for.
  await window.locator('body').waitFor();
  const english = window.getByTestId('locale-en');
  if ((await english.count()) > 0) await english.click();
  await window.getByRole('link', { name: 'Home' }).click();
  await window.getByRole('heading', { name: 'Keep your learning continuous' }).waitFor();
  await shot('00-home-before-import');

  // ---------------------------------------------------------------- import
  await step('import material', async () => {
    await window.getByLabel('File name').fill(`${TITLE}.md`);
    await window.getByLabel('Content').fill(CONTENT);
    await window.getByRole('button', { name: 'Import', exact: true }).click();
    const row = window.locator('.row', { has: window.getByRole('button', { name: 'Import' }) });
    await window.getByText(TITLE, { exact: false }).first().waitFor({ timeout: 15_000 });
    return (await row.innerText()).replace(/\s+/g, ' ').trim();
  });
  await shot('01-home-after-import');
  if (importOnly) throw new Error('__import_only_done__');

  const card = window.getByTestId('course-card').filter({ hasText: TITLE }).first();

  // ------------------------------------------------------------ course page
  await step('open course page', async () => {
    await card.getByRole('button', { name: 'View course' }).click();
    await window.getByRole('heading', { name: TITLE }).waitFor();
  });
  await shot('02-course-page');

  await step('the imported text is readable on the course page', async () => {
    const details = window.locator('details.material').first();
    await details.locator('summary').click();
    const body = (await details.locator('.material__body').innerText()).trim();
    if (body.length === 0) throw new Error('the section body is empty');
    const fragment = body.split('\n')[0]?.trim() ?? '';
    if (!CONTENT.includes(fragment)) {
      throw new Error(`the text does not come from the material: ${fragment}`);
    }
    return `${body.length} characters, matching the source`;
  });
  await shot('02b-course-material-text');

  // ----------------------------------------------------------------- focus
  await step('start session, land on the ready state', async () => {
    await window.getByRole('link', { name: 'Home' }).click();
    await card.getByTestId('start-session').click();
    await window.getByTestId('start-task').first().waitFor();
  });
  await shot('03-focus-ready');

  await step('start a step: timer runs', async () => {
    await window.getByTestId('start-task').first().click();
    await window.getByTestId('complete-task').waitFor();
  });
  await shot('04-focus-active');

  await step('pause', async () => {
    await window.getByRole('button', { name: 'Pause' }).click();
    await window.getByText('paused').waitFor();
  });
  await shot('05-focus-paused');

  await step('resume, then add a minute', async () => {
    await window.getByRole('button', { name: 'Continue', exact: true }).click();
    await window.getByRole('button', { name: '+1 minute' }).click();
  });
  await shot('06-focus-after-plus-one');

  await step('plan drawer opens', async () => {
    await window.getByTestId('focus-plan-toggle').click();
    await window.locator('.focus-plan[open]').waitFor();
  });
  await shot('07-focus-plan-drawer');
  await step('plan drawer closes', () => window.getByTestId('focus-plan-toggle').click());

  // ------------------------------------------------------- stuck -> agent
  await step('stuck opens a suggestion', async () => {
    await window.getByRole('button', { name: "I'm stuck" }).click();
    await window.locator('.agent').waitFor({ timeout: 10_000 });
  });
  await shot('08-focus-stuck-agent');
  await step('dismiss the suggestion', async () => {
    const notNow = window.locator('.agent').getByRole('button', { name: 'Not now' });
    if ((await notNow.count()) > 0) await notNow.click();
  });

  // ------------------------------------------------------- complete a step
  await step('complete the step', async () => {
    await window.getByTestId('complete-task').click();
    await window.getByTestId('tasks-completed').waitFor();
  });
  await shot('09-focus-complete');

  // -------------------------------------------- interruption -> resume card
  await step('distraction then return shows the resume card', async () => {
    await window.getByTestId('sim-distraction').click();
    await window.getByTestId('sim-return').click();
    await window.getByTestId('resume-continue').waitFor({ timeout: 15_000 });
  });
  await shot('10-resume-card');
  await step('resume card shows context', async () => {
    const show = window.getByRole('button', { name: 'Show context' });
    if ((await show.count()) > 0) await show.click();
    await window.waitForTimeout(300);
  });
  await shot('11-resume-card-context');
  await step('continue from the resume card', () => window.getByTestId('resume-continue').click());

  // ------------------------------------------------------------- dashboard
  await step('dashboard renders', async () => {
    await window.getByRole('link', { name: 'Dashboard' }).click();
    await window.getByTestId('insights-total').waitFor();
  });
  await shot('12-dashboard-week');
  for (const range of ['today', 'session', 'all']) {
    await step(`dashboard range: ${range}`, async () => {
      await window.getByTestId(`range-${range}`).click();
      await window.waitForTimeout(350);
      await shot(`13-dashboard-${range}`);
    });
  }
  await step('dashboard lower half', async () => {
    await window.locator('.content').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await window.waitForTimeout(400);
    await shot('14-dashboard-lower');
    await window.locator('.content').evaluate((el) => el.scrollTo(0, 0));
  });

  // --------------------------------------------------------------- chinese
  await step('interface switches to Chinese', async () => {
    await window.getByTestId('locale-zh').click();
    await window.waitForTimeout(400);
  });
  await shot('15-dashboard-zh');

  // ------------------------------------------------------------- end state
  await step('end the session', async () => {
    await window.getByRole('link', { name: '专注会话' }).click();
    await window.getByTestId('end-session').click();
    // Locale-independent: the End session button only exists while a session does.
    await window.getByTestId('end-session').waitFor({ state: 'detached', timeout: 10_000 });
  });
  await shot('16-focus-no-session');
} catch (error) {
  if (!String(error).includes('__import_only_done__')) {
    findings.push(`ABORT ${String(error).split('\n')[0]}`);
    await shot('99-abort');
    try {
      findings.push(`title: ${await window.title()}`);
      const text = (await window.locator('body').innerText()).replace(/\s+/g, ' ').trim();
      findings.push(`body: ${text.slice(0, 1000)}`);
    } catch (dumpError) {
      findings.push(`dump failed: ${String(dumpError).split('\n')[0]}`);
    }
  }
} finally {
  await app.close();
  process.stdout.write(`${findings.join('\n')}\n`);
  process.stdout.write(`shots: ${OUT}\n`);
}
