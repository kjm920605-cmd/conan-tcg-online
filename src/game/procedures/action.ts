import { responsePlayer } from "./contact-response.ts";
import type { Content, GameState, GameplayFrame } from "../model.ts";
import { checkpoint, emit, move } from "../engine/events.ts";
import { block, nextId, otherPlayer } from "../engine/state-helpers.ts";
import { check } from "../persistence/json.ts";
import { guardCandidates, onField } from "./gameplay-rules.ts";
import { currentStat, expireModifiers } from "../rules/modifiers.ts";

export function actionStep(state: GameState, content: Content, frame: Extract<GameplayFrame, { kind: "ACTION" }>): void {
  const owner = frame.playerId, opponent = otherPlayer(state, owner);
  switch (frame.step) {
    case "ACTION_DECLARE":
      frame.step = "GUARD_WINDOW"; checkpoint(state); break;
    case "GUARD_WINDOW": {
      if (!onField(state, frame.attackerId) || (frame.target.kind === "CHARACTER" && !onField(state, frame.target.cardId))) {
        block(state, "RULE-QUESTION-013", "Pre-Guard departure: Action-end trigger semantics are unconfirmed"); break;
      }
      const candidates = guardCandidates(state, opponent, content);
      if (candidates.length) state.choice = { id: nextId(state, "choice"), kind: "GUARD", playerId: opponent, candidates };
      else frame.step = "AFTER_GUARD";
      break;
    }
    case "AFTER_GUARD":
      if (!onField(state, frame.attackerId) || (frame.guardId !== null && !onField(state, frame.guardId)) || (frame.guardId === null && frame.target.kind === "CHARACTER" && !onField(state, frame.target.cardId))) {
        block(state, "RULE-QUESTION-013", "Participant departure between Guard and Contact requires a ruling"); break;
      }
      frame.step = "ACTION_END";
      if (frame.guardId !== null || frame.target.kind === "CHARACTER") {
        state.frames.push({ kind: "CONTACT", id: nextId(state, "contact"), playerId: owner, attackerId: frame.attackerId, defenderId: frame.guardId ?? frame.target.cardId, step: "CONTACT_START", priority: null, responseIndex: 0, responses: [], priorityAP: null });
      } else state.frames.push({ kind: "CASE_ACTION", playerId: owner, defenderPlayerId: opponent, evidenceId: null, step: "TAKE_EVIDENCE" });
      break;
    case "ACTION_END":
      emit(state, content, "ACTION_ENDED", owner, frame.attackerId);
      frame.step = "DONE"; checkpoint(state); break;
    case "DONE":
      expireModifiers(state, "UNTIL_ACTION_END", frame.id);
      state.frames.pop(); break;
  }
}
export function contactStep(state: GameState, content: Content, frame: Extract<GameplayFrame, { kind: "CONTACT" }>): void {
  if (!["CONTACT_END", "DONE"].includes(frame.step) && (!onField(state, frame.attackerId) || !onField(state, frame.defenderId))) frame.step = "CONTACT_END";
  switch (frame.step) {
    case "CONTACT_START":
      emit(state, content, "CONTACT_STARTED", frame.playerId, frame.attackerId);
      frame.step = "CONTACT_PRIORITY"; checkpoint(state); break;
    case "CONTACT_PRIORITY": {
      const attack = content.definitions[state.cards[frame.attackerId]!.definitionId]!;
      const defend = content.definitions[state.cards[frame.defenderId]!.definitionId]!;
      check(attack.type === "CHARACTER" && defend.type === "CHARACTER", "CONTACT_TYPE");
      frame.priorityAP = [currentStat(state, content, frame.attackerId, "AP"), currentStat(state, content, frame.defenderId, "AP")];
      const first = frame.priorityAP[0] < frame.priorityAP[1] ? frame.playerId : otherPlayer(state, frame.playerId);
      frame.priority = [first, otherPlayer(state, first)];
      frame.step = "CONTACT_RESPONSE";
      emit(state, content, "CONTACT_PRIORITY", first, null, frame.priority.join(","));
      checkpoint(state); break;
    }
    case "CONTACT_RESPONSE":
      if (responsePlayer(frame) === null) frame.step = "AP_COMPARE";
      else state.choice = { id: nextId(state, "choice"), kind: "CONTACT_RESPONSE", playerId: responsePlayer(frame)! };
      break;
    case "AP_COMPARE": {
      const attack = content.definitions[state.cards[frame.attackerId]!.definitionId]!;
      const defend = content.definitions[state.cards[frame.defenderId]!.definitionId]!;
      check(attack.type === "CHARACTER" && defend.type === "CHARACTER", "CONTACT_TYPE");
      const attackAP = currentStat(state, content, frame.attackerId, "AP"), defendAP = currentStat(state, content, frame.defenderId, "AP");
      emit(state, content, "AP_COMPARED", frame.playerId, frame.attackerId, attackAP + ">=" + defendAP);
      if (attackAP >= defendAP) move(state, content, state.cards[frame.defenderId]!.ownerId, frame.defenderId, "FIELD", "REMOVE", "AP_COMPARE");
      frame.step = "CONTACT_END"; checkpoint(state); break;
    }
    case "CONTACT_END":
      expireModifiers(state, "UNTIL_CONTACT_END", frame.id);
      emit(state, content, "CONTACT_ENDED", frame.playerId, frame.attackerId);
      frame.step = "DONE"; checkpoint(state); break;
    case "DONE": state.frames.pop(); break;
  }
}
export function caseActionStep(state: GameState, content: Content, frame: Extract<GameplayFrame, { kind: "CASE_ACTION" }>): void {
  switch (frame.step) {
    case "TAKE_EVIDENCE": {
      const id = state.players[frame.defenderPlayerId]!.zones.EVIDENCE[0];
      if (!id) { block(state, "RULE-QUESTION-013", "Case lost its evidence before the Case action"); break; }
      frame.evidenceId = id;
      move(state, content, frame.defenderPlayerId, id, "EVIDENCE", "PROCESSING", "CASE_ACTION");
      frame.step = "RELEASE_EVIDENCE"; checkpoint(state); break;
    }
    case "RELEASE_EVIDENCE":
      // Inspiration programs are rejected by content validation in this phase.
      move(state, content, frame.defenderPlayerId, frame.evidenceId!, "PROCESSING", "REMOVE", "CASE_ACTION");
      frame.step = "GAIN_EVIDENCE"; checkpoint(state); break;
    case "GAIN_EVIDENCE":
      frame.step = "DONE"; checkpoint(state);
      state.frames.push({ kind: "MOVE", playerId: frame.playerId, to: "EVIDENCE", remaining: 1 });
      break;
    case "DONE": state.frames.pop(); break;
  }
}
