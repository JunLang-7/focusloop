import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const watch = process.argv.includes('--watch');

/**
 * Native and Electron-provided modules must stay external.
 *
 * The four readers that turn an attached file into text are here for a harder reason than size: they load
 * their own files from their own package directories at runtime. `tesseract.js` reads its worker script
 * and its WebAssembly core from beside itself, and `@tesseract.js-data/*` computes its language-data path
 * from `__dirname` — bundled into `dist/main`, both would resolve into a directory where those files do
 * not exist, and the failure would arrive as "this file could not be read" for a file that is fine. Kept
 * external, they are `require`d from `node_modules` and resolve to the paths they were built to resolve to.
 */
const external = [
  'electron',
  'better-sqlite3',
  'pdf-parse',
  'mammoth',
  'tesseract.js',
  '@tesseract.js-data/eng',
  '@tesseract.js-data/chi_sim',
];

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
