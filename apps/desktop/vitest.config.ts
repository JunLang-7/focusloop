import { defineConfig } from 'vitest/config';
import { focusloopAlias } from '../../vitest.shared';

export default defineConfig({
  resolve: { alias: focusloopAlias },
  test: {
    environment: 'node',
    include: ['electron/**/*.spec.ts', 'src/**/*.spec.ts'],
  },
});
