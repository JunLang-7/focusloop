import type { LearningEventType } from './events';
import type { LearningState } from './state';

/**
 * Desktop ↔ extension protocol.
 *
 * Privacy boundary (enforced by both sides, not by convention):
 *  - only tab activity *metadata* travels: which tab became active, how long the
 *    learner was away, and the origin (scheme + host) at most;
 *  - never page text, never input values, never cookies, never full history.
 */
export const BRIDGE_PROTOCOL_VERSION = 1;

/** The only inbound message kinds the desktop will accept. */
export const BRIDGE_INBOUND_TYPES = [
  'HELLO',
  'TAB_LEFT',
  'TAB_RETURNED',
  'IDLE_STARTED',
  'IDLE_ENDED',
] as const;

export type BridgeInboundType = (typeof BRIDGE_INBOUND_TYPES)[number];

export interface BridgeInboundMessage {
  readonly protocol: number;
  readonly type: BridgeInboundType;
  readonly token: string;
  /** Caller-assigned id, used for duplicate protection across reconnects. */
  readonly eventId: string;
  readonly at: string;
  readonly payload: BridgePayload;
}

export interface BridgePayload {
  /** Origin only — `https://example.com`, never a full URL with a path. */
  readonly origin?: string;
  readonly awayMs?: number;
  readonly idleMs?: number;
  readonly clientVersion?: string;
}

export interface BridgeOutboundMessage {
  readonly protocol: number;
  readonly type: 'ACK' | 'ERROR';
  readonly eventId?: string;
  readonly state?: LearningState;
  readonly reason?: string;
}

export const BRIDGE_MESSAGE_LIMIT_BYTES = 2 * 1024;

/** A full URL is never accepted; only a bare origin survives validation. */
export function sanitiseOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  if (value.length > 120) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

/** Maps a bridge message onto the learning-event vocabulary. */
export function bridgeTypeToEventType(type: BridgeInboundType): LearningEventType | null {
  switch (type) {
    case 'TAB_LEFT':
      return 'TAB_LEFT';
    case 'TAB_RETURNED':
      return 'TAB_RETURNED';
    case 'IDLE_STARTED':
      return 'IDLE_STARTED';
    case 'IDLE_ENDED':
      return 'IDLE_ENDED';
    case 'HELLO':
    default:
      return null;
  }
}

export function parseBridgeInbound(value: unknown): BridgeInboundMessage | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  const protocol = record['protocol'];
  if (typeof protocol !== 'number' || protocol !== BRIDGE_PROTOCOL_VERSION) return null;

  const type = record['type'];
  if (typeof type !== 'string' || !(BRIDGE_INBOUND_TYPES as readonly string[]).includes(type)) {
    return null;
  }

  const token = record['token'];
  if (typeof token !== 'string' || token.length < 16 || token.length > 256) return null;

  const eventId = record['eventId'];
  if (typeof eventId !== 'string' || eventId.length === 0 || eventId.length > 128) return null;

  const at = record['at'];
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) return null;

  const rawPayload = record['payload'];
  const payloadRecord =
    typeof rawPayload === 'object' && rawPayload !== null && !Array.isArray(rawPayload)
      ? (rawPayload as Record<string, unknown>)
      : {};

  const payload: BridgePayload = {};
  const origin = sanitiseOrigin(payloadRecord['origin']);
  if (origin !== undefined) (payload as { origin?: string }).origin = origin;

  for (const key of ['awayMs', 'idleMs'] as const) {
    const candidate = payloadRecord[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) {
      (payload as Record<string, number>)[key] = candidate;
    }
  }

  const clientVersion = payloadRecord['clientVersion'];
  if (typeof clientVersion === 'string' && clientVersion.length <= 32) {
    (payload as { clientVersion?: string }).clientVersion = clientVersion;
  }

  return { protocol, type: type as BridgeInboundType, token, eventId, at, payload };
}

export const BRIDGE_DEFAULT_PORT = 47615;

export function bridgeUrl(port: number = BRIDGE_DEFAULT_PORT): string {
  return `ws://127.0.0.1:${port}`;
}
