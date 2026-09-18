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
      reportsDirectory: '../../coverage/agent-core',
      /*
       * A floor, not a target: each number is a couple of points below what this package measures
       * where the check runs — Node 22.13 from `.nvmrc`, on the CI runner — so it costs nothing to
       * keep and fails if a rule stops being exercised. Measure there, not on a newer local runtime:
       * Node 26 measured agent-core's functions two and a half points higher than Node 22 does.
       * Raise a floor when you add tests; never lower one to make a pull request pass.
       */
      thresholds: { lines: 95, statements: 95, branches: 84, functions: 88 },
    },
  },
});
