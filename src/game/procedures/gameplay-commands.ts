import { respondContact } from "./contact-response.ts";
import type { Command, Content, GameState } from "../model.ts";
import { check, exactKeys, integer } from "../persistence/json.ts";
import { checkpoint, emit, move, orient } from "../engine/events.ts";
import { nextId, otherPlayer } from "../engine/state-helpers.ts";
import { activeSource, canPlay, enter, guardCandidates, keywords, misleadCandidates, onField, useHand } from "./gameplay-rules.ts";
import { keywordValue } from "../rules/keywords.ts";

/** Choice answers are dispatched before the ordinary Main-action gate. */
export function gameplayChoice(state: GameState, content: Content, command: Command): boolean {
  const intent = command.intent;
  if (!["CHOOSE_NEXT_HINT_CARD", "CHOOSE_SWITCH", "CHOOSE_MISLEAD", "CHOOSE_GUARD", "RESPOND_CONTACT"].includes(intent.kind)) return false;
  check("choiceId" in intent && state.choice?.id === intent.choiceId && state.choice.playerId === command.actorId, "CHOICE");
  const choice = state.choice!;
  const frame = state.frames.at(-1)!;
  const owner = command.actorId;
  switch (intent.kind) {
    case "CHOOSE_NEXT_HINT_CARD":
      check(choice.kind === "NEXT_HINT_CARD" && frame.kind === "NEXT_HINT" && frame.step === "CHOOSE", "CHOICE");
      if (intent.cardId !== null) canPlay(state, content, owner, intent.cardId);
      state.choice = null; frame.step = "DONE";
      // Child use finishes before Next Hint's pending effects are drained.
      checkpoint(state);
      if (intent.cardId !== null) useHand(state, content, owner, intent.cardId);
      return true;
    case "CHOOSE_SWITCH":
      check(choice.kind === "SWITCH" && frame.kind === "ENTRY" && state.players[owner]!.zones.FIELD.length === 5 && choice.candidates.includes(intent.cardId), "SWITCH_SELECTION");
      canPlay(state, content, owner, frame.cardId);
      check(onField(state, intent.cardId) && state.cards[intent.cardId]!.ownerId === owner, "SWITCH_SELECTION");
      state.choice = null;
      move(state, content, owner, intent.cardId, "FIELD", "REMOVE", "SWITCH");
      enter(state, content, owner, frame.cardId);
      state.frames.pop();
      if (state.frames.at(-1)?.kind !== "CHECKPOINT") checkpoint(state);
      return true;
    case "CHOOSE_MISLEAD": {
      check(choice.kind === "MISLEAD" && frame.kind === "DEDUCTION" && frame.step === "MISLEAD_WINDOW", "CHOICE");
      const candidates = misleadCandidates(state, content, owner);
      check(Array.isArray(intent.cardIds) && new Set(intent.cardIds).size === intent.cardIds.length && intent.cardIds.every(id => candidates.includes(id)), "MISLEAD_SELECTION");
      const total = intent.cardIds.reduce((sum, id) => sum + keywordValue(keywords(state, content, id), "MISLEAD_X"), 0);
      check(integer(total), "LP_RANGE");
      frame.misleadIds = [...intent.cardIds]; frame.lpReduction = total;
      // Validate the complete batch before applying its simultaneous costs.
      for (const id of intent.cardIds) orient(state, content, id, "SLEEP");
      for (const id of intent.cardIds) emit(state, content, "MISLEAD_USED", owner, id);
      frame.step = "EFFECT_CHECKPOINT"; state.choice = null;
      return true;
    }
    case "CHOOSE_GUARD":
      check(choice.kind === "GUARD" && frame.kind === "ACTION" && frame.step === "GUARD_WINDOW", "CHOICE");
      check(intent.cardId === null || guardCandidates(state, owner, content).includes(intent.cardId), "GUARD_SELECTION");
      frame.guardId = intent.cardId; frame.step = "AFTER_GUARD"; state.choice = null;
      if (intent.cardId !== null) {
        orient(state, content, intent.cardId, "SLEEP");
        emit(state, content, "GUARD_DECLARED", owner, intent.cardId);
      }
      checkpoint(state);
      return true;
    case "RESPOND_CONTACT":
      check(choice.kind === "CONTACT_RESPONSE" && frame.kind === "CONTACT" && frame.step === "CONTACT_RESPONSE", "CHOICE");
      respondContact(state, content, frame, owner, intent);
      return true;
  }
  return false;
}

export function gameplayMain(state: GameState, content: Content, command: Command): boolean {
  const intent = command.intent, owner = command.actorId;
  const player = state.players[owner]!;
  switch (intent.kind) {
    case "NEXT_HINT":
      check(player.zones.FILE.length > 0, "EMPTY_FILE");
      check(player.zones.FILE.some(id => id !== player.partnerId), "RULE_QUESTION_009");
      state.turn.usedNextHint = true;
      checkpoint(state); state.frames.push({ kind: "NEXT_HINT", playerId: owner, step: "TAKE" });
      return true;
    case "PLAY_CARD":
      check(!state.turn.normalPlayUsed && !state.turn.usedNextHint, "NORMAL_PLAY_USED");
      canPlay(state, content, owner, intent.cardId);
      checkpoint(state);
      useHand(state, content, owner, intent.cardId);
      state.turn.normalPlayUsed = true;
      if (state.frames.at(-1)?.kind === "CHECKPOINT" && !state.pendingEffects.length) state.frames.pop();
      return true;
    case "DEDUCE":
      activeSource(state, content, owner, intent.cardId, true);
      orient(state, content, intent.cardId, "SLEEP");
      emit(state, content, "DEDUCTION_DECLARED", owner, intent.cardId);
      checkpoint(state);
      state.frames.push({ kind: "DEDUCTION", id: nextId(state, "deduction"), playerId: owner, sourceId: intent.cardId, step: "DEDUCTION_DECLARE", misleadIds: [], lpReduction: 0, calculatedLP: null, sampledLP: null });
      return true;
    case "DECLARE_ACTION": {
      activeSource(state, content, owner, intent.cardId, false, intent.target?.kind);
      check(intent.target && typeof intent.target === "object", "ACTION_TARGET");
      exactKeys(intent.target, ["kind", "cardId"], "ACTION_TARGET");
      const opponent = state.players[otherPlayer(state, owner)]!;
      if (intent.target.kind === "CHARACTER") {
        check(opponent.zones.FIELD.includes(intent.target.cardId) && state.cards[intent.target.cardId]!.orientation !== "ACTIVE", "ACTION_TARGET");
      } else check(intent.target.kind === "CASE" && intent.target.cardId === opponent.caseId && opponent.zones.EVIDENCE.length > 0, "ACTION_TARGET");
      orient(state, content, intent.cardId, "SLEEP");
      emit(state, content, "ACTION_DECLARED", owner, intent.cardId);
      checkpoint(state);
      state.frames.push({ kind: "ACTION", id: nextId(state, "action"), playerId: owner, attackerId: intent.cardId, target: structuredClone(intent.target), guardId: null, step: "ACTION_DECLARE" });
      return true;
    }
    default: return false;
  }
}
