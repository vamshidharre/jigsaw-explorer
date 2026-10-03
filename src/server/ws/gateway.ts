/**
 * WebSocket entry point. Handles the upgrade (origin + per-IP limits), the
 * hello handshake, heartbeats, message validation and rate limiting, then
 * routes validated messages to the player's room.
 */
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '../../shared/protocol';
import type { ServerEvent } from '../../shared/analytics';
import { log } from '../logger';
import type { Connection, Room } from '../rooms/Room';
import { RoomError, type RoomManager } from '../rooms/RoomManager';
import { TokenBucket, WindowRateLimiter } from '../util/rateLimit';
import { clientMessageSchema } from './schemas';

const HELLO_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 20_000;
const MAX_PAYLOAD = 32 * 1024;
const MAX_STRIKES = 50;

export interface GatewayOptions {
  allowedOrigins: string[];
  maxConnectionsPerIp: number;
  trustProxy: number;
  /** Usage counting hook (new players joining, rooms finishing a puzzle). */
  onEvent?: (event: ServerEvent) => void;
}

let nextConnId = 1;

export function attachGateway(server: Server, rooms: RoomManager, options: GatewayOptions) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false });
  const perIp = new Map<string, number>();
  const helloLimiter = new WindowRateLimiter(30, 60_000);

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    if (!originAllowed(req, options.allowedOrigins)) {
      log.warn('rejected websocket origin', { origin: req.headers.origin });
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const ip = clientIp(req, options.trustProxy);
    if ((perIp.get(ip) ?? 0) >= options.maxConnectionsPerIp) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, ip));
  });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, ip: string) => {
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    const bucket = new TokenBucket(60, 120);
    let strikes = 0;
    let room: Room | null = null;
    let alive = true;

    const conn: Connection = {
      id: nextConnId++,
      send(msg: ServerMessage) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      close(code: number, reason: string) {
        if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close(code, reason);
      },
    };

    const fail = (code: Extract<ServerMessage, { t: 'error' }>['code'], message: string, closeCode = 4000) => {
      conn.send({ t: 'error', code, message, fatal: true });
      conn.close(closeCode, code);
    };

    const helloTimer = setTimeout(() => {
      if (!room) fail('BAD_REQUEST', 'Handshake timed out.');
    }, HELLO_TIMEOUT_MS);

    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, HEARTBEAT_MS);
    ws.on('pong', () => (alive = true));

    ws.on('message', (raw, isBinary) => {
      alive = true;
      if (isBinary) return strike();
      if (!bucket.take()) {
        strikes++;
        if (strikes > MAX_STRIKES) fail('RATE_LIMITED', 'Too many messages.', 1008);
        return;
      }
      let msg: ClientMessage;
      try {
        const parsed = clientMessageSchema.safeParse(JSON.parse(raw.toString()));
        if (!parsed.success) return strike();
        msg = parsed.data as ClientMessage;
      } catch {
        return strike();
      }

      if (!room) {
        if (msg.t !== 'hello') return fail('BAD_REQUEST', 'Expected a hello message first.');
        if (msg.v !== PROTOCOL_VERSION) return fail('VERSION_MISMATCH', 'Please refresh the page to get the latest version.');
        if (!helloLimiter.take(ip)) return fail('RATE_LIMITED', 'Too many join attempts. Please wait a minute.', 1008);
        const target = rooms.get(msg.code);
        if (!target) return fail('ROOM_NOT_FOUND', 'This room does not exist or has expired.', 4004);
        const result = target.join(conn, msg);
        if (!result.ok) return fail(result.code, result.message, 4003);
        if (!result.resumed) options.onEvent?.('room_join');
        room = target;
        clearTimeout(helloTimer);
        return;
      }

      try {
        const wasComplete = room.completion !== null;
        room.handle(conn, msg, (req) => rooms.buildPuzzle(req));
        if (!wasComplete && room.completion !== null) options.onEvent?.('room_complete');
      } catch (err) {
        if (err instanceof RoomError) conn.send({ t: 'error', code: 'BAD_REQUEST', message: err.message, fatal: false });
        else {
          log.error('error handling message', { type: msg.t, err: String(err) });
          conn.send({ t: 'error', code: 'SERVER_ERROR', message: 'Something went wrong on the server.', fatal: false });
        }
      }
    });

    function strike() {
      strikes++;
      conn.send({ t: 'error', code: 'BAD_REQUEST', message: 'Malformed message.', fatal: false });
      if (strikes > MAX_STRIKES) fail('BAD_REQUEST', 'Too many malformed messages.', 1008);
    }

    ws.on('close', () => {
      clearTimeout(helloTimer);
      clearInterval(heartbeat);
      const n = (perIp.get(ip) ?? 1) - 1;
      if (n <= 0) perIp.delete(ip);
      else perIp.set(ip, n);
      if (room && room.hasPlayerConnection(conn)) room.disconnect(conn);
    });

    ws.on('error', (err) => log.warn('websocket error', { err: String(err) }));
  });

  return wss;
}

function originAllowed(req: IncomingMessage, allowed: string[]): boolean {
  const origin = req.headers.origin;
  // Non-browser clients do not send an Origin header; they cannot ride a user's session anyway.
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const host = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() ?? req.headers.host;
  if (originHost === host) return true;
  return allowed.some((a) => a === origin || a === originHost);
}

export function clientIp(req: IncomingMessage, trustProxy: number): string {
  if (trustProxy > 0) {
    const fwd = req.headers['x-forwarded-for'];
    const list = (Array.isArray(fwd) ? fwd.join(',') : (fwd ?? '')).split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length) return list[Math.max(0, list.length - trustProxy)] ?? list[0]!;
  }
  return req.socket.remoteAddress ?? 'unknown';
}
