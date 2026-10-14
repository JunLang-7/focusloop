import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { hermeticEnv } from '../hermetic-env.mjs';
import { closeElectronApp } from '../support/close-electron-app';
import { openSidebar } from '../support/sidebar';

const MAIN = resolve(__dirname, '..', '..', 'desktop', 'dist', 'main', 'main.cjs');

/**
 * The first-run questionnaire is answered for every other spec (`hermeticEnv` sets the flag), because
 * every spec uses a fresh profile and a modal that is right for a learner would sit over the suite.
 * This is the one launch that keeps it: it must ask once, write the answers as real settings, and never
 * ask again.
 */
test('the first-run questionnaire asks once and writes real settings', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'focusloop-onboarding-'));
  let app: ElectronApplication | undefined;
  try {
    const launch = (): Promise<ElectronApplication> =>
      electron.launch({
        args: [MAIN, `--user-data-dir=${profile}`],
        env: { ...hermeticEnv(), FOCUSLOOP_ONBOARDING: '1' },
      });

    app = await launch();
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.setViewportSize({ width: 1280, height: 900 });

    await expect(page.getByTestId('onboarding')).toBeVisible();

    // Language is asked first and switches the questionnaire itself, so the other two questions are not
    // read in a language the learner just said they do not want.
    await page.getByTestId('onboarding-language').selectOption('zh');
    await expect(page.locator('#onboarding-title')).toHaveText('三个小选择');

    await page.getByTestId('onboarding-reminder-toggle').click();
    await page.getByTestId('onboarding-reminder-time').fill('08:15');
    await page.getByTestId('onboarding-theme-light').click();
    await page.getByTestId('onboarding-start').click();
    await expect(page.getByTestId('onboarding')).toHaveCount(0);

    // The answers are real settings, not a thing the questionnaire keeps to itself.
    await openSidebar(page);
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('general-language')).toHaveValue('zh');
    await expect(page.getByTestId('theme-light')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('reminder-toggle')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('reminder-time')).toHaveValue('08:15');
    await page.getByTestId('settings-close').click();

    // A restart does not ask again, and the answers survive it.
    await closeElectronApp(app);
    app = await launch();
    const second = await app.firstWindow();
    await second.waitForLoadState('domcontentloaded');
    await second.setViewportSize({ width: 1280, height: 900 });
    await expect(second.getByTestId('onboarding')).toHaveCount(0);
    await openSidebar(second);
    await second.getByTestId('nav-settings').click();
    await expect(second.getByTestId('general-language')).toHaveValue('zh');
    await expect(second.getByTestId('reminder-time')).toHaveValue('08:15');
    await expect(second.getByTestId('theme-light')).toHaveAttribute('aria-pressed', 'true');
  } finally {
    if (app !== undefined) await closeElectronApp(app);
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
});
