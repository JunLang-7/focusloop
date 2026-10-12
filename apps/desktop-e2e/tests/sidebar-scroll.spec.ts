import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { hermeticEnv } from '../hermetic-env.mjs';

const MAIN = resolve(__dirname, '..', '..', 'desktop', 'dist', 'main', 'main.cjs');

test('main content scrolling never moves or scrolls the application sidebar', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'focusloop-scroll-'));
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${profile}`],
    env: hermeticEnv(),
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 640 });
    await expect(page.getByTestId('course-card').first()).toBeVisible();
    await page.getByTestId('sidebar-expand').click();
    await expect(page.locator('.sidebar')).toBeVisible();
    const sidebar = page.locator('.sidebar');
    await expect
      .poll(() => sidebar.evaluate((element) => Math.round(element.getBoundingClientRect().width)))
      .toBe(232);
    const content = page.locator('.content');
    const position = await sidebar.boundingBox();
    const sidebarScroll = await sidebar.evaluate((element) => element.scrollTop);
    await content.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    expect(await content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await sidebar.boundingBox()).toEqual(position);
    expect(await sidebar.evaluate((element) => element.scrollTop)).toBe(sidebarScroll);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
