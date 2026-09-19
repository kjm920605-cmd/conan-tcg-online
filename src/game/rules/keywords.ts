import type { Content, GameState, Keyword } from "../model.ts";
import { check, exactKeys, integer } from "../persistence/json.ts";

const permissions: Record<string, readonly string[]> = {
  RAPID: ["DEDUCTION", "CHARACTER", "CASE"], ASSAULT: ["CHARACTER", "CASE"],
  ASSAULT_CHARACTER: ["CHARACTER"], ASSAULT_CASE: ["CASE"],
  BULLET: [], TRACE: [], MISLEAD_X: [], INVESTIGATE_X: [],
};
export function keywordKind(kind: Keyword["kind"]): string { return kind === "MISLEAD" ? "MISLEAD_X" : kind; }
export function validateKeywords(values: Keyword[]): void {
  check(Array.isArray(values), "UNSUPPORTED_KEYWORD");
  check(new Set(values.map(k => keywordKind(k.kind))).size === values.length, "RULE_QUESTION_028");
  for (const k of values) {
    check(k && Object.hasOwn(permissions, keywordKind(k.kind)), "UNSUPPORTED_KEYWORD");
    const numeric = ["MISLEAD_X", "INVESTIGATE_X"].includes(keywordKind(k.kind));
    exactKeys(k, numeric ? ["kind", "value"] : ["kind"], "UNSUPPORTED_KEYWORD");
    if (numeric) check("value" in k && integer(k.value), "UNSUPPORTED_KEYWORD");
  }
}
export function keywords(state: GameState, content: Content, cardId: string): Keyword[] {
  const card = state.cards[cardId]!, definition = content.definitions[card.definitionId]!;
  if (card.attachment) return [];
  const entry = card.entryId ? state.entries[card.entryId] : null;
  return definition.type === "CHARACTER" ? [...(card.abilitiesSuppressed ? [] : definition.keywords ?? []),
    ...(entry?.status === "PRESENT" ? entry.grantedAbilities.flatMap(a => a.kind === "KEYWORD" ? [a.keyword] : []) : [])] : [];
}
/** Fixed ability text and retained grants, for a paid cost / already triggered program only.
 * This profile cannot alter keyword values or remove grants; it does not re-test validity. */
export function fixedAbilityKeywords(state: GameState, content: Content, cardId: string): Keyword[] {
  const card = state.cards[cardId]!, definition = content.definitions[card.definitionId]!;
  const entry = card.entryId ? state.entries[card.entryId] : null;
  return definition.type === "CHARACTER" ? [...(definition.keywords ?? []),
    ...(entry?.grantedAbilities.flatMap(a => a.kind === "KEYWORD" ? [a.keyword] : []) ?? [])] : [];
}
export function hasKeyword(state: GameState, content: Content, cardId: string, kind: string): boolean {
  return keywords(state, content, cardId).some(k => keywordKind(k.kind) === kind);
}
export function newcomerAllowed(state: GameState, content: Content, cardId: string, operation: string): boolean {
  return keywords(state, content, cardId).some(k => permissions[keywordKind(k.kind)]?.includes(operation));
}
export function keywordValue(values: readonly Keyword[], kind: string): number {
  return values.reduce((n, k) => n + (keywordKind(k.kind) === kind && "value" in k ? k.value : 0), 0);
}
