import { BRIDGE_DEFAULT_PORT, bridgeUrl, type BridgePayload } from '@focusloop/shared-types';
import { ActivityTracker, type TrackerEmission } from './tracker';
import { BridgeClient, type BridgeStatus, type SocketLike } from './bridge-client';

interface StoredSettings {
  readonly port?: number;
  readonly token?: string;
  readonly enabled?: boolean;
}

const SETTINGS_KEY = 'focusloop-bridge-settings';
const STATUS_KEY = 'focusloop-bridge-status';
const IDLE_DETECTION_SECONDS = 60;

const tracker = new ActivityTracker();
let status: BridgeStatus = { connected: false, queued: 0, lastError: null, lastState: null };
let client: BridgeClient | null = null;

async function loadSettings(): Promise<StoredSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return (stored[SETTINGS_KEY] as StoredSettings | undefined) ?? {};
}

async function saveStatus(next: BridgeStatus): Promise<void> {
  status = next;
  await chrome.storage.local.set({ [STATUS_KEY]: next });
}

function buildClient(settings: StoredSettings): BridgeClient {
  const port = settings.port ?? BRIDGE_DEFAULT_PORT;
  const token = settings.token ?? '';
  return new BridgeClient({
    url: () => bridgeUrl(port),
    token: () => token,
    // The DOM WebSocket satisfies SocketLike structurally.
    socketFactory: (url) => new WebSocket(url) as unknown as SocketLike,
    onStatus: (next) => {
      void saveStatus(next);
    },
  });
}

function emit(emission: TrackerEmission | null): void {
  if (emission === null || client === null) return;
  const payload: BridgePayload = emission.payload;
  client.emit(emission.type, payload);
}

async function ensureClient(): Promise<void> {
  const settings = await loadSettings();
  if (settings.enabled === false) return;
  if (settings.token === undefined || settings.token.length < 16) return;

  if (client === null) {
    client = buildClient(settings);
    client.start();
  }
}

async function restartClient(): Promise<void> {
  client?.stop();
  client = null;
  tracker.reset();
  await ensureClient();
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);
  void ensureClient();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureClient();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[SETTINGS_KEY] !== undefined) void restartClient();
});

chrome.idle.onStateChanged.addListener((state) => {
  emit(tracker.onIdleStateChanged(state, Date.now()));
});

// Only `tabs.onActivated` is used: it yields ids, never content or URLs.
if (chrome.tabs?.onActivated) {
  chrome.tabs.onActivated.addListener((info) => {
    emit(tracker.onTabActivated(info.tabId, Date.now()));
  });
}

if (chrome.windows?.onFocusChanged) {
  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      emit(tracker.onWindowFocusLost(Date.now()));
    } else {
      emit(tracker.onWindowFocusGained(Date.now()));
    }
  });
}

// Keeps the service worker alive long enough to flush the queue.
chrome.alarms.create('focusloop-bridge-keepalive', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(() => {
  void ensureClient();
  void saveStatus(status);
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: string }).type === 'status'
  ) {
    void (async () => {
      const settings = await loadSettings();
      sendResponse({
        status,
        settings: {
          port: settings.port ?? BRIDGE_DEFAULT_PORT,
          enabled: settings.enabled !== false,
        },
        tracker: tracker.snapshot(),
      });
    })();
    return true;
  }
  return false;
});

void ensureClient();
