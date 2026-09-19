import type { Content, GameState, Instruction, PendingEffect } from "../model.ts";
import { activeEntry } from "../rules/identity.ts";
import { addModifier } from "../rules/modifiers.ts";
import { block } from "../engine/state-helpers.ts";
import { move, orient } from "../engine/events.ts";

export function explicitInstruction(state: GameState, content: Content, effect: PendingEffect, instruction: Instruction): void {
  if (!("target" in instruction)) return;
  const contact = state.frames.findLast(f => f.kind === "CONTACT");
  const cardId = instruction.target === "SOURCE" ? effect.sourceId :
    contact?.kind === "CONTACT" ? (contact.playerId === effect.controllerId ? contact.attackerId : contact.defenderId) : null;
  if (!cardId || !activeEntry(state, cardId) || (instruction.target === "SOURCE" && effect.sourceEntryId !== state.cards[cardId]!.entryId)) {
    block(state, "RULE-QUESTION-014", "No confirmed field target; no rebinding or cross-zone fallback"); return;
  }
  const card = state.cards[cardId]!;
  switch (instruction.op) {
    case "ACTIVE": case "SLEEP": case "STUN": orient(state, content, cardId, instruction.op); break;
    case "REMOVE": move(state, content, card.ownerId, cardId, "FIELD", "REMOVE", "EFFECT"); break;
    case "MOVE": move(state, content, card.ownerId, cardId, instruction.from, instruction.to, "EFFECT"); break;
    case "AP_MOD": case "LP_MOD": {
      const duration = content.programs[effect.programId]!.duration;
      if (duration !== "INSTANT") addModifier(state, cardId, effect, instruction.op === "AP_MOD" ? "AP" : "LP", instruction.value, duration);
      break;
    }
    case "SET_CARD": case "STACK_UNDER":
      state.frames.push({ kind: "MOVE", playerId: card.ownerId, to: instruction.op === "SET_CARD" ? "SET" : "UNDER", remaining: instruction.count, hostEntryId: card.entryId! });
      break;
  }
}
