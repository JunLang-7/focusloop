import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { BRIDGE_PROTOCOL_VERSION } from '@focusloop/shared-types';
import { hermeticEnv } from '../hermetic-env.mjs';

const MAIN = resolve(__dirname, '..', '..', 'desktop', 'dist', 'main', 'main.cjs');

/**
 * One message through the real socket, and the answer it came back with.
 *
 * Resolved from `message`, not from a count: the bridge may answer more than one frame on a
 * reconnect, and the assertion below is about the ACK for the event it just sent.
 */
function submit(
  url: string,
  message: Record<string, unknown>,
): Promise<{ type: string; state?: string }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('the bridge did not answer in time'));
    }, 10_000);
    const done = (value: { type: string; state?: string }): void => {
      clearTimeout(timer);
      socket.close();
      resolve(value);
    };
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify(message));
    });
    socket.addEventListener('message', (event) => {
      const raw = typeof event.data === 'string' ? event.data : '';
      if (raw === '') return;
      done(JSON.parse(raw) as { type: string; state?: string });
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error(`could not reach the bridge at ${url}`));
    });
  });
}

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

/**
 * #204: an event the extension reports reaches the window by itself.
 *
 * The extension is the primary way an interruption is reported — the learner switches to the
 * browser, `TAB_LEFT` is sent over this socket, and the engine moves on. What it cannot do is touch
 * the window, so the window has to be told.
 *
 * The tick is pushed a minute out for this launch, and that is what makes the test decisive rather
 * than lucky: the five-second tick pushes the same response, so an assertion that polls for ten
 * seconds inside a five-second cycle would pass whether or not the push exists. With the timer moved
 * out of the way, the only thing that can carry the event to the screen is the event's own response.
 *
 * The expected state is read off the ACK rather than written into the assertion. Which state
 * `TAB_LEFT` produces is the engine's business (`DISTRACTED`, measured, not `INTERRUPTED` — the
 * later gap is what reports that); what is this test's business is that the window is told at all,
 * and taking the value from the socket's own answer is what keeps the two apart.
 */
test('an event the extension reports reaches the window without a tick', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'focusloop-bridge-event-'));
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${profile}`],
    env: { ...hermeticEnv(), FOCUSLOOP_TICK_INTERVAL_MS: '60000' },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.getByTestId('course-card').first().getByTestId('start-session').click();
    await page.getByTestId('start-task').first().click();
    await expect(page.getByTestId('state')).toHaveAttribute('data-state', 'FOCUSED');

    const info = await page.evaluate(async () => globalThis.focusloop.getBridgeInfo());
    expect(info.running, 'the bridge is not running, so the socket path cannot be tested').toBe(
      true,
    );

    const token = info.token;
    const left = await submit(info.url, {
      protocol: BRIDGE_PROTOCOL_VERSION,
      type: 'TAB_LEFT',
      token,
      eventId: 'e2e-tab-left',
      at: '2026-01-01T00:00:01.000Z',
      payload: { origin: 'https://example.com' },
    });
    expect(left.type).toBe('ACK');
    const leftState = left.state;
    expect(
      leftState,
      'the socket moved nothing, so an assertion about the window would pass vacuously',
    ).toBeDefined();
    expect(leftState).not.toBe('FOCUSED');

    /*
     * Nothing is clicked, no route changes, and the tick is a minute away: the engine recorded the
     * absence through the socket, and the screen has to say so on its own.
     */
    await expect(page.getByTestId('state')).toHaveAttribute('data-state', leftState ?? '');

    // And the other half of the round trip: coming back carries the window with it, same route.
    const returned = await submit(info.url, {
      protocol: BRIDGE_PROTOCOL_VERSION,
      type: 'TAB_RETURNED',
      token,
      eventId: 'e2e-tab-returned',
      at: '2026-01-01T00:00:04.000Z',
      payload: { origin: 'https://example.com' },
    });
    expect(returned.type).toBe('ACK');
    expect(
      returned.state,
      'the return left the window where the departure did, so this half proves nothing',
    ).not.toBe(leftState);
    await expect(page.getByTestId('state')).toHaveAttribute('data-state', returned.state ?? '');
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
