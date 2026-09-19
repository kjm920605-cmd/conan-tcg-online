import { createHash } from 'node:crypto';
import { GameEngine } from '../game/engine/GameEngine.ts';
import { fingerprint } from '../game/persistence/json.ts';
import { getLegalActions, getPendingDecision, projectGameState } from '../game/client/index.ts';
import { seededRng } from '../game/random/rng.ts';
import type { Content, CreateOptions, Rng, GameState } from '../game/model.ts';
import type { PlayerPacket } from '../../packages/protocol/index.ts';
import type { Gameplay, Versions, MatchRecord, StoredMatch, SnapshotRecord } from './persistence/model.ts';
import { PersistenceError } from './persistence/model.ts';

export const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export function versionsFor(content: Content): Versions {
  const engineVersion: GameState['engineVersion'] = '0.3.0';
  const rulesetVersion: GameState['rulesetVersion'] = 'pdf-2.5+explicit-3a';
  return { engineVersion, rulesetVersion, cardDataVersion: fingerprint(content) };
}

export class MatchManager {
  engine: GameEngine;
  record: MatchRecord;
  private content: Content;
  private rng: Rng | undefined;
  private constructor(engine: GameEngine, record: MatchRecord, content: Content, rng?: Rng) {
    this.engine = engine; this.record = record; this.content = content; this.rng = rng;
  }
  get stateVersion() { return this.record.stateVersion; }
  static create(options: CreateOptions, roomId: string, content: Content, rng?: Rng): MatchManager {
    const engine = GameEngine.create(options, content, rng);
    if (engine.runUntilDecision(2000) === 'STEP_LIMIT') throw new PersistenceError('AUTO_STEP_LIMIT');
    const state = engine.getState(), now = new Date();
    return new MatchManager(engine, { id: state.matchId, roomId, ...versionsFor(content), status: state.status,
      stateVersion: 0, outcome: structuredClone(state.outcome), createdAt: now, updatedAt: now, finishedAt: state.outcome ? now : null }, content, rng);
  }
  static restore(match: MatchRecord, snapshot: SnapshotRecord | null, content: Content, rng?: Rng): MatchManager {
    const versions = versionsFor(content);
    if (Object.entries(versions).some(([key, value]) => match[key as keyof Versions] !== value)) throw new PersistenceError('VERSION_INCOMPATIBLE');
    if (!snapshot || snapshot.stateVersion !== match.stateVersion) throw new PersistenceError('SNAPSHOT_MISSING');
    if (snapshot.matchId !== match.id || digest(snapshot.serializedState) !== snapshot.integrityHash) throw new PersistenceError('SNAPSHOT_CORRUPT');
    let parsed: GameState;
    try { parsed = JSON.parse(snapshot.serializedState); } catch { throw new PersistenceError('SNAPSHOT_INVALID'); }
    if (!parsed || parsed.schemaVersion !== 3 || parsed.engineVersion !== versions.engineVersion || parsed.rulesetVersion !== versions.rulesetVersion || parsed.contentFingerprint !== versions.cardDataVersion) throw new PersistenceError('VERSION_INCOMPATIBLE');
    if (parsed.rng?.algorithm && parsed.rng.algorithm !== (rng ?? seededRng).algorithm) throw new PersistenceError('VERSION_INCOMPATIBLE');
    try {
      if (parsed.matchId !== match.id || parsed.status !== match.status || fingerprint(parsed.outcome) !== fingerprint(match.outcome) || !!match.finishedAt !== (parsed.status === 'FINISHED')) throw new PersistenceError('SNAPSHOT_INVALID');
      return new MatchManager(GameEngine.restore(snapshot.serializedState, content, rng), match, content, rng);
    }
    catch { throw new PersistenceError('SNAPSHOT_INVALID'); }
  }
  stored(engine = this.engine, stateVersion = this.stateVersion): StoredMatch {
    const state = engine.getState(), now = new Date(), serializedState = engine.serialize();
    return { match: { ...this.record, stateVersion, status: state.status, outcome: structuredClone(state.outcome),
      updatedAt: now, finishedAt: this.record.finishedAt ?? (state.outcome ? now : null) },
      snapshot: { matchId: state.matchId, stateVersion, serializedState, integrityHash: digest(serializedState), createdAt: now } };
  }
  prepare(actor: string, message: Gameplay) {
    const draft = GameEngine.restore(this.engine.serialize(), this.content, this.rng);
    const result = draft.dispatch({ matchId: message.matchId, commandId: message.commandId, actorId: actor, expectedRevision: draft.getState().revision, intent: message.payload });
    if (!result.accepted) return { result, draft: null };
    try {
      if (draft.runUntilDecision(2000) === 'STEP_LIMIT') return { result: { accepted: false as const, code: 'AUTO_STEP_LIMIT', category: 'UnsupportedFeature' as const }, draft: null };
    } catch { return { result: { accepted: false as const, code: 'AUTO_ADVANCE_FAILED', category: 'UnsupportedFeature' as const }, draft: null }; }
    return { result, draft };
  }
  packet(playerId: string): PlayerPacket {
    return { matchId: this.record.id, stateVersion: this.stateVersion, view: projectGameState(this.engine.getState(), playerId, this.content),
      legalActions: getLegalActions(this.engine, this.content, playerId), decision: getPendingDecision(this.engine, this.content, playerId) };
  }
}
