import { GameEngine } from "../src/game/index.ts";
import type { Content, GameState, Intent, Rng } from "../src/game/index.ts";
import { createEntry } from "../src/game/rules/identity.ts";

import { fixture } from "../examples/synthetic-content.ts";
export { fixture } from "../examples/synthetic-content.ts";
export function send(engine: GameEngine, intent: Intent, actorId = engine.getState().choice?.playerId ?? engine.getState().turn.playerId) {
  const state = engine.getState();
  return engine.dispatch({ matchId: state.matchId, commandId: "cmd-" + state.revision, actorId, expectedRevision: state.revision, intent });
}
export function setup(content = fixture().content, rng?: Rng) {
  const { options } = fixture();
  const engine = GameEngine.create(options, content, rng);
  for (let i = 0; i < 2; i++) {
    const choice = engine.getState().choice!;
    send(engine, { kind: "MULLIGAN", choiceId: choice.id, cardIds: [] });
  }
  return engine;
}
export function main(content = fixture().content) {
  const engine = setup(content);
  engine.runUntilDecision();
  return engine;
}
export function mutable(engine: GameEngine): GameState { return JSON.parse(engine.serialize()) as GameState; }

// Trusted persistence fixtures: relocate existing physical cards, never create a 85th card.
// This helper is test-only; there is no player command for arbitrary zone changes.
export function relocate(state: GameState, playerId: string, from: keyof GameState["players"][string]["zones"], to: keyof GameState["players"][string]["zones"], count: number) {
  const player = state.players[playerId]!;
  for (let i = 0; i < count; i++) {
    const id = player.zones[from].shift()!;
    player.zones[to].unshift(id);
    state.cards[id]!.face = ["HAND", "FILE", "EVIDENCE", "DECK"].includes(to) ? "DOWN" : "UP";
    if (to === "FIELD") {
      state.cards[id]!.orientation = "ACTIVE";
      state.cards[id]!.enteredTurn = state.turn.number - 1;
      createEntry(state, id, "PLAY");
    }
  }
}
export function nearRefresh(content = fixture().content) {
  const state = mutable(main(content));
  const id = state.turn.playerId;
  relocate(state, id, "DECK", "REMOVE", state.players[id]!.zones.DECK.length - 1);
  return { state, id, other: state.playerOrder.find(p => p !== id)!, content };
}
export function conservation(state: ReturnType<GameEngine["getState"]>) {
  const ids = Object.values(state.players).flatMap(p => Object.values(p.zones).flat());
  return ids.length === 84 && new Set(ids).size === 84 && Object.keys(state.cards).length === 84;
}

