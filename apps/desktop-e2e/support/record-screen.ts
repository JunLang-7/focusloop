import { expect, type Page } from '@playwright/test';

/**
 * Opens the record screen (`#/more`): the week, the bridge's pairing details and the folded event log.
 *
 * Reached by hash rather than through the sidebar, because it is not one of the app's learning surfaces -
 * the dashboard links to it in the UI, and that link is asserted where it matters. It stays a route
 * rather than a dialog for a reason the log tests depend on: the change-offer dialog is modal, and the
 * log is what says whether a change was applied while that dialog is still on screen.
 */
export async function openMoreData(page: Page): Promise<void> {
  await page.evaluate(() => {
    location.hash = '#/more';
  });
  await expect(page.getByTestId('more-back')).toBeVisible();
}
