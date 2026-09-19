import assert from "node:assert/strict";
import { GameEngine } from "../src/game/index.ts";
import type { Command, CommandResult, Content, CreateOptions, Intent, Rng } from "../src/game/index.ts";
import { compileContent, readCardCatalog } from "../src/cards/index.ts";
import { freeze } from "../src/game/persistence/json.ts";

/** Test/demo adapter only. A deterministic injected RNG preserves the authored deck order. */
const rng: Rng = { algorithm: "fixture-ordered-v1", next(state, exclusiveMax) { return { value: exclusiveMax - 1, state: state + 1 }; } };
const catalogPromise = readCardCatalog(new URL("../data/", import.meta.url));
type RecordedStep = { kind: "COMMAND"; command: Command } | { kind: "ADVANCE" };

function deck(content: Content, opening: string[]): string[] {
  const result = [...opening];
  const legal = Object.values(content.definitions).filter(d => d.type === "CHARACTER" || d.type === "EVENT").map(d => d.definitionId).sort();
  assert.ok(result.every(id => legal.includes(id)));
  for (const id of legal) while (result.length < 40 && result.filter(c => c === id).length < 3) result.push(id);
  assert.equal(result.length, 40);
  assert.ok(result.every(id => result.filter(c => c === id).length <= 3));
  return result;
}

export class RepresentativeSession {
  readonly engine: GameEngine;
  readonly content: Content;
  readonly options: CreateOptions;
  readonly first: string;
  readonly other: string;
  readonly log: RecordedStep[] = [];
  restoreChecks = 0;

  private constructor(content: Content, options: CreateOptions) {
    this.content = freeze(content) as Content; this.options = options;
    this.engine = GameEngine.create(options, content, rng);
    this.first = this.engine.getState().firstPlayerId;
    this.other = this.engine.getState().playerOrder.find(id => id !== this.first)!;
    while (this.state.status === "SETUP") this.submit({ kind: "MULLIGAN", choiceId: this.state.choice!.id, cardIds: [] });
    this.drain();
  }
  static async create(firstOpening: string[] = [], secondOpening: string[] = []): Promise<RepresentativeSession> {
    const content = compileContent(await catalogPromise);
    return new RepresentativeSession(content, { matchId: "representative", seed: 123, players: [
      { playerId: "b", partner: "F-PARTNER", case: "F-CASE", deck: deck(content, secondOpening) },
      { playerId: "a", partner: "F-PARTNER", case: "F-CASE", deck: deck(content, firstOpening) },
    ] });
  }
  get state() { return this.engine.getState(); }
  private command(intent: Intent, actor?: string): Command {
    const state = this.state;
    return { matchId: state.matchId, commandId: "representative-" + this.log.length, actorId: actor ?? state.choice?.playerId ?? state.turn.playerId, expectedRevision: state.revision, intent };
  }
  submit(intent: Intent, actor?: string): void {
    const command = this.command(intent, actor), restored = GameEngine.restore(this.engine.serialize(), this.content, rng);
    const result = this.engine.dispatch(command);
    assert.ok(result.accepted, JSON.stringify(result)); assert.deepEqual(restored.dispatch(command), result);
    assert.equal(restored.serialize(), this.engine.serialize()); this.restoreChecks++;
    this.log.push({ kind: "COMMAND", command });
  }
  reject(intent: Intent, actor?: string): Extract<CommandResult, { accepted: false }> {
    const before = this.engine.serialize(), result = this.engine.dispatch(this.command(intent, actor));
    assert.ok(!result.accepted, "Expected rejection: " + JSON.stringify(intent));
    assert.equal(this.engine.serialize(), before); return result;
  }
  advance(): boolean {
    const restored = GameEngine.restore(this.engine.serialize(), this.content, rng);
    const changed = this.engine.advance(); assert.equal(restored.advance(), changed);
    assert.equal(restored.serialize(), this.engine.serialize()); this.restoreChecks++;
    if (changed) this.log.push({ kind: "ADVANCE" }); return changed;
  }
  settle(): void {
    for (let n = 0; n < 1000; n++) if (!this.advance()) { assert.equal(this.state.status, "PLAYING"); return; }
    throw new Error("Representative step budget exhausted");
  }
  drain(): void {
    for (let n = 0; n < 100; n++) {
      this.settle(); const choice = this.state.choice;
      if (choice?.kind !== "EFFECT_ORDER") return;
      this.submit({ kind: "CHOOSE_EFFECT", choiceId: choice.id, effectId: choice.candidates[0]! });
    }
    throw new Error("Representative checkpoint budget exhausted");
  }
  hand(definitionId: string, owner = this.state.turn.playerId): string {
    const id = this.state.players[owner]!.zones.HAND.find(id => this.state.cards[id]!.definitionId === definitionId);
    assert.ok(id, "Missing hand card " + definitionId); return id;
  }
  play(definitionId: string): string {
    const id = this.hand(definitionId); this.submit({ kind: "PLAY_CARD", cardId: id }); return id;
  }
  nextTurn(): void { this.submit({ kind: "END_MAIN" }); this.drain(); }
  finishContact(): void {
    for (let n = 0; n < 5; n++) {
      this.drain(); const choice = this.state.choice;
      if (!choice) return;
      if (choice.kind === "GUARD") this.submit({ kind: "CHOOSE_GUARD", choiceId: choice.id, cardId: null });
      else if (choice.kind === "CONTACT_RESPONSE") this.submit({ kind: "RESPOND_CONTACT", choiceId: choice.id, response: "PASS" });
      else throw new Error("Unexpected Contact choice " + choice.kind);
    }
    throw new Error("Representative Contact budget exhausted");
  }
  assertReplay(): void {
    const replay = GameEngine.create(this.options, this.content, rng);
    for (const step of this.log) {
      if (step.kind === "COMMAND") assert.ok(replay.dispatch(step.command).accepted);
      else assert.equal(replay.advance(), true);
    }
    assert.equal(replay.serialize(), this.engine.serialize());
  }
}
