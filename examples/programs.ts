import type { EffectProgram, Instruction } from "../src/game/index.ts";

// Explicit contracts for the already tested Phase 1/2 synthetic opcodes.
// This authoring helper is not an Engine input fallback or a card-text compiler.
export function coreProgram(instructions: Instruction[]): EffectProgram {
  const field = instructions.some(i => ["SET_SOURCE_STATE", "REMOVE_SOURCE", "SUPPRESS_SOURCE_ABILITIES"].includes(i.op));
  return { sourceRequirements: field ? "FIELD_ENTRY" : "INDEPENDENT", targetSelectionPoint: field ? "RESOLUTION" : "NONE",
    targetZone: field ? "FIELD" : "NONE", duration: "INSTANT", invalidTargetBehavior: "BLOCK", instructions };
}
