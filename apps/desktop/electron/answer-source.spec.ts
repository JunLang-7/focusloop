import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ANSWER_SOURCE_LIMITS } from '@focusloop/shared-types';
import { extractAnswerSource } from './answer-source';

/**
 * The readers, against files that really exist.
 *
 * Real files rather than stubs, because the claim being tested is "this can read the document you have":
 * a mocked reader would pass while `pdf-parse`'s API moved out from under it, and the one thing that
 * cannot be discovered by reading this code is whether the package still works. Two of the four are
 * committed fixtures (`electron/fixtures`) — the Word document and the photograph — because neither can
 * be built from a string here: a `.docx` is a zip, and a picture with words on it needs something to draw
 * with.
 *
 * OCR is the slow one (a second and a half for the WebAssembly engine, then the recognition) and it is
 * worth it: an engine that reads a photograph is exactly the kind of dependency that rots quietly.
 */
const workdir = mkdtempSync(join(tmpdir(), 'focusloop-answer-source-'));

/**
 * The three tests that load a parser carry their own budget.
 *
 * The suite's five seconds is a budget for a pure function; the first `await import` of a library read
 * from disk, in a file that runs beside forty others, is not that — the Word reader took ten seconds
 * under a full run and three on its own, and a test that fails because the machine was busy teaches
 * nothing about whether the feature works.
 */
const PARSER_TIMEOUT = 30_000;

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function file(name: string, content: string | Buffer): string {
  const path = join(workdir, name);
  writeFileSync(path, content);
  return path;
}

/** A one-page PDF with one line of text, written out by hand: the smallest real one there is. */
const PDF_LINE = 'FocusLoop reads this PDF sentence.';

function pdfFixture(name: string): string {
  const content = `BT /F1 18 Tf 40 700 Td (${PDF_LINE}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const startxref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return file(name, Buffer.from(pdf, 'latin1'));
}

describe('reading an answer out of a file', () => {
  it('reads a text file, and says how', async () => {
    const path = file('answer.txt', '  A BST keeps its order.  \n');
    const { source, refusal } = await extractAnswerSource(path);
    expect(refusal).toBeNull();
    expect(source).toMatchObject({
      name: 'answer.txt',
      kind: 'document',
      method: 'text',
      text: 'A BST keeps its order.',
      truncated: false,
    });
  });

  it(
    'reads a PDF, without the page footer its reader appends',
    async () => {
      const { source } = await extractAnswerSource(pdfFixture('notes.pdf'));
      expect(source?.method).toBe('pdf');
      expect(source?.text).toContain(PDF_LINE);
      expect(source?.text).not.toContain('-- 1 of 1 --');
    },
    PARSER_TIMEOUT,
  );

  it(
    'reads a Word document, paragraph by paragraph',
    async () => {
      const { source } = await extractAnswerSource(join(__dirname, 'fixtures', 'notes.docx'));
      expect(source?.method).toBe('docx');
      expect(source?.text).toContain('FocusLoop docx fixture sentence.');
      expect(source?.text).toContain('Second paragraph about the invariant.');
    },
    PARSER_TIMEOUT,
  );

  it('recognises words in a photograph, on this machine', async () => {
    const { source } = await extractAnswerSource(join(__dirname, 'fixtures', 'whiteboard.png'));
    expect(source?.kind).toBe('image');
    expect(source?.method).toBe('ocr');
    // Not an equality: an OCR engine is allowed to mis-read a glyph, and a test that demanded the exact
    // string would be pinning the engine's version rather than the feature. The words are the claim.
    expect(source?.text.toLowerCase()).toContain('focusloop');
  }, 60_000);

  it.each([
    ['a spreadsheet', 'budget.xlsx', 'unsupported'],
    ['the old binary Word format', 'letter.doc', 'unsupported'],
    ['something with no extension at all', 'notes', 'unsupported'],
  ])('refuses %s rather than guessing', async (_name, fileName, reason) => {
    const path = file(fileName, 'irrelevant');
    const { source, refusal } = await extractAnswerSource(path);
    expect(source).toBeNull();
    expect(refusal).toEqual({ reason, name: fileName });
  });

  it('refuses a file larger than it will read', async () => {
    const path = file('huge.txt', 'x'.repeat(64));
    const { refusal } = await extractAnswerSource(path, {
      fileSize: async () => ANSWER_SOURCE_LIMITS.bytes + 1,
    });
    expect(refusal).toEqual({ reason: 'too-big', name: 'huge.txt' });
  });

  it('reports a file it cannot open as unreadable rather than throwing', async () => {
    const { source, refusal } = await extractAnswerSource(join(workdir, 'not-here.txt'));
    expect(source).toBeNull();
    expect(refusal).toEqual({ reason: 'unreadable', name: 'not-here.txt' });
  });

  it('reports a file with nothing in it as empty, not as an answer of ""', async () => {
    const path = file('blank.txt', '   \n\n');
    expect(await extractAnswerSource(path)).toEqual({
      source: null,
      refusal: { reason: 'no-text', name: 'blank.txt' },
    });
  });

  it('gives back the beginning of a long document, and says it was cut', async () => {
    const path = file('long.txt', 'y'.repeat(ANSWER_SOURCE_LIMITS.characters + 500));
    const { source } = await extractAnswerSource(path);
    expect(source?.truncated).toBe(true);
    expect(source?.text).toHaveLength(ANSWER_SOURCE_LIMITS.characters);
  });
});
