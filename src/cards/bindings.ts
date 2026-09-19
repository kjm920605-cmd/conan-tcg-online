import type { CardDefinition, EffectProgram } from "../game/model.ts";
import { check } from "../game/persistence/json.ts";

export function programBindings(definition: CardDefinition) {
  return [
    ...definition.triggers.map(t => ({ programId: t.programId, timing: t.event })),
    ...(definition.cutIns ?? []).map(a => ({ programId: a.programId, timing: "CUT_IN" })),
    ...(definition.type === "CHARACTER" ? (definition.declarations ?? []).map(a => ({ programId: a.programId, timing: "OWN_MAIN" })) : []),
    ...(definition.type === "EVENT" ? [{ programId: definition.programId, timing: "HAND_USE" }] : []),
  ];
}

/** Narrow authoring checks, not new timing/target rules. Reject impossible bindings early. */
export function validateBindings(definition: CardDefinition, programs: Record<string, EffectProgram>): void {
  const contact = ["CUT_IN", "CONTACT_STARTED", "CONTACT_PRIORITY", "AP_COMPARED"];
  const openContact = ["CUT_IN", "CONTACT_STARTED", "CONTACT_PRIORITY"];
  const action = [...contact, "ACTION_DECLARED", "GUARD_DECLARED", "CONTACT_ENDED"];
  for (const binding of programBindings(definition)) {
    const program = programs[binding.programId]!;
    if (program.sourceRequirements === "FIELD_ENTRY") {
      check(definition.type === "CHARACTER" && !["CHARACTER_REMOVED", "CARD_MOVED"].includes(binding.timing), "RULE_QUESTION_014", "This binding cannot guarantee its original field source");
    }
    if (program.duration === "UNTIL_CONTACT_END") check(openContact.includes(binding.timing), "RULE_QUESTION_023", "No supported open Contact scope at this binding");
    if (program.duration === "UNTIL_ACTION_END") check(action.includes(binding.timing), "RULE_QUESTION_023", "No supported open Action scope at this binding");
    if (program.duration === "UNTIL_TURN_END") check(binding.timing !== "TURN_END", "RULE_QUESTION_023", "Cannot create a modifier in its closing scope");
    for (const instruction of program.instructions) {
      if ("target" in instruction && instruction.target === "OWN_CONTACT") check(contact.includes(binding.timing), "RULE_QUESTION_014", "OWN_CONTACT requires a supported Contact binding");
      if (instruction.op === "INVOKE_KEYWORD") check(definition.type === "CHARACTER" && definition.keywords?.some(k => k.kind === "INVESTIGATE_X"), "RULE_QUESTION_014", "Investigate requires fixed keyword text on this definition");
    }
  }
}
