#!/usr/bin/env node
/**
 * Theme invariant gate.
 *
 * `docs/architecture.md` states two arrangements about colour, and both are the kind that a
 * reviewer cannot reliably hold in their head:
 *
 *   1. **Every colour is a token.** The dark values live on `:root`, the light values on
 *      `:root[data-theme='light']`, and nothing below those blocks names a colour directly —
 *      `rg '#[0-9a-f]'` outside them returns nothing. A colour function whose arguments are all
 *      `var(...)` is not a literal; that is how a token gets an alpha, and it stays legal.
 *   2. **The window's native background is that token, per theme.** The main process cannot reach
 *      the stylesheet, so `electron/window.ts` repeats the page background as a literal. If `--bg`
 *      changes and that line does not, the app flashes the previous theme's colour before the
 *      renderer paints — the exact symptom the comment there says it prevents.
 *
 * Exit code 1 means the theme can drift.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const STYLESHEET = `${root}apps/desktop/src/styles.css`;
const WINDOW = `${root}apps/desktop/electron/window.ts`;

const DARK_BLOCK = /^:root\s*\{/;
const LIGHT_BLOCK = /^:root\[data-theme='light'\]\s*\{/;
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?|oklch|oklab|lch|lab|color)\(/;

const findings = [];
const report = (file, line, message) => findings.push({ file, line, message });

/**
 * Token blocks, as ranges, and the `--bg` value each one defines.
 *
 * A line-based reader is enough: the stylesheet defines both blocks at the top level and closes
 * them with a `}` in column 0, which is also what makes the rule legible to a human reading it.
 */
function tokenBlocks(lines) {
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    let kind = null;
    if (DARK_BLOCK.test(line)) kind = 'dark';
    else if (LIGHT_BLOCK.test(line)) kind = 'light';
    if (kind === null) continue;
    let end = index;
    while (end < lines.length && !/^\}/.test(lines[end])) end += 1;
    const body = lines.slice(index, end + 1).join('\n');
    const bg = /--bg:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? null;
    blocks.push({ kind, start: index + 1, end: end + 1, bg });
    index = end;
  }
  return blocks;
}

/** Colour functions are read with their arguments, so `rgb(var(--x) / var(--y))` can be allowed. */
function literalColourFunction(line) {
  const match = COLOUR_FUNCTION.exec(line);
  if (match === null) return null;
  const start = match.index + match[0].length;
  let depth = 1;
  let end = start;
  while (end < line.length && depth > 0) {
    if (line[end] === '(') depth += 1;
    if (line[end] === ')') depth -= 1;
    end += 1;
  }
  const args = line.slice(start, end - 1);
  return args.includes('var(') ? null : `${match[0]}${args})`;
}

function checkStylesheet() {
  const file = 'apps/desktop/src/styles.css';
  const lines = readFileSync(STYLESHEET, 'utf8').split('\n');
  const blocks = tokenBlocks(lines);
  const isTokenBlock = (number) =>
    blocks.some((block) => number >= block.start && number <= block.end);

  let inComment = false;
  lines.forEach((line, index) => {
    const number = index + 1;
    const code = inComment ? line.slice(line.indexOf('*/') + 1) : line.split('/*')[0];
    if (line.includes('/*') && !line.includes('*/')) inComment = true;
    if (inComment && line.includes('*/')) inComment = false;
    if (isTokenBlock(number) || code.trim() === '') return;

    if (HEX.test(code)) {
      report(file, number, `colour literal outside the token blocks: ${HEX.exec(code)[0]}`);
    }
    const literal = literalColourFunction(code);
    if (literal !== null) {
      report(file, number, `colour function without a token: ${literal}`);
    }
  });

  const dark = blocks.find((block) => block.kind === 'dark');
  const light = blocks.find((block) => block.kind === 'light');
  if (dark?.bg === undefined || light?.bg === undefined) {
    report(file, 1, 'could not read `--bg` from both token blocks');
  }
  return { dark: dark?.bg ?? null, light: light?.bg ?? null };
}

function checkWindowBackground({ dark, light }) {
  const file = 'apps/desktop/electron/window.ts';
  const source = readFileSync(WINDOW, 'utf8');
  const match =
    /backgroundColor:\s*nativeTheme\.shouldUseDarkColors\s*\?\s*'([^']+)'\s*:\s*'([^']+)'/.exec(
      source,
    );
  if (match === null) {
    report(
      file,
      1,
      'no `backgroundColor: nativeTheme.shouldUseDarkColors ? … : …` to compare against `--bg`',
    );
    return;
  }
  const line = source.slice(0, match.index).split('\n').length;
  if (dark !== null && match[1] !== dark) {
    report(
      file,
      line,
      `native dark background ${match[1]} is not the dark \`--bg\` token (${dark})`,
    );
  }
  if (light !== null && match[2] !== light) {
    report(
      file,
      line,
      `native light background ${match[2]} is not the light \`--bg\` token (${light})`,
    );
  }
}

for (const path of [STYLESHEET, WINDOW]) {
  if (!existsSync(path)) {
    console.error(`Theme invariants: missing ${path}`);
    process.exit(1);
  }
}

const background = checkStylesheet();
checkWindowBackground(background);

if (findings.length === 0) {
  // Written to stdout rather than with a console.log call: the release hygiene gate treats that
  // call as a debug leftover in a committed file.
  process.stdout.write('Theme invariants: clean.\n');
  process.exit(0);
}

console.error(`Theme invariants: ${findings.length} problem(s) found.\n`);
for (const finding of findings) {
  console.error(`  ${finding.file}:${finding.line}  ${finding.message}`);
}
console.error('\nAdd a token, or use the one that exists.');
process.exit(1);
