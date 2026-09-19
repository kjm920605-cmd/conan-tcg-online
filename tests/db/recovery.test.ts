import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresStore } from '../../src/server/persistence/postgres.ts';
import { createGameServer } from '../../src/server/index.ts';
import { digest } from '../../src/server/match.ts';
import { fixture } from '../fixtures.ts';
import { connect, online, orderedRng, mulligans, available } from '../online-fixtures.ts';
import type { PlayerPacket, RoomState } from '../../packages/protocol/index.ts';
import { coreProgram } from '../../examples/programs.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
assert(databaseUrl, 'TEST_DATABASE_URL must name a dedicated PostgreSQL test database');

const schemaName = () => `test_${randomUUID().replaceAll('-', '')}`;

async function disposeSchema(store: PostgresStore, schema: string) {
  await store.pool.query(`DROP SCHEMA "${schema}" CASCADE`);
  await store.close();
}

async function restart(schema: string, credentials: Record<'A' | 'B', { playerSessionId: string; resumeToken: string }>, content: ReturnType<typeof fixture>['content'], actors: ('A' | 'B')[] = ['A']) {
  const store = new PostgresStore({ connectionString: databaseUrl!, schema });
  const server = await createGameServer({ content, port: 0, store, rng: orderedRng });
  const peers = await Promise.all(actors.map(async actor => {
    const peer = await connect(server.port); await peer.wait('SESSION');
    peer.send({ type: 'RESUME_MATCH', playerSessionId: credentials[actor].playerSessionId, resumeToken: credentials[actor].resumeToken });
    return { actor, peer };
  }));
  return { store, server, peers };
}

test('A-only, AB-not-ready, and one-ready rooms restore their exact seats and readiness', async t => {
  for (const variant of ['A-only', 'AB-not-ready', 'one-ready'] as const) await t.test(variant, async () => {
    const schema = schemaName(), first = new PostgresStore({ connectionString: databaseUrl!, schema });
    await first.migrate(); const { content } = fixture();
    const server = await createGameServer({ content, port: 0, store: first, rng: orderedRng });
    const a = await connect(server.port), aCredential = await a.wait('SESSION');
    a.send({ type: 'CREATE_ROOM' }); const created = (await a.wait('ROOM_STATE')).room;
    let b: Awaited<ReturnType<typeof connect>> | null = null, bCredential: any = null;
    if (variant !== 'A-only') {
      b = await connect(server.port); bCredential = await b.wait('SESSION');
      b.send({ type: 'JOIN_ROOM', roomCode: created.roomCode }); await b.wait('ROOM_STATE');
      if (variant === 'one-ready') { a.send({ type: 'READY' }); await a.wait('ROOM_STATE', m => m.room.seats[0]!.ready); }
    }
    a.ws.terminate(); b?.ws.terminate(); await server.close(); await first.close();
    const credentials = { A: aCredential, B: bCredential } as any;
    const resumed = await restart(schema, credentials, content, ['A']);
    try {
      const room: RoomState = (await resumed.peers[0]!.peer.wait('ROOM_STATE')).room;
      assert.equal(room.roomCode, created.roomCode);
      assert.deepEqual(room.seats.map(s => ({ occupied: s.occupied, ready: s.ready })), variant === 'A-only'
        ? [{ occupied: true, ready: false }, { occupied: false, ready: false }]
        : variant === 'AB-not-ready'
          ? [{ occupied: true, ready: false }, { occupied: true, ready: false }]
          : [{ occupied: true, ready: true }, { occupied: true, ready: false }]);
      assert.equal(room.matchId, null);
    } finally { for (const { peer } of resumed.peers) peer.ws.terminate(); await resumed.server.close(); await disposeSchema(resumed.store, schema); }
  });
});

test('simultaneous lazy resumes restore one exact pending-decision authority', async () => {
  const schema = schemaName(), first = new PostgresStore({ connectionString: databaseUrl!, schema }); await first.migrate();
  const { content, options } = fixture(); const game = await online({ content, matchOptions: () => options, store: first, rng: orderedRng });
  const before = game.server.manager.inspectMatch(game.packets.A!.matchId)!;
  for (const peer of Object.values(game.peers)) peer.ws.terminate(); await game.server.close(); await first.close();
  const resumed = await restart(schema, game.credentials, content, ['A', 'B']);
  try {
    const packets: PlayerPacket[] = await Promise.all(resumed.peers.map(({ peer }) => peer.wait('RESYNC_STATE').then(m => m.packet)));
    assert.deepEqual(packets, [game.packets.A, game.packets.B]);
    assert.deepEqual(resumed.server.manager.inspectMatch(before.state.matchId), before);
    assert(packets.every(packet => packet.decision?.kind === 'MULLIGAN'));
  } finally { for (const { peer } of resumed.peers) peer.ws.terminate(); await resumed.server.close(); await disposeSchema(resumed.store, schema); }
});

