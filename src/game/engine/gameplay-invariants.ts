import { responsePlayer } from "../procedures/contact-response.ts";
import type { Choice, Content, GameState, GameplayFrame } from "../model.ts";
import { check, exactKeys, identifier, integer } from "../persistence/json.ts";
import { otherPlayer } from "./state-helpers.ts";
import { guardCandidates, handCandidates, misleadCandidates } from "../procedures/gameplay-rules.ts";
import { fixedAbilityKeywords, keywordKind, keywordValue } from "../rules/keywords.ts";

export function validateGameplayFrame(state: GameState, content: Content, frame: GameplayFrame): void {
  check(state.turn.phase === "MAIN" && frame.playerId === state.turn.playerId, "FRAME_PLAYER");
  const player = state.players[frame.playerId]!;
  const character = (id: string, owner: string) => check(Object.hasOwn(state.cards, id) && state.cards[id]!.ownerId === owner && content.definitions[state.cards[id]!.definitionId]!.type === "CHARACTER", "FRAME_REFERENCE");
  const step = (allowed: string[]) => check("step" in frame && allowed.includes(frame.step), "FRAME_STEP");
  switch (frame.kind) {
    case "NEXT_HINT":
      exactKeys(frame, ["kind", "playerId", "step"], "FRAME_SCHEMA");
      step(["TAKE", "CHOOSE", "DONE"]);
      check(state.turn.usedNextHint, "FRAME_NEXT_HINT"); break;
    case "ENTRY":
      exactKeys(frame, ["kind", "playerId", "cardId"], "FRAME_SCHEMA");
      character(frame.cardId, frame.playerId);
      check(player.zones.HAND.includes(frame.cardId) && player.zones.FIELD.length === 5, "FRAME_ENTRY"); break;
    case "DEDUCTION":
      exactKeys(frame, ["kind", "id", "playerId", "sourceId", "step", "misleadIds", "lpReduction", "calculatedLP", "sampledLP"], "FRAME_SCHEMA");
      check(identifier(frame.id) && Object.hasOwn(state.cards, frame.sourceId) && state.cards[frame.sourceId]!.ownerId === frame.playerId, "FRAME_REFERENCE");
      check(["CHARACTER", "PARTNER"].includes(content.definitions[state.cards[frame.sourceId]!.definitionId]!.type), "FRAME_REFERENCE");
      step(["DEDUCTION_DECLARE", "MISLEAD_WINDOW", "EFFECT_CHECKPOINT", "CALCULATE_LP", "GAIN_EVIDENCE", "GAIN_CHECKPOINT", "DEDUCTION_END", "DONE"]);
      check(Array.isArray(frame.misleadIds) && new Set(frame.misleadIds).size === frame.misleadIds.length && integer(frame.lpReduction), "FRAME_MISLEAD");
      frame.misleadIds.forEach(id => character(id, otherPlayer(state, frame.playerId)));
      const reduction = frame.misleadIds.reduce((sum, id) => {
        const values = fixedAbilityKeywords(state, content, id);
        check(values.some(k => keywordKind(k.kind) === "MISLEAD_X"), "FRAME_MISLEAD");
        return sum + keywordValue(values, "MISLEAD_X");
      }, 0);
      check(reduction === frame.lpReduction, "FRAME_MISLEAD");
      check(frame.calculatedLP === null || integer(frame.calculatedLP), "FRAME_LP");
      check((frame.calculatedLP !== null) === ["GAIN_EVIDENCE", "GAIN_CHECKPOINT", "DEDUCTION_END", "DONE"].includes(frame.step), "FRAME_LP");
      if (["DEDUCTION_DECLARE", "MISLEAD_WINDOW"].includes(frame.step)) check(frame.misleadIds.length === 0 && frame.lpReduction === 0, "FRAME_MISLEAD");
      if (frame.calculatedLP !== null) {
        const definition = content.definitions[state.cards[frame.sourceId]!.definitionId]!;
        check("lp" in definition && frame.calculatedLP === Math.max(0, frame.sampledLP! - frame.lpReduction), "FRAME_LP");
      }
      break;
    case "ACTION":
      exactKeys(frame, ["kind", "id", "playerId", "attackerId", "target", "guardId", "step"], "FRAME_SCHEMA");
      check(identifier(frame.id), "FRAME_ID");
      character(frame.attackerId, frame.playerId);
      exactKeys(frame.target, ["kind", "cardId"], "FRAME_TARGET");
      if (frame.target.kind === "CHARACTER") character(frame.target.cardId, otherPlayer(state, frame.playerId));
      else check(frame.target.kind === "CASE" && frame.target.cardId === state.players[otherPlayer(state, frame.playerId)]!.caseId, "FRAME_TARGET");
      if (frame.guardId !== null) character(frame.guardId, otherPlayer(state, frame.playerId));
      step(["ACTION_DECLARE", "GUARD_WINDOW", "AFTER_GUARD", "ACTION_END", "DONE"]);
      if (["ACTION_DECLARE", "GUARD_WINDOW"].includes(frame.step)) check(frame.guardId === null, "FRAME_GUARD");
      break;
    case "CONTACT":
      exactKeys(frame, ["kind", "id", "playerId", "attackerId", "defenderId", "step", "priority", "responseIndex", "responses", "priorityAP"], "FRAME_SCHEMA");
      check(identifier(frame.id), "FRAME_ID");
      character(frame.attackerId, frame.playerId); character(frame.defenderId, otherPlayer(state, frame.playerId));
      step(["CONTACT_START", "CONTACT_PRIORITY", "CONTACT_RESPONSE", "AP_COMPARE", "CONTACT_END", "DONE"]);
      check(integer(frame.responseIndex) && frame.responseIndex <= 3 && Array.isArray(frame.responses) && frame.responses.length === frame.responseIndex && frame.responses.every(r => ["PASS", "CUT_IN", "DISGUISE"].includes(r)), "FRAME_RESPONSE");
      check(frame.priority === null || (Array.isArray(frame.priority) && frame.priority.length === 2 && new Set(frame.priority).size === 2 && frame.priority.every(id => state.playerOrder.includes(id))), "FRAME_PRIORITY");
      if (frame.priority !== null) {
        const attacker = content.definitions[state.cards[frame.attackerId]!.definitionId]!;
        const defender = content.definitions[state.cards[frame.defenderId]!.definitionId]!;
        check(attacker.type === "CHARACTER" && defender.type === "CHARACTER" && frame.priority[0] === (frame.priorityAP![0] < frame.priorityAP![1] ? frame.playerId : otherPlayer(state, frame.playerId)), "FRAME_PRIORITY");
      }
      if (["CONTACT_START", "CONTACT_PRIORITY"].includes(frame.step)) check(frame.priority === null && frame.responseIndex === 0, "FRAME_PRIORITY");
      if (["CONTACT_RESPONSE", "AP_COMPARE"].includes(frame.step)) check(frame.priority !== null, "FRAME_PRIORITY");
      if (frame.step === "AP_COMPARE") check(responsePlayer(frame) === null, "FRAME_RESPONSE");
      break;
    case "CASE_ACTION":
      exactKeys(frame, ["kind", "playerId", "defenderPlayerId", "evidenceId", "step"], "FRAME_SCHEMA");
      check(frame.defenderPlayerId === otherPlayer(state, frame.playerId), "FRAME_PLAYER");
      step(["TAKE_EVIDENCE", "RELEASE_EVIDENCE", "GAIN_EVIDENCE", "DONE"]);
      if (frame.step === "TAKE_EVIDENCE") check(frame.evidenceId === null, "FRAME_EVIDENCE");
      else {
        check(frame.evidenceId !== null && Object.hasOwn(state.cards, frame.evidenceId) && state.cards[frame.evidenceId]!.ownerId === frame.defenderPlayerId, "FRAME_EVIDENCE");
        if (frame.step === "RELEASE_EVIDENCE") check(state.players[frame.defenderPlayerId]!.zones.PROCESSING.includes(frame.evidenceId), "FRAME_EVIDENCE");
      }
      break;
    default: throw new Error("UNSUPPORTED_FRAME");
  }
}

