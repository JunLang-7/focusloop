import { describe, expect, it } from 'vitest';
import {
  MATERIAL_FILE_MAX_BYTES,
  describeLimit,
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

  it('refuses a file that is not text', async () => {
    const { file } = fakeFile('notes.bin', 'PK\u0000\u0001binary');

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
