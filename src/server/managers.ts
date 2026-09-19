import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Content, CreateOptions, Rng } from '../game/model.ts';
import { fixtureOptions } from '../local/decks.ts';
import { fingerprint } from '../game/persistence/json.ts';
import { ServerMessageSchema } from '../../packages/protocol/index.ts';
import type { ClientMessage, ServerMessage, RoomState } from '../../packages/protocol/index.ts';
import { MatchManager, digest } from './match.ts';
import { MemoryStore } from './persistence/memory.ts';
import { PersistenceError, persistenceCode, roomStatus } from './persistence/model.ts';
import type { MatchStore, SessionRecord, RoomRecord, Gameplay } from './persistence/model.ts';
import { silentLogger } from './logging.ts';
import type { AuditLogger } from './logging.ts';
export { MatchManager } from './match.ts';

export type Connection = { id?: string; send: (message: ServerMessage) => void; close: () => void };
export type ServerOptions = { content: Content; port?: number; host?: string; matchOptions?: () => CreateOptions; rng?: Rng; store?: MatchStore;
  logger?: AuditLogger; failureCode?: (error: unknown) => string };
type Session = { record: SessionRecord; connection: Connection | null };

/** One process owns one serialized authority queue; DB I/O never creates parallel match runtimes. */
export class RoomManager {
  #sessions = new Map<string, Session>();
  #connections = new Map<Connection, Session>();
  #matches = new Map<string, MatchManager>();
  #tail: Promise<void> = Promise.resolve();
  #store: MatchStore;
  private options: ServerOptions;
  private get log() { return this.options.logger ?? silentLogger; }
  private failureCode(error: unknown) { return this.options.failureCode?.(error) ?? persistenceCode(error); }
  constructor(options: ServerOptions) { this.options = options; this.#store = options.store ?? new MemoryStore(); }
  #send(connection: Connection | null, message: ServerMessage) { if (connection) connection.send(ServerMessageSchema.parse(message)); }
  #reject(connection: Connection, code: string, commandId: string | null = null, stateVersion: number | null = null) {
    this.log('warn', 'command.rejected', { ...(connection.id ? { connectionId: connection.id } : {}), code, ...(stateVersion === null ? {} : { stateVersion }) });
    this.#send(connection, { type: 'COMMAND_REJECTED', commandId, code, message: code, stateVersion });
  }
  #enqueue(connection: Connection | null, commandId: string | null, work: () => Promise<void>): Promise<void> {
    const job = this.#tail.then(work).catch(error => { if (connection) this.#reject(connection, this.failureCode(error), commandId); });
    this.#tail = job.catch(() => {}); return this.#tail;
  }
  idle() { return this.#tail; }
  invalid(connection: Connection) { this.#reject(connection, 'INVALID_MESSAGE'); }
  #newSession() {
    const token = randomBytes(32).toString('hex'), now = new Date();
    return { token, record: { id: randomUUID(), resumeTokenHash: digest(token), createdAt: now, lastSeenAt: now } satisfies SessionRecord };
  }
  #attach(connection: Connection, record: SessionRecord, token: string) {
    const previous = this.#sessions.get(record.id)?.connection;
    if (previous && previous !== connection) { this.#connections.delete(previous); previous.close(); }
    const session = { record, connection };
    this.#sessions.set(record.id, session); this.#connections.set(connection, session);
    this.#send(connection, { type: 'SESSION', playerSessionId: record.id, resumeToken: token });
    return session;
  }
  connect(connection: Connection) {
    return this.#enqueue(connection, null, async () => {
      const session = this.#newSession();
      try { await this.#store.createSession(session.record); }
      catch (error) { this.#reject(connection, this.failureCode(error)); connection.close(); return; }
      this.#attach(connection, session.record, session.token);
    });
  }
  #actor(room: RoomRecord, id: string): 'A' | 'B' {
    if (room.playerAId === id) return 'A'; if (room.playerBId === id) return 'B'; throw new PersistenceError('NOT_IN_ROOM');
  }
  #roomState(room: RoomRecord): RoomState {
    return { roomCode: room.code, status: room.status, matchId: room.matchId, seats: [
      { playerId: 'A', occupied: !!room.playerAId, ready: room.readyA, connected: !!(room.playerAId && this.#sessions.get(room.playerAId)?.connection), deck: room.deckA },
      { playerId: 'B', occupied: !!room.playerBId, ready: room.readyB, connected: !!(room.playerBId && this.#sessions.get(room.playerBId)?.connection), deck: room.deckB },
    ] };
  }
  #broadcast(room: RoomRecord, message: ServerMessage) {
    for (const id of [room.playerAId, room.playerBId]) if (id) this.#send(this.#sessions.get(id)?.connection ?? null, message);
  }
  #roomUpdate(room: RoomRecord) { this.#broadcast(room, { type: 'ROOM_STATE', room: this.#roomState(room) }); }
  async #match(room: RoomRecord): Promise<MatchManager> {
    if (!room.matchId) throw new PersistenceError('MATCH_NOT_STARTED');
    const cached = this.#matches.get(room.matchId); if (cached) return cached;
    const loaded = await this.#store.loadMatch(room.matchId);
    if (!loaded) throw new PersistenceError('MATCH_NOT_FOUND');
    if (loaded.match.roomId !== room.id || roomStatus(loaded.match.status) !== room.status) throw new PersistenceError('SNAPSHOT_INVALID');
    const match = MatchManager.restore(loaded.match, loaded.snapshot, this.options.content, this.options.rng);
    this.log('info', 'match.restored', { roomId: room.id, matchId: match.record.id, stateVersion: match.stateVersion });
    this.#matches.set(room.matchId, match); return match;
  }
  #view(session: Session, room: RoomRecord, match: MatchManager, type: 'MATCH_STARTED' | 'GAME_VIEW' | 'RESYNC_STATE') {
    const packet = match.packet(this.#actor(room, session.record.id));
    this.#send(session.connection, { type, packet });
    this.#send(session.connection, { type: 'PENDING_DECISION', matchId: packet.matchId, stateVersion: packet.stateVersion, decision: packet.decision });
    if (type === 'RESYNC_STATE' && packet.view.blocked) this.#send(session.connection, { type: 'RULE_BLOCKED', matchId: packet.matchId, stateVersion: packet.stateVersion, questionId: packet.view.blocked.questionId });
    if (type === 'RESYNC_STATE' && packet.view.outcome) this.#send(session.connection, { type: 'GAME_FINISHED', matchId: packet.matchId, stateVersion: packet.stateVersion, outcome: packet.view.outcome });
  }
  disconnect(connection: Connection) {
    return this.#enqueue(null, null, async () => {
      const session = this.#connections.get(connection); this.#connections.delete(connection);
      if (!session || session.connection !== connection) return;
      session.connection = null;
      const room = await this.#store.getRoomBySession(session.record.id);
      if (room) {
        this.#broadcast(room, { type: 'PLAYER_DISCONNECTED', playerId: this.#actor(room, session.record.id), matchId: room.matchId });
        this.#roomUpdate(room);
      }
      // A session without a room also remains durable and may be resumed after restart.
    });
  }
  receive(connection: Connection, message: ClientMessage) {
    return this.#enqueue(connection, 'commandId' in message ? message.commandId : null, async () => {
      const session = this.#connections.get(connection);
      if (!session || session.connection !== connection) throw new PersistenceError('INVALID_SESSION');
      if (message.type === 'RESUME_MATCH') { await this.#resume(connection, session, message); return; }
      let room = await this.#store.getRoomBySession(session.record.id);
      if (message.type === 'CREATE_ROOM' || message.type === 'JOIN_ROOM') {
        if (room) throw new PersistenceError('ALREADY_IN_ROOM');
        if (message.type === 'CREATE_ROOM') {
          let code: string; do { code = randomBytes(4).toString('hex').toUpperCase(); } while (await this.#store.getRoomByCode(code));
          const now = new Date(); room = { id: randomUUID(), code, playerAId: session.record.id, playerBId: null, readyA: false, readyB: false,
            deckA: 'Fixture Deck A', deckB: 'Fixture Deck B', matchId: null, status: 'WAITING', createdAt: now, updatedAt: now };
        } else {
          room = await this.#store.getRoomByCode(message.roomCode.toUpperCase());
          if (!room) throw new PersistenceError('ROOM_NOT_FOUND');
          if (room.matchId || room.playerAId && room.playerBId) throw new PersistenceError('ROOM_FULL');
          if (!room.playerAId) room.playerAId = session.record.id; else room.playerBId = session.record.id;
          room.updatedAt = new Date();
        }
        await this.#store.saveRoom({ room });
        this.log('info', message.type === 'CREATE_ROOM' ? 'room.created' : 'room.joined', { roomId: room.id, ...(connection.id ? { connectionId: connection.id } : {}) });
        this.#roomUpdate(room); return;
      }
      if (!room) throw new PersistenceError('NOT_IN_ROOM');
      if (message.type === 'LEAVE_ROOM') {
        if (room.matchId) { session.connection = null; this.#connections.delete(connection); connection.close(); this.#roomUpdate(room); return; }
        this.#clearSeat(room, session.record.id);
        const replacement = this.#newSession();
        await this.#store.saveRoom({ room, deleteSessionId: session.record.id, newSession: replacement.record });
        this.#sessions.delete(session.record.id); this.#connections.delete(connection);
        this.#attach(connection, replacement.record, replacement.token); this.#roomUpdate(room); return;
      }
      if (message.type === 'READY') { await this.#ready(room, session); return; }
      if (!room.matchId) throw new PersistenceError('MATCH_NOT_STARTED');
      if (!('matchId' in message) || message.matchId !== room.matchId) throw new PersistenceError('MATCH_MISMATCH');
      const match = await this.#match(room);
      if (message.type === 'RESYNC') { this.#view(session, room, match, 'RESYNC_STATE'); return; }
      await this.#command(connection, session, room, match, message);
    });
  }
  #clearSeat(room: RoomRecord, id: string) {
    if (room.playerAId === id) { room.playerAId = null; room.readyA = false; }
    if (room.playerBId === id) { room.playerBId = null; room.readyB = false; }
    room.updatedAt = new Date();
  }
  async #resume(connection: Connection, temporary: Session, message: Extract<ClientMessage, { type: 'RESUME_MATCH' }>) {
    const original = await this.#store.getSession(message.playerSessionId);
    const tokenHash = Buffer.from(digest(message.resumeToken));
    const expected = Buffer.from(original?.resumeTokenHash ?? '');
    if (!original || tokenHash.length !== expected.length || !timingSafeEqual(tokenHash, expected)) throw new PersistenceError('INVALID_SESSION');
    const temporaryRoom = await this.#store.getRoomBySession(temporary.record.id);
    if (temporary.record.id !== original.id && temporaryRoom?.matchId) throw new PersistenceError('ALREADY_IN_ROOM');
    const room = await this.#store.getRoomBySession(original.id);
    // Validate restore before replacing authentication bindings or publishing any restored view.
    const match = room?.matchId ? await this.#match(room) : null;
    await this.#store.touchSession(original.id, new Date());
    if (temporary.record.id !== original.id) {
      if (temporaryRoom) { this.#clearSeat(temporaryRoom, temporary.record.id); await this.#store.saveRoom({ room: temporaryRoom, deleteSessionId: temporary.record.id }); this.#roomUpdate(temporaryRoom); }
      else await this.#store.deleteSession(temporary.record.id);
      this.#sessions.delete(temporary.record.id);
    }
    const session = this.#attach(connection, original, message.resumeToken);
    this.log('info', 'session.resumed', { ...(connection.id ? { connectionId: connection.id } : {}), ...(room ? { roomId: room.id } : {}), ...(match ? { matchId: match.record.id, stateVersion: match.stateVersion } : {}) });
    if (room) {
      this.#roomUpdate(room); if (match) this.#view(session, room, match, 'RESYNC_STATE');
      this.#broadcast(room, { type: 'PLAYER_CONNECTED', playerId: this.#actor(room, original.id), matchId: room.matchId });
    } else this.#send(connection, { type: 'SESSION_RESTORED' });
  }
  async #ready(room: RoomRecord, session: Session) {
    if (room.matchId) throw new PersistenceError('MATCH_ALREADY_STARTED');
    if (this.#actor(room, session.record.id) === 'A') room.readyA = true; else room.readyB = true;
    room.updatedAt = new Date();
    let match: MatchManager | null = null;
    if (room.playerAId && room.playerBId && room.readyA && room.readyB && this.#sessions.get(room.playerAId)?.connection && this.#sessions.get(room.playerBId)?.connection) {
      const options = structuredClone(this.options.matchOptions?.() ?? fixtureOptions(randomBytes(4).readUInt32LE()));
      options.matchId = randomUUID(); options.players[0].playerId = 'A'; options.players[1].playerId = 'B';
      match = MatchManager.create(options, room.id, this.options.content, this.options.rng);
      room.matchId = match.record.id; room.status = roomStatus(match.record.status);
    }
    await this.#store.saveRoom({ room, ...(match ? { newMatch: match.stored() } : {}) });
    if (match) {
      this.#matches.set(match.record.id, match);
      this.log('info', 'match.started', { roomId: room.id, matchId: match.record.id, stateVersion: match.stateVersion });
      for (const id of [room.playerAId, room.playerBId]) { const s = id ? this.#sessions.get(id) : null; if (s) this.#view(s, room, match, 'MATCH_STARTED'); }
    }
    this.#roomUpdate(room);
  }
  async #command(connection: Connection, session: Session, room: RoomRecord, match: MatchManager, message: Gameplay) {
    const actor = this.#actor(room, session.record.id), hash = fingerprint(message);
    const receipt = await this.#store.getCommand(match.record.id, message.commandId);
    const reject = (code: string) => this.#reject(connection, code, message.commandId, match.stateVersion);
    if (receipt) {
      if (receipt.playerId !== actor || receipt.fingerprint !== hash) { reject('COMMAND_ID_REUSED'); return; }
      this.log('info', 'command.duplicate', { matchId: match.record.id, stateVersion: receipt.resultVersion, commandType: message.type });
      this.#send(connection, { type: 'COMMAND_ACCEPTED', commandId: message.commandId, matchId: message.matchId, stateVersion: receipt.resultVersion, duplicate: true });
      this.#view(session, room, match, 'RESYNC_STATE'); return;
    }
    if (match.record.status === 'FINISHED') { reject('MATCH_FINISHED'); return; }
    if (message.expectedVersion !== match.stateVersion) { reject('STALE_STATE'); this.#view(session, room, match, 'RESYNC_STATE'); return; }
    const state = match.engine.getState(), intent = message.payload;
    if (state.choice && state.choice.playerId !== actor) { reject('NOT_DECISION_OWNER'); return; }
    if ('choiceId' in intent && intent.choiceId !== state.choice?.id) { reject('STALE_DECISION'); return; }
    const { result, draft } = match.prepare(actor, message);
    if (!result.accepted || !draft) {
      if (!result.accepted) {
        reject(result.code);
        if (result.category === 'UnsupportedRule') this.#send(connection, { type: 'RULE_BLOCKED', matchId: message.matchId, stateVersion: match.stateVersion, questionId: result.code });
      }
      return;
    }
    const stored = match.stored(draft, match.stateVersion + 1);
    try {
      await this.#store.commitGameplay({ ...stored, expectedVersion: match.stateVersion, command: {
        matchId: message.matchId, commandId: message.commandId, playerId: actor, expectedVersion: message.expectedVersion,
        resultVersion: stored.match.stateVersion, type: message.type, payload: message.payload, fingerprint: hash, resultStatus: 'ACCEPTED', createdAt: new Date(),
      } });
    } catch (error) {
      // Even an uncertain COMMIT response cannot leave a cached authority guessing its durable version.
      this.#matches.delete(message.matchId);
      this.log('error', 'persistence.failed', { matchId: match.record.id, stateVersion: match.stateVersion, code: this.failureCode(error), ...(connection.id ? { connectionId: connection.id } : {}) });
      throw error;
    }
    match.engine = draft; match.record = stored.match; room.status = roomStatus(stored.match.status);
    this.log('info', 'command.accepted', { matchId: match.record.id, stateVersion: match.stateVersion, commandType: message.type });
    this.#send(connection, { type: 'COMMAND_ACCEPTED', commandId: message.commandId, matchId: message.matchId, stateVersion: match.stateVersion, duplicate: false });
    for (const id of [room.playerAId, room.playerBId]) { const s = id ? this.#sessions.get(id) : null; if (s) this.#view(s, room, match, 'GAME_VIEW'); }
    const final = draft.getState();
    if (final.blocked) this.#broadcast(room, { type: 'RULE_BLOCKED', matchId: message.matchId, stateVersion: match.stateVersion, questionId: final.blocked.questionId });
    if (final.outcome) {
      this.log('info', 'match.finished', { matchId: match.record.id, stateVersion: match.stateVersion });
      this.#broadcast(room, { type: 'GAME_FINISHED', matchId: message.matchId, stateVersion: match.stateVersion, outcome: { ...final.outcome } });
    }
    if (final.blocked || final.outcome) this.#roomUpdate(room);
  }
  /** Read-only trusted host inspection, never a network endpoint. */
  inspectMatch(matchId: string) { const match = this.#matches.get(matchId); return match ? { state: match.engine.getState(), stateVersion: match.stateVersion } : null; }
}
