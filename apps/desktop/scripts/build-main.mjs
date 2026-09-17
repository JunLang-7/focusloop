import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const watch = process.argv.includes('--watch');

/** Native and Electron-provided modules must stay external. */
const external = ['electron', 'better-sqlite3'];

const options = {
  entryPoints: {
    main: join(root, 'electron', 'main.ts'),
    preload: join(root, 'electron', 'preload.ts'),
  },
  outdir: join(root, 'dist', 'main'),
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  tsconfig: join(root, 'tsconfig.main.json'),
  external,
  logLevel: 'info',
};

if (watch) {
  const { context } = await import('esbuild');
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
