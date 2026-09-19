import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../src/server/index.ts';
import { MemoryStore } from '../src/server/persistence/memory.ts';
import { fixture } from './fixtures.ts';
import { connect, online } from './online-fixtures.ts';

test('persistent store restores identical match, seat, decision and receipt after runtime restart', async () => {
  const store = new MemoryStore(), { content, options } = fixture();
  const game = await online({ content, matchOptions: () => options, store });
  const actor = game.actor() as 'A' | 'B';
  const command = await game.submit({ kind: 'MULLIGAN', choiceId: game.packets[actor]!.decision!.id, cardIds: [] });
  const before = game.server.manager.inspectMatch(command.matchId), packet = game.packets[actor]!;
  const credential = game.credentials[actor]; await game.close();
  const server = await createGameServer({ content, store, rng: { algorithm: 'online-ordered', next: (state, max) => ({ value: max - 1, state: state + 1 }) }, port: 0 });
  const peer = await connect(server.port);
  try {
    assert.equal(server.manager.inspectMatch(command.matchId), null);
    await peer.wait('SESSION'); peer.send({ type: 'RESUME_MATCH', playerSessionId: credential.playerSessionId, resumeToken: credential.resumeToken });
    assert.deepEqual((await peer.wait('RESYNC_STATE')).packet, packet);
    assert.deepEqual(server.manager.inspectMatch(command.matchId), before);
    peer.send(command); assert.equal((await peer.wait('COMMAND_ACCEPTED')).duplicate, true);
    assert.deepEqual(server.manager.inspectMatch(command.matchId), before);
    const session = await store.getSession(credential.playerSessionId);
    assert(session); assert.equal('token' in session, false); assert.equal('resumeToken' in session, false);
    assert(!JSON.stringify(session).includes(credential.resumeToken));
  } finally { peer.ws.terminate(); await server.close(); }
});

test('single occupied waiting room and ready flag survive restart without starting a match', async () => {
  const store = new MemoryStore(), { content } = fixture();
  let server = await createGameServer({ content, store, port: 0 });
  let peer = await connect(server.port); const credential = await peer.wait('SESSION');
  peer.send({ type: 'CREATE_ROOM' }); const room = (await peer.wait('ROOM_STATE')).room;
  peer.send({ type: 'READY' }); await peer.wait('ROOM_STATE', m => m.room.seats[0]!.ready);
  peer.ws.terminate(); await server.close(); server = await createGameServer({ content, store, port: 0 });
  peer = await connect(server.port);
  try {
    await peer.wait('SESSION'); peer.send({ type: 'RESUME_MATCH', playerSessionId: credential.playerSessionId, resumeToken: credential.resumeToken });
    const recovered = (await peer.wait('ROOM_STATE')).room;
    assert.equal(recovered.roomCode, room.roomCode); assert.equal(recovered.seats[0].ready, true);
    assert.equal(recovered.matchId, null); assert.equal(recovered.seats[1].occupied, false);
  } finally { peer.ws.terminate(); await server.close(); }
});

test('persistent session without a room explicitly completes resume', async () => {
  const store = new MemoryStore(), { content } = fixture();
  let server = await createGameServer({ content, store, port: 0 });
  let peer = await connect(server.port); const credential = await peer.wait('SESSION');
  peer.ws.terminate(); await server.close(); server = await createGameServer({ content, store, port: 0 });
  peer = await connect(server.port);
  try {
    await peer.wait('SESSION'); peer.send({ type: 'RESUME_MATCH', playerSessionId: credential.playerSessionId, resumeToken: credential.resumeToken });
    await peer.wait('SESSION_RESTORED'); peer.send({ type: 'CREATE_ROOM' });
    assert.equal((await peer.wait('ROOM_STATE')).room.seats[0].occupied, true);
  } finally { peer.ws.terminate(); await server.close(); }
});
