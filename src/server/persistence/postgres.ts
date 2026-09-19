import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, desc, eq, or } from 'drizzle-orm';
import { persistenceSchema } from './schema.ts';
import { PersistenceError, roomStatus } from './model.ts';
import type { MatchStore, SessionRecord, RoomCommit, GameplayCommit } from './model.ts';

export class PostgresStore implements MatchStore {
  readonly pool: Pool;
  readonly schemaName: string;
  private tables: ReturnType<typeof persistenceSchema>;
  private db: ReturnType<typeof drizzle>;
  constructor(options: { connectionString: string; schema?: string }) {
    this.schemaName = options.schema ?? 'public'; this.tables = persistenceSchema(this.schemaName);
    this.pool = new Pool({ connectionString: options.connectionString, options: `-c search_path=${this.schemaName}`, max: 4,
      connectionTimeoutMillis: 2000, query_timeout: 5000, statement_timeout: 5000 });
    // Idle-connection failures surface on subsequent operations; EventEmitter must not terminate the server.
    this.pool.on('error', () => {});
    this.db = drizzle(this.pool);
  }
  async migrate() {
    const migration = await readFile(new URL('../../../db/migrations/0001_persistent_matches.sql', import.meta.url), 'utf8');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${this.schemaName}"`);
      await client.query(`SET LOCAL search_path = "${this.schemaName}"`);
      await client.query('CREATE TABLE IF NOT EXISTS _migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
      const applied = await client.query('SELECT id FROM _migrations WHERE id = $1', ['0001_persistent_matches']);
      if (!applied.rowCount) { await client.query(migration); await client.query('INSERT INTO _migrations(id) VALUES ($1)', ['0001_persistent_matches']); }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async close() { await this.pool.end(); }
  /** Readiness verifies connectivity and the version-controlled schema, without reading match data. */
  async ready() {
    const result = await this.pool.query("SELECT EXISTS (SELECT 1 FROM _migrations WHERE id = '0001_persistent_matches') AS migrated, to_regclass('player_sessions') IS NOT NULL AND to_regclass('rooms') IS NOT NULL AND to_regclass('matches') IS NOT NULL AND to_regclass('match_snapshots') IS NOT NULL AND to_regclass('match_commands') IS NOT NULL AS tables_ready");
    if (!result.rows[0]?.migrated || !result.rows[0]?.tables_ready) throw new PersistenceError('DATABASE_UNAVAILABLE');
  }
  async createSession(record: SessionRecord) { await this.db.insert(this.tables.sessions).values(record); }
  async getSession(id: string) { return (await this.db.select().from(this.tables.sessions).where(eq(this.tables.sessions.id, id)))[0] ?? null; }
  async touchSession(id: string, at: Date) { await this.db.update(this.tables.sessions).set({ lastSeenAt: at }).where(eq(this.tables.sessions.id, id)); }
  async deleteSession(id: string) { await this.db.delete(this.tables.sessions).where(eq(this.tables.sessions.id, id)); }
  async getRoomByCode(code: string) { return (await this.db.select().from(this.tables.rooms).where(eq(this.tables.rooms.code, code)))[0] ?? null; }
  async getRoomBySession(id: string) {
    const t = this.tables.rooms;
    return (await this.db.select().from(t).where(or(eq(t.playerAId, id), eq(t.playerBId, id))))[0] ?? null;
  }
  async saveRoom(input: RoomCommit) {
    const t = this.tables;
    await this.db.transaction(async tx => {
      if (input.newSession) await tx.insert(t.sessions).values(input.newSession);
      await tx.insert(t.rooms).values(input.room).onConflictDoUpdate({ target: t.rooms.id, set: input.room });
      if (input.newMatch) {
        await tx.insert(t.matches).values(input.newMatch.match);
        await tx.insert(t.snapshots).values(input.newMatch.snapshot);
      }
      if (input.deleteSessionId) await tx.delete(t.sessions).where(eq(t.sessions.id, input.deleteSessionId));
    });
  }
  async loadMatch(id: string) {
    const t = this.tables;
    const match = (await this.db.select().from(t.matches).where(eq(t.matches.id, id)))[0];
    if (!match) return null;
    const snapshot = (await this.db.select().from(t.snapshots).where(eq(t.snapshots.matchId, id)).orderBy(desc(t.snapshots.stateVersion)).limit(1))[0] ?? null;
    return { match, snapshot };
  }
  async getCommand(matchId: string, commandId: string) {
    const t = this.tables.commands;
    return (await this.db.select().from(t).where(and(eq(t.matchId, matchId), eq(t.commandId, commandId))))[0] ?? null;
  }
  async commitGameplay(input: GameplayCommit) {
    const t = this.tables;
    if (input.match.stateVersion !== input.expectedVersion + 1 || input.snapshot.stateVersion !== input.match.stateVersion || input.snapshot.matchId !== input.match.id) throw new PersistenceError('PERSISTENCE_CONFLICT');
    await this.db.transaction(async tx => {
      const updated = await tx.update(t.matches).set(input.match)
        .where(and(eq(t.matches.id, input.match.id), eq(t.matches.stateVersion, input.expectedVersion))).returning({ id: t.matches.id });
      if (updated.length !== 1) throw new PersistenceError('PERSISTENCE_CONFLICT');
      await tx.insert(t.commands).values(input.command);
      await tx.insert(t.snapshots).values(input.snapshot);
      await tx.update(t.rooms).set({ status: roomStatus(input.match.status), updatedAt: input.match.updatedAt }).where(eq(t.rooms.id, input.match.roomId));
    });
  }
}
