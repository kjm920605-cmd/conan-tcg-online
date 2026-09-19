import assert from "node:assert/strict";
import { GameEngine } from "../src/game/index.ts";
import type { CardDefinition, Content, Intent } from "../src/game/index.ts";
import { fixture, main, mutable, relocate, send } from "./fixtures.ts";

export { send };
export function effects(engine: GameEngine): void {
  for (let i = 0; i < 200; i++) {
    engine.runUntilDecision();
    const choice = engine.getState().choice;
    if (!choice || choice.kind !== "EFFECT_ORDER") return;
    ok(engine, { kind: "CHOOSE_EFFECT", choiceId: choice.id, effectId: choice.candidates[0]! });
  }
  assert.fail("Unexpected fixture effect loop");
}
export function ok(engine: GameEngine, intent: Intent, actor?: string): void {
  const result = send(engine, intent, actor);
  assert.equal(result.accepted, true, JSON.stringify(result));
}
export function passContact(engine: GameEngine): void {
  for (let i = 0; i < 3; i++) {
    effects(engine);
    const choice = engine.getState().choice;
    if (!choice || choice.kind !== "CONTACT_RESPONSE") return;
    ok(engine, { kind: "RESPOND_CONTACT", choiceId: choice.id, response: "PASS" });
  }
  effects(engine);
}
export function arena() {
  const { content, options } = fixture();
  const state = mutable(main(content));
  const turn = state.turn.playerId;
  const other = state.playerOrder.find(id => id !== turn)!;
  let counter = 0;
  return {
    content, state, turn, other,
    add(owner = turn, values: Partial<Extract<CardDefinition, { type: "CHARACTER" }>> = {}) {
      const id = state.players[owner]!.zones.DECK[0]!;
      const definitionId = "arena-" + counter++;
      const base = content.definitions.v0!;
      assert.equal(base.type, "CHARACTER");
      content.definitions[definitionId] = { ...base, ...values, definitionId, printedId: definitionId } as CardDefinition;
      state.cards[id]!.definitionId = definitionId;
      relocate(state, owner, "DECK", "FIELD", 1);
      return id;
    },
    resume() {
      // Content is a trusted synthetic rules fixture, not a mutable player payload.
      state.contentFingerprint = GameEngine.create(options, content).getState().contentFingerprint;
      return GameEngine.restore(JSON.stringify(state), content);
    },
  };
}
export function roundtrip(engine: GameEngine, content: Content): GameEngine {
  const restored = GameEngine.restore(engine.serialize(), content);
  assert.equal(restored.serialize(), engine.serialize());
  return restored;
}
