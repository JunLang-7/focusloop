import { expect, type Page } from '@playwright/test';

/** Exercise the real recall control and wait for its grid animation before measuring/clicking. */
export async function openSidebar(page: Page): Promise<void> {
  const shell = page.locator('.shell');
  const sidebar = page.locator('.sidebar');
  // Visibility remains true during a fold and during hover-peek; neither means pinned open.
  if (!(await shell.evaluate((element) => element.classList.contains('is-forced-open'))))
    await page.getByTestId('sidebar-expand').click();
  await expect(shell).toHaveClass(/is-forced-open/);
  await expect(sidebar).toBeVisible();
  await expect
    .poll(() => sidebar.evaluate((element) => Math.round(element.getBoundingClientRect().width)))
    .toBe(232);
}
