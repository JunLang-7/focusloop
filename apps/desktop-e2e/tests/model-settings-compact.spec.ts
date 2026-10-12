/* eslint-disable no-empty-pattern -- Electron needs no browser fixtures, but screenshots use testInfo. */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { hermeticEnv } from '../hermetic-env.mjs';
import { openSidebar } from '../support/sidebar';

const MAIN = resolve(__dirname, '..', '..', 'desktop', 'dist', 'main', 'main.cjs');

test('compact form keeps one model input, searchable selection and collapsed advanced options', async ({}, testInfo) => {
  const profile = mkdtempSync(join(tmpdir(), 'focusloop-compact-'));
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${profile}`],
    env: hermeticEnv(),
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 850 });
    await openSidebar(page);
    await page.getByTestId('model-entry-toggle').click();
    await expect(page.getByTestId('llm-model-id')).toHaveValue('deepseek-chat');
    await expect(page.getByTestId('llm-settings').locator('input:visible')).toHaveCount(4);
    await expect(page.getByTestId('llm-advanced')).toHaveJSProperty('open', false);
    await expect(page.getByTestId('llm-fetch-models')).toBeDisabled();
    await page.getByTestId('llm-model-picker').click();
    await expect(page.getByTestId('llm-model-search')).toBeFocused();
    await page.getByTestId('llm-model-picker').click();
    await expect(page.getByTestId('llm-model-search')).toBeHidden();
    await page.getByTestId('llm-model-picker').click();
    await page.getByTestId('llm-model-search').fill('reasoner');
    await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1);
    await page.getByTestId('llm-model-search').press('Enter');
    await expect(page.getByTestId('llm-model-id')).toHaveValue('deepseek-reasoner');
    await expect(page.getByTestId('llm-model-id')).toBeFocused();
    await expect(page.getByTestId('llm-model-search')).toBeHidden();
    await page.getByTestId('llm-model-id').fill('manual-model');
    await page.getByTestId('llm-advanced').locator('summary').click();
    await page.getByLabel('Display name (optional)').fill('Manual label');
    // Further ID edits preserve a deliberately edited display name.
    await page.getByTestId('llm-model-id').fill('manual-model-final');
    await expect(page.getByLabel('Display name (optional)')).toHaveValue('Manual label');
    const navigation = await page.locator('.llm-providers').boundingBox();
    await page.locator('.llm-editor').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    expect(await page.locator('.llm-providers').boundingBox()).toEqual(navigation);
    await page.getByTestId('llm-save').click();
    await expect(page.getByTestId('llm-notice')).toContainText('Configuration saved');
    const settings = await page.evaluate(() => window.focusloop.getLlmSettings());
    expect(settings.active).toBeNull();
    expect(settings.providers.find((p) => p.id === 'deepseek')?.models).toContainEqual(
      expect.objectContaining({ id: 'manual-model-final', displayName: 'Manual label' }),
    );
    await page.getByTestId('llm-close').click();
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('theme-dark').click();
    await page.getByTestId('general-language').selectOption('zh');
    await page.getByTestId('settings-models-tab').click();
    await expect(page.getByTestId('llm-settings')).toContainText('连接服务商');
    await page.screenshot({ path: testInfo.outputPath('compact-dark-zh.png') });
    await page.getByTestId('llm-model-picker').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('llm-settings')).toBeVisible();
    await expect(page.getByTestId('llm-model-search')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('nav-settings')).toBeFocused();
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('theme-light').click();
    await page.getByTestId('settings-models-tab').click();
    await page.screenshot({ path: testInfo.outputPath('compact-light-zh.png') });
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

test('model picker follows editor scrolling and resizing; token select matches both themes', async ({}, testInfo) => {
  const profile = mkdtempSync(join(tmpdir(), 'focusloop-anchor-'));
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${profile}`],
    env: hermeticEnv(),
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });
    await openSidebar(page);
    for (const theme of ['dark', 'light']) {
      await page.getByTestId('nav-settings').click();
      await page.getByTestId(`theme-${theme}`).click();
      await page.getByTestId('settings-models-tab').click();
      await page.getByTestId('llm-advanced').locator('summary').click();
      const token = page.getByTestId('llm-token-parameter');
      const inputStyle = await page.getByTestId('llm-model-id').evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          background: style.backgroundColor,
          color: style.color,
          border: style.borderColor,
          radius: style.borderRadius,
          fontSize: style.fontSize,
        };
      });
      expect(
        await token.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            background: style.backgroundColor,
            color: style.color,
            border: style.borderColor,
            radius: style.borderRadius,
            fontSize: style.fontSize,
          };
        }),
      ).toEqual(inputStyle);
      await token.selectOption('max_completion_tokens');
      await expect(token).toHaveValue('max_completion_tokens');
      const editor = page.locator('.llm-editor');
      await editor.evaluate((element) => {
        element.scrollTop = 0;
      });
      await page.getByTestId('llm-model-picker').click();
      const anchor = page.locator('.llm-model-input');
      const picker = page.locator('.llm-picker');
      await expect(picker).toBeVisible();
      const before = await picker.boundingBox();
      const beforeAnchor = await anchor.boundingBox();
      if (!before || !beforeAnchor) throw new Error('Missing model picker bounds');
      await editor.evaluate((element) => {
        element.scrollTop += 48;
      });
      await expect
        .poll(async () => {
          const after = await picker.boundingBox();
          return Math.abs((after?.y ?? 0) - (before.y - 48));
        })
        .toBeLessThan(1);
      expect((await anchor.boundingBox())?.y).toBeCloseTo(beforeAnchor.y - 48, 0);
      // Resizing the settings workspace must keep the picker aligned with its input.
      await page.setViewportSize({ width: 1150, height: 900 });
      await expect
        .poll(async () => {
          const a = await anchor.boundingBox();
          const p = await picker.boundingBox();
          return Math.abs((a?.x ?? 0) - (p?.x ?? 0));
        })
        .toBeLessThan(1);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('llm-settings')).toBeVisible();
      await token.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`token-select-${theme}.png`) });
      await page.getByTestId('llm-close').click();
      await page.setViewportSize({ width: 1280, height: 900 });
    }
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

