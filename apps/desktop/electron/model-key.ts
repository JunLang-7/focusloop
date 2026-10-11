import { existsSync, rmSync } from 'node:fs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeStorage } from 'electron';

/**
 * The model key the learner configures in the app (#255), and where it lives.
 *
 * Until now the only way to give FocusLoop a model was `FOCUSLOOP_DEEPSEEK_API_KEY` in the
 * environment — a developer's door, and one an ordinary learner will never open. Storing the key
 * raises a question the environment variable never had to answer: where does a secret go?
 *
 * **Not in the repository, and not in the database.** The database is a file the learner is invited
 * to find, copy and delete, so a key inside it would travel with every backup. This is a separate
 * file beside it, and it is written **encrypted by the operating system's own keychain** through
 * `safeStorage` — the same mechanism Chrome and VS Code use for cookies and tokens. On a machine
 * where that is unavailable (a bare Linux container with no keyring, for example) the app says so and
 * refuses to store anything rather than silently writing the key in the clear; a key that is only
 * "secret" because nobody looked is worse than no key at all.
 *
 * The key is never returned to the renderer. `ModelSettings` reports *whether* one is configured and
 * where it came from; the value only ever goes into the provider, in this process.
 */
const KEY_FILE = 'model-key.bin';

function keyPath(userDataPath: string): string {
  return join(userDataPath, KEY_FILE);
}

/**
 * Whether a key can be stored at all on this machine.
 *
 * Asked before the surface offers the field, not after a failed save: an input that accepts a secret
 * and then discards it is how a learner ends up believing a key is in use when it is not.
 */
export function canStoreModelKey(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/** The stored key, or null when there is none — including when the file cannot be decrypted. */
export function readStoredModelKey(userDataPath: string): string | null {
  const path = keyPath(userDataPath);
  if (!existsSync(path)) return null;
  try {
    const decrypted = safeStorage.decryptString(readFileSync(path));
    return decrypted.trim() === '' ? null : decrypted;
  } catch {
    /*
     * Reported, not thrown, and treated as "no key": a file written by another OS account, or a
     * corrupt one, must not stop the app from starting. The settings surface shows "no key", which is
     * the true answer for this process.
     */
    console.error('FocusLoop could not read the stored model key; starting without one.');
    return null;
  }
}

/** Stores the key, encrypted. Returns false when this machine cannot encrypt — nothing is written. */
export function storeModelKey(userDataPath: string, apiKey: string): boolean {
  if (!canStoreModelKey()) return false;
  try {
    writeFileSync(keyPath(userDataPath), safeStorage.encryptString(apiKey));
    return true;
  } catch (error) {
    console.error('FocusLoop could not store the model key:', error);
    return false;
  }
}

/** Removes the stored key. Idempotent: clearing what is not there is not an error. */
export function clearStoredModelKey(userDataPath: string): void {
  const path = keyPath(userDataPath);
  if (!existsSync(path)) return;
  try {
    rmSync(path);
  } catch (error) {
    console.error('FocusLoop could not remove the stored model key:', error);
  }
}
