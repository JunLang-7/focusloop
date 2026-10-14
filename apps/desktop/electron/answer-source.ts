import { access, copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  ANSWER_SOURCE_LIMITS,
  answerSourceKindOf,
  answerSourceMethodOf,
  boundAnswerSourceText,
  type AnswerSourceResponse,
  type AnswerSourceResult,
} from '@focusloop/shared-types';

/**
 * Reading the text out of a file the learner chose, so an answer does not have to be typed.
 *
 * Four readers, all of them free, all of them local, none of them a network call:
 *
 * - `.txt`, `.md` and friends are read as text;
 * - `.pdf` through `pdf-parse`, which walks the page content streams;
 * - `.docx` through `mammoth`, which reads the document part of the zip;
 * - images through `tesseract.js`, an OCR engine compiled to WebAssembly, with its language data
 *   **resolved from `@tesseract.js-data` in `node_modules`** rather than downloaded — the default would
 *   fetch it from a CDN the first time, which is exactly the network call this product promises not to
 *   make, and it would make the first photograph a learner takes depend on being online.
 *
 * What this module deliberately does not do: infer a format from the bytes (the extension decides, and a
 * reader that fails says so), guess at an encoding (UTF-8, and a file that is not is reported as
 * unreadable rather than turned into mojibake), or send anything anywhere. The file is read on this
 * machine and the text is handed back to the window that asked.
 *
 * The heavy readers are imported lazily, so a session that never attaches a file never pays for the OCR
 * engine's several megabytes of WebAssembly: the module loads when the first image is read.
 */

export interface AnswerSourceDeps {
  /** Injected so a test can drive the failure paths without arranging real files. */
  readonly readFileBytes?: (path: string) => Promise<Buffer>;
  readonly fileSize?: (path: string) => Promise<number>;
}

/**
 * The text in this file, or why there is none.
 *
 * Never throws for a file it cannot read: every failure here is something the learner can act on — the
 * wrong kind of file, one that is too large, a scan with no words on it — and an exception would reach
 * the window as a red banner about an internal error instead of a sentence about their document.
 */
export async function extractAnswerSource(
  path: string,
  deps: AnswerSourceDeps = {},
): Promise<AnswerSourceResponse> {
  const name = basename(path);
  const kind = answerSourceKindOf(name);
  const method = answerSourceMethodOf(name);
  if (kind === null || method === null)
    return { source: null, refusal: { reason: 'unsupported', name } };

  const size = await (deps.fileSize ?? fileSizeOf)(path);
  if (size === null) return { source: null, refusal: { reason: 'unreadable', name } };
  if (size > ANSWER_SOURCE_LIMITS.bytes)
    return { source: null, refusal: { reason: 'too-big', name } };

  let raw: string;
  try {
    raw = await readText(path, method, deps);
  } catch {
    return { source: null, refusal: { reason: 'unreadable', name } };
  }

  const { text, truncated } = boundAnswerSourceText(raw);
  if (text === '') return { source: null, refusal: { reason: 'no-text', name } };

  const source: AnswerSourceResult = { path, name, kind, method, text, truncated };
  return { source, refusal: null };
}

async function fileSizeOf(path: string): Promise<number | null> {
  try {
    const stats = await stat(path);
    return stats.isFile() ? stats.size : null;
  } catch {
    return null;
  }
}

async function readText(
  path: string,
  method: NonNullable<ReturnType<typeof answerSourceMethodOf>>,
  deps: AnswerSourceDeps,
): Promise<string> {
  const bytes = await (deps.readFileBytes ?? readFile)(path);
  if (method === 'text') return bytes.toString('utf8');
  if (method === 'pdf') return readPdf(bytes);
  if (method === 'docx') return readDocx(bytes);
  return readImage(bytes);
}

/**
 * A PDF's text, with the page numbers its own reader appends taken back out.
 *
 * `pdf-parse` separates pages with a `-- N of M --` line. That is useful in a parser's output and noise
 * in an answer box — the learner is writing an answer, not transcribing a footer.
 */
async function readPdf(bytes: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    const result = await parser.getText();
    return result.text.replace(/^-- \d+ of \d+ --$/gm, '');
  } finally {
    await parser.destroy();
  }
}

async function readDocx(bytes: Buffer): Promise<string> {
  const mammoth = (await import('mammoth')).default;
  const result = await mammoth.extractRawText({ buffer: bytes });
  return result.value;
}

/**
 * An image's text, recognised on this machine.
 *
 * One worker per call, terminated in the `finally`: the engine is a WebAssembly module with a language
 * model loaded into it, and holding one alive between calls would keep tens of megabytes resident for a
 * feature the learner may use once.
 */
async function readImage(bytes: Buffer): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const languages = await ocrLanguages();
  const worker = await createWorker(languages.langs, 1, {
    langPath: languages.langPath,
    gzip: languages.gzip,
    cachePath: languages.cachePath,
  });
  try {
    const { data } = await worker.recognize(bytes);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

interface OcrData {
  readonly code: string;
  readonly gzip: boolean;
  readonly langPath: string;
}

/**
 * The language data this machine already has, in one directory, as `tesseract.js` needs to be pointed at it.
 *
 * Both packages are dependencies rather than optional extras: a learner who photographs their notes in
 * Chinese and is told the app cannot read Chinese would be right to call that a broken feature. What is
 * *not* bundled is any download — the engine is told where the data already is, because the default is to
 * fetch it from a CDN the first time, which is exactly the network call this product promises not to make.
 *
 * The two packages ship their files in **separate** directories and the engine takes **one** `langPath`,
 * so the files are collected into one directory the first time an image is read. Collected, not moved: the
 * packages stay where the package manager put them, and the collection is two megabytes of copies that the
 * next call finds already there.
 */
async function ocrLanguages(): Promise<{
  readonly langs: string;
  readonly langPath: string;
  readonly cachePath: string;
  readonly gzip: boolean;
}> {
  const modules = await Promise.all([
    import('@tesseract.js-data/eng'),
    import('@tesseract.js-data/chi_sim'),
  ]);
  const packs = modules
    .map((module) => module.default as OcrData | undefined)
    .filter((data): data is OcrData => data !== undefined);
  if (packs.length === 0) throw new Error('no OCR language data is installed');

  const langs = packs.map((pack) => pack.code).join('+');
  const directories = [...new Set(packs.map((pack) => pack.langPath))];
  if (directories.length === 1) {
    const [only] = directories;
    return {
      langs,
      langPath: only ?? '',
      cachePath: join(ocrScratchDirectory(), 'cache'),
      gzip: packs[0]?.gzip ?? true,
    };
  }

  const collected = join(ocrScratchDirectory(), 'tessdata');
  await mkdir(collected, { recursive: true });
  for (const pack of packs) {
    const file = `${pack.code}.traineddata${pack.gzip ? '.gz' : ''}`;
    const to = join(collected, file);
    if (!(await exists(to))) await copyFile(join(pack.langPath, file), to);
  }
  return {
    langs,
    langPath: collected,
    cachePath: join(ocrScratchDirectory(), 'cache'),
    gzip: packs[0]?.gzip ?? true,
  };
}

/** Everything OCR needs to write, under the operating system's own temporary directory. */
function ocrScratchDirectory(): string {
  return join(temporaryDirectory(), 'focusloop-ocr');
}

function temporaryDirectory(): string {
  return process.env['TEMP'] ?? process.env['TMPDIR'] ?? '/tmp';
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