test('active match and duplicate receipt survive restart without state, RNG, or cost changes', async () => {
  const schema = schemaName(), first = new PostgresStore({ connectionString: databaseUrl!, schema }); await first.migrate();
  const { content, options } = fixture(); const game = await online({ content, matchOptions: () => options, store: first, rng: orderedRng });
  await mulligans(game); const actor = game.actor() as 'A' | 'B', packet = game.packets[actor]!;
  const command = { type: 'GAME_COMMAND' as const, commandId: 'cross-restart-command', matchId: packet.matchId, expectedVersion: packet.stateVersion, payload: { kind: 'END_MAIN' as const } };
  game.peers[actor].send(command); const accepted = await game.peers[actor].wait('COMMAND_ACCEPTED', m => m.commandId === command.commandId);
  for (const id of ['A', 'B'] as const) game.packets[id] = (await game.peers[id].wait('GAME_VIEW', m => 'packet' in m && m.packet.stateVersion === accepted.stateVersion)).packet;
  const before = game.server.manager.inspectMatch(command.matchId)!;
  for (const peer of Object.values(game.peers)) peer.ws.terminate(); await game.server.close(); await first.close();
  const resumed = await restart(schema, game.credentials, content, [actor]);
  try {
    const restored = (await resumed.peers[0]!.peer.wait('RESYNC_STATE')).packet;
    assert.deepEqual(restored, game.packets[actor]); assert.deepEqual(resumed.server.manager.inspectMatch(command.matchId), before);
    resumed.peers[0]!.peer.send(command);
    const duplicate = await resumed.peers[0]!.peer.wait('COMMAND_ACCEPTED', m => m.commandId === command.commandId);
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.stateVersion, accepted.stateVersion);
    await resumed.peers[0]!.peer.wait('RESYNC_STATE');
    assert.deepEqual(resumed.server.manager.inspectMatch(command.matchId), before);
  } finally { resumed.peers[0]!.peer.ws.terminate(); await resumed.server.close(); await disposeSchema(resumed.store, schema); }
});

for (const column of ['engine_version', 'ruleset_version', 'card_data_version'] as const) test(`${column} mismatch rejects restore without replacing the temporary session`, async () => {
  const schema = schemaName(), first = new PostgresStore({ connectionString: databaseUrl!, schema }); await first.migrate();
  const { content, options } = fixture(); const game = await online({ content, matchOptions: () => options, store: first, rng: orderedRng });
  const matchId = game.packets.A!.matchId; for (const peer of Object.values(game.peers)) peer.ws.terminate(); await game.server.close();
  await first.pool.query(`UPDATE matches SET ${column} = 'incompatible' WHERE id = $1`, [matchId]); await first.close();
  const resumed = await restart(schema, game.credentials, content, ['A']);
  try { assert.equal((await resumed.peers[0]!.peer.wait('COMMAND_REJECTED')).code, 'VERSION_INCOMPATIBLE'); }
  finally { resumed.peers[0]!.peer.ws.terminate(); await resumed.server.close(); await disposeSchema(resumed.store, schema); }
});