export function validateGameplayChoice(state: GameState, content: Content, choice: Choice): void {
  const frame = state.frames.at(-1);
  check(state.status === "PLAYING" || state.status === "RULE_BLOCKED", "CHOICE_STATE");
  let candidates: string[] = [];
  let owner = state.turn.playerId;
  switch (choice.kind) {
    case "NEXT_HINT_CARD":
      check(frame?.kind === "NEXT_HINT" && frame.step === "CHOOSE", "CHOICE_PROCEDURE");
      candidates = handCandidates(state, content, owner); break;
    case "SWITCH":
      check(frame?.kind === "ENTRY", "CHOICE_PROCEDURE");
      candidates = state.players[owner]!.zones.FIELD; break;
    case "MISLEAD":
      check(frame?.kind === "DEDUCTION" && frame.step === "MISLEAD_WINDOW", "CHOICE_PROCEDURE");
      owner = otherPlayer(state, owner); candidates = misleadCandidates(state, content, owner); break;
    case "GUARD":
      check(frame?.kind === "ACTION" && frame.step === "GUARD_WINDOW", "CHOICE_PROCEDURE");
      owner = otherPlayer(state, owner); candidates = guardCandidates(state, owner, content); break;
    case "CONTACT_RESPONSE":
      exactKeys(choice, ["id", "kind", "playerId"], "CHOICE_SCHEMA");
      check(frame?.kind === "CONTACT" && frame.step === "CONTACT_RESPONSE" && choice.playerId === responsePlayer(frame), "CHOICE_PROCEDURE");
      return;
    default: throw new Error("UNSUPPORTED_CHOICE");
  }
  exactKeys(choice, ["id", "kind", "playerId", "candidates"], "CHOICE_SCHEMA");
  check("candidates" in choice && choice.playerId === owner && JSON.stringify(choice.candidates) === JSON.stringify(candidates), "CHOICE_CANDIDATES");
}
