import type { Content, GameState, GameplayFrame } from "../model.ts";
import { checkpoint, emit } from "../engine/events.ts";
import { block, nextId, otherPlayer } from "../engine/state-helpers.ts";
import { check, integer } from "../persistence/json.ts";
import { misleadCandidates, onField } from "./gameplay-rules.ts";
import { currentStat } from "../rules/modifiers.ts";

export function deductionStep(state: GameState, content: Content, frame: Extract<GameplayFrame, { kind: "DEDUCTION" }>): void {
  switch (frame.step) {
    case "DEDUCTION_DECLARE":
      frame.step = "MISLEAD_WINDOW"; checkpoint(state); break;
    case "MISLEAD_WINDOW": {
      const opponent = otherPlayer(state, frame.playerId);
      const candidates = misleadCandidates(state, content, opponent);
      if (candidates.length) state.choice = { id: nextId(state, "choice"), kind: "MISLEAD", playerId: opponent, candidates };
      else frame.step = "EFFECT_CHECKPOINT";
      break;
    }
    case "EFFECT_CHECKPOINT":
      frame.step = "CALCULATE_LP"; checkpoint(state); break;
    case "CALCULATE_LP": {
      const card = state.cards[frame.sourceId]!;
      if (!onField(state, card.instanceId) && !state.players[frame.playerId]!.zones.PARTNER.includes(card.instanceId)) {
        block(state, "RULE-QUESTION-012", "Deduction source departure and LP sampling need a ruling"); break;
      }
      const definition = content.definitions[card.definitionId]!;
      check(definition.type === "CHARACTER" || definition.type === "PARTNER", "DEDUCTION_SOURCE");
      frame.sampledLP = currentStat(state, content, frame.sourceId, "LP");
      frame.calculatedLP = Math.max(0, frame.sampledLP - frame.lpReduction);
      check(integer(frame.calculatedLP), "LP_RANGE");
      frame.step = "GAIN_EVIDENCE"; break;
    }
    case "GAIN_EVIDENCE":
      frame.step = "GAIN_CHECKPOINT";
      state.frames.push({ kind: "MOVE", playerId: frame.playerId, to: "EVIDENCE", remaining: frame.calculatedLP! });
      break;
    case "GAIN_CHECKPOINT":
      frame.step = "DEDUCTION_END"; checkpoint(state); break;
    case "DEDUCTION_END":
      emit(state, content, "DEDUCTION_ENDED", frame.playerId, frame.sourceId);
      frame.step = "DONE"; checkpoint(state); break;
    case "DONE": state.frames.pop(); break;
  }
}
