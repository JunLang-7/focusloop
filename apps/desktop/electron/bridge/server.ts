import { createServer, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  BRIDGE_DEFAULT_PORT,
  BRIDGE_MESSAGE_LIMIT_BYTES,
  BRIDGE_PROTOCOL_VERSION,
  bridgeTypeToEventType,
  parseBridgeInbound,
  type BridgeOutboundMessage,
} from '@focusloop/shared-types';
import type { FocusLoopEngine } from '@focusloop/agent-core';

export interface BridgeServerOptions {
  readonly engine: FocusLoopEngine;
  readonly port?: number;
  readonly token?: string;
  readonly host?: string;
  /** Bounded ring of recently applied event ids (reconnect protection). */
  readonly dedupeWindowSize?: number;
}

export interface BridgeServerHandle {
  readonly token: string;
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
  connectionCount(): number;
}

/**
 * Loopback-only WebSocket bridge for the browser extension.
 *
 * Three invariants, all enforced here:
 *  1. binds to 127.0.0.1 only — never a routable interface;
 *  2. every message must carry the session token, checked with a constant-time
 *     comparison;
 *  3. the same eventId is applied at most once, so a reconnect storm cannot
 *     double-count an interruption.
 */
export async function startBridgeServer(options: BridgeServerOptions): Promise<BridgeServerHandle> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? BRIDGE_DEFAULT_PORT;
  const token = options.token ?? randomUUID().replace(/-/g, '');
  const dedupeWindowSize = options.dedupeWindowSize ?? 256;

  const seen: string[] = [];
  const seenSet = new Set<string>();
  const sockets = new Set<WebSocket>();

  function remember(eventId: string): boolean {
    if (seenSet.has(eventId)) return false;
    seenSet.add(eventId);
    seen.push(eventId);
    if (seen.length > dedupeWindowSize) {
      const oldest = seen.shift();
      if (oldest !== undefined) seenSet.delete(oldest);
    }
    return true;
  }

  function submit(message: ReturnType<typeof parseBridgeInbound> & object): BridgeOutboundMessage {
    if (!timingSafeEqual(message.token, token)) {
      return { protocol: BRIDGE_PROTOCOL_VERSION, type: 'ERROR', reason: 'unauthorized' };
    }
    const eventType = bridgeTypeToEventType(message.type);
    if (eventType === null) {
      return { protocol: BRIDGE_PROTOCOL_VERSION, type: 'ACK', eventId: message.eventId };
    }
    if (!remember(message.eventId)) {
      return { protocol: BRIDGE_PROTOCOL_VERSION, type: 'ACK', eventId: message.eventId };
    }

    const session = options.engine.getCurrentSession();
    if (session === null) {
      return { protocol: BRIDGE_PROTOCOL_VERSION, type: 'ERROR', reason: 'no-active-session' };
    }

    const response = options.engine.dispatch({
      sessionId: session.session.id,
      type: eventType,
      source: 'extension',
      payload: message.payload as Record<string, unknown>,
      at: message.at,
      eventId: `ext:${message.eventId}`,
    });

    return {
      protocol: BRIDGE_PROTOCOL_VERSION,
      type: 'ACK',
      eventId: message.eventId,
      state: response.state,
    };
  }

  const httpServer: HttpServer = createServer((_request, response) => {
    response.writeHead(426, { 'content-type': 'text/plain' });
    response.end('FocusLoop bridge: WebSocket only.');
  });

  const wss = new WebSocketServer({ server: httpServer, maxPayload: BRIDGE_MESSAGE_LIMIT_BYTES });
  // A failed listen surfaces through `httpServer`; without this listener the
  // WebSocketServer would re-emit it as an unhandled error.
  wss.on('error', () => undefined);

  wss.on('connection', (socket: WebSocket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));

    socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        socket.send(
          JSON.stringify({
            protocol: BRIDGE_PROTOCOL_VERSION,
            type: 'ERROR',
            reason: 'malformed-json',
          } satisfies BridgeOutboundMessage),
        );
        return;
      }

      const message = parseBridgeInbound(parsed);
      if (message === null) {
        socket.send(
          JSON.stringify({
            protocol: BRIDGE_PROTOCOL_VERSION,
            type: 'ERROR',
            reason: 'schema-validation-failed',
          } satisfies BridgeOutboundMessage),
        );
        return;
      }

      socket.send(JSON.stringify(submit(message)));
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  const address = httpServer.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : port;

  return {
    token,
    port: boundPort,
    url: `ws://${host}:${boundPort}`,
    connectionCount: () => sockets.size,
    close: async () => {
      for (const socket of sockets) socket.close();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

/** Constant-time-ish comparison to avoid leaking the token by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}