for (const corruption of ['missing', 'hash', 'structure', 'outcome', 'json', 'rng'] as const) test(`${corruption} snapshot is rejected and no replacement view is published`, async () => {
  const schema = schemaName(), first = new PostgresStore({ connectionString: databaseUrl!, schema }); await first.migrate();
  const { content, options } = fixture(); const game = await online({ content, matchOptions: () => options, store: first, rng: orderedRng });
  if (corruption === 'missing') await mulligans(game);
  const matchId = game.packets.A!.matchId; for (const peer of Object.values(game.peers)) peer.ws.terminate(); await game.server.close();
  if (corruption === 'missing') {
    await first.pool.query('DELETE FROM match_snapshots WHERE match_id = $1 AND state_version = $2', [matchId, game.packets.A!.stateVersion]);
    assert((await first.pool.query('SELECT count(*)::int AS count FROM match_snapshots WHERE match_id=$1', [matchId])).rows[0].count > 0);
  }
  if (corruption === 'hash') await first.pool.query("UPDATE match_snapshots SET serialized_state = serialized_state || ' ' WHERE match_id = $1", [matchId]);
  if (['structure', 'outcome', 'json', 'rng'].includes(corruption)) {
    const raw = await first.pool.query('SELECT serialized_state FROM match_snapshots WHERE match_id = $1', [matchId]);
    const state = JSON.parse(raw.rows[0].serialized_state);
    if (corruption === 'structure') delete state.players;
    if (corruption === 'outcome') delete state.outcome;
    if (corruption === 'rng') state.rng.algorithm = 'incompatible-rng';
    const serialized = corruption === 'json' ? '{' : JSON.stringify(state);
    await first.pool.query('UPDATE match_snapshots SET serialized_state=$1, integrity_hash=$2 WHERE match_id=$3', [serialized, digest(serialized), matchId]);
  }
  await first.close(); const resumed = await restart(schema, game.credentials, content, ['A']);
  try {
    const rejection = await resumed.peers[0]!.peer.wait('COMMAND_REJECTED');
    assert.equal(rejection.code, corruption === 'missing' ? 'SNAPSHOT_MISSING' : corruption === 'hash' ? 'SNAPSHOT_CORRUPT' : corruption === 'rng' ? 'VERSION_INCOMPATIBLE' : 'SNAPSHOT_INVALID');
    assert.equal(resumed.peers[0]!.peer.messages.some(m => m.type === 'RESYNC_STATE'), false);
  } finally { resumed.peers[0]!.peer.ws.terminate(); await resumed.server.close(); await disposeSchema(resumed.store, schema); }
});

test('resume tokens are hashed at rest and an invalid token cannot restore', async () => {
  const schema = schemaName(), store = new PostgresStore({ connectionString: databaseUrl!, schema }); await store.migrate();
  const { content, options } = fixture(); const game = await online({ content, matchOptions: () => options, store, rng: orderedRng });
  const raw = await store.pool.query('SELECT id, resume_token_hash FROM player_sessions WHERE id=$1', [game.credentials.A.playerSessionId]);
  assert.equal(raw.rows[0].resume_token_hash, digest(game.credentials.A.resumeToken)); assert(!JSON.stringify(raw.rows).includes(game.credentials.A.resumeToken));
  const bad = await connect(game.server.port); await bad.wait('SESSION'); bad.send({ type: 'RESUME_MATCH', playerSessionId: game.credentials.A.playerSessionId, resumeToken: '0'.repeat(64) });
  assert.equal((await bad.wait('COMMAND_REJECTED')).code, 'INVALID_SESSION');
  bad.ws.terminate(); for (const peer of Object.values(game.peers)) peer.ws.terminate(); await game.server.close(); await disposeSchema(store, schema);
});

test('real PostgreSQL trigger failure rolls back match, snapshot, and receipt and publishes no ACK/view', async () => {
  const schema = schemaName(), store = new PostgresStore({ connectionString: databaseUrl!, schema }); await store.migrate();
  const { content, options } = fixture(); const game = await online({ content, matchOptions: () => options, store, rng: orderedRng }); await mulligans(game);
  const actor = game.actor() as 'A' | 'B', packet = game.packets[actor]!, matchId = packet.matchId;
  const before = await store.loadMatch(matchId), receiptCount = await store.pool.query('SELECT count(*)::int AS count FROM match_commands WHERE match_id=$1', [matchId]);
  await store.pool.query("CREATE FUNCTION reject_snapshot() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''forced snapshot failure''; END'");
  await store.pool.query('CREATE TRIGGER reject_snapshot BEFORE INSERT ON match_snapshots FOR EACH ROW EXECUTE FUNCTION reject_snapshot()');
  for (const peer of Object.values(game.peers)) peer.messages.splice(0);
  game.peers[actor].send({ type: 'GAME_COMMAND', commandId: 'forced-rollback', matchId, expectedVersion: packet.stateVersion, payload: { kind: 'END_MAIN' } });
  assert.equal((await game.peers[actor].wait('COMMAND_REJECTED')).code, 'PERSISTENCE_ERROR');
  assert.deepEqual(await store.loadMatch(matchId), before);
  assert.equal((await store.pool.query('SELECT count(*)::int AS count FROM match_commands WHERE match_id=$1', [matchId])).rows[0].count, receiptCount.rows[0].count);
  assert.equal(Object.values(game.peers).flatMap(p => p.messages).some(m => m.type === 'COMMAND_ACCEPTED' || m.type === 'GAME_VIEW'), false);
  for (const peer of Object.values(game.peers)) peer.ws.terminate(); await game.server.close(); await disposeSchema(store, schema);
});

