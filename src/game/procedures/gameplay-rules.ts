import type { Content, GameState } from "../model.ts";
import { check } from "../persistence/json.ts";
import { move } from "../engine/events.ts";
import { nextId } from "../engine/state-helpers.ts";
import { createEntry } from "../rules/identity.ts";
import { hasKeyword, newcomerAllowed } from "../rules/keywords.ts";
export { keywords } from "../rules/keywords.ts";

export function onField(state: GameState, cardId: string): boolean {
  return Object.hasOwn(state.cards, cardId) && state.players[state.cards[cardId]!.ownerId]!.zones.FIELD.includes(cardId);
}
export function misleadCandidates(state: GameState, content: Content, owner: string): string[] {
  return state.players[owner]!.zones.FIELD.filter(id => state.cards[id]!.orientation === "ACTIVE" && hasKeyword(state, content, id, "MISLEAD_X"));
}
export function guardCandidates(state: GameState, owner: string, content: Content): string[] {
  const action = state.frames.find(f => f.kind === "ACTION");
  if (action?.kind === "ACTION" && hasKeyword(state, content, action.attackerId, "BULLET")) return [];
  return state.players[owner]!.zones.FIELD.filter(id => state.cards[id]!.orientation === "ACTIVE");
}
export function canPlay(state: GameState, content: Content, owner: string, cardId: string): void {
  const player = state.players[owner]!;
  check(player.zones.HAND.includes(cardId), "HAND_CARD");
  const card = state.cards[cardId]!;
  const definition = content.definitions[card.definitionId]!;
  check(definition.type === "CHARACTER" || definition.type === "EVENT", "CARD_TYPE");
  if (definition.type === "CHARACTER") check(card.enteredTurn === null, "RULE_QUESTION_027");
  const caseDef = content.definitions[state.cards[player.caseId]!.definitionId]!;
  check(definition.level <= player.zones.FILE.length && definition.colors.every(c => caseDef.colors.includes(c)), "PLAY_ELIGIBILITY");
}
export function handCandidates(state: GameState, content: Content, owner: string): string[] {
  return state.players[owner]!.zones.HAND.filter(id => {
    try { canPlay(state, content, owner, id); return true; } catch { return false; }
  });
}
export function enter(state: GameState, content: Content, owner: string, cardId: string): void {
  const card = state.cards[cardId]!;
  card.orientation = "ACTIVE";
  card.enteredTurn = state.turn.number;
  createEntry(state, cardId, "PLAY");
  move(state, content, owner, cardId, "HAND", "FIELD", "ENTRY");
}
/** Caller owns the enclosing checkpoint; entry and Event are nested continuations. */
export function useHand(state: GameState, content: Content, owner: string, cardId: string): void {
  canPlay(state, content, owner, cardId);
  const definition = content.definitions[state.cards[cardId]!.definitionId]!;
  if (definition.type === "CHARACTER") {
    if (state.players[owner]!.zones.FIELD.length === 5) {
      state.frames.push({ kind: "ENTRY", playerId: owner, cardId });
      state.choice = { id: nextId(state, "choice"), kind: "SWITCH", playerId: owner, candidates: [...state.players[owner]!.zones.FIELD] };
    } else enter(state, content, owner, cardId);
  } else {
    check(definition.type === "EVENT", "CARD_TYPE");
    move(state, content, owner, cardId, "HAND", "PROCESSING", "HAND_USE");
    state.frames.push(
      { kind: "FINISH_EVENT", playerId: owner, cardId },
      { kind: "EFFECT", effect: { id: nextId(state, "effect"), controllerId: owner, sourceId: cardId, programId: definition.programId }, cursor: 0 },
    );
  }
}
export function activeSource(state: GameState, content: Content, owner: string, cardId: string, allowPartner: boolean, operation = "DEDUCTION"): void {
  check(Object.hasOwn(state.cards, cardId) && state.cards[cardId]!.ownerId === owner, "ACTION_SOURCE");
  const card = state.cards[cardId]!;
  const definition = content.definitions[card.definitionId]!;
  if (definition.type === "PARTNER" && allowPartner) {
    check(state.players[owner]!.zones.PARTNER.includes(cardId), "RULE_QUESTION_025");
  } else {
    check(definition.type === "CHARACTER" && onField(state, cardId), "ACTION_SOURCE");
    check(card.enteredTurn !== state.turn.number || newcomerAllowed(state, content, cardId, operation), "NEW_CHARACTER");
  }
  check(card.orientation === "ACTIVE", "SLEEP_COST");
}
