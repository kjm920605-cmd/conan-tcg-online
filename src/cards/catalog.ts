import type { Content } from "../game/model.ts";
import { assertJson, check, exactKeys, freeze, identifier } from "../game/persistence/json.ts";
import type { CardCatalog, CatalogCard, ProgramRecord } from "./model.ts";
import { validateCardDefinition, validateEffectProgram } from "./validation.ts";
import { programBindings } from "./bindings.ts";

export function parseCatalog(cardRecords: unknown[], programRecords: unknown[]): CardCatalog {
  assertJson(cardRecords); assertJson(programRecords);
  check(Array.isArray(cardRecords) && Array.isArray(programRecords), "CATALOG_ARRAY");
  const programs: CardCatalog["programs"] = {};
  for (const record of programRecords) {
    validateEffectProgram(record);
    check(!Object.hasOwn(programs, record.programId), "DUPLICATE_PROGRAM");
    programs[record.programId] = record.program;
  }
  const cards: CardCatalog["cards"] = {};
  for (const record of cardRecords) {
    validateCardDefinition(record, programs);
    check(!Object.hasOwn(cards, record.cardId), "DUPLICATE_CARD"); cards[record.cardId] = record;
  }
  return freeze(structuredClone({ version: "representative-fixtures-3b-v1", cards: Object.fromEntries(Object.keys(cards).sort().map(id => [id, cards[id]!])), programs: Object.fromEntries(Object.keys(programs).sort().map(id => [id, programs[id]!])) })) as CardCatalog;
}

/** Trusted content compiler. Partial cards are never silently stripped into playable cards. */
export function compileContent(catalog: CardCatalog, cardIds?: string[]): Content {
  assertJson(catalog); exactKeys(catalog, ["version", "cards", "programs"], "CATALOG_FIELDS");
  check(catalog.version === "representative-fixtures-3b-v1", "CATALOG_VERSION");
  check(catalog.cards && catalog.programs, "CATALOG_FIELDS");
  for (const [id, card] of Object.entries(catalog.cards)) check(id === card.cardId, "CATALOG_DEFINITION_ID");
  const validated = parseCatalog(Object.values(catalog.cards), Object.entries(catalog.programs).map(([programId, program]) => ({ programId, program } satisfies ProgramRecord)));
  const selected = cardIds ?? Object.values(validated.cards).filter(c => c.supportStatus === "SUPPORTED").map(c => c.cardId);
  check(Array.isArray(selected) && selected.every(identifier) && new Set(selected).size === selected.length, "CATALOG_SELECTION");
  const cards: CatalogCard[] = selected.map(id => {
    check(Object.hasOwn(validated.cards, id), "CATALOG_CARD_REFERENCE");
    const card = validated.cards[id]!;
    check(card.supportStatus === "SUPPORTED", card.blockedBy[0]?.replace("RULE-QUESTION-", "RULE_QUESTION_") ?? "UNSUPPORTED_CARD_STATUS", "Card cannot be played in this profile: " + id);
    return card;
  });
  const usedPrograms = [...new Set(cards.flatMap(c => programBindings(c.definition).map(b => b.programId)))].sort();
  return structuredClone({ version: validated.version, definitions: Object.fromEntries(cards.sort((a, b) => a.cardId < b.cardId ? -1 : 1).map(c => [c.cardId, c.definition])), programs: Object.fromEntries(usedPrograms.map(id => [id, validated.programs[id]!])) });
}
