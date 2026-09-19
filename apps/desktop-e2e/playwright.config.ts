import { defineConfig } from '@playwright/test';

/**
 * Electron-only suite: no browser binaries are required, because Playwright
 * drives the app's own Chromium through the Electron binary.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] === 'true' ? 1 : 0,
  reporter: process.env['CI'] === 'true' ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    trace: 'retain-on-failure',
    // The CI workflow uploads `test-results/` when the suite fails. The trace is the better artefact
    // for a DOM problem; the screenshot is the one a reviewer can look at without a viewer.
    screenshot: 'only-on-failure',
  },
});
