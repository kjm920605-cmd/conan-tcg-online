import type { Content, GameState, Rng } from "../model.ts";
import { block, endMatch, fact, nextId, otherPlayer } from "../engine/state-helpers.ts";
import { EffectQueue } from "../effects/EffectQueue.ts";
import { EffectResolver } from "../effects/EffectResolver.ts";
import { shuffle } from "../random/rng.ts";
import { move, emit, orient, checkpoint } from "../engine/events.ts";
import { handCandidates } from "./gameplay-rules.ts";
import { deductionStep } from "./deduction.ts";
import { actionStep, contactStep, caseActionStep } from "./action.ts";
import { check } from "../persistence/json.ts";
import { expireModifiers } from "../rules/modifiers.ts";
import { investigationStep } from "./investigation.ts";

export function advanceState(state: GameState, content: Content, rng: Rng): boolean {
  if (state.status !== "PLAYING" || state.choice || !state.frames.length) return false;
  const frame = state.frames.at(-1)!;
  switch (frame.kind) {
    case "INVESTIGATION": investigationStep(state, frame); break;
    case "NEXT_HINT": {
      if (frame.step === "TAKE") {
        const player = state.players[frame.playerId]!;
        const id = player.zones.FILE.find(id => id !== player.partnerId)!;
        check(id, "RULE_QUESTION_009");
        move(state, content, player.id, id, "FILE", "HAND", "NEXT_HINT");
        emit(state, content, "NEXT_HINT_TAKEN", player.id, id);
        frame.step = "CHOOSE"; checkpoint(state);
      } else if (frame.step === "CHOOSE") {
        state.choice = { id: nextId(state, "choice"), kind: "NEXT_HINT_CARD", playerId: frame.playerId, candidates: handCandidates(state, content, frame.playerId) };
      } else state.frames.pop();
      break;
    }
    case "ENTRY": throw new Error("MISSING_SWITCH_CHOICE");
    case "DEDUCTION": deductionStep(state, content, frame); break;
    case "ACTION": actionStep(state, content, frame); break;
    case "CONTACT": contactStep(state, content, frame); break;
    case "CASE_ACTION": caseActionStep(state, content, frame); break;
    case "AUTO": {
      const player = state.players[state.turn.playerId]!;
      switch (frame.step++) {
        case 0:
          if (player.assistReturnOnOwnAuto) {
            move(state, content, player.id, player.partnerId, "FILE", "PARTNER");
            player.assistReturnOnOwnAuto = false;
          }
          // A slept Partner that stayed in Partner Area also becomes Active.
          if (state.cards[player.partnerId]!.orientation !== "ACTIVE") {
            state.cards[player.partnerId]!.orientation = "ACTIVE";
            emit(state, content, "ORIENTATION_CHANGED", player.id, player.partnerId, "ACTIVE");
          }
          fact(state, "AUTO_PARTNER", player.id, player.partnerId);
          if (state.pendingEffects.length) checkpoint(state);
          break;
        case 1:
          for (const id of player.zones.FIELD) {
            orient(state, content, id, "ACTIVE");
          }
          fact(state, "AUTO_CHARACTERS", player.id);
          if (state.pendingEffects.length) checkpoint(state);
          break;
        case 2:
          checkpoint(state);
          state.frames.push({ kind: "MOVE", playerId: player.id, to: "HAND", remaining: 1 });
          break;
        case 3:
          checkpoint(state);
          state.frames.push({ kind: "MOVE", playerId: player.id, to: "FILE", remaining: state.turn.number === 1 && player.id === state.firstPlayerId ? 1 : 2 });
          break;
        case 4:
          state.frames.pop(); state.turn.phase = "MAIN";
          fact(state, "MAIN_STARTED", player.id);
          break;
        default: throw new Error("FRAME_STEP");
      }
      break;
    }
    case "MOVE": {
      if (frame.remaining === 0) { state.frames.pop(); break; }
      const player = state.players[frame.playerId]!;
      const id = player.zones.DECK[0];
      check(id, "EMPTY_DECK_WITHOUT_REFRESH");
      if (frame.to === "SET" || frame.to === "UNDER") {
        if (!frame.hostEntryId || state.entries[frame.hostEntryId]?.status !== "PRESENT") {
          block(state, "RULE-QUESTION-014", "Attachment host left its confirmed occurrence"); break;
        }
        state.cards[id]!.attachment = { kind: frame.to, hostEntryId: frame.hostEntryId };
      }
      move(state, content, player.id, id, "DECK", frame.to);
      frame.remaining--;
      if (frame.to === "HAND") {
        emit(state, content, "CARD_DRAWN", player.id, id);
      }
      // Keep the interrupt even if an unconfirmed trigger checkpoint blocks progress.
      if (!player.zones.DECK.length) state.frames.push({ kind: "REFRESH", playerId: player.id, step: "REBUILD" });
      break;
    }
    case "REFRESH": {
      const player = state.players[frame.playerId]!;
      if (frame.step === "REBUILD") {
        const opponent = state.players[otherPlayer(state, player.id)]!;
        if (!player.zones.DECK.length && !opponent.zones.DECK.length) {
          block(state, "RULE-QUESTION-002", "Simultaneous empty decks require an official ruling");
        } else if (!player.zones.REMOVE.length) {
          endMatch(state, player.id, "EMPTY_DECK");
        } else {
          for (const id of [...player.zones.REMOVE].reverse()) move(state, content, player.id, id, "REMOVE", "DECK", "REFRESH");
          shuffle(state, rng, player.zones.DECK);
          fact(state, "REFRESHED", player.id);
          opponent.traceDiscovered = true;
          fact(state, "TRACE_DISCOVERED", opponent.id);
          frame.step = "PENALTY";
        }
      } else if (frame.step === "PENALTY") {
        frame.step = "DONE";
        state.frames.push({ kind: "MOVE", playerId: otherPlayer(state, player.id), to: "EVIDENCE", remaining: 1 });
      } else {
        state.frames.pop();
      }
      break;
    }
    case "CHECKPOINT": {
      const eligible = EffectQueue.eligible(state);
      if (!eligible.length) { state.frames.pop(); break; }
      state.choice = { id: nextId(state, "choice"), kind: "EFFECT_ORDER", playerId: eligible[0]!.controllerId, candidates: eligible.map(e => e.id) };
      fact(state, "EFFECT_CHOICE_OPENED", state.choice.playerId, null, state.choice.id);
      break;
    }
    case "EFFECT": EffectResolver.step(state, content, frame); break;
    case "FINISH_EVENT":
      move(state, content, frame.playerId, frame.cardId, "PROCESSING", "REMOVE");
      state.frames.pop();
      break;
    case "END":
      switch (frame.step++) {
        case 0:
          emit(state, content, "TURN_END", state.turn.playerId);
          state.frames.push({ kind: "CHECKPOINT" });
          break;
        case 1:
          expireModifiers(state, "UNTIL_TURN_END", "turn-" + state.turn.number);
          fact(state, "END_EFFECTS_EXPIRED", state.turn.playerId);
          break;
        case 2:
          state.frames.pop();
          state.turn = { number: state.turn.number + 1, playerId: otherPlayer(state, state.turn.playerId), phase: "AUTO", normalPlayUsed: false, usedNextHint: false };
          state.frames.push({ kind: "AUTO", step: 0 });
          fact(state, "TURN_STARTED", state.turn.playerId);
          break;
        default: throw new Error("FRAME_STEP");
      }
      break;
  }
  return true;
}