for (const boundary of ['pending', 'blocked'] as const) test(`${boundary} effects and deduction continuation restore at exactly the same rule boundary`, async () => {
  const schema = schemaName(), first = new PostgresStore({ connectionString: databaseUrl!, schema }); await first.migrate();
  const { content, options } = fixture();
  content.programs.depart = coreProgram([{ op: 'REMOVE_SOURCE' }]);
  for (const d of Object.values(content.definitions)) if (d.type === 'CHARACTER') {
    d.keywords = [{ kind: 'RAPID' }]; d.triggers = [{ event: 'DEDUCTION_DECLARED', player: 'SELF', subject: 'SOURCE', programId: 'depart' }];
  }
  const game = await online({ content, matchOptions: () => options, store: first });
  await mulligans(game); await game.submit(available(game, 'PLAY_CARD'));
  const actor = game.actor(), card = game.packets[actor]!.view.players[actor]!.zones.FIELD[0]!;
  await game.submit({ kind: 'DEDUCE', cardId: card.id! });
  if (boundary === 'blocked') while (game.packets.A!.decision?.kind === 'EFFECT_ORDER') await game.submit(available(game, 'CHOOSE_EFFECT'));
  const matchId = game.packets.A!.matchId, before = game.server.manager.inspectMatch(matchId)!;
  if (boundary === 'pending') { assert.equal(before.state.choice?.kind, 'EFFECT_ORDER'); assert(before.state.pendingEffects.length > 0); assert(before.state.frames.length > 0); }
  else { assert.equal(before.state.status, 'RULE_BLOCKED'); assert.equal(before.state.blocked!.questionId, 'RULE-QUESTION-012'); }
  const durable = await first.loadMatch(matchId); await game.close(); await first.close();
  const resumed = await restart(schema, game.credentials, content, ['A', 'B']);
  try {
    for (const { actor: seat, peer } of resumed.peers) assert.deepEqual((await peer.wait('RESYNC_STATE')).packet, game.packets[seat]);
    assert.deepEqual(resumed.server.manager.inspectMatch(matchId), before); assert.deepEqual(await resumed.store.loadMatch(matchId), durable);
    if (boundary === 'blocked') {
      for (const { peer } of resumed.peers) assert.equal((await peer.wait('RULE_BLOCKED')).questionId, 'RULE-QUESTION-012');
      assert.equal(resumed.server.manager.inspectMatch(matchId)!.state.outcome, null);
    } else {
      const owner = before.state.choice!.playerId, peer = resumed.peers.find(p => p.actor === owner)!.peer;
      const intent = game.packets[owner]!.decision!.actions.find(a => a.available)!.intent;
      peer.send({ type: 'RESOLVE_DECISION', commandId: 'after-pending-restart', matchId, expectedVersion: before.stateVersion, payload: intent });
      await peer.wait('COMMAND_ACCEPTED'); await peer.wait('RULE_BLOCKED');
      assert.equal(resumed.server.manager.inspectMatch(matchId)!.state.blocked!.questionId, 'RULE-QUESTION-012');
    }
  } finally { for (const { peer } of resumed.peers) peer.ws.terminate(); await resumed.server.close(); await disposeSchema(resumed.store, schema); }
});

test('finished match restores its final snapshot, timestamps and outcome and rejects new gameplay', async () => {
  const schema = schemaName(), first = new PostgresStore({ connectionString: databaseUrl!, schema }); await first.migrate();
  const { content, options } = fixture(); const game = await online({ content, matchOptions: () => options, store: first });
  await mulligans(game);
  for (let turn = 0; turn < 40 && game.packets.A!.view.status !== 'FINISHED'; turn++) {
    await game.submit(available(game, 'DEDUCE')); if (game.server.manager.inspectMatch(game.packets.A!.matchId)!.state.status !== 'FINISHED') await game.submit({ kind: 'END_MAIN' });
  }
  assert.equal(game.packets.A!.view.status, 'FINISHED');
  const packet = game.packets.A!, durable = await first.loadMatch(packet.matchId); assert(durable!.match.finishedAt);
  await game.close(); await first.close(); const resumed = await restart(schema, game.credentials, content, ['A', 'B']);
  try {
    for (const { actor, peer } of resumed.peers) {
      assert.deepEqual((await peer.wait('RESYNC_STATE')).packet, game.packets[actor]);
      assert.deepEqual((await peer.wait('GAME_FINISHED')).outcome, durable!.match.outcome);
    }
    const peer = resumed.peers[0]!.peer;
    peer.send({ type: 'GAME_COMMAND', commandId: 'finished-restart-new', matchId: packet.matchId, expectedVersion: packet.stateVersion, payload: { kind: 'END_MAIN' } });
    assert.equal((await peer.wait('COMMAND_REJECTED')).code, 'MATCH_FINISHED'); assert.deepEqual(await resumed.store.loadMatch(packet.matchId), durable);
  } finally { for (const { peer } of resumed.peers) peer.ws.terminate(); await resumed.server.close(); await disposeSchema(resumed.store, schema); }
});

