import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(root, 'dist');
const shouldZip = process.argv.includes('--zip');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: {
    background: join(root, 'src', 'background.ts'),
    popup: join(root, 'src', 'popup.ts'),
  },
  outdir: dist,
  bundle: true,
  platform: 'browser',
  target: 'chrome116',
  format: 'esm',
  sourcemap: false,
  minify: true,
  tsconfig: join(root, 'tsconfig.json'),
  logLevel: 'info',
});

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
writeFileSync(join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
cpSync(join(root, 'src', 'popup.html'), join(dist, 'popup.html'));

if (shouldZip) {
  const releaseDir = join(root, 'release');
  mkdirSync(releaseDir, { recursive: true });
  const zipPath = join(releaseDir, 'focusloop-extension.zip');
  rmSync(zipPath, { force: true });
  if (process.platform === 'win32') {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path '${join(dist, '*')}' -DestinationPath '${zipPath}' -Force`,
      ],
      { stdio: 'inherit' },
    );
  } else {
    execFileSync('zip', ['-r', zipPath, '.'], { cwd: dist, stdio: 'inherit' });
  }
  console.warn(`Extension packaged at ${zipPath}`);
}
