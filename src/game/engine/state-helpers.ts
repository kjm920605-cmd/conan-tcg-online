import type { GameState, PlayerId, Zone } from "../model.ts";
import { check } from "../persistence/json.ts";

export const zones: Zone[] = ["DECK", "HAND", "FILE", "EVIDENCE", "REMOVE", "PARTNER", "CASE", "FIELD", "PROCESSING", "SET", "UNDER"];
export function otherPlayer(state: GameState, playerId: string): string {
  check(state.playerOrder.includes(playerId), "PLAYER");
  return state.playerOrder[0] === playerId ? state.playerOrder[1] : state.playerOrder[0];
}
export function nextId(state: GameState, prefix: string): string { return prefix + "-" + state.nextId++; }
export function fact(state: GameState, type: string, playerId: PlayerId | null = null, cardId: string | null = null, detail = ""): void {
  state.events.push({ sequence: state.events.length + 1, type, playerId, cardId, detail });
}
export function block(state: GameState, questionId: string, detail: string): void {
  state.status = "RULE_BLOCKED";
  state.blocked = { questionId, detail };
  fact(state, "RULE_BLOCKED", null, null, questionId);
}
export function move(state: GameState, playerId: string, cardId: string, from: Zone, to: Zone, log = true): void {
  const player = state.players[playerId]!;
  check(state.cards[cardId]?.ownerId === playerId, "OWNER");
  const index = player.zones[from].indexOf(cardId);
  check(index >= 0, "LOCATION");
  player.zones[from].splice(index, 1);
  player.zones[to].unshift(cardId);
  state.cards[cardId]!.face = ["DECK", "HAND", "FILE", "EVIDENCE", "SET", "UNDER"].includes(to) ? "DOWN" : "UP";
  // The Assist Partner stays face up in FILE.
  if (cardId === player.partnerId && to === "FILE") state.cards[cardId]!.face = "UP";
  if (log) fact(state, "CARD_MOVED", playerId, cardId, from + ">" + to);
}
export function endMatch(state: GameState, loserId: string, reason: "EMPTY_DECK" | "CASE_SOLVED"): void {
  // An unresolved rule encountered in this atomic step takes precedence over adjudication.
  if (state.status === "RULE_BLOCKED") return;
  const winnerId = otherPlayer(state, loserId);
  state.status = "FINISHED";
  state.outcome = { winnerId, loserId, reason };
  state.choice = null;
  // Preserve interrupted frames for diagnostics; FINISHED never executes them.
  fact(state, "MATCH_ENDED", winnerId, null, reason);
}
