import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startServer } from '../../src/server/index';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '../../src/shared/protocol';

export type TestServer = Awaited<ReturnType<typeof startServer>> & { url: string; dataDir: string; cleanup: () => Promise<void> };

export async function launch(dataDir?: string, overrides: Parameters<typeof startServer>[0] = {}): Promise<TestServer> {
  const dir = dataDir ?? (await mkdtemp(path.join(tmpdir(), 'jigsaw-test-')));
  const srv = await startServer({
    port: 0,
    host: '127.0.0.1',
    dataDir: dir,
    publicDir: path.join(dir, 'no-client'),
    trustProxy: 0,
    maxConnectionsPerIp: 1000,
    ...overrides,
  });
  return {
    ...srv,
    dataDir: dir,
    url: `http://127.0.0.1:${srv.port}`,
    cleanup: async () => {
      await srv.stop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function createRoom(url: string, body: Record<string, unknown> = {}) {
  const res = await fetch(`${url}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image: { kind: 'catalog', id: 'starry-night' }, pieces: 12, rotation: false, capacity: 4, aspect: 1.6, ...body }),
  });
  if (res.status !== 201) throw new Error(`create failed ${res.status} ${await res.text()}`);
  return (await res.json()) as { code: string; hostKey: string };
}

export class TestClient {
  readonly messages: ServerMessage[] = [];
  private waiters: Array<{ pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];
  closed: { code: number; reason: string } | null = null;
  private closeWaiters: Array<() => void> = [];

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      this.messages.push(msg);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(msg)) {
          w.resolve(msg);
          return false;
        }
        return true;
      });
    });
    ws.on('close', (code, reason) => {
      this.closed = { code, reason: reason.toString() };
      this.closeWaiters.forEach((f) => f());
    });
  }

  static async connect(url: string, headers: Record<string, string> = {}): Promise<TestClient> {
    const ws = new WebSocket(url.replace('http', 'ws') + '/ws', { headers });
    const client = new TestClient(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    return client;
  }

  send(msg: ClientMessage | Record<string, unknown>) {
    this.ws.send(JSON.stringify(msg));
  }

  hello(code: string, name: string, extra: Partial<Extract<ClientMessage, { t: 'hello' }>> = {}) {
    this.send({ t: 'hello', v: PROTOCOL_VERSION, code, name, ...extra });
  }

  /** Waits for the next message (including already received ones after `from`) matching the predicate. */
  waitFor<T extends ServerMessage['t']>(
    type: T,
    pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true,
    timeoutMs = 3000,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const match = (m: ServerMessage) => m.t === type && pred(m as Extract<ServerMessage, { t: T }>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeoutMs);
      this.waiters.push({
        pred: match,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { t: T }>);
        },
      });
    });
  }

  waitForClose(timeoutMs = 3000): Promise<{ code: number; reason: string }> {
    if (this.closed) return Promise.resolve(this.closed);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for close')), timeoutMs);
      this.closeWaiters.push(() => {
        clearTimeout(timer);
        resolve(this.closed!);
      });
    });
  }

  close() {
    this.ws.close();
  }

  /** Simulates an abrupt network drop (no close frame). */
  kill() {
    this.ws.terminate();
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
