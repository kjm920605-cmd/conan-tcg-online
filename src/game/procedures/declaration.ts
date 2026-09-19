import type { Content, GameState, Intent } from "../model.ts";
import { check } from "../persistence/json.ts";
import { checkpoint, emit } from "../engine/events.ts";
import { nextId } from "../engine/state-helpers.ts";

/** Finite authoring profile, not a ruling on arbitrary MR text, timing, costs or usage. */
export function declareAbility(state: GameState, content: Content, owner: string, intent: Extract<Intent, { kind: "DECLARE_ABILITY" }>): void {
  const card = state.cards[intent.cardId], player = state.players[owner]!;
  check(card && card.ownerId === owner, "ABILITY_SOURCE");
  check(!(intent.cardId === player.partnerId && player.zones.FILE.includes(intent.cardId)), "RULE_QUESTION_025");
  const definition = content.definitions[card.definitionId]!;
  check(definition.type === "CHARACTER", "UNSUPPORTED_DECLARATION");
  const ability = definition.declarations?.find(a => a.abilityId === intent.abilityId);
  check(ability, "DECLARATION_ABILITY");
  check(ability.zones.some(zone => player.zones[zone].includes(card.instanceId)), "DECLARATION_ZONE");
  check(!card.abilitiesSuppressed, "DECLARATION_DISABLED");
  emit(state, content, "ABILITY_DECLARED", owner, card.instanceId, ability.abilityId);
  checkpoint(state);
  state.frames.push({ kind: "EFFECT", cursor: 0, effect: { id: nextId(state, "effect"), controllerId: owner,
    sourceId: card.instanceId, programId: ability.programId, ...(player.zones.FIELD.includes(card.instanceId) ? { sourceEntryId: card.entryId! } : {}) } });
}
