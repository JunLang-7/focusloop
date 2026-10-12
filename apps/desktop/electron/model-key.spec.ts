import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const encryption = vi.hoisted(() => ({
  available: true,
  throws: false,
  backend: 'gnome_libsecret',
  writeFails: false,
}));
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => {
      if (encryption.throws) throw new Error('no keyring');
      return encryption.available;
    },
    getSelectedStorageBackend: () => encryption.backend,
    encryptString: (plain: string) => {
      if (encryption.writeFails) throw new Error('SECRET must not be logged');
      return Buffer.from(`v1:${Buffer.from(plain).toString('base64')}`);
    },
    decryptString: (buffer: Buffer) => {
      const value = buffer.toString();
      if (!value.startsWith('v1:')) throw new Error('corrupt');
      return Buffer.from(value.slice(3), 'base64').toString();
    },
  },
}));
const { canStoreModelKey, readProviderKey, storeProviderKey, clearProviderKey } =
  await import('./model-key');
const directories: string[] = [];
function directory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'focusloop-key-'));
  directories.push(dir);
  return dir;
}
afterEach(() => {
  Object.assign(encryption, {
    available: true,
    throws: false,
    backend: 'gnome_libsecret',
    writeFails: false,
  });
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
describe('provider-scoped credentials', () => {
  it('encrypts and round-trips without plaintext on disk', () => {
    const dir = directory();
    storeProviderKey(dir, 'a', 'https://example.com/v1', 'SECRET');
    expect(readProviderKey(dir, 'a', 'https://example.com/v1')).toBe('SECRET');
    for (const file of readdirSync(dir))
      expect(readFileSync(join(dir, file)).includes('SECRET')).toBe(false);
  });
  it('isolates both provider identity and endpoint', () => {
    const dir = directory();
    storeProviderKey(dir, 'a', 'https://one.com/v1', 'one');
    storeProviderKey(dir, 'b', 'https://one.com/v1', 'two');
    expect(readProviderKey(dir, 'a', 'https://two.com/v1')).toBeNull();
    expect(readProviderKey(dir, 'b', 'https://one.com/v1')).toBe('two');
    clearProviderKey(dir, 'a', 'https://one.com/v1');
    expect(readProviderKey(dir, 'a', 'https://one.com/v1')).toBeNull();
    expect(readProviderKey(dir, 'b', 'https://one.com/v1')).toBe('two');
    expect(() => clearProviderKey(dir, 'a', 'https://one.com/v1')).not.toThrow();
  });
  it('refuses unavailable encryption without writing plaintext', () => {
    const dir = directory();
    encryption.available = false;
    expect(canStoreModelKey()).toBe(false);
    expect(() => storeProviderKey(dir, 'a', 'https://one.com/v1', 'SECRET')).toThrow('unavailable');
    expect(readdirSync(dir)).toEqual([]);
    encryption.throws = true;
    expect(canStoreModelKey()).toBe(false);
  });
  it('rejects Linux basic_text storage', () => {
    vi.stubGlobal('process', { ...process, platform: 'linux' });
    encryption.backend = 'basic_text';
    expect(canStoreModelKey()).toBe(false);
    vi.unstubAllGlobals();
  });
  it('does not truncate the working key when encryption fails', () => {
    const dir = directory();
    storeProviderKey(dir, 'a', 'https://one.com/v1', 'old');
    encryption.writeFails = true;
    expect(() => storeProviderKey(dir, 'a', 'https://one.com/v1', 'new')).toThrow(
      'Could not securely store',
    );
    expect(readProviderKey(dir, 'a', 'https://one.com/v1')).toBe('old');
    expect(readdirSync(dir)).toHaveLength(1);
  });
  it('handles corrupt or empty ciphertext as no key', () => {
    const dir = directory();
    storeProviderKey(dir, 'a', 'https://one.com/v1', ' ');
    expect(readProviderKey(dir, 'a', 'https://one.com/v1')).toBeNull();
    writeFileSync(join(dir, readdirSync(dir)[0]!), 'corrupt');
    expect(readProviderKey(dir, 'a', 'https://one.com/v1')).toBeNull();
  });
});
