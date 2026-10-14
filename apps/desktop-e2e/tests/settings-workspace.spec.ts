/* eslint-disable no-empty-pattern -- Electron uses no browser fixtures; screenshots use testInfo. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { hermeticEnv } from '../hermetic-env.mjs';
import { openSidebar } from '../support/sidebar';
const MAIN = resolve(__dirname, '..', '..', 'desktop', 'dist', 'main', 'main.cjs');

test('sidebar keeps learning navigation; modal General and Models tabs persist preferences', async ({}, testInfo) => {
  const profile = mkdtempSync(join(tmpdir(), 'focusloop-settings-'));
  let app: ElectronApplication | undefined;
  const launch = async () => {
    app = await electron.launch({ args: [MAIN, `--user-data-dir=${profile}`], env: hermeticEnv() });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });
    return page;
  };
  try {
    const page = await launch();
    await expect(page.getByTestId('nav-home')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.sidebar')).toBeHidden();
    await expect(page.locator('.sidebar .nav a')).toHaveCount(3);
    await expect(page.locator('.content .nav')).toHaveCount(0);
    await expect(page.getByTestId('general-language')).toHaveCount(0);
    await expect(page.locator('.sidebar')).not.toContainText('Language');
    await expect(page.locator('.sidebar')).not.toContainText('Theme');
    await openSidebar(page);
    const url = page.url();
    await page.getByTestId('nav-settings').click();
    await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByTestId('settings-general-tab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('settings-close')).toHaveText('');
    await expect(page.getByTestId('settings-close')).toHaveAccessibleName('Close settings');
    await page.getByTestId('general-language').selectOption('zh');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh');
    await page.getByTestId('theme-light').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByTestId('material-text-toggle').click();
    await expect(page.getByTestId('material-text-toggle')).toHaveAttribute('aria-checked', 'false');
    await page.getByTestId('reminder-toggle').click();
    await page.getByTestId('reminder-time').fill('07:45');
    await expect(page.getByTestId('reminder-toggle')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('clock-12h').click();
    await expect(page.getByTestId('clock-12h')).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: testInfo.outputPath('general-light-zh.png') });
    const navigation = await page.locator('.settings__nav').boundingBox();
    await page.getByTestId('settings-models-tab').click();
    await expect(page.getByTestId('llm-model-id')).toHaveValue('deepseek-chat');
    await expect(page.getByTestId('settings-models-tab')).toHaveAttribute('aria-selected', 'true');
    expect(await page.locator('.settings__nav').boundingBox()).toEqual(navigation);
    await expect(page.getByTestId('llm-close')).toHaveText('');
    await page.screenshot({ path: testInfo.outputPath('models-light-zh.png') });
    await page.getByTestId('settings-general-tab').click();
    await page.getByTestId('theme-dark').click();
    await page.screenshot({ path: testInfo.outputPath('general-dark-zh.png') });
    await page.getByTestId('settings-close').click();
    await expect(page.getByTestId('settings-dialog')).toHaveCount(0);
    await expect(page.getByTestId('nav-settings')).toBeFocused();
    expect(page.url()).toBe(url);
    await app!.close();
    app = undefined;
    const second = await launch();
    await expect(second.locator('.sidebar')).toBeHidden();
    await expect(second.locator('html')).toHaveAttribute('lang', 'zh');
    await expect(second.locator('html')).toHaveAttribute('data-theme', 'dark');
    await openSidebar(second);
    await second.getByTestId('nav-settings').click();
    await expect(second.getByTestId('general-language')).toHaveValue('zh');
    await expect(second.getByTestId('material-text-toggle')).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(second.getByTestId('reminder-toggle')).toHaveAttribute('aria-checked', 'true');
    await expect(second.getByTestId('reminder-time')).toHaveValue('07:45');
    await expect(second.getByTestId('clock-12h')).toHaveAttribute('aria-pressed', 'true');
    await second.getByTestId('theme-system').click();
    await expect(second.getByTestId('theme-system')).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await app?.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

test('settings remains reachable while leaving a focused session folds the sidebar', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'focusloop-settings-focus-'));
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${profile}`],
    env: hermeticEnv(),
  });
  try {
    const page = await app.firstWindow();
    await page.getByTestId('course-card').first().getByTestId('start-session').click();
    await page.getByTestId('start-task').first().click();
    await expect(page.getByTestId('state')).toHaveAttribute('data-state', 'FOCUSED');
    await openSidebar(page);
    await page.getByTestId('nav-dashboard').click();
    await expect(page.getByTestId('nav-dashboard')).toHaveAttribute('aria-current', 'page');
    // The logical fold precedes CSS visibility; recall must not mistake the fading panel for open.
    await expect(page.locator('.shell')).toHaveClass(/is-collapsed/);
    await openSidebar(page);
    await expect(page.locator('.shell')).toHaveClass(/is-forced-open/);
    await expect(page.getByTestId('insights-total')).toBeVisible();
    const url = page.url();
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('general-settings')).toBeVisible();
    await expect(page.getByTestId('data-path')).toBeVisible();
    await page.getByTestId('settings-close').click();
    expect(page.url()).toBe(url);
    await expect(page.getByTestId('nav-settings')).toBeFocused();
    await expect(page.getByTestId('insights-total')).toBeVisible();
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

test('settings does not navigate; keyboard tabs and nested-dialog Escape preserve the underlying screen', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'focusloop-settings-return-'));
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${profile}`],
    env: hermeticEnv(),
  });
  try {
    const page = await app.firstWindow();
    await openSidebar(page);
    await page.getByTestId('nav-dashboard').click();
    await expect(page.getByTestId('insights-total')).toBeVisible();
    const url = page.url();
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-general-tab').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('settings-models-tab')).toBeFocused();
    await expect(page.getByTestId('llm-model-id')).toBeVisible();
    await page.keyboard.press('Home');
    await expect(page.getByTestId('general-settings')).toBeVisible();
    await page.getByTestId('data-delete').click();
    await expect(page.getByTestId('data-confirm-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('data-confirm-dialog')).toBeHidden();
    await expect(page.getByTestId('settings-dialog')).toBeVisible();
    await expect(page.getByTestId('data-delete')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-dialog')).toHaveCount(0);
    await expect(page.getByTestId('nav-settings')).toBeFocused();
    expect(page.url()).toBe(url);
    await expect(page.getByTestId('insights-total')).toBeVisible();
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