test('fetch opens a searchable picker without replacing a manually entered ID or requiring keychain storage', async ({}, testInfo) => {
  const profile = mkdtempSync(join(tmpdir(), 'focusloop-picker-'));
  let discoveries = 0;
  const server = createServer((request, response) => {
    discoveries += 1;
    expect(request.method).toBe('GET');
    expect(request.url).toBe('/v1/models');
    expect(request.headers.authorization).toBe('Bearer transient-test-key');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        data: [
          { id: 'vendor/model-a', display_name: 'Vendor A' },
          { id: 'vendor/model-b', display_name: 'Vendor B' },
        ],
      }),
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test listener');
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${profile}`],
    env: hermeticEnv(),
  });
  try {
    const page = await app.firstWindow();
    await openSidebar(page);
    await page.getByTestId('model-entry-toggle').click();
    await page.getByTestId('llm-add-provider').click();
    await page.getByTestId('llm-name').fill('Test provider');
    await page.getByTestId('llm-key').fill('transient-test-key');
    await page.getByTestId('llm-base-url').fill(`http://127.0.0.1:${address.port}/v1`);
    await page.getByTestId('llm-model-id').fill('my-manual-model');
    await page.getByTestId('llm-fetch-models').click();
    await expect(page.getByTestId('llm-model-search')).toBeFocused();
    await expect(page.getByTestId('llm-model-id')).toHaveValue('my-manual-model');
    await page.getByTestId('llm-model-search').fill('Vendor B');
    await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('searchable-model-picker.png') });
    await page.getByRole('option', { name: 'vendor/model-b Vendor B' }).click();
    await expect(page.getByTestId('llm-model-id')).toHaveValue('vendor/model-b');
    await page.getByTestId('llm-advanced').locator('summary').click();
    await expect(page.getByLabel('Display name (optional)')).toHaveValue('Vendor B');
    await page.getByLabel('Display name (optional)').fill('My model');
    await page.getByTestId('llm-model-id').fill('any-manual-id');
    await expect(page.getByLabel('Display name (optional)')).toHaveValue('My model');
    await page.getByTestId('llm-model-picker').click();
    await page.getByTestId('llm-model-search').fill('does-not-exist');
    await expect(page.getByRole('listbox')).toContainText('No matching models');
    await page.getByTestId('llm-refresh-models').click();
    await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(2);
    expect(discoveries).toBe(2);
    await page.keyboard.press('Escape');
    await page.getByTestId('llm-base-url').fill(`http://127.0.0.1:${address.port}/other/v1`);
    await expect(page.getByTestId('llm-model-picker')).toBeDisabled();
    const settings = await page.evaluate(() => window.focusloop.getLlmSettings());
    expect(settings.active).toBeNull();
    expect(settings.providers).toHaveLength(2);
  } finally {
    await app.close();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
    rmSync(profile, { recursive: true, force: true });
  }
});
