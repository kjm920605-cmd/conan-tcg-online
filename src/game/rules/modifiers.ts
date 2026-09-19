import type { Content, Duration, GameState, PendingEffect } from "../model.ts";
import { activeEntry } from "./identity.ts";
import { block, fact, nextId } from "../engine/state-helpers.ts";
import { check, integer } from "../persistence/json.ts";

export function currentStat(state: GameState, content: Content, cardId: string, stat: "AP" | "LP"): number {
  const definition = content.definitions[state.cards[cardId]!.definitionId]!;
  const base = stat === "AP" && definition.type === "CHARACTER" ? definition.ap : stat === "LP" && "lp" in definition ? definition.lp : 0;
  const entry = activeEntry(state, cardId);
  const value = base + Object.values(state.modifiers).reduce((sum, m) => sum + (entry && m.targetEntryId === entry.entryId && m.stat === stat ? m.value : 0), 0);
  check(integer(value, Number.MIN_SAFE_INTEGER), "STAT_RANGE");
  return value;
}
export function addModifier(state: GameState, cardId: string, effect: PendingEffect, stat: "AP" | "LP", value: number, duration: Duration): void {
  const entry = activeEntry(state, cardId);
  if (!entry) { block(state, "RULE-QUESTION-014", "Modifier target is outside the confirmed field occurrence"); return; }
  if (stat === "LP" && state.frames.some(f => f.kind === "DEDUCTION" && f.sourceId === cardId && ["GAIN_EVIDENCE", "GAIN_CHECKPOINT"].includes(f.step))) {
    block(state, "RULE-QUESTION-012", "LP mutation during evidence quantity processing is not adjudicated"); return;
  }
  const scope = duration === "UNTIL_CONTACT_END" ? state.frames.findLast(f => f.kind === "CONTACT") :
    duration === "UNTIL_ACTION_END" ? state.frames.findLast(f => f.kind === "ACTION") : null;
  if ((duration === "UNTIL_TURN_END" && state.turn.phase === "END") ||
      (scope?.kind === "CONTACT" && ["CONTACT_END", "DONE"].includes(scope.step)) ||
      (scope?.kind === "ACTION" && scope.step === "DONE")) {
    block(state, "RULE-QUESTION-023", "Creating a modifier inside its own ending window is not adjudicated"); return;
  }
  if (duration !== "UNTIL_TURN_END" && !scope) { block(state, "RULE-QUESTION-023", "The duration has no active scope"); return; }
  const scopeId = scope && "id" in scope ? scope.id : "turn-" + state.turn.number;
  const id = nextId(state, "modifier");
  state.modifiers[id] = { id, targetEntryId: entry.entryId, sourceEffectId: effect.id, stat, value, duration, scopeId };
  fact(state, "MODIFIER_ADDED", effect.controllerId, cardId, id);
}
/** No trigger detection here: expiry-trigger content is rejected at load (RQ-023). */
export function expireModifiers(state: GameState, duration: Duration, scopeId: string): void {
  for (const [id, modifier] of Object.entries(state.modifiers)) if (modifier.duration === duration && modifier.scopeId === scopeId) {
    delete state.modifiers[id];
    fact(state, "MODIFIER_EXPIRED", null, null, id);
  }
}
