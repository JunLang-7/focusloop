import { describe, expect, it } from 'vitest';
import {
  MATERIAL_FILE_MAX_BYTES,
  describeBytes,
  describeLimit,
  isFileDrag,
  readImportFile,
  type PickedFile,
} from './import-file';

/** A stand-in for a `File` that also records whether it was read at all. */
function fakeFile(name: string, content: string, size = content.length) {
  const state = { reads: 0 };
  const file: PickedFile = {
    name,
    size,
    text: () => {
      state.reads += 1;
      return Promise.resolve(content);
    },
  };
  return { state, file };
}

describe('readImportFile', () => {
  it('takes the name and the text out of the file', async () => {
    const { file } = fakeFile(
      'rotations.md',
      '# Rotations\n\nA pivot moves down and to the right.\n',
    );

    await expect(readImportFile(file)).resolves.toEqual({
      outcome: 'picked',
      fileName: 'rotations.md',
      content: '# Rotations\n\nA pivot moves down and to the right.\n',
    });
  });

  it('refuses a file that is too big without reading it first', async () => {
    const { state, file } = fakeFile('huge.md', 'x', MATERIAL_FILE_MAX_BYTES + 1);

    await expect(readImportFile(file)).resolves.toEqual({
      outcome: 'too-large',
      limitBytes: MATERIAL_FILE_MAX_BYTES,
    });

    // The check exists to avoid the read, not to report on it afterwards. Reading a too-big file to
    // discover that it is too big is the freeze this is here to prevent.
    expect(state.reads).toBe(0);
  });

  /*
   * A name the parser cannot place is refused here rather than sent: the import contract turns it
   * into `Error invoking remote method 'focusloop:material:import': MaterialParseError: Cannot
   * determine a supported format for outline.rst.`, which names a channel and an error class and
   * nothing a learner can act on.
   */
  it('refuses a name the import cannot read, without reading the file', async () => {
    const { state, file } = fakeFile('outline.rst', '# Outline\n\nSome text.\n');

    await expect(readImportFile(file)).resolves.toEqual({ outcome: 'unsupported-format' });
    expect(state.reads).toBe(0);
  });

  it('refuses a name with no extension at all', async () => {
    await expect(readImportFile(fakeFile('notes', 'Some text.\n').file)).resolves.toEqual({
      outcome: 'unsupported-format',
    });
    await expect(readImportFile(fakeFile('notes.', 'Some text.\n').file)).resolves.toEqual({
      outcome: 'unsupported-format',
    });
  });

  it('takes every extension the parser can read', async () => {
    // The list is duplicated from `material-parser` (its hashing is not available to the renderer),
    // so what it is copied from is pinned here: a name refused that the parser would have read is a
    // form refusing a file it could have taken.
    for (const name of ['notes.md', 'notes.MARKDOWN', 'notes.mdx', 'notes.txt', 'notes.TEXT']) {
      const result = await readImportFile(fakeFile(name, 'Some text.\n').file);
      expect([name, result.outcome]).toEqual([name, 'picked']);
    }
  });

  it('accepts a file exactly at the limit', async () => {
    const content = 'x'.repeat(MATERIAL_FILE_MAX_BYTES);
    const { state, file } = fakeFile('exact.md', content, MATERIAL_FILE_MAX_BYTES);

    const result = await readImportFile(file);

    expect(result.outcome).toBe('picked');
    expect(state.reads).toBe(1);
  });

  it('refuses a file one byte over the limit', async () => {
    const { file } = fakeFile('just-over.md', 'x', MATERIAL_FILE_MAX_BYTES + 1);

    await expect(readImportFile(file)).resolves.toEqual({
      outcome: 'too-large',
      limitBytes: MATERIAL_FILE_MAX_BYTES,
    });
  });

  it('refuses a text file that carries binary content', async () => {
    // A `.txt` extension the parser accepts is the only way this check is reached now: an
    // unreadable extension is refused before the file is read at all.
    const { file } = fakeFile('notes.txt', 'PK\u0000\u0001binary');

    await expect(readImportFile(file)).resolves.toEqual({ outcome: 'not-text' });
  });

  it('refuses a file with nothing in it', async () => {
    await expect(readImportFile(fakeFile('blank.md', '').file)).resolves.toEqual({
      outcome: 'empty',
    });

    // Whitespace-only is the same nothing as emptiness, and less obvious to the person looking at it.
    await expect(readImportFile(fakeFile('spaces.md', '\n\n   \n').file)).resolves.toEqual({
      outcome: 'empty',
    });
  });

  it('reports a file that cannot be read instead of throwing', async () => {
    const file: PickedFile = {
      name: 'gone.md',
      size: 12,
      text: () => Promise.reject(new Error('ENOENT: no such file or directory')),
    };

    await expect(readImportFile(file)).resolves.toEqual({ outcome: 'unreadable' });
  });
});

describe('describeLimit', () => {
  it('reads a whole number of megabytes as megabytes', () => {
    expect(describeLimit(MATERIAL_FILE_MAX_BYTES)).toBe('1 MB');
  });

  it('reads anything smaller as kilobytes', () => {
    expect(describeLimit(512 * 1024)).toBe('512 KB');
  });
});

describe('describeBytes', () => {
  it('reads a file the way the limit beside it is read', () => {
    expect(describeBytes(12 * 1024)).toBe('12 KB');
    expect(describeBytes(MATERIAL_FILE_MAX_BYTES)).toBe('1 MB');
    expect(describeBytes(512 * 1024)).toBe('512 KB');
  });

  it('answers a size it cannot make sense of with zero rather than with NaN', () => {
    expect(describeBytes(0)).toBe('0 KB');
    expect(describeBytes(-1)).toBe('0 KB');
    expect(describeBytes(Number.NaN)).toBe('0 KB');
  });
});

describe('isFileDrag', () => {
  /*
   * The distinction the zone turns on: a dragged text selection also fires dragenter and dragover, and
   * raising the drop state for one invites a drop that would do nothing.
   */
  it('accepts a drag that carries files and refuses one that does not', () => {
    expect(isFileDrag(['Files'])).toBe(true);
    expect(isFileDrag(['text/plain'])).toBe(false);
    expect(isFileDrag([])).toBe(false);
    expect(isFileDrag(undefined)).toBe(false);
  });

  it('accepts a file among other types, which is what a real drag reports', () => {
    expect(isFileDrag(['text/plain', 'Files'])).toBe(true);
  });
});
