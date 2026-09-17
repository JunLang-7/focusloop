import { describe, expect, it } from 'vitest';
import {
  MAX_CONTENT_BYTES,
  MaterialParseError,
  detectFormat,
  hashContent,
  isKnownUnsupported,
  normalizeContent,
  parseMaterial,
  slugify,
  titleFromFileName,
} from './parse-material';

const NOW = '2026-01-01T00:00:00.000Z';

describe('detectFormat', () => {
  it('recognises markdown and text extensions', () => {
    expect(detectFormat('notes.md')).toBe('markdown');
    expect(detectFormat('notes.MARKDOWN')).toBe('markdown');
    expect(detectFormat('notes.txt')).toBe('text');
  });

  it('returns null for unknown or missing extensions', () => {
    expect(detectFormat('notes')).toBeNull();
    expect(detectFormat('notes.bin')).toBeNull();
  });

  it('flags formats we know we do not support yet', () => {
    expect(isKnownUnsupported('paper.pdf')).toBe(true);
    expect(isKnownUnsupported('notes.md')).toBe(false);
  });
});

describe('normalizeContent', () => {
  it('converts CRLF to LF', () => {
    expect(normalizeContent('a\r\nb')).toBe('a\nb');
  });

  it('strips trailing whitespace per line', () => {
    expect(normalizeContent('a   \nb\t')).toBe('a\nb');
  });

  it('collapses runs of blank lines', () => {
    expect(normalizeContent('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('trims the document', () => {
    expect(normalizeContent('\n\n  a  \n\n')).toBe('a');
  });
});

describe('hashContent', () => {
  it('is stable and content sensitive', () => {
    expect(hashContent('abc')).toBe(hashContent('abc'));
    expect(hashContent('abc')).not.toBe(hashContent('abd'));
    expect(hashContent('abc')).toHaveLength(64);
  });
});

describe('titleFromFileName', () => {
  it('cleans separators and drops the extension', () => {
    expect(titleFromFileName('red-black_trees.md')).toBe('red black trees');
    expect(titleFromFileName('C:\\notes\\alpha.txt')).toBe('alpha');
  });

  it('falls back for an empty stem', () => {
    expect(titleFromFileName('.md')).toBe('Untitled material');
  });
});

describe('slugify', () => {
  it('produces url-safe ids from unicode titles', () => {
    expect(slugify('Red-Black Trees: 基础')).toBe('red-black-trees-基础');
  });

  it('never returns a leading or trailing dash', () => {
    expect(slugify('  --hello--  ')).toBe('hello');
  });
});

describe('parseMaterial — markdown', () => {
  const markdown = [
    '# Red-black trees',
    '',
    'Balanced search trees.',
    '',
    '## Rotation',
    '',
    'Rotations restore balance.',
    '',
    '## Colour invariant',
    '',
    'Red nodes cannot have red children.',
  ].join('\n');

  it('splits sections on headings and keeps their depth', () => {
    const { document } = parseMaterial({ fileName: 'rbt.md', content: markdown, now: NOW });
    expect(document.format).toBe('markdown');
    expect(document.title).toBe('Red-black trees');
    expect(document.sections.map((section) => section.heading)).toEqual([
      'Red-black trees',
      'Rotation',
      'Colour invariant',
    ]);
    expect(document.sections.map((section) => section.depth)).toEqual([1, 2, 2]);
    expect(document.sections[0]?.body).toBe('Balanced search trees.');
  });

  it('is deterministic, including the derived id', () => {
    const a = parseMaterial({ fileName: 'rbt.md', content: markdown, now: NOW });
    const b = parseMaterial({ fileName: 'rbt.md', content: markdown, now: NOW });
    expect(a).toEqual(b);
    expect(a.document.id).toBe(`material-${hashContent(normalizeContent(markdown)).slice(0, 12)}`);
  });

  it('produces the same document for CRLF and LF input', () => {
    const lf = parseMaterial({ fileName: 'a.md', content: markdown, now: NOW });
    const crlf = parseMaterial({
      fileName: 'a.md',
      content: markdown.replace(/\n/g, '\r\n'),
      now: NOW,
    });
    expect(crlf.document.contentHash).toBe(lf.document.contentHash);
  });

  it('keeps preamble text as its own section', () => {
    const { document } = parseMaterial({
      fileName: 'a.md',
      content: 'Intro line.\n\n# Title\n\nBody.',
      now: NOW,
    });
    expect(document.sections).toHaveLength(2);
    expect(document.sections[0]?.heading).toBe('a');
    expect(document.sections[0]?.body).toBe('Intro line.');
  });

  it('falls back to a single section when there are no headings', () => {
    const { document } = parseMaterial({ fileName: 'plain.md', content: 'just words', now: NOW });
    expect(document.sections).toHaveLength(1);
    expect(document.sections[0]?.heading).toBe('plain');
    expect(document.title).toBe('plain');
  });

  it('keeps sections aligned with the order field', () => {
    const { document } = parseMaterial({ fileName: 'rbt.md', content: markdown, now: NOW });
    expect(document.sections.map((section) => section.order)).toEqual([0, 1, 2]);
  });
});

describe('parseMaterial — plain text', () => {
  it('splits paragraphs into sections', () => {
    const { document } = parseMaterial({
      fileName: 'notes.txt',
      content: 'First paragraph.\n\nSecond paragraph.',
      now: NOW,
    });
    expect(document.format).toBe('text');
    expect(document.title).toBe('notes');
    expect(document.sections).toHaveLength(2);
    expect(document.sections[1]?.body).toBe('Second paragraph.');
  });

  it('uses the file name as the heading', () => {
    const { document } = parseMaterial({ fileName: 'notes.txt', content: 'Body.', now: NOW });
    expect(document.sections[0]?.heading).toBe('Body.');
  });

  it('truncates a long first line when using it as a heading', () => {
    const long = 'x'.repeat(200);
    const { document } = parseMaterial({ fileName: 'notes.txt', content: long, now: NOW });
    expect(document.sections[0]?.heading.length).toBeLessThanOrEqual(60);
    expect(document.sections[0]?.heading.endsWith('...')).toBe(true);
  });
});

describe('parseMaterial — edge cases', () => {
  it('warns and returns no sections for empty content', () => {
    const { document, warnings } = parseMaterial({
      fileName: 'empty.txt',
      content: '   \n\n',
      now: NOW,
    });
    expect(document.sections).toEqual([]);
    expect(warnings).toContain('The file was empty, so no sections were created.');
  });

  it('rejects unsupported formats with a clear reason', () => {
    expect(() => parseMaterial({ fileName: 'paper.pdf', content: 'x', now: NOW })).toThrow(
      MaterialParseError,
    );
    try {
      parseMaterial({ fileName: 'paper.pdf', content: 'x', now: NOW });
    } catch (error) {
      expect((error as MaterialParseError).reason).toBe('unsupported-format');
      expect((error as MaterialParseError).message).toContain('not supported yet');
    }
  });

  it('rejects content above the size limit', () => {
    const huge = 'a'.repeat(MAX_CONTENT_BYTES + 1);
    expect(() => parseMaterial({ fileName: 'big.txt', content: huge, now: NOW })).toThrow(
      MaterialParseError,
    );
  });

  it('records the import time it is given', () => {
    const { document } = parseMaterial({ fileName: 'a.txt', content: 'x', now: NOW });
    expect(document.importedAt).toBe(NOW);
    expect(document.source).toBe('imported');
  });

  it('tolerates a null byte and unusual unicode', () => {
    const { document } = parseMaterial({
      fileName: 'u.txt',
      content: 'emoji \u{1F600} and \u0000 nul',
      now: NOW,
    });
    expect(document.sections).toHaveLength(1);
  });
});
