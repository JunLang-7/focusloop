/**
 * Fires one demo command through the app's own seam.
 *
 * The renderer used to carry a developer bar at the bottom whose buttons did this by being clicked.
 * The bar is gone — it was the one surface a learner must never see, and it put a row of debug
 * buttons under every screen — but the command behind it is a supported part of the product: it is
 * what keeps the golden path demonstrable without the browser extension. So the specs reach it the
 * way any other caller does, through `focusloop.simulate` on the preload API, instead of through a
 * button that no longer exists.
 *
 * The session is read first rather than assumed. The bar only rendered while a session was running,
 * so a spec that fired a command with no session used to time out on an absent button; failing here
 * with a sentence keeps that guard while dropping the UI dependency.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'distraction' | 'return' | 'confusion' | 'overload' | 'success'} command
 * @returns {Promise<void>}
 */
export async function fireDemoEvent(page, command) {
  await page.evaluate(async (name) => {
    const snapshot = await globalThis.focusloop.getCurrentSession();
    if (snapshot === null) {
      throw new Error(`no active session for the demo command "${name}"`);
    }
    await globalThis.focusloop.simulate({ command: name, sessionId: snapshot.session.id });
  }, command);
}
