import type { GameState } from "../model.ts";
import { check } from "../persistence/json.ts";
import { isDisguiseReplacement } from "../rules/identity.ts";

/** Frames are resumable procedure continuations, never an effect-resolution stack. */
export function validateProcedures(state: GameState): void {
  const root = state.frames[0];
  if (state.status === "SETUP") {
    check(state.pendingEffects.length === 0 && Object.values(state.players).every(p => p.zones.PROCESSING.length === 0), "SETUP_PROCEDURE");
    return;
  }
  if (state.turn.phase === "AUTO" || state.turn.phase === "END") check(root?.kind === state.turn.phase, "PROCEDURE_ROOT");
  else check(!root || root.kind === "CHECKPOINT", "PROCEDURE_ROOT");
  for (let i = 1; i < state.frames.length; i++) {
    const parent = state.frames[i - 1]!, child = state.frames[i]!, grandparent = state.frames[i - 2];
    switch (parent.kind) {
      case "AUTO":
        check(parent.step >= 1 && child.kind === "CHECKPOINT", "PROCEDURE_AUTO"); break;
      case "END":
        check(parent.step === 1 && child.kind === "CHECKPOINT", "PROCEDURE_END"); break;
      case "CHECKPOINT":
        if (child.kind === "EFFECT") break;
        if (child.kind === "MOVE") {
          check((grandparent?.kind === "AUTO" && child.playerId === state.turn.playerId &&
            ((grandparent.step === 3 && child.to === "HAND" && child.remaining <= 1) || (grandparent.step === 4 && child.to === "FILE" && child.remaining <= 2))) ||
            (grandparent?.kind === "CASE_ACTION" && grandparent.step === "DONE" && child.to === "EVIDENCE" && child.playerId === grandparent.playerId && child.remaining <= 1), "PROCEDURE_CHECKPOINT");
        } else {
          check((i === 1 && state.turn.phase === "MAIN" && ["NEXT_HINT", "ENTRY", "DEDUCTION", "ACTION", "FINISH_EVENT"].includes(child.kind)) ||
            (grandparent?.kind === "NEXT_HINT" && grandparent.step === "DONE" && ["ENTRY", "FINISH_EVENT"].includes(child.kind)), "PROCEDURE_CHECKPOINT");
        }
        break;
      case "NEXT_HINT":
        check(["CHOOSE", "DONE"].includes(parent.step) && child.kind === "CHECKPOINT", "PROCEDURE_NEXT_HINT"); break;
      case "ENTRY": throw new Error("PROCEDURE_ENTRY");
      case "DEDUCTION":
        check((child.kind === "CHECKPOINT" && ["MISLEAD_WINDOW", "CALCULATE_LP", "DEDUCTION_END", "DONE"].includes(parent.step)) ||
          (child.kind === "MOVE" && parent.step === "GAIN_CHECKPOINT" && child.playerId === parent.playerId && child.to === "EVIDENCE" && child.remaining <= parent.calculatedLP!), "PROCEDURE_DEDUCTION");
        break;
      case "ACTION":
        if (child.kind === "CHECKPOINT") check(["GUARD_WINDOW", "AFTER_GUARD", "DONE"].includes(parent.step), "PROCEDURE_ACTION");
        else {
          check(parent.step === "ACTION_END" && (child.kind === "CONTACT" || child.kind === "CASE_ACTION") && child.playerId === parent.playerId, "PROCEDURE_ACTION");
          if (child.kind === "CONTACT") check(child.attackerId === parent.attackerId && (child.defenderId === (parent.guardId ?? parent.target.cardId) || isDisguiseReplacement(state, child.defenderId, parent.guardId ?? parent.target.cardId)) && (parent.guardId !== null || parent.target.kind === "CHARACTER"), "PROCEDURE_CONTACT");
          else check(parent.target.kind === "CASE" && parent.guardId === null, "PROCEDURE_CASE");
        }
        break;
      case "CONTACT":
        check(child.kind === "CHECKPOINT" && ["CONTACT_PRIORITY", "CONTACT_RESPONSE", "CONTACT_END", "DONE"].includes(parent.step), "PROCEDURE_CONTACT"); break;
      case "CASE_ACTION":
        check(child.kind === "CHECKPOINT" && parent.step !== "TAKE_EVIDENCE", "PROCEDURE_CASE"); break;
      case "FINISH_EVENT":
        check(child.kind === "EFFECT" && child.effect.sourceId === parent.cardId && child.effect.controllerId === parent.playerId, "PROCEDURE_EVENT"); break;
      case "EFFECT":
        check(parent.cursor > 0 && ["MOVE", "INVESTIGATION"].includes(child.kind), "PROCEDURE_EFFECT"); break;
      case "INVESTIGATION": throw new Error("PROCEDURE_INVESTIGATION");
      case "MOVE":
        check(child.kind === "REFRESH" && child.playerId === parent.playerId, "PROCEDURE_REFRESH"); break;
      case "REFRESH":
        check(parent.step === "DONE" && child.kind === "MOVE" && child.playerId !== parent.playerId && child.to === "EVIDENCE" && child.remaining <= 1, "PROCEDURE_PENALTY"); break;
    }
  }
  const processing = Object.values(state.players).flatMap(p => p.zones.PROCESSING);
  const finishers = state.frames.flatMap(f => f.kind === "FINISH_EVENT" ? [f.cardId] : f.kind === "CASE_ACTION" && f.step === "RELEASE_EVIDENCE" ? [f.evidenceId!] : []);
  check(processing.length === finishers.length && new Set(finishers).size === processing.length && processing.every(id => finishers.includes(id)), "PROCESSING_PROCEDURE");
  if (state.pendingEffects.length > 0) check(state.frames.some(f => f.kind === "CHECKPOINT") || state.status === "RULE_BLOCKED" || state.status === "FINISHED", "PENDING_PROCEDURE");
  if (state.choice?.kind === "EFFECT_ORDER") check(state.frames.at(-1)?.kind === "CHECKPOINT", "PROCEDURE_CHOICE");
  if (state.frames.at(-1)?.kind === "ENTRY") check(state.choice?.kind === "SWITCH", "PROCEDURE_CHOICE");
}
