import {
  BRIDGE_PROTOCOL_VERSION,
  type BridgeInboundMessage,
  type BridgeInboundType,
  type BridgeOutboundMessage,
  type BridgePayload,
} from '@focusloop/shared-types';

export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
}

export interface BridgeClientOptions {
  readonly socketFactory: (url: string) => SocketLike;
  readonly url: () => string;
  readonly token: () => string;
  readonly now?: () => number;
  readonly idFactory?: () => string;
  readonly maxQueueSize?: number;
  readonly reconnectBaseMs?: number;
  readonly reconnectMaxMs?: number;
  readonly onStatus?: (status: BridgeStatus) => void;
  readonly setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  readonly clearTimeoutFn?: (handle: unknown) => void;
}

export interface BridgeStatus {
  readonly connected: boolean;
  readonly queued: number;
  readonly lastError: string | null;
  readonly lastState: string | null;
}

const OPEN = 1;

/**
 * Resilient loopback client.
 *
 * Guarantees:
 *  - events produced while disconnected are queued (bounded) and flushed in order;
 *  - every event carries a stable id, so a reconnect cannot apply it twice;
 *  - reconnects use capped exponential backoff and never give up;
 *  - nothing but metadata is ever sent.
 */
export class BridgeClient {
  private socket: SocketLike | null = null;
  private queue: BridgeInboundMessage[] = [];
  private attempt = 0;
  private timer: unknown = null;
  private stopped = true;
  private counter = 0;
  private lastError: string | null = null;
  private lastState: string | null = null;

  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly maxQueueSize: number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly options: BridgeClientOptions) {
    this.now = options.now ?? (() => Date.now());
    this.idFactory = options.idFactory ?? (() => `${this.now()}-${(this.counter += 1)}`);
    this.maxQueueSize = options.maxQueueSize ?? 128;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 1_000;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 30_000;
    this.setTimer = options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
    this.clearTimer = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle as number));
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.socket?.close();
    this.socket = null;
  }

  status(): BridgeStatus {
    return {
      connected: this.socket?.readyState === OPEN,
      queued: this.queue.length,
      lastError: this.lastError,
      lastState: this.lastState,
    };
  }

  /** Emits an event, connecting lazily if needed. */
  emit(type: BridgeInboundType, payload: BridgePayload = {}): string {
    const message: BridgeInboundMessage = {
      protocol: BRIDGE_PROTOCOL_VERSION,
      type,
      token: this.options.token(),
      eventId: this.idFactory(),
      at: new Date(this.now()).toISOString(),
      payload,
    };
    this.enqueue(message);
    return message.eventId;
  }

  private enqueue(message: BridgeInboundMessage): void {
    this.queue.push(message);
    if (this.queue.length > this.maxQueueSize) {
      // Drop the oldest: stale context is worse than no context.
      this.queue.shift();
    }
    if (this.socket?.readyState === OPEN) this.flush();
    else if (this.stopped) {
      this.stopped = false;
      this.connect();
    }
  }

  private flush(): void {
    const socket = this.socket;
    if (socket === null || socket.readyState !== OPEN) return;
    const pending = [...this.queue];
    this.queue = [];
    for (const message of pending) {
      try {
        socket.send(JSON.stringify(message));
      } catch {
        this.queue.unshift(message);
        this.lastError = 'send failed';
        break;
      }
    }
    this.publish();
  }

  private connect(): void {
    if (this.stopped) return;
    let socket: SocketLike;
    try {
      socket = this.options.socketFactory(this.options.url());
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    socket.addEventListener('open', () => {
      this.attempt = 0;
      this.lastError = null;
      this.flush();
      this.publish();
    });
    socket.addEventListener('message', (event: unknown) => {
      const data = (event as { data?: unknown }).data;
      if (typeof data !== 'string') return;
      try {
        const response = JSON.parse(data) as BridgeOutboundMessage;
        if (response.type === 'ERROR') this.lastError = response.reason ?? 'error';
        if (typeof response.state === 'string') this.lastState = response.state;
      } catch {
        this.lastError = 'malformed response';
      }
      this.publish();
    });
    socket.addEventListener('close', () => {
      if (this.socket === socket) this.socket = null;
      this.scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      this.lastError = 'socket error';
      this.publish();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.timer !== null) return;
    this.attempt += 1;
    const delay = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * 2 ** (this.attempt - 1));
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.connect();
    }, delay);
    this.publish();
  }

  private publish(): void {
    this.options.onStatus?.(this.status());
  }
}
