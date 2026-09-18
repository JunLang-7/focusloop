import { defineConfig } from 'vitest/config';
import { focusloopAlias } from '../../vitest.shared';

export default defineConfig({
  resolve: { alias: focusloopAlias },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/fixtures.ts'],
      reporter: ['text-summary', 'html'],
      reportsDirectory: '../../coverage/persistence',
      /*
       * A floor, not a target: each number is a couple of points below what this package measures
       * today, so it costs nothing to keep and fails if a rule stops being exercised. Raise one when
       * you add tests — never lower one to make a pull request pass.
       */
      thresholds: { lines: 92, statements: 92, branches: 81, functions: 90 },
    },
  },
});
