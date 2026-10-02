import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { fromWire, type WelcomeMessage } from '../../src/shared/protocol';
import { PuzzleModel } from '../../src/shared/puzzle/model';
import { createRoom, launch, sleep, TestClient, type TestServer } from './helpers';

let server: TestServer;

beforeEach(async () => {
  process.env.NODE_ENV = 'test';
  server = await launch(undefined, { reconnectGraceMs: 1500 });
});

afterEach(async () => {
  await server.cleanup();
});

async function join(code: string, name: string, extra = {}) {
  const c = await TestClient.connect(server.url);
  const welcome = c.waitFor('welcome');
  c.hello(code, name, extra);
  return { c, welcome: await welcome };
}

function modelFrom(w: WelcomeMessage) {
  return new PuzzleModel(w.puzzle.spec, w.groups.map(fromWire));
}

describe('rooms over HTTP', () => {
  it('creates a room and reports a summary', async () => {
    const { code } = await createRoom(server.url);
    const res = await fetch(`${server.url}/api/rooms/${code}`);
    expect(res.status).toBe(200);
    const summary = (await res.json()) as Record<string, number | string | boolean>;
    expect(summary).toMatchObject({ code, title: 'The Starry Night', players: 0, full: false });
    expect(summary.pieces as number).toBeGreaterThanOrEqual(10);
  });

  it('rejects invalid room settings and unknown images', async () => {
    const bad = await fetch(`${server.url}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"pieces":5}' });
    expect(bad.status).toBe(400);
    const unknown = await fetch(`${server.url}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: { kind: 'catalog', id: 'nope' }, pieces: 20, rotation: false, capacity: 4, aspect: 1 }),
    });
    expect(unknown.status).toBe(400);
  });

  it('returns 400 for malformed codes and 404 for unknown rooms', async () => {
    expect((await fetch(`${server.url}/api/rooms/abc`)).status).toBe(400);
    expect((await fetch(`${server.url}/api/rooms/ZZZZZZ`)).status).toBe(404);
  });
});

