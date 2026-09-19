import type { ClientMessage } from '../../../packages/protocol/index.ts';
import type { GameState } from '../../game/model.ts';

export type Gameplay = Extract<ClientMessage, { commandId: string }>;
export type SessionRecord = { id: string; resumeTokenHash: string; createdAt: Date; lastSeenAt: Date };
export type RoomRecord = {
  id: string; code: string; playerAId: string | null; playerBId: string | null;
  readyA: boolean; readyB: boolean; deckA: 'Fixture Deck A'; deckB: 'Fixture Deck B';
  matchId: string | null; status: 'WAITING' | 'PLAYING' | 'RULE_BLOCKED' | 'FINISHED'; createdAt: Date; updatedAt: Date;
};
export type Versions = { engineVersion: string; rulesetVersion: string; cardDataVersion: string };
export type MatchRecord = Versions & {
  id: string; roomId: string; status: GameState['status']; stateVersion: number;
  outcome: GameState['outcome']; createdAt: Date; updatedAt: Date; finishedAt: Date | null;
};
export type SnapshotRecord = { matchId: string; stateVersion: number; serializedState: string; integrityHash: string; createdAt: Date };
export type CommandRecord = {
  matchId: string; commandId: string; playerId: string; expectedVersion: number; resultVersion: number;
  type: Gameplay['type']; payload: Gameplay['payload']; fingerprint: string; resultStatus: 'ACCEPTED'; createdAt: Date;
};
export type StoredMatch = { match: MatchRecord; snapshot: SnapshotRecord };
export type RoomCommit = { room: RoomRecord; newMatch?: StoredMatch; deleteSessionId?: string; newSession?: SessionRecord };
export type GameplayCommit = StoredMatch & { expectedVersion: number; command: CommandRecord };

/** Storage methods resolve only after their transaction has committed. Never expose this port to the browser. */
export interface MatchStore {
  createSession(session: SessionRecord): Promise<void>;
  getSession(id: string): Promise<SessionRecord | null>;
  touchSession(id: string, at: Date): Promise<void>;
  deleteSession(id: string): Promise<void>;
  getRoomByCode(code: string): Promise<RoomRecord | null>;
  getRoomBySession(id: string): Promise<RoomRecord | null>;
  saveRoom(input: RoomCommit): Promise<void>;
  loadMatch(id: string): Promise<{ match: MatchRecord; snapshot: SnapshotRecord | null } | null>;
  getCommand(matchId: string, commandId: string): Promise<CommandRecord | null>;
  commitGameplay(input: GameplayCommit): Promise<void>;
}

export class PersistenceError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
export function persistenceCode(error: unknown): string {
  return error instanceof PersistenceError ? error.code : 'PERSISTENCE_ERROR';
}
export function roomStatus(status: GameState['status']): RoomRecord['status'] {
  return status === 'SETUP' ? 'PLAYING' : status;
}
