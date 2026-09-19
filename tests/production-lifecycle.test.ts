import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import WebSocket from 'ws';
import { createProductionServer } from '../src/server/production.ts';
import { AlphaAccess } from '../src/server/access.ts';
import type { ProductionSettings } from '../src/server/config.ts';
import { MemoryStore } from '../src/server/persistence/memory.ts';
import type { SessionRecord } from '../src/server/persistence/model.ts';
import type { ServerMessage } from '../packages/protocol/index.ts';
import { fixture } from './fixtures.ts';

const settings: ProductionSettings = { webPublicUrl: 'https://lifecycle.example.test', gameServerPublicUrl: 'wss://lifecycle.example.test/ws',
  allowedOrigins: ['https://lifecycle.example.test'], sessionSecret: 'synthetic-signing-'.repeat(4), alphaAccessSecret: 'synthetic-access-'.repeat(4),
  trustProxy: true, alphaTtlSeconds: 3600 };
const cookie = new AlphaAccess(settings).issueCookie().split(';')[0]!;
const source = (index: number) => `198.51.${Math.floor(index / 250)}.${index % 250 + 1}`;
const gate = () => { let release!: () => void; const blocked = new Promise<void>(resolve => release = resolve); return { blocked, release }; };
async function until(predicate: () => boolean) {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('Lifecycle condition timed out');
}
async function start(store: MemoryStore) {
  let closed = 0;
  const app = await createProductionServer({ content: fixture().content, port: 0, host: '127.0.0.1', config: settings,
    staticRoot: new URL('../dist/', import.meta.url), ready: async () => {}, store,
    logger: (_level, event) => { if (event === 'connection.closed') closed++; } });
  return { ...app, closed: () => closed };
}
async function upgrade(port: number, index: number) {
  const messages: ServerMessage[] = [];
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: settings.webPublicUrl,
    headers: { Cookie: cookie, 'X-Forwarded-For': source(index) } });
  socket.on('message', data => messages.push(JSON.parse(data.toString())));
  const status = await new Promise<number>((resolve, reject) => {
    socket.once('open', () => resolve(101)); socket.on('error', reject);
    socket.once('unexpected-response', (_request, response) => { response.resume(); resolve(response.statusCode!); socket.terminate(); });
  });
  async function wait<T extends ServerMessage['type']>(type: T) {
    await until(() => messages.some(message => message.type === type));
    return messages.splice(messages.findIndex(message => message.type === type), 1)[0] as Extract<ServerMessage, { type: T }>;
  }
  return { socket, status, wait };
}
async function churn(app: Awaited<ReturnType<typeof start>>, attempts: number, offset = 0) {
  let accepted = 0, rejected = 0;
  const initialClosed = app.closed();
  for (let i = 0; i < attempts; i++) {
    const peer = await upgrade(app.port, offset + i);
    if (peer.status === 101) {
      accepted++;
      const closed = new Promise<void>(resolve => peer.socket.once('close', () => resolve()));
      peer.socket.terminate(); await closed;
    } else { assert.equal(peer.status, 429); rejected++; }
  }
  await until(() => app.closed() === initialClosed + accepted);
  return { accepted, rejected };
}

test('production reserves connect and cleanup before upgrade while the session store stalls, then recovers', async () => {
  const pause = gate(); let sessions = 0, cleanups = 0;
  class PausedStore extends MemoryStore {
    override async createSession(record: SessionRecord) { sessions++; await pause.blocked; return super.createSession(record); }
    override async getRoomBySession(id: string) { cleanups++; return super.getRoomBySession(id); }
  }
  const app = await start(new PausedStore());
  try {
    const result = await churn(app, 300);
    assert.deepEqual(result, { accepted: 128, rejected: 172 });
    assert.equal(sessions, 1, 'Only the first database session job may start while blocked');
    pause.release(); await app.manager.idle();
    assert.equal(sessions, 128, 'Rejected upgrades must never create PlayerSessions');
    assert.equal(cleanups, 128, 'Every admitted connection retains ordered disconnect cleanup');
    const recovered = await upgrade(app.port, 500);
    try {
      assert.equal(recovered.status, 101); await recovered.wait('SESSION');
      recovered.socket.send(JSON.stringify({ type: 'CREATE_ROOM' })); await recovered.wait('ROOM_STATE');
    } finally { recovered.socket.terminate(); }
  } finally { pause.release(); await app.close(); }
});

