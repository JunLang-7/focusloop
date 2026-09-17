interface StoredSettings {
  port?: number;
  token?: string;
  enabled?: boolean;
}

const SETTINGS_KEY = 'focusloop-bridge-settings';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Missing element #${id}`);
  return found as T;
}

async function loadSettings(): Promise<StoredSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return (stored[SETTINGS_KEY] as StoredSettings | undefined) ?? {};
}

async function refresh(): Promise<void> {
  const settings = await loadSettings();
  element<HTMLInputElement>('port').value = String(settings.port ?? 47615);
  element<HTMLInputElement>('token').value = settings.token ?? '';

  const response = (await chrome.runtime.sendMessage({ type: 'status' })) as
    | {
        status?: {
          connected: boolean;
          queued: number;
          lastError: string | null;
          lastState: string | null;
        };
      }
    | undefined;

  const status = response?.status;
  element('status').textContent = [
    `connected: ${status?.connected === true ? 'yes' : 'no'}`,
    `queued: ${status?.queued ?? 0}`,
    `state: ${status?.lastState ?? '—'}`,
    `last error: ${status?.lastError ?? 'none'}`,
  ].join('\n');
}

async function save(): Promise<void> {
  const port = Number(element<HTMLInputElement>('port').value);
  const token = element<HTMLInputElement>('token').value.trim();
  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      port: Number.isFinite(port) && port > 0 && port < 65536 ? port : 47615,
      token,
      enabled: token.length >= 16,
    } satisfies StoredSettings,
  });
  window.setTimeout(() => void refresh(), 350);
}

element<HTMLButtonElement>('save').addEventListener('click', () => void save());
void refresh();
