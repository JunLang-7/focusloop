import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { hermeticEnv } from '../hermetic-env.mjs';

const MAIN = resolve(__dirname, '..', '..', 'desktop', 'dist', 'main', 'main.cjs');

/**
 * #135: the dashboard is the learner's own screen, and the bridge's address, protocol version,
 * connection count and token are machinery. They stay reachable, because connecting the browser
 * extension needs them - but behind a request, not in the body text of the numbers.
 */
test('the dashboard keeps the bridge behind an explicit request', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'focusloop-bridge-surface-'));
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${profile}`],
    env: hermeticEnv(),
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByTestId('course-card').first().getByTestId('start-session').click();
    await page.evaluate(() => {
      location.hash = '#/dashboard';
    });
    await expect(page.getByTestId('insights-total')).toBeVisible();

    /*
     * Nothing from the machinery reaches a learner who has not asked for it - in either language,
     * because the guarantee is the template's, not the translation's. A translator adding the address
     * to a translated string would otherwise slip past a suite that only ever ran in English.
     */
    const body = page.locator('body');
    for (const locale of ['en', 'zh'] as const) {
      await page.getByTestId(`locale-${locale}`).click();
      await expect(page.getByTestId(`locale-${locale}`)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('bridge-token')).toHaveCount(0);
      await expect(body).not.toContainText('ws://');
      await expect(body).not.toContainText('protocol v');
      await expect(body).not.toContainText('127.0.0.1:');
    }
    await page.getByTestId('locale-en').click();

    // And it stays reachable.
    const reveal = page.getByTestId('bridge-reveal');
    /*
     * Wait for the running branch, and name what was found instead if it never appears. The renderer
     * starts with no bridge information and paints `bridge-unavailable` until the IPC answer arrives, so
     * `unavailable` has to keep polling; `stopped` is terminal - the bridge resolved and said so - and is
     * worth failing on immediately rather than after the whole timeout.
     */
    await expect
      .poll(
        async () => {
          if ((await reveal.count()) > 0) return 'running';
          if ((await page.getByTestId('bridge-stopped').count()) > 0) return 'stopped';
          if ((await page.getByTestId('bridge-unavailable').count()) > 0) return 'unavailable';
          return 'unrendered';
        },
        {
          timeout: 15_000,
          message:
            'the dashboard never offered the bridge reveal control: the bridge is not running',
        },
      )
      .toBe('running');
    await expect(reveal).toHaveAttribute('aria-expanded', 'false');
    await reveal.click();

    await expect(page.getByTestId('bridge-token')).toBeVisible();
    await expect(body).toContainText('ws://');
    await expect(body).toContainText('protocol v');
    await expect(reveal).toHaveAttribute('aria-expanded', 'true');
    /*
     * The revealed region is announced by, and sits after, the control that reveals it (APG disclosure
     * pattern). Both halves matter: the id is what a screen reader follows, and the order is what keeps
     * the button from jumping out from under the pointer that just clicked it.
     */
    await expect(reveal).toHaveAttribute('aria-controls', 'bridge-details');
    expect(
      await page.evaluate(() => {
        const button = document.querySelector('[data-testid="bridge-reveal"]');
        const region = document.getElementById('bridge-details');
        if (button === null || region === null) return 'missing';
        const position = button.compareDocumentPosition(region);
        return (position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 ? 'after' : 'before';
      }),
    ).toBe('after');

    // Asking is a choice, and it can be taken back.
    await reveal.click();
    await expect(page.getByTestId('bridge-token')).toHaveCount(0);
    await expect(body).not.toContainText('ws://');
    await expect(reveal).toHaveAttribute('aria-expanded', 'false');
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
