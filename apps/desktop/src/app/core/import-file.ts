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

/**
 * The extensions the parser behind the import can read anything into.
 *
 * Spelled out here rather than imported from it: that package hashes with `node:crypto`, which the
 * renderer's bundle does not have, so the list is duplicated — and the duplication is the risk, not
 * the answer. A name refused here but readable there is a form refusing a file it could have taken,
 * and the reverse is the jargon error this check exists to prevent, so `import-file.spec.ts` pins
 * the list and the parser's own suite pins the one it is copied from.
 */
const IMPORTABLE_EXTENSIONS = ['.md', '.markdown', '.mdx', '.txt', '.text'];

/**
 * Whether the import can tell what this name is, which is the same question the parser asks of it
 * before it will read anything. Without an extension — or with one nobody can parse — an import
 * cannot know whether the text is Markdown, so it refuses.
 */
export function isImportableFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot >= 0 && IMPORTABLE_EXTENSIONS.includes(lower.slice(dot));
}

export type ImportFileOutcome =
  | { readonly outcome: 'picked'; readonly fileName: string; readonly content: string }
  | { readonly outcome: 'too-large'; readonly limitBytes: number }
  | { readonly outcome: 'unsupported-format' }
  | { readonly outcome: 'empty' }
  | { readonly outcome: 'not-text' }
  | { readonly outcome: 'unreadable' };

/**
 * Reads one picked file, or says why it will not be read.
 *
 * The two checks that need no read come first, cheapest answer first: the size, and then whether the
 * import can place the name at all. Reading a file to find out that it is too big to keep, or that
 * its extension means nothing to the parser, is work whose only outcome is a refusal.
 */
export async function readImportFile(file: PickedFile): Promise<ImportFileOutcome> {
  if (file.size > MATERIAL_FILE_MAX_BYTES) {
    return { outcome: 'too-large', limitBytes: MATERIAL_FILE_MAX_BYTES };
  }

  /*
   * A drop bypasses the chooser's `accept` filter entirely, and the chooser itself always offers
   * "All files", so a name the parser cannot read does reach here. Refusing it in the same place as
   * the other refusals is what keeps it from arriving as `Error invoking remote method
   * 'focusloop:material:import': MaterialParseError: Cannot determine a supported format for …`.
   */
  if (!isImportableFileName(file.name)) return { outcome: 'unsupported-format' };

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
 * Whether a drag carries files — the only kind this zone accepts.
 *
 * Pure and here rather than inside the component because it is the whole of the drop zone's policy
 * about drags. Without it any dragged text — a selection from another window, a link — raises the
 * drop state and invites a drop that would do nothing, which is a drop target lying about itself.
 */
export function isFileDrag(types: readonly string[] | undefined): boolean {
  return types !== undefined && Array.from(types).includes('Files');
}

/**
 * A byte count as a person reads it, in the units the limit is stated in.
 *
 * Shared with `describeLimit` so the size on a picked file's row and the size the zone accepts are
 * read the same way — a row saying `1024 KB` beside a limit saying `1 MB` would look like two
 * different numbers rather than one file and its ceiling.
 */
export function describeBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  const kilobytes = bytes / 1024;
  return kilobytes >= 1024 ? `${Math.round(kilobytes / 1024)} MB` : `${Math.round(kilobytes)} KB`;
}

/**
 * The limit as a person reads it, derived from the limit itself so the two cannot drift apart in
 * translation.
 */
export function describeLimit(limitBytes: number): string {
  return describeBytes(limitBytes);
}
