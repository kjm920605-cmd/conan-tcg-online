import type { MatchStore, SessionRecord, RoomRecord, StoredMatch, CommandRecord, RoomCommit, GameplayCommit } from './model.ts';
import { PersistenceError, roomStatus } from './model.ts';

/** Explicit ephemeral adapter for unit tests / Phase 5A development. Never a DB-failure fallback. */
export class MemoryStore implements MatchStore {
  #sessions = new Map<string, SessionRecord>();
  #rooms = new Map<string, RoomRecord>();
  #matches = new Map<string, StoredMatch>();
  #commands = new Map<string, CommandRecord>();
  async createSession(session: SessionRecord) { this.#sessions.set(session.id, structuredClone(session)); }
  async getSession(id: string) { return structuredClone(this.#sessions.get(id) ?? null); }
  async touchSession(id: string, at: Date) { const s = this.#sessions.get(id); if (s) s.lastSeenAt = at; }
  async deleteSession(id: string) { this.#sessions.delete(id); }
  async getRoomByCode(code: string) { return structuredClone([...this.#rooms.values()].find(r => r.code === code) ?? null); }
  async getRoomBySession(id: string) { return structuredClone([...this.#rooms.values()].find(r => r.playerAId === id || r.playerBId === id) ?? null); }
  async saveRoom(input: RoomCommit) {
    const copy = structuredClone(input);
    this.#rooms.set(copy.room.id, copy.room);
    if (copy.newMatch) this.#matches.set(copy.newMatch.match.id, copy.newMatch);
    if (copy.deleteSessionId) this.#sessions.delete(copy.deleteSessionId);
    if (copy.newSession) this.#sessions.set(copy.newSession.id, copy.newSession);
  }
  async loadMatch(id: string) { return structuredClone(this.#matches.get(id) ?? null); }
  async getCommand(matchId: string, commandId: string) { return structuredClone(this.#commands.get(JSON.stringify([matchId, commandId])) ?? null); }
  async commitGameplay(input: GameplayCommit) {
    const current = this.#matches.get(input.match.id);
    if (!current || current.match.stateVersion !== input.expectedVersion) throw new PersistenceError('PERSISTENCE_CONFLICT');
    const key = JSON.stringify([input.match.id, input.command.commandId]);
    if (this.#commands.has(key)) throw new PersistenceError('PERSISTENCE_CONFLICT');
    const copy = structuredClone(input);
    this.#matches.set(copy.match.id, { match: copy.match, snapshot: copy.snapshot });
    this.#commands.set(key, copy.command);
    const room = this.#rooms.get(copy.match.roomId)!;
    room.status = roomStatus(copy.match.status); room.updatedAt = copy.match.updatedAt;
  }
}
