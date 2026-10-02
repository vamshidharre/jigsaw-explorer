/**
 * WebSocket connection to a multiplayer room with automatic reconnection.
 *
 * The player's seat (id + secret token) is kept in sessionStorage, so a page
 * refresh or a dropped connection resumes the same identity, while a second
 * tab joins as a separate player.
 */
import { PROTOCOL_VERSION, type ClientMessage, type ErrorCode, type ServerMessage, type WelcomeMessage } from '../../shared/protocol';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'failed' | 'closed';

export interface ConnectionHandlers {
  onWelcome(msg: WelcomeMessage, resumed: boolean): void;
  onMessage(msg: ServerMessage): void;
  onStatus(status: ConnectionStatus, detail?: { code?: ErrorCode; message?: string; attempt?: number }): void;
  onLatency?(ms: number): void;
}

const FATAL: ReadonlySet<ErrorCode> = new Set(['ROOM_NOT_FOUND', 'ROOM_FULL', 'VERSION_MISMATCH', 'REPLACED']);
const PING_INTERVAL = 5000;
const DEAD_AFTER = 15000;
const MAX_RECONNECT_MS = 120_000;

interface Seat {
  playerId: string;
  token: string;
}

function seatKey(code: string) {
  return `jigsaw.seat.${code}`;
}

export function hostKeyStorageKey(code: string) {
  return `jigsaw.host.${code}`;
}

function readSession<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeSession(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: reconnection still works for this page load.
  }
}

export class RoomConnection {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'connecting';
  private attempt = 0;
  private reconnectTimer = 0;
  private pingTimer = 0;
  private lastMessageAt = 0;
  private disconnectedSince: number | null = null;
  private seat: Seat | null;
  private fatal = false;
  private stopped = false;
  private everConnected = false;
  selfId: string | null = null;

  constructor(
    private readonly code: string,
    private name: string,
    private readonly handlers: ConnectionHandlers,
  ) {
    this.seat = readSession<Seat>(seatKey(code));
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
  }

  connect(): void {
    if (this.stopped) return;
    clearTimeout(this.reconnectTimer);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.setStatus('offline');
      return;
    }
    this.setStatus(this.everConnected ? 'reconnecting' : 'connecting', { attempt: this.attempt });
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws`);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      const hostKey = readSession<string>(hostKeyStorageKey(this.code)) ?? undefined;
      this.rawSend({ t: 'hello', v: PROTOCOL_VERSION, code: this.code, name: this.name, resume: this.seat ?? undefined, hostKey });
    };

    ws.onmessage = (ev) => {
      this.lastMessageAt = Date.now();
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.t === 'welcome') {
        const resumed = this.everConnected;
        this.everConnected = true;
        this.attempt = 0;
        this.disconnectedSince = null;
        this.selfId = msg.you.id;
        this.seat = { playerId: msg.you.id, token: msg.you.token };
        writeSession(seatKey(this.code), this.seat);
        this.setStatus('connected');
        this.startPing();
        this.handlers.onWelcome(msg, resumed);
        return;
      }
      if (msg.t === 'pong') {
        this.handlers.onLatency?.(Math.max(0, Math.round(performance.now() - msg.ts)));
        return;
      }
      if (msg.t === 'error' && msg.fatal) {
        if (FATAL.has(msg.code)) {
          this.fatal = true;
          this.setStatus('failed', { code: msg.code, message: msg.message });
        }
        return;
      }
      this.handlers.onMessage(msg);
    };

    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      clearInterval(this.pingTimer);
      if (this.stopped || this.fatal) return;
      if (ev.code === 4004 || ev.code === 4003) {
        // Fatal close without a preceding error message (should not normally happen).
        this.fatal = true;
        this.setStatus('failed', { code: ev.code === 4004 ? 'ROOM_NOT_FOUND' : 'ROOM_FULL' });
        return;
      }
      this.disconnectedSince ??= Date.now();
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose follows and handles reconnection.
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.fatal) return;
    if (this.disconnectedSince !== null && Date.now() - this.disconnectedSince > MAX_RECONNECT_MS) {
      this.setStatus('offline');
      return;
    }
    this.attempt++;
    const base = Math.min(10_000, 400 * Math.pow(1.8, this.attempt - 1));
    const delay = base * (0.75 + Math.random() * 0.5);
    this.setStatus(this.everConnected ? 'reconnecting' : 'connecting', { attempt: this.attempt });
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  private startPing(): void {
    clearInterval(this.pingTimer);
    this.lastMessageAt = Date.now();
    this.pingTimer = window.setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastMessageAt > DEAD_AFTER) {
        // The socket looks open but nothing arrives: force a reconnect.
        this.ws.close();
        return;
      }
      this.rawSend({ t: 'ping', ts: performance.now() });
    }, PING_INTERVAL);
  }

  /** Retry immediately (e.g. from a "Try again" button). */
  retry(): void {
    if (this.stopped) return;
    this.fatal = false;
    this.attempt = 0;
    this.disconnectedSince = Date.now();
    this.ws?.close();
    this.ws = null;
    this.connect();
  }

  send(msg: ClientMessage): boolean {
    if (this.status !== 'connected') return false;
    return this.rawSend(msg);
  }

  private rawSend(msg: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  setName(name: string): void {
    this.name = name;
    this.send({ t: 'name', name });
  }

  /**
   * Leaves the room for good (frees the seat for others). Only has an effect
   * once the server has accepted us; before that it simply disconnects.
   */
  leave(): void {
    if (this.stopped) return;
    if (this.selfId && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.rawSend({ t: 'leave' });
      try {
        sessionStorage.removeItem(seatKey(this.code));
        sessionStorage.removeItem(hostKeyStorageKey(this.code));
      } catch {
        // ignore
      }
    }
    this.close();
  }

  /** Closes the socket without leaving (e.g. navigating away; the seat is kept for a while). */
  close(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    const ws = this.ws;
    this.ws = null;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close(1000, 'closed');
    this.setStatus('closed');
  }

  private onOnline = () => {
    if (this.status === 'offline' || this.status === 'reconnecting') {
      this.attempt = 0;
      this.disconnectedSince = Date.now();
      this.connect();
    }
  };

  private onOffline = () => {
    if (this.stopped || this.fatal) return;
    this.disconnectedSince ??= Date.now();
    const ws = this.ws;
    this.ws = null;
    clearInterval(this.pingTimer);
    ws?.close();
    this.setStatus('offline');
  };

  private setStatus(status: ConnectionStatus, detail?: { code?: ErrorCode; message?: string; attempt?: number }): void {
    this.status = status;
    this.handlers.onStatus(status, detail);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }
}
