import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { hermeticEnv } from '../hermetic-env.mjs';

const MAIN = resolve(__dirname, '..', '..', 'desktop', 'dist', 'main', 'main.cjs');

/**
 * #255: the model is reachable from the app.
 *
 * Until this landed the only way to give FocusLoop a model was `FOCUSLOOP_DEEPSEEK_API_KEY` in the
 * environment, which `hermeticEnv` strips — so this launch starts exactly where a learner does: no key
 * anywhere, an offline reply behind every hint, and a footer that says so.
 *
 * The restarts are the point rather than a detour. "Configured" has to mean stored, and a single
 * process cannot show that: the same `--user-data-dir` on a second launch is the only way to tell a
 * setting from a screen that changed colour, and the single-instance lock means the first app has to be
 * closed before the second can start.
 */
test('the model can be configured from the footer, and survives a restart', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'focusloop-model-'));
  /*
   * Every launch is tracked and closed together at the end, rather than each one being closed where it
   * is used: the teardown has to survive a test that failed part-way through, and an app left running
   * holds the profile's single-instance lock, which is what breaks the *next* run rather than this one.
   */
  const launched: ElectronApplication[] = [];

  const launch = async () => {
    const app = await electron.launch({
      args: [MAIN, `--user-data-dir=${profile}`],
      env: hermeticEnv(),
    });
    launched.push(app);
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    return page;
  };

  try {
    const page = await launch();
    await page.setViewportSize({ width: 1280, height: 900 });

    const entry = page.getByTestId('model-entry');
    await expect(entry).toBeVisible();
    // Off, and said so before anything is opened: "is a model configured" is the question this entry
    // has to answer without being asked.
    await expect(entry.locator('.model-entry__state')).toHaveAttribute('data-state', 'offline');
    await expect(entry).toContainText('local only');

    await page.getByTestId('model-entry-toggle').click();
    await expect(page.getByTestId('model-entry-note')).toContainText('nothing leaves this machine');

    const input = page.getByTestId('model-key-input');
    await expect(input).toHaveAttribute('type', 'password');
    // Nothing to save yet, so an empty submit cannot read as a click that did something.
    await expect(page.getByTestId('model-key-save')).toBeDisabled();

    await input.fill('sk-e2e-not-a-real-key');
    await page.getByTestId('model-key-save').click();

    await expect(entry.locator('.model-entry__state')).toHaveAttribute('data-state', 'connected');
    await expect(page.getByTestId('model-entry-note')).toContainText('sends that step’s text');
    // Cleared on the way out: a secret does not sit in a DOM field for the next person at the machine.
    await expect(input).toHaveValue('');

    await launched[0]?.close();

    const restarted = await launch();
    await expect(
      restarted.getByTestId('model-entry').locator('.model-entry__state'),
    ).toHaveAttribute('data-state', 'connected');

    await launched[1]?.close();

    // And removing it returns the app to the offline reply, which is the state the promise depends on.
    const third = await launch();
    await third.getByTestId('model-entry-toggle').click();
    await third.getByTestId('model-key-clear').click();
    await expect(third.getByTestId('model-entry').locator('.model-entry__state')).toHaveAttribute(
      'data-state',
      'offline',
    );
  } finally {
    for (const app of launched) {
      await app.close().catch(() => undefined);
    }
    rmSync(profile, { recursive: true, force: true });
  }
});
