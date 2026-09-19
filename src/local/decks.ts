import type { CreateOptions } from "../game/model.ts";

/** Deck composition is fixture data, not card-specific gameplay behavior. */
const deckA = ["F-ACTIVE", "F-EVIDENCE", "F-LP-BOOST", "F-ENTER-DRAW", "F-MISLEAD", "F-CUTIN", "F-DISGUISE", "F-AP-BOOST", "F-COMBO-ENTER", "F-COMBO-REACT", "F-VANILLA", "F-SET", "F-UNDER", "F-REMOVE-DRAW"];
const deckB = ["F-MISLEAD", "F-AP-BOOST", "F-MR", "F-DISGUISE", "F-COMBO-CUT", "F-ACTIVATED-DRAW", "F-STUN", "F-SLEEP", "F-INVESTIGATE", "F-TRACE", "F-EVENT-DRAW", "F-VANILLA", "F-EVIDENCE", "F-ACTIVE"];
export function fixtureOptions(seed = 42): CreateOptions {
  return { matchId: "local-fixture", seed, players: [
    { playerId: "A", partner: "F-PARTNER", case: "F-CASE", deck: Array.from({ length: 40 }, (_, i) => deckA[i % deckA.length]!) },
    { playerId: "B", partner: "F-PARTNER", case: "F-CASE", deck: Array.from({ length: 40 }, (_, i) => deckB[i % deckB.length]!) },
  ] };
}
