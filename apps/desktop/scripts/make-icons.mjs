/**
 * Generate icons and sidebar wordmarks from docs/assets/ using Electron's image tooling.
 * Run `node apps/desktop/scripts/make-icons.mjs` after updating the artwork, then commit the
 * generated files under resources/. No extra image dependencies or network access are needed.
 * On headless Linux, run the command under xvfb-run (Electron needs a display).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const filename = fileURLToPath(import.meta.url);
const here = dirname(filename);
const outputDirectory = join(here, '..', 'resources');
const sourcePath = join(here, '..', '..', '..', 'docs', 'assets', 'pure_logo.png');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/** An ICO containing 32-bit PNG entries at every Windows shell size. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const directory = Buffer.alloc(images.length * 16);
  let offset = header.length + directory.length;
  images.forEach((image, index) => {
    const entry = index * 16;
    directory[entry] = image.size === 256 ? 0 : image.size;
    directory[entry + 1] = directory[entry];
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(image.data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.data.length;
  });
  return Buffer.concat([header, directory, ...images.map((image) => image.data)]);
}

/** PNG-backed macOS representations, including Retina sizes. */
function icns(render) {
  const entries = [
    ['icp4', 16],
    ['icp5', 32],
    ['icp6', 64],
    ['ic07', 128],
    ['ic08', 256],
    ['ic09', 512],
    ['ic10', 1024],
    ['ic11', 32],
    ['ic12', 64],
    ['ic13', 256],
    ['ic14', 512],
  ].map(([type, size]) => {
    const data = render(size);
    const header = Buffer.alloc(8);
    header.write(type, 0, 'ascii');
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(8 + entries.reduce((total, entry) => total + entry.length, 0), 4);
  return Buffer.concat([header, ...entries]);
}

/** Extract the lettering from the transparent horizontal logo, without its symbol or whitespace. */
function writeWordmarks(nativeImage) {
  const image = nativeImage.createFromPath(join(dirname(sourcePath), 'logo_name_pure.png'));
  if (image.isEmpty()) throw new Error('Cannot read the transparent wordmark.');
  const { width, height } = image.getSize();
  const pixels = image.toBitmap();
  // The symbol occupies the first 30% of this artwork; the rest is the original lettering.
  const start = Math.floor(width * 0.3);
  let left = width;
  let right = start;
  let top = height;
  let bottom = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = start; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] < 128) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (left > right || top > bottom) throw new Error('The wordmark contains no visible lettering.');
  const padding = 4;
  const x = Math.max(start, left - padding);
  const y = Math.max(0, top - padding);
  const cropped = image.crop({
    x,
    y,
    width: Math.min(width, right + padding + 1) - x,
    height: Math.min(height, bottom + padding + 1) - y,
  });
  const light = cropped.resize({ width: 600, quality: 'best' });
  writeFileSync(join(outputDirectory, 'wordmark-light.png'), light.toPNG());

  // Native bitmaps are premultiplied BGRA. Lift only the navy "Focus" to white;
  // the blue "Loop" and all transparent/antialiased edges keep their original artwork.
  const darkPixels = light.toBitmap();
  for (let offset = 0; offset < darkPixels.length; offset += 4) {
    const alpha = darkPixels[offset + 3];
    if (alpha === 0) continue;
    if (Math.max(...darkPixels.subarray(offset, offset + 3)) < alpha * 0.4) {
      darkPixels.fill(Math.round(alpha * 0.97), offset, offset + 3);
    }
  }
  const dark = nativeImage.createFromBitmap(darkPixels, light.getSize());
  writeFileSync(join(outputDirectory, 'wordmark-dark.png'), dark.toPNG());
}

if (!process.versions.electron) {
  // Re-enter with the Electron already installed for the desktop app, not a system image utility.
  const require = createRequire(import.meta.url);
  const env = { ...process.env };
  delete env['ELECTRON_RUN_AS_NODE'];
  const child = spawnSync(require('electron'), [filename], { stdio: 'inherit', env });
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
} else {
  const { app, nativeImage } = await import('electron');
  // Do not top-level-await whenReady: Electron waits for ESM evaluation before becoming ready.
  void app.whenReady().then(() => {
    try {
      const source = nativeImage.createFromPath(sourcePath);
      if (source.isEmpty()) throw new Error(`Cannot read logo: ${sourcePath}`);
      const { width, height } = source.getSize();
      if (width !== height) throw new Error('The application logo must be square.');
      const render = (size) =>
        source.resize({ width: size, height: size, quality: 'best' }).toPNG();
      mkdirSync(outputDirectory, { recursive: true });
      writeFileSync(
        join(outputDirectory, 'icon.ico'),
        ico(SIZES.map((size) => ({ size, data: render(size) }))),
      );
      writeFileSync(join(outputDirectory, 'icon.png'), render(512));
      writeFileSync(join(outputDirectory, 'icon.icns'), icns(render));
      writeWordmarks(nativeImage);
      process.stdout.write(`Wrote icons and light/dark wordmarks from ${dirname(sourcePath)}\n`);
      app.quit();
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
}
