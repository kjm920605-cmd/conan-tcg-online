import type { Content, CreateOptions, GameState, PlayerState, Rng, Zone } from "../model.ts";
import { validateDecks } from "../content/validate.ts";
import { fingerprint } from "../persistence/json.ts";
import { fact, move, nextId } from "./state-helpers.ts";
import { randomInt, shuffle } from "../random/rng.ts";

export function createState(options: CreateOptions, content: Content, rng: Rng): GameState {
  validateDecks(options, content);
  const order: [string, string] = [options.players[0].playerId, options.players[1].playerId];
  const state: GameState = {
    schemaVersion: 3, engineVersion: "0.3.0", rulesetVersion: "pdf-2.5+explicit-3a",
    contentFingerprint: fingerprint(content), matchId: options.matchId, revision: 0, nextId: 1,
    status: "SETUP", playerOrder: order, firstPlayerId: order[0], players: {}, cards: {}, entries: {}, modifiers: {},
    turn: { number: 1, playerId: order[0], phase: "AUTO", normalPlayUsed: false, usedNextHint: false },
    mulligansCompleted: 0, choice: null, frames: [], pendingEffects: [],
    rng: { algorithm: rng.algorithm, state: options.seed, cursor: 0 },
    events: [], commandReceipts: {}, blocked: null, outcome: null,
  };
  for (const input of options.players) {
    const player: PlayerState = {
      id: input.playerId, partnerId: "", caseId: "", chapter: "CASE",
      traceDiscovered: false, assistReturnOnOwnAuto: false,
      zones: { DECK: [], HAND: [], FILE: [], EVIDENCE: [], REMOVE: [], PARTNER: [], CASE: [], FIELD: [], PROCESSING: [], SET: [], UNDER: [] },
    };
    state.players[player.id] = player;
    function add(definitionId: string, zone: Zone): string {
      const id = nextId(state, "card");
      state.cards[id] = { instanceId: id, definitionId, ownerId: player.id, face: "DOWN", orientation: zone === "PARTNER" ? "ACTIVE" : null, enteredTurn: null, entryId: null, attachment: null };
      player.zones[zone].push(id);
      return id;
    }
    player.partnerId = add(input.partner, "PARTNER");
    player.caseId = add(input.case, "CASE");
    input.deck.forEach(id => add(id, "DECK"));
  }
  fact(state, "CARDS_PLACED");
  for (const player of Object.values(state.players)) {
    shuffle(state, rng, player.zones.DECK);
    fact(state, "DECK_SHUFFLED", player.id);
  }
  state.firstPlayerId = order[randomInt(state, rng, 2)]!;
  state.turn.playerId = state.firstPlayerId;
  fact(state, "FIRST_PLAYER_DECIDED", state.firstPlayerId);
  for (const player of Object.values(state.players)) for (let i = 0; i < 5; i++) {
    const id = player.zones.DECK[0]!;
    move(state, player.id, id, "DECK", "HAND");
    fact(state, "CARD_DRAWN", player.id, id);
  }
  state.choice = { id: nextId(state, "choice"), kind: "MULLIGAN", playerId: state.firstPlayerId };
  return state;
}