describe('multiplayer session', () => {
  it('lets two players see each other and synchronises moves and merges', async () => {
    const { code, hostKey } = await createRoom(server.url);
    const a = await join(code, 'Alice', { hostKey });
    expect(a.welcome.room.hostId).toBe(a.welcome.you.id);

    const aSeesBob = a.c.waitFor('players', (m) => m.players.length === 2);
    const b = await join(code, 'Bob');
    const players = (await aSeesBob).players;
    expect(players.map((p) => p.name).sort()).toEqual(['Alice', 'Bob']);
    expect(players.find((p) => p.name === 'Alice')!.isHost).toBe(true);
    expect(b.welcome.players).toHaveLength(2);

    const model = modelFrom(a.welcome);
    const g0 = model.groupOf(0).id;
    const g1 = model.groupOf(1).id;

    // Alice grabs piece 0; Bob sees the hold and Alice's live movement.
    const bobSeesHeld = b.c.waitFor('held', (m) => m.g === g0);
    a.c.send({ t: 'grab', g: g0 });
    expect((await bobSeesHeld).by).toBe(a.welcome.you.id);

    const bobSeesMove = b.c.waitFor('tick', (m) => !!m.m?.some(([g]) => g === g0));
    a.c.send({ t: 'move', g: g0, x: 2000, y: 2000, r: 0 });
    const tick = await bobSeesMove;
    expect(tick.m!.find(([g]) => g === g0)!.slice(1, 3)).toEqual([2000, 2000]);

    // Bob cannot steal a group Alice is holding.
    const denied = b.c.waitFor('denied', (m) => m.g === g0);
    b.c.send({ t: 'grab', g: g0 });
    await denied;

    const aliceDrop = b.c.waitFor('update', (m) => m.reason === 'drop' && m.by === a.welcome.you.id);
    a.c.send({ t: 'drop', g: g0, x: 2000, y: 2000, r: 0, snap: 'normal', op: 1 });
    await aliceDrop;

    // Bob drops piece 1 right next to it: the server merges them for everyone.
    b.c.send({ t: 'grab', g: g1 });
    await a.c.waitFor('held', (m) => m.g === g1);
    const aliceSeesMerge = a.c.waitFor('update', (m) => m.reason === 'drop' && m.kind === 'piece');
    const bobAck = b.c.waitFor('update', (m) => m.op === 7);
    const playersAfterMerge = a.c.waitFor('players', (m) => m.players.some((p) => p.placed > 0));
    b.c.send({ t: 'drop', g: g1, x: 2004, y: 1997, r: 0, snap: 'normal', op: 7 });
    const merge = await aliceSeesMerge;
    await bobAck;
    expect(merge.removed).toHaveLength(1);
    expect(merge.groups[0]!.p.sort()).toEqual([0, 1]);
    expect(merge.connected).toBe(2);
    expect(merge.groups[0]!.x).toBe(2000);

    // Contributions are tracked per player.
    const playersAfter = await playersAfterMerge;
    expect(playersAfter.players.find((p) => p.name === 'Bob')!.placed).toBe(2);

    a.c.close();
    b.c.close();
  });

  it('resolves simultaneous grabs so exactly one player wins', async () => {
    const { code } = await createRoom(server.url);
    const a = await join(code, 'A');
    const b = await join(code, 'B');
    const g = modelFrom(a.welcome).groupOf(3).id;
    const aHeld = a.c.waitFor('held', (m) => m.g === g);
    a.c.send({ t: 'grab', g });
    b.c.send({ t: 'grab', g });
    const winner = (await aHeld).by;
    await sleep(150);
    const loser = winner === a.welcome.you.id ? b : a;
    expect(loser.c.messages.some((m) => m.t === 'denied' && m.g === g)).toBe(true);
    // The loser's moves are ignored.
    loser.c.send({ t: 'move', g, x: 5, y: 5, r: 0 });
    await sleep(150);
    const moves = [...a.c.messages, ...b.c.messages].filter((m) => m.t === 'tick' && m.m?.some(([id, x]) => id === g && x === 5));
    expect(moves).toHaveLength(0);
    a.c.close();
    b.c.close();
  });

  it('handles disconnects, reconnection with the same identity, and expiry of the seat', async () => {
    const { code, hostKey } = await createRoom(server.url);
    const a = await join(code, 'Alice', { hostKey });
    const b = await join(code, 'Bob');

    // Alice grabs a piece and then her network drops.
    const g = modelFrom(a.welcome).groupOf(2).id;
    a.c.send({ t: 'grab', g });
    await b.c.waitFor('held', (m) => m.g === g);
    const released = b.c.waitFor('update', (m) => m.reason === 'release' && m.groups[0]?.i === g);
    const offline = b.c.waitFor('players', (m) => m.players.some((p) => p.name === 'Alice' && !p.online));
    a.c.kill();
    await offline;
    await released; // her hold is released so the piece is not stuck

    // She comes back with her resume token and keeps her seat, colour and host role.
    const rejoined = b.c.waitFor('event', (m) => m.event.kind === 'rejoined');
    const again = await join(code, 'Alice', { resume: { playerId: a.welcome.you.id, token: a.welcome.you.token } });
    await rejoined;
    expect(again.welcome.you.id).toBe(a.welcome.you.id);
    expect(again.welcome.you.color).toBe(a.welcome.you.color);
    expect(again.welcome.room.hostId).toBe(a.welcome.you.id);

    // A forged token gets a brand new identity instead.
    const forged = await join(code, 'Mallory', { resume: { playerId: a.welcome.you.id, token: 'x'.repeat(32) } });
    expect(forged.welcome.you.id).not.toBe(a.welcome.you.id);

    // Bob drops off and does not return within the grace period: he is removed.
    const bobLeft = again.c.waitFor('event', (m) => m.event.kind === 'left' && m.event.name === 'Bob', 6000);
    b.c.kill();
    await bobLeft;
    again.c.close();
    forged.c.close();
  });

  it('migrates the host when the host leaves', async () => {
    const { code, hostKey } = await createRoom(server.url);
    const a = await join(code, 'Alice', { hostKey });
    const b = await join(code, 'Bob');
    const hostEvent = b.c.waitFor('event', (m) => m.event.kind === 'host');
    const roomUpdate = b.c.waitFor('room', (m) => m.room.hostId === b.welcome.you.id);
    a.c.send({ t: 'leave' });
    expect((await hostEvent).event.playerId).toBe(b.welcome.you.id);
    await roomUpdate;
    // Only the host may start a new puzzle.
    const c = await join(code, 'Carol');
    const notHost = c.c.waitFor('error', (m) => m.code === 'NOT_HOST');
    c.c.send({ t: 'newPuzzle', puzzle: { image: { kind: 'catalog', id: 'great-wave' }, pieces: 20, rotation: false, aspect: 1.5 } });
    await notHost;
    const reset = c.c.waitFor('puzzle');
    b.c.send({ t: 'newPuzzle', puzzle: { image: { kind: 'catalog', id: 'great-wave' }, pieces: 20, rotation: false, aspect: 1.5 } });
    const next = await reset;
    expect(next.puzzle.title).toBe('The Great Wave off Kanagawa');
    b.c.close();
    c.c.close();
  });

  it('rejects unknown rooms and full rooms with clear errors', async () => {
    const ghost = await TestClient.connect(server.url);
    const err = ghost.waitFor('error');
    ghost.hello('ZZZZZZ', 'Ghost');
    expect((await err).code).toBe('ROOM_NOT_FOUND');
    expect((await ghost.waitForClose()).code).toBe(4004);

    const { code } = await createRoom(server.url, { capacity: 2 });
    const a = await join(code, 'A');
    const b = await join(code, 'B');
    const third = await TestClient.connect(server.url);
    const full = third.waitFor('error');
    third.hello(code, 'C');
    expect((await full).code).toBe('ROOM_FULL');
    a.c.close();
    b.c.close();
  });

  it('survives malformed and out-of-bounds messages', async () => {
    const { code } = await createRoom(server.url);
    const a = await join(code, 'A');
    const errors = a.c.waitFor('error', (m) => m.code === 'BAD_REQUEST');
    a.c.ws.send('not json');
    a.c.send({ t: 'move', g: 'x' } as Record<string, unknown>);
    a.c.send({ t: 'drop', g: 1, x: Infinity });
    await errors;
    const g = modelFrom(a.welcome).groupOf(0).id;
    a.c.send({ t: 'grab', g });
    await a.c.waitFor('held');
    // A drop far outside the table is refused and the true state is returned.
    const refused = a.c.waitFor('update', (m) => m.op === 3);
    a.c.send({ t: 'drop', g, x: 900000, y: 0, r: 0, snap: 'normal', op: 3 });
    const res = await refused;
    expect(res.reason).toBe('release');
    expect(a.c.closed).toBeNull();
    a.c.close();
  });

  it('completes the puzzle and reports contributions', async () => {
    const { code } = await createRoom(server.url, { pieces: 6 });
    const a = await join(code, 'A');
    const b = await join(code, 'B');
    const model = modelFrom(a.welcome);
    const complete = b.c.waitFor('complete', () => true, 5000);
    const pieces = model.pieceCount;
    for (let p = 0; p < pieces; p++) {
      const player = p % 2 === 0 ? a : b;
      const g = model.groupOf(p);
      if (g.locked) continue;
      const held = player.c.waitFor('held', (m) => m.g === g.id);
      player.c.send({ t: 'grab', g: g.id });
      await held;
      const upd = player.c.waitFor('update', (m) => m.op === p + 100);
      player.c.send({ t: 'drop', g: g.id, x: 1, y: -1, r: 0, snap: 'normal', op: p + 100 });
      const res = await upd;
      model.applyChanges(res.groups.map(fromWire), res.removed);
    }
    const done = await complete;
    expect(done.completion.contributions.reduce((s, c) => s + c.placed, 0)).toBe(pieces);
    // Nothing can be grabbed after completion.
    const denied = a.c.waitFor('denied');
    a.c.send({ t: 'grab', g: model.groupOf(0).id });
    await denied;
    a.c.close();
    b.c.close();
  });

  it('restores rooms after a server restart', async () => {
    const { code, hostKey } = await createRoom(server.url);
    const a = await join(code, 'Alice', { hostKey });
    const g = modelFrom(a.welcome).groupOf(4).id;
    a.c.send({ t: 'grab', g });
    await a.c.waitFor('held');
    const ack = a.c.waitFor('update', (m) => m.op === 9);
    a.c.send({ t: 'drop', g, x: 3333, y: 4444, r: 0, snap: 'normal', op: 9 });
    await ack;

    const dataDir = server.dataDir;
    const closed = a.c.waitForClose();
    await server.stop();
    expect((await closed).code).toBe(1012);

    server = await launch(dataDir, { reconnectGraceMs: 1500 });
    const again = await join(code, 'Alice', { resume: { playerId: a.welcome.you.id, token: a.welcome.you.token } });
    expect(again.welcome.you.id).toBe(a.welcome.you.id);
    const restored = again.welcome.groups.find((w) => w.i === g)!;
    expect([restored.x, restored.y]).toEqual([3333, 4444]);
    again.c.close();
  });

  it('rejects WebSocket connections from foreign origins', async () => {
    await expect(TestClient.connect(server.url, { Origin: 'https://evil.example' })).rejects.toThrow();
  });
});

