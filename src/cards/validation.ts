import type { EffectProgram } from "../game/model.ts";
import { validateProgram } from "../game/content/programs.ts";
import { validateContent } from "../game/content/validate.ts";
import { assertJson, check, exactKeys, identifier, integer, RuleError } from "../game/persistence/json.ts";
import { validateBindings } from "./bindings.ts";
import type { CatalogCard, ProgramRecord } from "./model.ts";

function record(value: unknown): asserts value is Record<string, unknown> {
  check(value && typeof value === "object" && !Array.isArray(value), "CATALOG_OBJECT");
}
function strings(value: unknown): asserts value is string[] {
  check(Array.isArray(value) && value.every(identifier) && new Set(value).size === value.length, "CATALOG_IDENTIFIERS");
}
function questions(value: unknown): asserts value is string[] {
  strings(value);
  check(value.every(id => /^RULE-QUESTION-0(0[1-9]|1[0-9]|2[0-8])$/.test(id)), "CATALOG_RULE_QUESTION");
}
export function validateEffectProgram(value: unknown): asserts value is ProgramRecord {
  assertJson(value); record(value); exactKeys(value, ["programId", "program"], "CATALOG_PROGRAM_FIELDS");
  check(identifier(value.programId), "CATALOG_PROGRAM_ID");
  validateProgram(value.program as EffectProgram);
  const program = value.program as EffectProgram;
  for (const instruction of program.instructions) {
    if (["SET_CARD", "STACK_UNDER", "MOVE"].includes(instruction.op)) check("target" in instruction && instruction.target === "SOURCE", "RULE_QUESTION_014", "This opcode profile only supports SOURCE");
  }
}

export function validateCardDefinition(value: unknown, programs: Record<string, EffectProgram>): asserts value is CatalogCard {
  assertJson(value); record(value);
  exactKeys(value, ["cardId", "provenance", "supportStatus", "blockedBy", "mechanics", "unsupportedMechanics", "definition"], "CATALOG_CARD_FIELDS");
  check(identifier(value.cardId), "CATALOG_CARD_ID");
  record(value.provenance); exactKeys(value.provenance, ["kind", "description"], "CATALOG_PROVENANCE");
  check(value.provenance.kind === "FIXTURE" && typeof value.provenance.description === "string" && value.provenance.description.trim().length > 0, "UNSUPPORTED_PROVENANCE", "This catalog only contains explicitly synthetic FIXTURE data");
  check(["SUPPORTED", "PARTIAL", "BLOCKED"].includes(value.supportStatus as string), "CATALOG_SUPPORT_STATUS");
  questions(value.blockedBy); strings(value.mechanics); check(value.mechanics.length > 0, "CATALOG_MECHANICS");
  check(Array.isArray(value.unsupportedMechanics), "CATALOG_UNSUPPORTED_MECHANICS");
  const requirementQuestions: string[] = [];
  for (const mechanic of value.unsupportedMechanics) {
    record(mechanic); exactKeys(mechanic, ["mechanic", "reason", "blockedBy"], "CATALOG_UNSUPPORTED_MECHANIC");
    check(identifier(mechanic.mechanic) && typeof mechanic.reason === "string" && mechanic.reason.trim().length > 0, "CATALOG_UNSUPPORTED_MECHANIC");
    questions(mechanic.blockedBy); requirementQuestions.push(...mechanic.blockedBy);
  }
  check(JSON.stringify([...new Set(requirementQuestions)].sort()) === JSON.stringify([...value.blockedBy].sort()), "CATALOG_BLOCKER_MISMATCH");
  if (value.supportStatus === "SUPPORTED") check(value.blockedBy.length === 0 && value.unsupportedMechanics.length === 0, "CATALOG_SUPPORT_STATUS");
  else check(value.unsupportedMechanics.length > 0 && (value.supportStatus !== "BLOCKED" || value.blockedBy.length > 0), "CATALOG_SUPPORT_STATUS");
  record(value.definition);
  check(value.definition.definitionId === value.cardId && typeof value.definition.name === "string" && value.definition.name.startsWith("FIXTURE "), "CATALOG_DEFINITION_ID");
  if (value.definition.type === "CHARACTER" || value.definition.type === "EVENT") check(integer(value.definition.level), "CATALOG_LEVEL");
  for (const [programId, program] of Object.entries(programs)) validateEffectProgram({ programId, program });
  const card = value as unknown as CatalogCard;
  try { validateContent({ version: "catalog-check", definitions: { [card.cardId]: card.definition }, programs }); }
  catch (error) { if (error instanceof RuleError) throw error; throw new RuleError("INVALID_CARD_DEFINITION", error instanceof Error ? error.message : String(error)); }
  validateBindings(card.definition, programs);
}
