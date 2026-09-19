import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresStore } from '../../src/server/persistence/postgres.ts';
import { fixture } from '../fixtures.ts';
import { MatchManager, digest } from '../../src/server/match.ts';

test('real PostgreSQL transaction persists snapshot + command + version atomically and enforces uniqueness', async () => {
  assert(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL must name a dedicated PostgreSQL test database');
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const store = new PostgresStore({ connectionString: process.env.TEST_DATABASE_URL, schema });
  try {
    await store.migrate(); const now = new Date();
    const session = { id: randomUUID(), resumeTokenHash: digest('test-secret'), createdAt: now, lastSeenAt: now };
    await store.createSession(session);
    const room = { id: randomUUID(), code: 'DBTEST01', playerAId: session.id, playerBId: null, readyA: false, readyB: false,
      deckA: 'Fixture Deck A' as const, deckB: 'Fixture Deck B' as const, status: 'WAITING' as const, matchId: null, createdAt: now, updatedAt: now };
    const { content, options } = fixture(); const match = MatchManager.create(options, room.id, content);
    const stored = match.stored(); await store.saveRoom({ room: { ...room, matchId: stored.match.id, status: 'PLAYING' }, newMatch: stored });
    const state = match.engine.getState(); const message = { type: 'MULLIGAN' as const, commandId: 'durable-one', matchId: state.matchId, expectedVersion: 0,
      payload: { kind: 'MULLIGAN' as const, choiceId: state.choice!.id, cardIds: [] } };
    const prepared = match.prepare(state.choice!.playerId, message); assert(prepared.draft);
    const next = match.stored(prepared.draft, 1);
    const input = { ...next, expectedVersion: 0, command: { ...message, playerId: state.choice!.playerId, resultVersion: 1,
      fingerprint: digest('fixture-envelope'), resultStatus: 'ACCEPTED' as const, createdAt: now } };
    await store.commitGameplay(input);
    assert.deepEqual(await store.loadMatch(state.matchId), next);
    assert.equal((await store.getCommand(state.matchId, message.commandId))!.resultVersion, 1);
    await assert.rejects(store.commitGameplay(input));
    assert.deepEqual(await store.loadMatch(state.matchId), next);
    const raw = await store.pool.query('SELECT * FROM "player_sessions"');
    assert.equal(raw.rows[0].resume_token_hash, digest('test-secret')); assert(!JSON.stringify(raw.rows).includes('test-secret'));
  } finally { await store.pool.query(`DROP SCHEMA "${schema}" CASCADE`); await store.close(); }
});
