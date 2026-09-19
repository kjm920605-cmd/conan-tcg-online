import type { EffectProgram } from "../model.ts";
import { check, exactKeys, integer } from "../persistence/json.ts";

export function validateProgram(program: EffectProgram): void {
  check(program && typeof program === "object" && !Array.isArray(program), "UNSUPPORTED_PROGRAM");
  exactKeys(program, ["sourceRequirements", "targetSelectionPoint", "targetZone", "duration", "invalidTargetBehavior", "instructions", "condition"], "RULE_QUESTION_014");
  check(program.condition === undefined || program.condition === "TRACE_DISCOVERED", "UNSUPPORTED_CONDITION");
  check(["INDEPENDENT", "FIELD_ENTRY"].includes(program.sourceRequirements), "RULE_QUESTION_014");
  check(["NONE", "RESOLUTION"].includes(program.targetSelectionPoint) && ["NONE", "FIELD"].includes(program.targetZone) && program.invalidTargetBehavior === "BLOCK", "RULE_QUESTION_014");
  check(["INSTANT", "UNTIL_CONTACT_END", "UNTIL_ACTION_END", "UNTIL_TURN_END"].includes(program.duration), "RULE_QUESTION_023");
  check(Array.isArray(program.instructions), "UNSUPPORTED_PROGRAM");
  for (const instruction of program.instructions) {
    check(instruction && typeof instruction === "object", "UNSUPPORTED_PROGRAM");
    if (["DRAW", "GAIN_EVIDENCE", "ADD_FILE", "REMOVE_TOP"].includes(instruction.op)) {
      exactKeys(instruction, ["op", "player", "count"], "UNSUPPORTED_PROGRAM");
      check("player" in instruction && ["SELF", "OPPONENT"].includes(instruction.player) && integer(instruction.count), "PROGRAM_ARGUMENT");
    } else if (["SET_SOURCE_STATE", "REMOVE_SOURCE", "SUPPRESS_SOURCE_ABILITIES"].includes(instruction.op)) {
      exactKeys(instruction, instruction.op === "SET_SOURCE_STATE" ? ["op", "state"] : ["op"], "UNSUPPORTED_PROGRAM");
      if (instruction.op === "SET_SOURCE_STATE") check(["ACTIVE", "SLEEP", "STUN"].includes(instruction.state), "PROGRAM_STATE");
      check(program.sourceRequirements === "FIELD_ENTRY" && program.targetSelectionPoint === "RESOLUTION" && program.targetZone === "FIELD", "RULE_QUESTION_014");
    } else if (instruction.op === "INVOKE_KEYWORD") {
      exactKeys(instruction, ["op", "keyword"], "UNSUPPORTED_PROGRAM");
      check(instruction.keyword === "INVESTIGATE_X", "UNSUPPORTED_KEYWORD");
      check(program.sourceRequirements === "FIELD_ENTRY" && program.targetSelectionPoint === "RESOLUTION" && program.targetZone === "FIELD", "RULE_QUESTION_014");
    } else {
      check(["REMOVE", "MOVE", "ACTIVE", "SLEEP", "STUN", "AP_MOD", "LP_MOD", "SET_CARD", "STACK_UNDER"].includes(instruction.op), "UNSUPPORTED_OPCODE");
      check("target" in instruction && ["SOURCE", "OWN_CONTACT"].includes(instruction.target) && program.targetSelectionPoint === "RESOLUTION" && program.targetZone === "FIELD", "RULE_QUESTION_014");
      if (instruction.target === "SOURCE") check(program.sourceRequirements === "FIELD_ENTRY", "RULE_QUESTION_014");
      if (instruction.op === "AP_MOD" || instruction.op === "LP_MOD") {
        exactKeys(instruction, ["op", "target", "value"], "UNSUPPORTED_PROGRAM");
        check(integer(instruction.value, Number.MIN_SAFE_INTEGER), "PROGRAM_ARGUMENT");
        check(program.duration !== "INSTANT", "RULE_QUESTION_023");
      } else if (instruction.op === "SET_CARD" || instruction.op === "STACK_UNDER") {
        exactKeys(instruction, ["op", "target", "count"], "UNSUPPORTED_PROGRAM");
        check(integer(instruction.count), "PROGRAM_ARGUMENT");
        // p.20 explicitly covers multi-card deck-top Set continuation.
        check(instruction.op !== "STACK_UNDER" || instruction.count <= 1, "UNSUPPORTED_STACK_BATCH");
      } else if (instruction.op === "MOVE") {
        exactKeys(instruction, ["op", "target", "from", "to"], "RULE_QUESTION_014");
        check(instruction.from === "FIELD" && ["HAND", "REMOVE", "DECK"].includes(instruction.to), "RULE_QUESTION_027");
      } else exactKeys(instruction, ["op", "target"], "UNSUPPORTED_PROGRAM");
    }
  }
}
