import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { hermeticEnv } from '../hermetic-env.mjs';

const MAIN = resolve(__dirname, '..', '..', 'desktop', 'dist', 'main', 'main.cjs');

test('expanded, collapsed and peeked sidebar branding loads in both themes', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'focusloop-branding-'));
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${profile}`],
    env: hermeticEnv(),
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // Wait for the initial navigation to finish before testing sidebar state changes.
    await expect(page.locator('.nav a.is-active')).toBeVisible();
    const identity = await app.evaluate(({ app: runtime, Menu }) => ({
      name: runtime.getName(),
      userData: runtime.getPath('userData'),
      platform: process.platform,
      menu: Menu.getApplicationMenu()?.items[0]?.label,
      about: Menu.getApplicationMenu()?.items[0]?.submenu?.items[0]?.label,
    }));
    expect(identity.name).toBe('FocusLoop');
    // macOS canonicalises /var to /private/var; compare the actual directories.
    expect(realpathSync(identity.userData)).toBe(realpathSync(profile));
    if (identity.platform === 'darwin') {
      expect(identity.menu).toBe('FocusLoop');
      expect(identity.about).toBe('About FocusLoop');
    }
    const logo = page.locator('.brand__mark');
    for (const theme of ['light', 'dark']) {
      await page.getByTestId(`theme-${theme}`).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(logo).toBeVisible();
      await expect(logo).toHaveAttribute('src', 'assets/icon.png');
      await expect
        .poll(() =>
          logo.evaluate((element) => {
            const image = element as HTMLImageElement;
            return image.complete && image.naturalWidth === 512 && image.naturalHeight === 512;
          }),
        )
        .toBe(true);
      await expect(logo).toHaveCSS('object-fit', 'contain');
      const wordmark = page.locator(`.brand__wordmark--${theme}`);
      const otherWordmark = page.locator(
        `.brand__wordmark--${theme === 'light' ? 'dark' : 'light'}`,
      );
      await expect(wordmark).toBeVisible();
      await expect(otherWordmark).toBeHidden();
      await expect(wordmark).toHaveAttribute('alt', 'FocusLoop');
      await expect
        .poll(() =>
          wordmark.evaluate((element) => {
            const image = element as HTMLImageElement;
            return image.complete && image.naturalWidth === 600;
          }),
        )
        .toBe(true);

      await page.getByTestId('sidebar-toggle').click();
      await page.mouse.move(500, 200);
      await expect(page.locator('.sidebar')).toBeHidden();
      const expand = page.getByTestId('sidebar-expand');
      await expect(expand).toBeVisible();
      await expect(expand).toHaveText('');
      await expect(expand.locator('img')).toHaveAttribute('src', 'assets/icon.png');
      await expect
        .poll(() =>
          expand.locator('img').evaluate((element) => {
            const image = element as HTMLImageElement;
            return image.complete && image.naturalWidth === 512;
          }),
        )
        .toBe(true);
      await expect(expand).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(expand).toHaveCSS('background-image', 'none');

      await expand.hover();
      await expect(page.locator('.sidebar')).toBeVisible();
      await expect(wordmark).toBeVisible();
      await expect(logo).toBeHidden(); // The floating logo takes its place during a hover-peek.
      await expand.click();
      await expect(expand).toBeHidden();
      await expect(logo).toBeVisible();
      await expect(wordmark).toBeVisible();
    }
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', 'assets/icon.png');
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
  }
});
