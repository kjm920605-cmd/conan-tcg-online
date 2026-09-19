import { move, orient, checkpoint } from "../engine/events.ts";
import { gameplayChoice, gameplayMain } from "./gameplay-commands.ts";
import { chooseInvestigation } from "./investigation.ts";
import { declareAbility } from "./declaration.ts";
import type { Command, Content, GameState, Rng } from "../model.ts";
import { check, exactKeys, identifier, integer } from "../persistence/json.ts";
import { endMatch, fact, nextId, otherPlayer } from "../engine/state-helpers.ts";
import { shuffle } from "../random/rng.ts";
import { EffectQueue } from "../effects/EffectQueue.ts";

export function applyCommand(state: GameState, content: Content, rng: Rng, command: Command): void {
  check(command.matchId === state.matchId && identifier(command.commandId), "COMMAND_ID");
  check(command.expectedRevision === state.revision && integer(command.expectedRevision), "REVISION");
  check(state.playerOrder.includes(command.actorId), "ACTOR");
  check(state.status === "SETUP" || state.status === "PLAYING", "MATCH_STOPPED");
  const intent = command.intent;
  check(intent && typeof intent === "object", "COMMAND");
  const keys: Record<string, string[]> = {
    MULLIGAN: ["kind", "choiceId", "cardIds"], CHOOSE_EFFECT: ["kind", "choiceId", "effectId"],
    CHOOSE_INVESTIGATION_ORDER: ["kind", "choiceId", "cardIds"],
    DECLARE_ABILITY: ["kind", "cardId", "abilityId"],
    NEXT_HINT: ["kind"], CHOOSE_NEXT_HINT_CARD: ["kind", "choiceId", "cardId"], CHOOSE_SWITCH: ["kind", "choiceId", "cardId"], CHOOSE_MISLEAD: ["kind", "choiceId", "cardIds"], CHOOSE_GUARD: ["kind", "choiceId", "cardId"], RESPOND_CONTACT: ["kind", "choiceId", "response", "cardId", "abilityId"], DECLARE_ACTION: ["kind", "cardId", "target"],
    ASSIST: ["kind"], SOLVE_CASE: ["kind"], END_MAIN: ["kind"], PLAY_CARD: ["kind", "cardId"], DEDUCE: ["kind", "cardId"],
  };
  check(Object.hasOwn(keys, intent.kind), "UNSUPPORTED_COMMAND");
  exactKeys(intent, keys[intent.kind]!, "COMMAND_FIELDS");
  const player = state.players[command.actorId]!;
  if (intent.kind === "MULLIGAN") {
    const choice = state.choice;
    check(state.status === "SETUP" && choice?.kind === "MULLIGAN" && choice.playerId === player.id && choice.id === intent.choiceId, "CHOICE");
    check(Array.isArray(intent.cardIds) && new Set(intent.cardIds).size === intent.cardIds.length && intent.cardIds.every(id => player.zones.HAND.includes(id)), "MULLIGAN_SELECTION");
    if (intent.cardIds.length > 0) {
      for (const id of intent.cardIds) move(state, content, player.id, id, "HAND", "DECK");
      fact(state, "MULLIGAN_RETURNED", player.id);
      shuffle(state, rng, player.zones.DECK);
      fact(state, "DECK_SHUFFLED", player.id);
      for (let i = 0; i < intent.cardIds.length; i++) {
        const id = player.zones.DECK[0]!;
        move(state, content, player.id, id, "DECK", "HAND"); fact(state, "CARD_DRAWN", player.id, id);
      }
    }
    state.mulligansCompleted++;
    fact(state, "MULLIGAN_COMPLETED", player.id);
    if (state.mulligansCompleted === 1) {
      state.choice = { id: nextId(state, "choice"), kind: "MULLIGAN", playerId: otherPlayer(state, state.firstPlayerId) };
    } else {
      state.choice = null; state.status = "PLAYING";
      for (const p of Object.values(state.players)) {
        state.cards[p.partnerId]!.face = "UP"; state.cards[p.caseId]!.face = "UP";
      }
      fact(state, "PARTNERS_CASES_REVEALED");
      state.frames.push({ kind: "AUTO", step: 0 });
      fact(state, "TURN_STARTED", state.firstPlayerId);
    }
    return;
  }
  check(state.status === "PLAYING", "PHASE");
  if (intent.kind === "CHOOSE_EFFECT") {
    const choice = state.choice;
    check(choice?.kind === "EFFECT_ORDER" && choice.id === intent.choiceId && choice.playerId === player.id && choice.candidates.includes(intent.effectId), "CHOICE");
    const effect = EffectQueue.take(state, player.id, intent.effectId);
    state.choice = null;
    state.frames.push({ kind: "EFFECT", effect, cursor: 0 });
    return;
  }
  if (gameplayChoice(state, content, command)) return;
  if (intent.kind === "CHOOSE_INVESTIGATION_ORDER") { chooseInvestigation(state, intent, player.id); return; }
  check(!state.choice && state.frames.length === 0 && state.pendingEffects.length === 0 && state.turn.phase === "MAIN" && state.turn.playerId === player.id, "PHASE");
  if (gameplayMain(state, content, command)) return;
  if (intent.kind === "DECLARE_ABILITY") { declareAbility(state, content, command.actorId, intent); return; }
  const partner = state.cards[player.partnerId]!;
  const partnerAvailable = () => {
    check(player.zones.PARTNER.includes(partner.instanceId), "RULE-QUESTION-025", "FILE Partner action is not supported");
    check(partner.orientation === "ACTIVE", "SLEEP_COST");
  };
  switch (intent.kind) {
    case "ASSIST":
      partnerAvailable();
      orient(state, content, partner.instanceId, "SLEEP");
      move(state, content, player.id, partner.instanceId, "PARTNER", "FILE");
      player.assistReturnOnOwnAuto = true;
      if (player.zones.FILE.length >= 7 && player.chapter === "CASE") {
        player.chapter = "RESOLUTION"; fact(state, "CASE_CHAPTER_CHANGED", player.id);
      }
      fact(state, "ASSIST_USED", player.id, partner.instanceId);
      break;
    case "SOLVE_CASE": {
      partnerAvailable();
      check(player.chapter === "RESOLUTION", "CASE_CHAPTER");
      orient(state, content, partner.instanceId, "SLEEP");
      const definition = content.definitions[state.cards[player.caseId]!.definitionId]!;
      check(definition.type === "CASE", "CASE_TYPE");
      const level = player.id === state.firstPlayerId ? definition.firstLevel : definition.secondLevel;
      fact(state, "CASE_SOLVE_DECLARED", player.id, partner.instanceId);
      if (player.zones.EVIDENCE.length >= level) endMatch(state, otherPlayer(state, player.id), "CASE_SOLVED");
      break;
    }
    case "END_MAIN":
      state.turn.phase = "END";
      state.frames.push({ kind: "END", step: 0 });
      break;
  }
  if (state.pendingEffects.length && state.status === "PLAYING" && state.frames.length === 0) checkpoint(state);
}
