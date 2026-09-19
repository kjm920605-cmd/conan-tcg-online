import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/server/persistence/memory.ts';
import type { GameplayCommit, SessionRecord } from '../src/server/persistence/model.ts';
import { fixture } from './fixtures.ts';
import { connect, online } from './online-fixtures.ts';
import { createGameServer } from '../src/server/index.ts';
import { OnlineGameClient } from '../src/client/OnlineGameClient.ts';
import { orderedRng } from './online-fixtures.ts';

test('failed initial session persistence closes the socket and a new connection can recover', async () => {
  class FailOnce extends MemoryStore {
    fail = true;
    override async createSession(s: SessionRecord) { if (this.fail) { this.fail = false; throw new Error('offline'); } await super.createSession(s); }
  }
  const { content } = fixture(), server = await createGameServer({ content, store: new FailOnce(), port: 0 });
  const bad = await connect(server.port);
  try {
    assert.equal((await bad.wait('COMMAND_REJECTED')).code, 'PERSISTENCE_ERROR');
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(bad.ws.readyState, bad.ws.CLOSED);
    const recovered = await connect(server.port);
    try { await recovered.wait('SESSION'); recovered.send({ type: 'CREATE_ROOM' }); await recovered.wait('ROOM_STATE'); }
    finally { recovered.ws.terminate(); }
  } finally { bad.ws.terminate(); await server.close(); }
});

test('no accepted receipt, view or runtime mutation is visible before durable commit', async () => {
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>(resolve => release = resolve), started = new Promise<void>(resolve => entered = resolve);
  class Delayed extends MemoryStore { override async commitGameplay(input: GameplayCommit) { entered(); await blocked; await super.commitGameplay(input); } }
  const { content, options } = fixture(), game = await online({ content, matchOptions: () => options, store: new Delayed() });
  try {
    const actor = game.actor() as 'A' | 'B', packet = game.packets[actor]!;
    const before = game.server.manager.inspectMatch(packet.matchId);
    const command = game.submit({ kind: 'MULLIGAN', choiceId: packet.decision!.id, cardIds: [] });
    await started;
    assert.deepEqual(game.server.manager.inspectMatch(packet.matchId), before);
    for (const p of Object.values(game.peers)) assert(!p.messages.some(m => m.type === 'COMMAND_ACCEPTED' || m.type === 'GAME_VIEW'));
    release(); await command; assert.equal(game.packets[actor]!.stateVersion, 1);
  } finally { release(); await game.close(); }
});

for (const committed of [false, true]) test(`persistence failure ${committed ? 'after uncertain commit' : 'before commit'} evicts authority and recovers durable receipt/state`, async () => {
  class Failure extends MemoryStore {
    fail = true;
    override async commitGameplay(input: GameplayCommit) {
      if (!this.fail) return super.commitGameplay(input);
      this.fail = false; if (committed) await super.commitGameplay(input); throw new Error('connection lost');
    }
  }
  const store = new Failure(), { content, options } = fixture();
  const game = await online({ content, matchOptions: () => options, store });
  try {
    const actor = game.actor() as 'A' | 'B', peer = game.peers[actor], packet = game.packets[actor]!;
    const before = game.server.manager.inspectMatch(packet.matchId);
    const command = { type: 'MULLIGAN' as const, commandId: 'uncertain', matchId: packet.matchId, expectedVersion: 0,
      payload: { kind: 'MULLIGAN' as const, choiceId: packet.decision!.id, cardIds: [packet.decision!.candidates[0]!.id] } };
    peer.send(command); assert.equal((await peer.wait('COMMAND_REJECTED')).code, 'PERSISTENCE_ERROR');
    assert.equal(game.server.manager.inspectMatch(packet.matchId), null);
    for (const p of Object.values(game.peers)) assert(!p.messages.some(m => m.type === 'COMMAND_ACCEPTED' || m.type === 'GAME_VIEW'));
    peer.send({ type: 'RESYNC', matchId: packet.matchId });
    const recovered = (await peer.wait('RESYNC_STATE')).packet;
    assert.equal(recovered.stateVersion, committed ? 1 : 0);
    if (!committed) assert.deepEqual(game.server.manager.inspectMatch(packet.matchId), before);
    const durable = await store.loadMatch(packet.matchId);
    peer.send(command); assert.equal((await peer.wait('COMMAND_ACCEPTED')).duplicate, committed);
    if (committed) assert.deepEqual(await store.loadMatch(packet.matchId), durable);
    else assert.equal((await store.loadMatch(packet.matchId))!.match.stateVersion, 1);
  } finally { await game.close(); }
});

test('online client can retry a failed lazy restore using its original resume credentials', async () => {
  class Unavailable extends MemoryStore {
    unavailable = false;
    override async loadMatch(id: string) { if (this.unavailable) throw new Error('DB offline'); return super.loadMatch(id); }
  }
  const store = new Unavailable(), { content, options } = fixture();
  const game = await online({ content, matchOptions: () => options, store });
  const original = game.credentials.A; await game.close(); store.unavailable = true;
  const server = await createGameServer({ content, store, rng: orderedRng, port: 0 });
  const client = new OnlineGameClient(`ws://127.0.0.1:${server.port}`, { credentials: { playerSessionId: original.playerSessionId, resumeToken: original.resumeToken } });
  async function until(predicate: () => boolean) {
    for (let n = 0; n < 200; n++) { if (predicate()) return; await new Promise(r => setTimeout(r, 10)); }
    assert.fail('client recovery timed out');
  }
  try {
    client.connect(); await until(() => !!client.getLobbySnapshot().error);
    assert.equal(client.getLobbySnapshot().connection, 'DISCONNECTED');
    store.unavailable = false; client.connect(); await until(() => !!client.getSnapshot().view);
    assert.equal(client.getSnapshot().view!.viewerId, 'A'); assert.equal(client.getLobbySnapshot().hasSession, true);
  } finally { client.dispose(); await server.close(); }
});