test('unavailable PostgreSQL produces structured errors while the WebSocket server keeps accepting connections', async () => {
  const store = new PostgresStore({ connectionString: 'postgresql://postgres@127.0.0.1:1/conan_tcg_test' });
  const { content } = fixture(), server = await createGameServer({ content, store, port: 0 });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const peer = await connect(server.port);
      try { assert.equal((await peer.wait('COMMAND_REJECTED')).code, 'PERSISTENCE_ERROR'); }
      finally { peer.ws.terminate(); }
    }
  } finally { await server.close(); await store.close(); }
});

test('mid-program Investigate restores effect cursor and never repeats an already completed Draw', async () => {
  const schema = schemaName(), first = new PostgresStore({ connectionString: databaseUrl!, schema }); await first.migrate();
  const { content, options } = fixture();
  content.programs.investigate = { sourceRequirements: 'FIELD_ENTRY', targetSelectionPoint: 'RESOLUTION', targetZone: 'FIELD', duration: 'INSTANT', invalidTargetBehavior: 'BLOCK',
    instructions: [{ op: 'DRAW', player: 'SELF', count: 1 }, { op: 'INVOKE_KEYWORD', keyword: 'INVESTIGATE_X' }, { op: 'DRAW', player: 'SELF', count: 2 }] };
  for (const d of Object.values(content.definitions)) if (d.type === 'CHARACTER') {
    d.keywords = [{ kind: 'INVESTIGATE_X', value: 3 }];
    d.declarations = [{ abilityId: 'investigate', programId: 'investigate', zones: ['FIELD'], timing: 'OWN_MAIN', cost: 'NONE' }];
  }
  const game = await online({ content, matchOptions: () => options, store: first });
  await mulligans(game); await game.submit(available(game, 'PLAY_CARD'));
  const actor = game.actor(), hand = game.packets[actor]!.view.players[actor]!.zones.HAND.length;
  await game.submit(available(game, 'DECLARE_ABILITY'));
  while (game.packets.A!.decision?.kind === 'EFFECT_ORDER') await game.submit(available(game, 'CHOOSE_EFFECT'));
  const matchId = game.packets.A!.matchId, before = game.server.manager.inspectMatch(matchId)!;
  assert.equal(before.state.choice?.kind, 'INVESTIGATION_ORDER');
  assert.equal(before.state.players[actor]!.zones.HAND.length, hand + 1);
  const effect = before.state.frames.find(f => f.kind === 'EFFECT'); assert(effect?.kind === 'EFFECT'); assert.equal(effect.cursor, 2);
  await game.close(); await first.close(); const resumed = await restart(schema, game.credentials, content, ['A', 'B']);
  try {
    for (const { actor: seat, peer } of resumed.peers) assert.deepEqual((await peer.wait('RESYNC_STATE')).packet, game.packets[seat]);
    assert.deepEqual(resumed.server.manager.inspectMatch(matchId), before);
    const choice = before.state.choice!; assert(choice.kind === 'INVESTIGATION_ORDER');
    const peer = resumed.peers.find(p => p.actor === choice.playerId)!.peer;
    peer.send({ type: 'RESOLVE_DECISION', commandId: 'resume-investigation', matchId, expectedVersion: before.stateVersion,
      payload: { kind: 'CHOOSE_INVESTIGATION_ORDER', choiceId: choice.id, cardIds: [...choice.candidates].reverse() } });
    await peer.wait('COMMAND_ACCEPTED'); await peer.wait('GAME_VIEW');
    const after = resumed.server.manager.inspectMatch(matchId)!;
    assert.equal(after.state.players[actor]!.zones.HAND.length, hand + 3);
    assert.equal(after.state.rng.cursor, before.state.rng.cursor);
    assert.equal(after.state.frames.length, 0); assert.equal(after.state.pendingEffects.length, 0);
  } finally { for (const { peer } of resumed.peers) peer.ws.terminate(); await resumed.server.close(); await disposeSchema(resumed.store, schema); }
});