describe('uploads', () => {
  it('accepts a real image and serves the processed version', async () => {
    const png = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#3a7' } }).png().toBuffer();
    const res = await fetch(`${server.url}/api/uploads`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: png });
    expect(res.status).toBe(201);
    const meta = (await res.json()) as { id: string; width: number; height: number };
    expect(meta).toMatchObject({ width: 900, height: 600 });
    const img = await fetch(`${server.url}/api/images/${meta.id}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/webp');
    // The uploaded image can be used for a room.
    const room = await createRoom(server.url, { image: { kind: 'upload', id: meta.id }, pieces: 24 });
    expect(room.code).toHaveLength(6);
  });

  it('rejects non-images, tiny images and oversized bodies', async () => {
    const junk = await fetch(`${server.url}/api/uploads`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: Buffer.from('hello world') });
    expect(junk.status).toBe(400);
    const tiny = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#000' } }).png().toBuffer();
    expect((await fetch(`${server.url}/api/uploads`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: tiny })).status).toBe(400);
    const huge = Buffer.alloc(16 * 1024 * 1024, 1);
    const big = await fetch(`${server.url}/api/uploads`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: huge });
    expect(big.status).toBe(413);
    expect((await fetch(`${server.url}/api/images/../../etc/passwd`)).status).toBe(404);
  });
});
