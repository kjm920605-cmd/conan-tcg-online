import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { AlphaAccess } from '../src/server/access.ts';
import { createProductionServer } from '../src/server/production.ts';
import type { ProductionSettings } from '../src/server/config.ts';
import { MemoryStore } from '../src/server/persistence/memory.ts';
import type { SessionRecord } from '../src/server/persistence/model.ts';
import type { ClientMessage, ServerMessage } from '../packages/protocol/index.ts';
import { fixture } from './fixtures.ts';

// Synthetic credentials and actual loopback WebSockets; no external service or fake transport.
const settings: ProductionSettings = { webPublicUrl: 'https://web.example.com', gameServerPublicUrl: 'wss://game.example.net/ws',
  allowedOrigins: ['https://web.example.com'], sessionSecret: 'synthetic-expiry-signing-'.repeat(4),
  alphaAccessSecret: 'synthetic-expiry-access-'.repeat(4), trustProxy: false, alphaTtlSeconds: 300, alphaTransport: 'TICKET' };
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean) {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await sleep(5); }
  assert.fail('WebSocket expiry condition timed out');
}
function nearExpiryCookie() {
  const cookie = new AlphaAccess(settings, () => Date.now() - 297000).issueCookie().split(';')[0]!;
  return { cookie, expiresAt: Number(cookie.split('.')[1]) * 1000 };
}
async function start(store = new MemoryStore()) {
  const data = fixture();
  return createProductionServer({ config: settings, content: data.content, matchOptions: () => data.options,
    store, ready: async () => {}, host: '127.0.0.1', port: 0, staticRoot: new URL('../dist/', import.meta.url) });
}
async function peer(port: number, cookie: string) {
  const ticket = new AlphaAccess(settings).issueSocketTicket(cookie); assert(ticket);
  const messages: ServerMessage[] = [];
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, ['conan-alpha.v1', ticket], { origin: settings.webPublicUrl });
  socket.on('error', () => {});
  socket.on('message', data => messages.push(JSON.parse(data.toString())));
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  async function wait<T extends ServerMessage['type']>(type: T) {
    await until(() => messages.some(message => message.type === type));
    return messages.splice(messages.findIndex(message => message.type === type), 1)[0] as ServerMessage & { type: T };
  }
  return { socket, messages, wait, send: (message: ClientMessage) => socket.send(JSON.stringify(message)) };
}

test('idle ticket socket stops receiving gameplay at alpha expiry and can resume with fresh admission', async () => {
  const app = await start(), near = nearExpiryCookie(), access = new AlphaAccess(settings);
  const sockets: WebSocket[] = [];
  try {
    const a = await peer(app.port, near.cookie); sockets.push(a.socket);
    const original = await a.wait('SESSION');
    const b = await peer(app.port, access.issueCookie().split(';')[0]!); sockets.push(b.socket); await b.wait('SESSION');
    a.send({ type: 'CREATE_ROOM' }); const room = (await a.wait('ROOM_STATE')).room;
    b.send({ type: 'JOIN_ROOM', roomCode: room.roomCode }); await b.wait('ROOM_STATE');
    a.send({ type: 'READY' }); b.send({ type: 'READY' });
    const initial = (await a.wait('MATCH_STARTED')).packet; await b.wait('MATCH_STARTED');
    assert.equal(initial.decision!.playerId, 'A');
    a.send({ type: 'MULLIGAN', commandId: 'expiry-first', matchId: initial.matchId, expectedVersion: 0,
      payload: { kind: 'MULLIGAN', choiceId: initial.decision!.id, cardIds: [] } });
    await a.wait('COMMAND_ACCEPTED'); await a.wait('GAME_VIEW');
    const next = (await b.wait('GAME_VIEW')).packet;
    assert.equal(next.decision!.playerId, 'B');
    await sleep(Math.max(0, near.expiresAt - Date.now() + 150));
    assert.equal(access.verifyCookie(near.cookie), false);
    // The expired player sends nothing: server-to-client publication must enforce expiry itself.
    b.send({ type: 'MULLIGAN', commandId: 'expiry-second', matchId: next.matchId, expectedVersion: 1,
      payload: { kind: 'MULLIGAN', choiceId: next.decision!.id, cardIds: [] } });
    await b.wait('COMMAND_ACCEPTED'); await b.wait('GAME_VIEW'); await sleep(50);
    assert.equal(a.messages.some(message => message.type === 'GAME_VIEW' && message.packet.stateVersion === 2), false,
      'Expired idle socket must not receive the opponent-triggered GAME_VIEW');
    await until(() => a.socket.readyState === WebSocket.CLOSED);

    const resumed = await peer(app.port, access.issueCookie().split(';')[0]!); sockets.push(resumed.socket); await resumed.wait('SESSION');
    resumed.send({ type: 'RESUME_MATCH', playerSessionId: original.playerSessionId, resumeToken: original.resumeToken });
    const restored = (await resumed.wait('RESYNC_STATE')).packet;
    assert.equal(restored.matchId, initial.matchId); assert.equal(restored.stateVersion, 2); assert.equal(restored.view.viewerId, 'A');
  } finally { for (const socket of sockets) socket.terminate(); await app.close(); }
});

test('session database completion cannot publish SESSION after its ticket alpha lifetime expired', async () => {
  let release!: () => void, began = false;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  class DelayedSessionStore extends MemoryStore {
    override async createSession(record: SessionRecord) { began = true; await blocked; return super.createSession(record); }
  }
  const app = await start(new DelayedSessionStore()), near = nearExpiryCookie();
  let connection: Awaited<ReturnType<typeof peer>> | undefined;
  try {
    connection = await peer(app.port, near.cookie); await until(() => began);
    await sleep(Math.max(0, near.expiresAt - Date.now() + 150));
    assert.equal(new AlphaAccess(settings).verifyCookie(near.cookie), false);
    release(); await app.manager.idle(); await sleep(50);
    assert.equal(connection.messages.some(message => message.type === 'SESSION'), false,
      'A delayed DB result must not publish a new resume credential to an expired connection');
    await until(() => connection!.socket.readyState === WebSocket.CLOSED);
  } finally { release(); connection?.socket.terminate(); await app.close(); }
});
