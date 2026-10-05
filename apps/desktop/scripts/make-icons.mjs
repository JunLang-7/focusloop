/**
 * Draws the FocusLoop mark and writes the packaged icon files.
 *
 * The mark is the sidebar badge: the app's own `FL` monogram on the accent gradient, so the window,
 * the taskbar, the installer and the installed shortcuts all show what the sidebar already shows.
 * It is drawn here, in code, because a checked-in binary that nobody can regenerate is not source:
 * change the numbers below, run
 *
 *     node apps/desktop/scripts/make-icons.mjs
 *
 * and commit both files. Packaging only *references* them; it never generates them.
 *
 * Dependency-free on purpose: no image library, no ImageMagick, no network. The PNG encoder is the
 * smallest one that produces a valid RGBA image, and the ICO is a directory of PNG entries, which
 * Windows has accepted since Vista.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const outputDirectory = join(here, '..', 'resources');

/** The badge geometry in a 256-unit square, matching `.brand__mark` in the stylesheet. */
const CANVAS = 256;
const INSET = 16;
/** The stylesheet's 10px radius on a 34px badge, as a fraction of the 224-unit square. */
const RADIUS = 66;
const ACCENT = [0x6e, 0xa8, 0xfe];
const ACCENT_END = [0x8b, 0x5c, 0xf6];
const MONOGRAM = [0x05, 0x07, 0x0b];

/** The monogram as strokes: F is a stem with two arms, L a stem with a foot. */
const STROKES = [
  [60, 82, 86, 176],
  [60, 82, 122, 107],
  [60, 122, 110, 147],
  [140, 82, 166, 176],
  [140, 151, 200, 176],
];

/** Windows sizes: the shell asks for these, and 256 is the one the file picker uses. */
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/** Sub-pixels per axis. The badge has round corners and a diagonal glyph, so edges need coverage. */
const SUPERSAMPLE = 4;

function insideBadge(x, y) {
  const minimum = INSET;
  const maximum = CANVAS - INSET;
  if (x < minimum || x >= maximum || y < minimum || y >= maximum) return false;
  // The nearest point of the inner rectangle: zero offset inside the straight edges, and the corner
  // centre inside a rounded corner, which turns the test into one circle per corner.
  const cx = Math.min(Math.max(x, minimum + RADIUS), maximum - RADIUS);
  const cy = Math.min(Math.max(y, minimum + RADIUS), maximum - RADIUS);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= RADIUS * RADIUS;
}

function insideMonogram(x, y) {
  return STROKES.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1);
}

/** One sub-pixel sample: transparent, monogram, or a point on the diagonal gradient. */
function sample(x, y) {
  if (!insideBadge(x, y)) return [0, 0, 0, 0];
  if (insideMonogram(x, y)) return [...MONOGRAM, 255];
  const span = 2 * (CANVAS - 2 * INSET);
  const t = Math.min(Math.max((x - INSET + (y - INSET)) / span, 0), 1);
  return [
    Math.round(ACCENT[0] + (ACCENT_END[0] - ACCENT[0]) * t),
    Math.round(ACCENT[1] + (ACCENT_END[1] - ACCENT[1]) * t),
    Math.round(ACCENT[2] + (ACCENT_END[2] - ACCENT[2]) * t),
    255,
  ];
}

/** RGBA pixels for one size. Colour is accumulated pre-multiplied so the edges do not darken. */
function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = CANVAS / size;
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const [r, g, b, a] = sample(
            (px + (sx + 0.5) / SUPERSAMPLE) * scale,
            (py + (sy + 0.5) / SUPERSAMPLE) * scale,
          );
          red += r * a;
          green += g * a;
          blue += b * a;
          alpha += a;
        }
      }
      const offset = (py * size + px) * 4;
      pixels[offset] = alpha === 0 ? 0 : Math.round(red / alpha);
      pixels[offset + 1] = alpha === 0 ? 0 : Math.round(green / alpha);
      pixels[offset + 2] = alpha === 0 ? 0 : Math.round(blue / alpha);
      pixels[offset + 3] = Math.round(alpha / samples);
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(pixels, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let row = 0; row < size; row += 1) {
    raw[row * (stride + 1)] = 0; // filter: none
    pixels.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** An ICO whose entries are PNG images: 32-bit colour at every size, including the 256 one. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const directory = Buffer.alloc(images.length * 16);
  let offset = header.length + directory.length;
  images.forEach((image, index) => {
    const entry = index * 16;
    directory[entry] = image.size === 256 ? 0 : image.size; // 0 means 256
    directory[entry + 1] = image.size === 256 ? 0 : image.size;
    directory.writeUInt16LE(1, entry + 4); // colour planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(image.data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.data.length;
  });
  return Buffer.concat([header, directory, ...images.map((image) => image.data)]);
}

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  join(outputDirectory, 'icon.ico'),
  ico(SIZES.map((size) => ({ size, data: png(render(size), size) }))),
);
writeFileSync(join(outputDirectory, 'icon.png'), png(render(512), 512));
process.stdout.write(`Wrote ${SIZES.join(', ')} ICO entries and a 512 PNG to ${outputDirectory}\n`);
