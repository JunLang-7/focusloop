/**
 * Reading a study file the learner picked.
 *
 * This happens in the renderer, and deliberately so. The import contract already takes text —
 * `importMaterial(fileName, content)` is what the main process validates, and it has never needed a
 * path — so an `<input type="file">` hands the renderer a `File`, `File.text()` reads it, and
 * nothing new crosses the bridge. The alternative, a `dialog.showOpenDialog` handler plus `node:fs`
 * in the main process, would have added an IPC channel, a filesystem read reachable from the
 * renderer's requests, and a second home for user-facing words: all of it to arrive back at the same
 * two strings this already has.
 *
 * What is left over is the part genuinely worth testing, which is what happens to a file that is too
 * big to be study material or is not text at all. Those answers do not depend on where the file came
 * from, so they live here rather than inside a component.
 */

/**
 * A NUL byte is the cheapest reliable sign that a file is not text: UTF-8 text never contains one,
 * and almost every binary format contains one early.
 */
const BINARY_MARKER = '\u0000';

/**
 * A megabyte of Markdown is already several hundred pages — past anything the parser turns into a
 * useful course, and past what a textarea can show without becoming the whole window. Beyond this
 * the honest answer is "not this file" rather than a frozen screen.
 */
export const MATERIAL_FILE_MAX_BYTES = 1_048_576;

/**
 * The part of a `File` this module needs, spelled structurally so a test can pass a plain object
 * instead of a browser one.
 */
export interface PickedFile {
  readonly name: string;
  readonly size: number;
  text(): Promise<string>;
}

export type ImportFileOutcome =
  | { readonly outcome: 'picked'; readonly fileName: string; readonly content: string }
  | { readonly outcome: 'too-large'; readonly limitBytes: number }
  | { readonly outcome: 'empty' }
  | { readonly outcome: 'not-text' }
  | { readonly outcome: 'unreadable' };

/**
 * Reads one picked file, or says why it will not be read.
 *
 * The size is checked before the read rather than after it, which is the entire point of the check:
 * finding out that a file was too big by reading it into a string first is how the window freezes.
 */
export async function readImportFile(file: PickedFile): Promise<ImportFileOutcome> {
  if (file.size > MATERIAL_FILE_MAX_BYTES) {
    return { outcome: 'too-large', limitBytes: MATERIAL_FILE_MAX_BYTES };
  }

  let content: string;
  try {
    content = await file.text();
  } catch {
    // A file can be picked and then stop being readable: deleted, on a stick that was pulled out, or
    // permissions changed in the moment between the chooser closing and this read. There is nothing
    // to retry and no one to blame, so it is a plain answer rather than a thrown error.
    return { outcome: 'unreadable' };
  }

  if (content.includes(BINARY_MARKER)) return { outcome: 'not-text' };

  // An empty file imports as an empty course, which looks exactly like the import having silently
  // done nothing. Refusing it here is the only place that can tell the learner otherwise.
  if (content.trim().length === 0) return { outcome: 'empty' };

  return { outcome: 'picked', fileName: file.name, content };
}

/**
 * The limit as a person reads it, derived from the limit itself so the two cannot drift apart in
 * translation.
 */
export function describeLimit(limitBytes: number): string {
  const kilobytes = limitBytes / 1024;
  return kilobytes >= 1024 ? `${Math.round(kilobytes / 1024)} MB` : `${Math.round(kilobytes)} KB`;
}
