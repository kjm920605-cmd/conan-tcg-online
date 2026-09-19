import { pgSchema, pgTable, text, timestamp, boolean, bigint, jsonb, primaryKey, unique } from 'drizzle-orm/pg-core';
import type { PgTableFn } from 'drizzle-orm/pg-core';
import type { RoomRecord, MatchRecord, CommandRecord } from './model.ts';

/** Schema name is host configuration; never supplied by network players. */
export function persistenceSchema(name = 'public') {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error('INVALID_DATABASE_SCHEMA');
  const table: PgTableFn<string | undefined> = name === 'public' ? pgTable : pgSchema(name).table;
  const sessions = table('player_sessions', {
    id: text('id').primaryKey(), resumeTokenHash: text('resume_token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(), lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  });
  const rooms = table('rooms', {
    id: text('id').primaryKey(), code: text('code').notNull().unique(),
    playerAId: text('player_a_id').references(() => sessions.id), playerBId: text('player_b_id').references(() => sessions.id),
    readyA: boolean('ready_a').notNull(), readyB: boolean('ready_b').notNull(),
    deckA: text('deck_a').$type<RoomRecord['deckA']>().notNull(), deckB: text('deck_b').$type<RoomRecord['deckB']>().notNull(),
    matchId: text('match_id').unique(), status: text('status').$type<RoomRecord['status']>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  });
  const matches = table('matches', {
    id: text('id').primaryKey(), roomId: text('room_id').notNull().unique().references(() => rooms.id),
    status: text('status').$type<MatchRecord['status']>().notNull(), stateVersion: bigint('state_version', { mode: 'number' }).notNull(),
    rulesetVersion: text('ruleset_version').notNull(), engineVersion: text('engine_version').notNull(), cardDataVersion: text('card_data_version').notNull(),
    outcome: jsonb('outcome').$type<MatchRecord['outcome']>(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(), finishedAt: timestamp('finished_at', { withTimezone: true }),
  });
  const snapshots = table('match_snapshots', {
    matchId: text('match_id').notNull().references(() => matches.id), stateVersion: bigint('state_version', { mode: 'number' }).notNull(),
    serializedState: text('serialized_state').notNull(), integrityHash: text('integrity_hash').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  }, t => [primaryKey({ columns: [t.matchId, t.stateVersion] })]);
  const commands = table('match_commands', {
    matchId: text('match_id').notNull().references(() => matches.id), commandId: text('command_id').notNull(), playerId: text('player_id').notNull(),
    expectedVersion: bigint('expected_version', { mode: 'number' }).notNull(), resultVersion: bigint('result_version', { mode: 'number' }).notNull(),
    type: text('command_type').$type<CommandRecord['type']>().notNull(), payload: jsonb('payload').$type<CommandRecord['payload']>().notNull(),
    fingerprint: text('fingerprint').notNull(), resultStatus: text('result_status').$type<CommandRecord['resultStatus']>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  }, t => [primaryKey({ columns: [t.matchId, t.commandId] }), unique().on(t.matchId, t.resultVersion)]);
  return { sessions, rooms, matches, snapshots, commands };
}
