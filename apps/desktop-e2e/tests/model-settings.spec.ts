import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { hermeticEnv } from '../hermetic-env.mjs';
import { openSidebar } from '../support/sidebar';

const MAIN = resolve(__dirname, '..', '..', 'desktop', 'dist', 'main', 'main.cjs');

test('provider selection, secure keys and local-only mode survive restarts', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'focusloop-model-'));
  const launched: ElectronApplication[] = [];
  const launch = async () => {
    const app = await electron.launch({
      args: [MAIN, `--user-data-dir=${profile}`],
      env: hermeticEnv(),
    });
    launched.push(app);
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await openSidebar(page);
    return page;
  };
  try {
    const page = await launch();
    await expect(page.getByTestId('model-entry').locator('.model-entry__state')).toHaveAttribute(
      'data-state',
      'offline',
    );
    await page.getByTestId('model-entry-toggle').click();
    await expect(page.getByTestId('llm-settings')).toBeVisible();
    await expect(page.getByTestId('llm-key')).toHaveAttribute('type', 'password');
    test.skip(
      !(await page.evaluate(async () => (await window.focusloop.getLlmSettings()).canStore)),
      'This integration requires secure OS credential storage',
    );
    await expect(page.getByTestId('llm-use')).toBeDisabled();
    const sidebarBefore = await page.locator('.llm-providers').boundingBox();
    await page.locator('.llm-editor').evaluate((editor) => {
      editor.scrollTop = editor.scrollHeight;
    });
    expect(await page.locator('.llm-providers').boundingBox()).toEqual(sidebarBefore);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.getByTestId('llm-key').fill('sk-e2e-not-real');
    await page.getByTestId('llm-save').click();
    await expect(page.getByTestId('llm-key')).toHaveValue('');
    await expect(page.getByTestId('llm-notice')).toContainText('Configuration saved');
    await page.getByTestId('llm-model-picker').click();
    await page.getByTestId('llm-model-search').fill('reasoner');
    await page.getByRole('option', { name: /deepseek-reasoner/ }).click();
    await expect(page.getByTestId('llm-model-id')).toHaveValue('deepseek-reasoner');
    await page.getByTestId('llm-use').click();
    await expect(page.getByTestId('llm-notice')).toContainText('new requests');
    await page.getByTestId('llm-close').click();
    await expect(page.getByTestId('model-entry').locator('.model-entry__state')).toHaveAttribute(
      'data-state',
      'configured',
    );
    await expect(page.getByTestId('model-entry')).toContainText('deepseek-reasoner');
    await launched[0]!.close();

    const second = await launch();
    await expect(second.getByTestId('model-entry')).toContainText('deepseek-reasoner');
    await second.getByTestId('model-entry-toggle').click();
    await expect(second.getByTestId('llm-verification')).toContainText(/not verified/i);
    await second.getByTestId('llm-local').click();
    await expect(second.getByTestId('llm-notice')).toContainText('Local-only mode');
    await second.keyboard.press('Escape');
    await expect(second.getByTestId('llm-settings')).toHaveCount(0);
    await expect(second.getByTestId('model-entry-toggle')).toBeFocused();
    await launched[1]!.close();

    const third = await launch();
    await expect(third.getByTestId('model-entry').locator('.model-entry__state')).toHaveAttribute(
      'data-state',
      'offline',
    );
    await third.getByTestId('model-entry-toggle').click();
    await third.getByTestId('llm-advanced').locator('summary').click();
    await expect(third.getByTestId('llm-clear-key')).toBeVisible();
    await third.getByTestId('llm-clear-key').click();
    await expect(third.getByTestId('llm-notice')).toContainText('Saved key removed');
    await expect(third.getByTestId('llm-use')).toBeDisabled();
  } finally {
    for (const app of launched) await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

test('custom endpoints test real IPC without remote credentials or fixed ports', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'focusloop-gateway-'));
  let requests = 0;
  let discoveries = 0;
  let status = 200;
  const bodies: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/gateway/v1/models') {
      discoveries += 1;
      expect(request.headers.authorization).toBe('Bearer test-only-key');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ data: [{ id: 'discovered-model' }, { id: 'alternate-model' }] }),
      );
      return;
    }
    requests += 1;
    let text = '';
    for await (const chunk of request) text += String(chunk);
    bodies.push(JSON.parse(text) as Record<string, unknown>);
    expect(request.url).toBe('/gateway/v1/chat/completions');
    expect(request.headers.authorization).toBe('Bearer test-only-key');
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify(
        status === 200
          ? { model: 'custom-model', choices: [{ message: { content: 'OK' } }] }
          : { error: 'rejected' },
      ),
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No test listener');
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${profile}`],
    env: hermeticEnv(),
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await openSidebar(page);
    await page.getByTestId('model-entry-toggle').click();
    test.skip(
      !(await page.evaluate(async () => (await window.focusloop.getLlmSettings()).canStore)),
      'This integration requires secure OS credential storage',
    );
    await page.getByTestId('llm-add-provider').click();
    await page.getByTestId('llm-name').fill('Test Gateway');
    await page.getByTestId('llm-base-url').fill(`http://127.0.0.1:${address.port}/gateway/v1/`);
    await page.getByTestId('llm-key').fill('test-only-key');
    await page.getByTestId('llm-fetch-models').click();
    await expect(page.getByTestId('llm-model-search')).toBeVisible();
    await expect(page.getByTestId('llm-model-id')).toHaveValue('');
    await page.getByTestId('llm-model-search').fill('alternate');
    await page.getByRole('option', { name: 'alternate-model', exact: true }).click();
    await expect(page.getByTestId('llm-model-id')).toHaveValue('alternate-model');
    // Discovered identifiers remain ordinary editable fields, not a locked allowlist.
    await page.getByTestId('llm-model-id').fill('custom-model');
    expect(discoveries).toBe(1);
    await page.getByTestId('llm-save').click();
    await expect(page.getByTestId('llm-notice')).toContainText('Configuration saved');
    expect(requests).toBe(0);
    await page.getByTestId('llm-test').click();
    await expect(page.getByTestId('llm-notice')).toContainText('Connection verified');
    expect(requests).toBe(1);
    expect(bodies[0]).toMatchObject({
      model: 'custom-model',
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      max_tokens: 64,
    });
    await page.getByTestId('llm-use').click();
    await expect(page.getByTestId('llm-notice')).toContainText('new requests');
    await page.getByTestId('llm-close').click();
    await expect(page.getByTestId('model-entry').locator('.model-entry__state')).toHaveAttribute(
      'data-state',
      'connected',
    );

    await page.getByTestId('model-entry-toggle').click();
    status = 401;
    await page.getByTestId('llm-test').click();
    await expect(page.getByTestId('llm-notice')).toContainText('rejected authentication');
    expect(requests).toBe(2);
    await expect(page.getByTestId('llm-verification')).toContainText(/not verified/i);
    await page.getByTestId('llm-base-url').fill(`http://127.0.0.1:${address.port}/other/v1`);
    await page.getByTestId('llm-save').click();
    await expect(page.getByTestId('llm-notice')).toContainText('Configuration saved');
    await expect(page.getByTestId('llm-use')).toBeDisabled();
    await page.getByTestId('llm-advanced').locator('summary').click();
    await page.getByTestId('llm-delete').click();
    await page.getByTestId('llm-confirm-delete').click();
    await expect(page.getByTestId('llm-notice')).toContainText('Provider deleted');
    await page.getByTestId('llm-close').click();
    await expect(page.getByTestId('model-entry').locator('.model-entry__state')).toHaveAttribute(
      'data-state',
      'offline',
    );
  } finally {
    await app.close();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
    rmSync(profile, { recursive: true, force: true });
  }
});
