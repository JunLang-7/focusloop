/* eslint-disable no-empty-pattern -- Electron uses no browser fixture; screenshots use testInfo. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { hermeticEnv } from '../hermetic-env.mjs';
import { openSidebar } from '../support/sidebar';

const MAIN = resolve(__dirname, '..', '..', 'desktop', 'dist', 'main', 'main.cjs');
const SHORTCUT = process.platform === 'darwin' ? 'Meta+,' : 'Control+,';

test('settings shortcut works with a folded sidebar, preserves drafts and restores keyboard focus', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'focusloop-settings-keys-'));
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${profile}`],
    env: hermeticEnv(),
  });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.sidebar')).toBeHidden();
    const opener = page.getByTestId('course-card').first().getByTestId('start-session');
    await opener.focus();
    const url = page.url();
    await page.keyboard.press(SHORTCUT);
    await expect(page.getByTestId('general-settings')).toBeVisible();
    await expect(page.locator('.sidebar')).toBeHidden();
    await page.getByTestId('settings-models-tab').click();
    await page.getByTestId('llm-name').fill('Unsaved provider name');
    await page.keyboard.press(SHORTCUT);
    await expect(page.getByTestId('settings-dialog')).toHaveCount(1);
    await expect(page.getByTestId('settings-models-tab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('llm-name')).toHaveValue('Unsaved provider name');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-dialog')).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(page.url()).toBe(url);
    await page.keyboard.press(SHORTCUT);
    await page.getByTestId('data-delete').click();
    await expect(page.getByTestId('data-confirm-dialog')).toBeVisible();
    await page.keyboard.press(SHORTCUT);
    await expect(page.getByTestId('data-confirm-dialog')).toBeVisible();
    await expect(page.getByTestId('settings-dialog')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('data-confirm-dialog')).toBeHidden();
    await expect(page.getByTestId('data-delete')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-dialog')).toHaveCount(0);
    await expect(opener).toBeFocused();
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

test('Harness scrollbar skin and Settings keycap hint match both themes', async ({}, testInfo) => {
  const profile = mkdtempSync(join(tmpdir(), 'focusloop-scrollbars-'));
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${profile}`],
    env: hermeticEnv(),
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 650 });
    await openSidebar(page);

    // The shortcut hint sits beside Settings, in Harness's keycap presentation.
    const settingsButton = page.getByTestId('nav-settings');
    const expectedKeys = process.platform === 'darwin' ? ['⌘', ','] : ['Ctrl', '+', ','];
    await expect(settingsButton.locator('kbd')).toHaveText(expectedKeys);
    await expect(settingsButton).toHaveAttribute(
      'aria-keyshortcuts',
      process.platform === 'darwin' ? 'Meta+,' : 'Control+,',
    );
    await expect(settingsButton).toHaveAccessibleName('Settings');
    await settingsButton.click();

    // Hover is a CSS rule, not a DOM node; assert it once rather than chasing
    // native scrollbar hit-testing, which is the engine's own territory.
    expect(
      await page.evaluate(() => {
        const texts: string[] = [];
        for (let i = 0; i < document.styleSheets.length; i += 1) {
          const sheet = document.styleSheets[i];
          if (sheet === undefined) continue;
          try {
            const rules = sheet.cssRules;
            for (let j = 0; j < rules.length; j += 1) {
              const rule = rules[j];
              if (rule !== undefined) texts.push(rule.cssText);
            }
          } catch {
            // A cross-origin sheet cannot be read; FocusLoop ships none.
          }
        }
        return texts.some(
          (text) =>
            text.includes('::-webkit-scrollbar-thumb:hover') &&
            text.includes('var(--dsh-scrollbar-thumb-hover)'),
        );
      }),
    ).toBe(true);

    for (const theme of ['light', 'dark'] as const) {
      await page.getByTestId(`theme-${theme}`).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const inspect = async (selector: string) => {
        await page.mouse.move(0, 0);
        return page.locator(selector).evaluate((element) => {
          const bar = getComputedStyle(element, '::-webkit-scrollbar');
          const thumb = getComputedStyle(element, '::-webkit-scrollbar-thumb');
          const track = getComputedStyle(element, '::-webkit-scrollbar-track');
          const corner = getComputedStyle(element, '::-webkit-scrollbar-corner');
          return {
            width: bar.width,
            height: bar.height,
            radius: thumb.borderRadius,
            clip: thumb.backgroundClip,
            thumb: thumb.backgroundColor,
            track: track.backgroundColor,
            corner: corner.backgroundColor,
            standardWidth: getComputedStyle(element).scrollbarWidth,
          };
        });
      };
      const geometry = {
        width: '5px',
        height: '5px',
        radius: '999px',
        clip: 'content-box',
        track: 'rgba(0, 0, 0, 0)',
        corner: 'rgba(0, 0, 0, 0)',
        // Auto keeps Chromium's own thumb sizing: the thumb length stays adaptive.
        standardWidth: 'auto',
      };
      const base = theme === 'light' ? 'rgb(229, 229, 229)' : 'rgb(60, 60, 61)';
      const elevated = theme === 'light' ? base : 'rgb(84, 85, 87)';
      expect(await inspect('.content')).toEqual({ ...geometry, thumb: base });
      expect(await inspect('fl-general-settings')).toEqual({ ...geometry, thumb: elevated });
      await expect
        .poll(() =>
          page
            .locator('fl-general-settings')
            .evaluate((element) => element.scrollHeight > element.clientHeight),
        )
        .toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`settings-scrollbar-${theme}.png`) });

      await page.getByTestId('settings-models-tab').click();
      await page.getByTestId('llm-advanced').locator('summary').click();
      expect(await inspect('.llm-editor')).toEqual({ ...geometry, thumb: elevated });
      await page.getByTestId('llm-model-picker').click();
      await expect(page.getByRole('listbox')).toBeVisible();
      expect(await inspect('.llm-picker__list')).toEqual({ ...geometry, thumb: elevated });
      await page.screenshot({ path: testInfo.outputPath(`picker-scrollbar-${theme}.png`) });
      await page.keyboard.press('Escape');
      await page.getByTestId('settings-general-tab').click();
    }
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

test('wheel scrolling runs at half speed across the page and settings, leaving pinch zoom native', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'focusloop-scroll-speed-'));
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${profile}`],
    env: hermeticEnv(),
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 650 });
    interface WheelProbe {
      readonly deltaY: number;
      readonly deltaMode: number;
      readonly ctrlKey?: boolean;
    }
    const dispatchWheel = (selector: string, init: WheelProbe) =>
      page.locator(selector).evaluate((element, wheel) => {
        const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...wheel });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      }, init);

    // Main page: a 50px wheel step moves 25px.
    expect(await dispatchWheel('.content', { deltaY: 50, deltaMode: 0 })).toBe(true);
    await expect
      .poll(() => page.locator('.content').evaluate((element) => element.scrollTop))
      .toBe(25);

    // Settings: same policy inside the modal's own scrollport.
    await page.getByTestId('course-card').first().getByTestId('start-session').focus();
    await page.keyboard.press(SHORTCUT);
    const target = page.locator('fl-general-settings');
    await expect(target).toBeVisible();
    const maximum = await target.evaluate((element) => element.scrollHeight - element.clientHeight);
    expect(maximum).toBeGreaterThan(0);
    expect(await dispatchWheel('fl-general-settings', { deltaY: 50, deltaMode: 0 })).toBe(true);
    await expect.poll(() => target.evaluate((element) => element.scrollTop)).toBe(25);

    // Ctrl+wheel stays with the browser for pinch zoom.
    expect(
      await dispatchWheel('fl-general-settings', { deltaY: 50, deltaMode: 0, ctrlKey: true }),
    ).toBe(false);
    await expect.poll(() => target.evaluate((element) => element.scrollTop)).toBe(25);

    // With no overflow left, the event is handed back untouched. The height is chosen so the panel
    // (which gained the reminder row) is taller than its content; the boundary itself is what this
    // test is about, not the number of rows the General tab happens to have.
    await page.setViewportSize({ width: 1280, height: 1400 });
    await expect
      .poll(() => target.evaluate((element) => element.scrollHeight <= element.clientHeight + 1))
      .toBe(true);
    expect(await dispatchWheel('fl-general-settings', { deltaY: 50, deltaMode: 0 })).toBe(false);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-dialog')).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
