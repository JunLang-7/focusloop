import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { safeStorage } from 'electron';

/** A credential belongs to both the provider instance and the exact normalized endpoint. */
function keyPath(directory: string, providerId: string, baseUrl: string): string {
  const scope = createHash('sha256')
    .update(JSON.stringify([providerId, baseUrl]))
    .digest('hex');
  return join(directory, `llm-key-${scope}.bin`);
}

/** Only app-owned ciphertext files, including credentials whose provider was removed. */
export function providerKeyFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => /^llm-key-[a-f0-9]{64}\.bin$/.test(name))
    .map((name) => join(directory, name));
}

export function canStoreModelKey(): boolean {
  try {
    return (
      safeStorage.isEncryptionAvailable() &&
      !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text')
    );
  } catch {
    return false;
  }
}

export function readProviderKey(
  directory: string,
  providerId: string,
  baseUrl: string,
): string | null {
  if (!canStoreModelKey()) return null;
  const path = keyPath(directory, providerId, baseUrl);
  if (!existsSync(path)) return null;
  try {
    const key = safeStorage.decryptString(readFileSync(path)).trim();
    return key || null;
  } catch {
    return null;
  }
}

/** Atomic ciphertext replacement; a failed save never truncates a working credential. */
export function storeProviderKey(
  directory: string,
  providerId: string,
  baseUrl: string,
  key: string,
): void {
  if (!canStoreModelKey()) throw new Error('Secure credential storage is unavailable');
  const path = keyPath(directory, providerId, baseUrl);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, safeStorage.encryptString(key.trim()), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } catch {
    throw new Error('Could not securely store the API key');
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function clearProviderKey(directory: string, providerId: string, baseUrl: string): void {
  try {
    rmSync(keyPath(directory, providerId, baseUrl), { force: true });
  } catch {
    throw new Error('Could not remove the saved API key');
  }
}
