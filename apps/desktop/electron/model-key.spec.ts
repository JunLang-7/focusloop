import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * `safeStorage` is mocked as a reversible transform whose output does not contain its input, and that
 * shape is the point. A spy would let the test agree with itself that `encryptString` was called, and a
 * mock that merely prefixed the key would make "the key is not on disk" a claim about the mock. Base64
 * gives the one property under test the same shape the real keychain gives it: reversible, and not the
 * input.
 */
const encryption = vi.hoisted(() => ({ available: true, throws: false }));
/** Marks this mock's own output, so data it did not write is rejected the way a real keychain rejects it. */
const TAG = 'v1:';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => {
      if (encryption.throws) throw new Error('no keyring here');
      return encryption.available;
    },
    encryptString: (plain: string) =>
      Buffer.from(TAG + Buffer.from(plain, 'utf8').toString('base64'), 'utf8'),
    decryptString: (buffer: Buffer) => {
      const text = buffer.toString('utf8');
      if (!text.startsWith(TAG)) throw new Error('not ours to decrypt');
      return Buffer.from(text.slice(TAG.length), 'base64').toString('utf8');
    },
  },
}));

const { canStoreModelKey, clearStoredModelKey, readStoredModelKey, storeModelKey } =
  await import('./model-key');

const SECRET = 'sk-live-do-not-log-me';
const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'focusloop-model-key-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  encryption.available = true;
  encryption.throws = false;
  while (directories.length > 0)
    rmSync(directories.pop() as string, { recursive: true, force: true });
});

describe('the stored model key', () => {
  it('reports no key on a machine that has never been given one', () => {
    expect(readStoredModelKey(temporaryDirectory())).toBeNull();
  });

  it('round-trips a key through the OS keychain', () => {
    const directory = temporaryDirectory();
    expect(storeModelKey(directory, SECRET)).toBe(true);
    expect(readStoredModelKey(directory)).toBe(SECRET);
  });

  it('never writes the key itself to disk', () => {
    /*
     * The property this whole module exists for. Asserted against the file rather than against a call
     * count: a refactor that moved to `writeFileSync(key)` while still calling something named
     * `encryptString` would pass a spy and fail this.
     */
    const directory = temporaryDirectory();
    storeModelKey(directory, SECRET);
    const bytes = readFileSync(join(directory, 'model-key.bin'));
    expect(bytes.includes(SECRET)).toBe(false);
    expect(bytes.toString('utf8')).not.toContain(SECRET);
  });

  it('refuses to store anything when the machine cannot encrypt', () => {
    const directory = temporaryDirectory();
    encryption.available = false;
    expect(canStoreModelKey()).toBe(false);
    expect(storeModelKey(directory, SECRET)).toBe(false);
    // Not "stored in the clear as a fallback": nothing is written at all.
    expect(existsSync(join(directory, 'model-key.bin'))).toBe(false);
  });

  it('treats a keychain that throws as unavailable rather than crashing', () => {
    encryption.throws = true;
    expect(canStoreModelKey()).toBe(false);
  });

  it('starts without a key when the stored file cannot be decrypted', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const directory = temporaryDirectory();
    writeFileSync(
      join(directory, 'model-key.bin'),
      Buffer.from('written by another account', 'utf8'),
    );
    expect(readStoredModelKey(directory)).toBeNull();
    expect(consoleError).toHaveBeenCalled();
  });

  it('treats a blank stored value as no key, so an empty secret cannot read as configured', () => {
    const directory = temporaryDirectory();
    storeModelKey(directory, '   ');
    expect(readStoredModelKey(directory)).toBeNull();
  });

  it('removes the key, and clearing what is not there is not an error', () => {
    const directory = temporaryDirectory();
    storeModelKey(directory, SECRET);
    clearStoredModelKey(directory);
    expect(readStoredModelKey(directory)).toBeNull();
    expect(() => clearStoredModelKey(directory)).not.toThrow();
  });
});
