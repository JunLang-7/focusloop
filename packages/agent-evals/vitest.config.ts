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
      exclude: ['src/**/*.spec.ts'],
      reporter: ['text-summary', 'html'],
      reportsDirectory: '../../coverage/agent-evals',
    },
  },
});
