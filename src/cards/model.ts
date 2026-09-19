import type { CardDefinition, EffectProgram } from "../game/model.ts";

export type RuleQuestionId = `RULE-QUESTION-${string}`;
export type CatalogCard = {
  cardId: string;
  provenance: { kind: "FIXTURE"; description: string };
  supportStatus: "SUPPORTED" | "PARTIAL" | "BLOCKED";
  blockedBy: RuleQuestionId[];
  mechanics: string[];
  unsupportedMechanics: { mechanic: string; reason: string; blockedBy: RuleQuestionId[] }[];
  definition: CardDefinition;
};
export type ProgramRecord = { programId: string; program: EffectProgram };
export type CardCatalog = { version: "representative-fixtures-3b-v1"; cards: Record<string, CatalogCard>; programs: Record<string, EffectProgram> };
