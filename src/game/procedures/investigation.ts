import type { Frame, GameState, Intent } from "../model.ts";
import { check } from "../persistence/json.ts";
import { fact, nextId } from "../engine/state-helpers.ts";

type Investigation = Extract<Frame, { kind: "INVESTIGATION" }>;
export function investigationStep(state: GameState, frame: Investigation): void {
  if (frame.step === "REVEAL") {
    frame.revealed = state.players[frame.deckOwnerId]!.zones.DECK.slice(0, frame.count);
    for (const id of frame.revealed) state.cards[id]!.face = "UP";
    fact(state, "INVESTIGATION_REVEALED", frame.deckOwnerId, frame.sourceId, JSON.stringify(frame.revealed));
    frame.step = "ORDER";
  } else if (frame.step === "ORDER") {
    state.choice = { id: nextId(state, "choice"), kind: "INVESTIGATION_ORDER", playerId: frame.deckOwnerId, candidates: [...frame.revealed] };
  } else state.frames.pop();
}
export function chooseInvestigation(state: GameState, intent: Extract<Intent, { kind: "CHOOSE_INVESTIGATION_ORDER" }>, owner: string): void {
  const frame = state.frames.at(-1), choice = state.choice;
  check(frame?.kind === "INVESTIGATION" && frame.step === "ORDER" && choice?.kind === "INVESTIGATION_ORDER" && choice.id === intent.choiceId && owner === frame.deckOwnerId, "CHOICE");
  check(Array.isArray(intent.cardIds) && intent.cardIds.length === frame.revealed.length && new Set(intent.cardIds).size === intent.cardIds.length && intent.cardIds.every(id => frame.revealed.includes(id)), "INVESTIGATION_ORDER");
  const deck = state.players[owner]!.zones.DECK;
  check(JSON.stringify(deck.slice(0, frame.revealed.length)) === JSON.stringify(frame.revealed), "RULE_QUESTION_014");
  // Cards never leave the deck during reveal/reordering; do not create a false empty deck.
  deck.splice(0, frame.revealed.length);
  deck.push(...intent.cardIds);
  for (const id of frame.revealed) state.cards[id]!.face = "DOWN";
  const parent = state.frames.at(-2);
  check(parent?.kind === "EFFECT", "PROCEDURE_INVESTIGATION");
  parent.foundCards = [...frame.revealed];
  frame.step = "DONE"; state.choice = null;
  // The chosen bottom order is private; the host snapshot/command already preserves it.
  fact(state, "INVESTIGATION_ORDERED", owner, frame.sourceId, String(frame.revealed.length));
}
