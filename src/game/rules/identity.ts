import type { GameState } from "../model.ts";
import { nextId } from "../engine/state-helpers.ts";
import { check } from "../persistence/json.ts";

export function createEntry(state: GameState, cardId: string, creation: "PLAY" | "DISGUISE", previousEntryId: string | null = null): string {
  const card = state.cards[cardId]!;
  check(card.entryId === null, "RULE_QUESTION_027");
  const entryId = nextId(state, "entry");
  state.entries[entryId] = { entryId, instanceId: cardId, ownerId: card.ownerId, createdTurn: state.turn.number, creation, status: "PRESENT", previousEntryId, grantedAbilities: [] };
  card.entryId = entryId;
  return entryId;
}
export function activeEntry(state: GameState, cardId: string) {
  const card = state.cards[cardId];
  const entry = card?.entryId ? state.entries[card.entryId] : undefined;
  return entry?.status === "PRESENT" && state.players[entry.ownerId]!.zones.FIELD.includes(cardId) ? entry : null;
}
export function isDisguiseReplacement(state: GameState, currentId: string, originalId: string): boolean {
  const card = state.cards[currentId];
  let entry = card?.entryId ? state.entries[card.entryId] : null;
  const seen = new Set<string>();
  while (entry && entry.creation === "DISGUISE" && entry.previousEntryId && !seen.has(entry.entryId)) {
    seen.add(entry.entryId);
    entry = state.entries[entry.previousEntryId];
    if (entry?.instanceId === originalId) return true;
  }
  return false;
}