test('production shares lifecycle admission with queued gameplay and rejects overflow before execution', async () => {
  const pause = gate(); let blocked = false, reads = 0, sessions = 0;
  class PausedStore extends MemoryStore {
    override async createSession(record: SessionRecord) { sessions++; return super.createSession(record); }
    override async getRoomBySession(id: string) { reads++; if (blocked) await pause.blocked; return super.getRoomBySession(id); }
  }
  const app = await start(new PausedStore()), peers: Awaited<ReturnType<typeof upgrade>>[] = [];
  try {
    for (let i = 0; i < 4; i++) { const peer = await upgrade(app.port, i); peers.push(peer); await peer.wait('SESSION'); }
    blocked = true;
    for (const peer of peers) {
      for (let i = 0; i < 8; i++) peer.socket.send(JSON.stringify({ type: 'RESYNC', matchId: 'unavailable' }));
      const pong = new Promise<void>(resolve => peer.socket.once('pong', () => resolve()));
      peer.socket.ping(); await pong; // Ordered round trip confirms preceding frames reached the server.
    }
    await until(() => reads === 1);
    // Four active cleanup reservations + 32 commands leave room for 110 two-slot admissions.
    assert.deepEqual(await churn(app, 120, 20), { accepted: 110, rejected: 10 });
    peers[0]!.socket.send(JSON.stringify({ type: 'RESYNC', matchId: 'overflow' }));
    assert.equal((await peers[0]!.wait('COMMAND_REJECTED')).code, 'RATE_LIMITED');
    assert.equal(sessions, 4);
    pause.release(); await app.manager.idle();
    assert.equal(sessions, 114); assert.equal(reads, 32 + 110);
  } finally { pause.release(); for (const peer of peers) peer.socket.terminate(); await app.close(); }
});

test('production retains cleanup capacity after socket close and shutdown waits for the admitted work', async () => {
  const pause = gate(); let sessions = 0, cleanups = 0;
  class PausedCleanup extends MemoryStore {
    override async createSession(record: SessionRecord) { sessions++; return super.createSession(record); }
    override async getRoomBySession(id: string) { cleanups++; await pause.blocked; return super.getRoomBySession(id); }
  }
  const app = await start(new PausedCleanup()); let closing: Promise<void> | undefined;
  try {
    assert.deepEqual(await churn(app, 300), { accepted: 128, rejected: 172 });
    assert.equal(sessions, 1); assert.equal(cleanups, 1);
    let drained = false;
    closing = app.close().then(() => { drained = true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(drained, false);
    pause.release(); await closing;
    assert.equal(sessions, 128); assert.equal(cleanups, 128);
  } finally { pause.release(); await (closing ?? app.close()); }
});

test('invalid WebSocket handshakes release admission without creating PlayerSessions', async () => {
  let sessions = 0;
  class ObservedStore extends MemoryStore {
    override async createSession(record: SessionRecord) { sessions++; return super.createSession(record); }
  }
  const app = await start(new ObservedStore());
  try {
    for (let i = 0; i < 140; i++) {
      const status = await new Promise<number>((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port: app.port, path: '/ws', headers: { Origin: settings.webPublicUrl,
          Cookie: cookie, 'X-Forwarded-For': source(i), Connection: 'Upgrade', Upgrade: 'websocket',
          'Sec-WebSocket-Version': '12', 'Sec-WebSocket-Key': Buffer.alloc(16).toString('base64') } }, response => {
          response.resume(); response.once('end', () => resolve(response.statusCode!));
        });
        req.on('error', reject); req.end();
      });
      assert.equal(status, 400);
    }
    assert.equal(sessions, 0);
    const recovered = await upgrade(app.port, 500);
    try { assert.equal(recovered.status, 101); await recovered.wait('SESSION'); }
    finally { recovered.socket.terminate(); }
  } finally { await app.close(); }
});
