import type { Content, GameState } from "../model.ts";
export function isMR(state: GameState, content: Content, id: string): boolean {
  const definition = content.definitions[state.cards[id]!.definitionId]!;
  return definition.type === "CHARACTER" && definition.mr === true;
}
export function existingMR(state: GameState, content: Content, owner: string, except: string): string[] {
  const zones = state.players[owner]!.zones;
  return [...zones.FIELD, ...zones.PARTNER].filter(id => id !== except && isMR(state, content, id));
}
