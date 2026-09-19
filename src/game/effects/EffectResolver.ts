import type { Content, Frame, GameState, Instruction } from "../model.ts";
import { block, fact, otherPlayer } from "../engine/state-helpers.ts";
import { move, orient } from "../engine/events.ts";
import { check } from "../persistence/json.ts";
import { explicitInstruction } from "./explicit.ts";
import { fixedAbilityKeywords, keywordValue } from "../rules/keywords.ts";

type EffectFrame = Extract<Frame, { kind: "EFFECT" }>;
type Operation = (state: GameState, frame: EffectFrame, instruction: Instruction, content: Content) => void;
const operations: Record<Instruction["op"], Operation> = {
  DRAW: moveInstruction,
  GAIN_EVIDENCE: moveInstruction,
  ADD_FILE: moveInstruction,
  REMOVE_TOP: moveInstruction,
  REMOVE: explicitOperation, MOVE: explicitOperation, ACTIVE: explicitOperation, SLEEP: explicitOperation, STUN: explicitOperation,
  AP_MOD: explicitOperation, LP_MOD: explicitOperation,
  SET_CARD: explicitOperation, STACK_UNDER: explicitOperation,
  INVOKE_KEYWORD(state, frame, _instruction, content) {
    const card = fieldSource(state, frame);
    if (!card) return;
    const values = fixedAbilityKeywords(state, content, card.instanceId);
    if (!values.some(k => k.kind === "INVESTIGATE_X")) {
      block(state, "RULE-QUESTION-014", "An already triggered Investigate requires verified fixed keyword text"); return;
    }
    state.frames.push({ kind: "INVESTIGATION", playerId: frame.effect.controllerId, deckOwnerId: otherPlayer(state, frame.effect.controllerId),
      sourceId: card.instanceId, count: keywordValue(values, "INVESTIGATE_X"), revealed: [], step: "REVEAL" });
  },
  REMOVE_SOURCE(state, frame, _instruction, content) {
    const card = fieldSource(state, frame);
    if (card) move(state, content, card.ownerId, card.instanceId, "FIELD", "REMOVE", "EFFECT");
  },
  SUPPRESS_SOURCE_ABILITIES(state, frame) {
    const card = fieldSource(state, frame);
    if (card) {
      card.abilitiesSuppressed = true;
      fact(state, "ABILITIES_SUPPRESSED", card.ownerId, card.instanceId);
    }
  },
  SET_SOURCE_STATE(state, frame, instruction, content) {
    check(instruction.op === "SET_SOURCE_STATE", "OPCODE");
    const card = fieldSource(state, frame);
    if (card) orient(state, content, card.instanceId, instruction.state);
  },
};
function fieldSource(state: GameState, frame: EffectFrame) {
  const card = state.cards[frame.effect.sourceId]!;
  if (state.players[card.ownerId]!.zones.FIELD.includes(card.instanceId) && card.entryId === frame.effect.sourceEntryId) return card;
  block(state, "RULE-QUESTION-014", "Source identity outside its original field location is unconfirmed");
  return null;
}
function explicitOperation(state: GameState, frame: EffectFrame, instruction: Instruction, content: Content): void {
  explicitInstruction(state, content, frame.effect, instruction);
}
function moveInstruction(state: GameState, frame: EffectFrame, instruction: Instruction): void {
  check("player" in instruction, "OPCODE");
  const playerId = instruction.player === "SELF" ? frame.effect.controllerId : otherPlayer(state, frame.effect.controllerId);
  const to = { DRAW: "HAND", GAIN_EVIDENCE: "EVIDENCE", ADD_FILE: "FILE", REMOVE_TOP: "REMOVE" } as const;
  // p.20: removal effects only remove the original available cards, never refill the shortfall.
  const remaining = instruction.op === "REMOVE_TOP" ? Math.min(instruction.count, state.players[playerId]!.zones.DECK.length) : instruction.count;
  state.frames.push({ kind: "MOVE", playerId, to: to[instruction.op], remaining });
}
export class EffectResolver {
  static step(state: GameState, content: Content, frame: EffectFrame): void {
    const program = content.programs[frame.effect.programId]!.instructions;
    if (frame.cursor === 0 && content.programs[frame.effect.programId]!.sourceRequirements === "FIELD_ENTRY" && !fieldSource(state, frame)) return;
    if (frame.cursor === 0 && content.programs[frame.effect.programId]!.condition === "TRACE_DISCOVERED" && !state.players[frame.effect.controllerId]!.traceDiscovered) frame.cursor = program.length;
    if (frame.cursor === program.length) {
      state.frames.pop();
      fact(state, "EFFECT_RESOLVED", frame.effect.controllerId, frame.effect.sourceId, frame.effect.id);
      return;
    }
    const instruction = program[frame.cursor]!;
    check(!!operations[instruction.op], "UNSUPPORTED_OPCODE");
    // Save the next instruction before a child operation can trigger Refresh.
    frame.cursor++;
    operations[instruction.op](state, frame, instruction, content);
  }
}
