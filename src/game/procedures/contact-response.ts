import type { Content, GameState, GameplayFrame, Intent } from "../model.ts";
import { check } from "../persistence/json.ts";
import { fact, move as relocate, nextId } from "../engine/state-helpers.ts";
import { checkpoint, emit, move, observers } from "../engine/events.ts";
import { activeEntry, createEntry } from "../rules/identity.ts";
import { isMR } from "../rules/mr.ts";

type Contact = Extract<GameplayFrame, { kind: "CONTACT" }>;
export function responsePlayer(frame: Contact): string | null {
  if (!frame.priority) return null;
  if (frame.responseIndex < 2) return frame.priority[frame.responseIndex]!;
  return frame.responseIndex === 2 && frame.responses[0] === "PASS" && frame.responses[1] !== "PASS" ? frame.priority[0] : null;
}
export function respondContact(state: GameState, content: Content, frame: Contact, owner: string, intent: Extract<Intent, { kind: "RESPOND_CONTACT" }>): void {
  check(responsePlayer(frame) === owner, "CONTACT_RESPONSE_PLAYER");
  if (intent.response === "PASS") {
    frame.responses.push("PASS"); frame.responseIndex++; state.choice = null; return;
  }
  // Old extension-only requests without a card/ability still fail atomically.
  check("cardId" in intent && typeof intent.cardId === "string", "UNSUPPORTED_CONTACT_RESPONSE");
  const player = state.players[owner]!;
  check(player.zones.HAND.includes(intent.cardId), "CONTACT_HAND_CARD");
  check(state.cards[intent.cardId]!.entryId === null, "RULE_QUESTION_027", "Ability/state retention after a prior field occurrence is unconfirmed");
  const definition = content.definitions[state.cards[intent.cardId]!.definitionId]!;
  if (intent.response === "CUT_IN") {
    check(typeof intent.abilityId === "string", "UNSUPPORTED_CONTACT_RESPONSE");
    const ability = definition.cutIns?.find(a => a.abilityId === intent.abilityId);
    check(ability, "CUT_IN_ABILITY");
    move(state, content, owner, intent.cardId, "HAND", "REMOVE", "CUT_IN");
    emit(state, content, "CUT_IN_USED", owner, intent.cardId, ability.abilityId);
    frame.responses.push("CUT_IN"); frame.responseIndex++; state.choice = null;
    checkpoint(state);
    if (!state.cards[intent.cardId]!.abilitiesSuppressed) state.frames.push({ kind: "EFFECT", effect: { id: nextId(state, "effect"), controllerId: owner, sourceId: intent.cardId, programId: ability.programId }, cursor: 0 });
    else fact(state, "CUT_IN_DISABLED", owner, intent.cardId, ability.abilityId);
  } else {
    check(intent.response === "DISGUISE" && definition.type === "CHARACTER" && definition.disguise === true, "DISGUISE_ABILITY");
    check(!state.cards[intent.cardId]!.abilitiesSuppressed, "DISGUISE_DISABLED");
    const caseDefinition = content.definitions[state.cards[player.caseId]!.definitionId]!;
    check(definition.level <= player.zones.FILE.length && definition.colors.every(c => caseDefinition.colors.includes(c)), "RULE_QUESTION_010");
    check(state.cards[intent.cardId]!.entryId === null, "RULE_QUESTION_027");
    replaceDisguise(state, content, frame, owner, intent.cardId);
    frame.responses.push("DISGUISE"); frame.responseIndex++; state.choice = null;
    checkpoint(state);
  }
}
/** p.18 replacement, deliberately bypasses ordinary leave/entry cleanup and triggers. */
function replaceDisguise(state: GameState, content: Content, frame: Contact, owner: string, replacementId: string): void {
  const oldId = owner === frame.playerId ? frame.attackerId : frame.defenderId;
  check(!isMR(state, content, oldId) && !isMR(state, content, replacementId), "RULE_QUESTION_019");
  const entry = activeEntry(state, oldId);
  check(entry, "CONTACT_PARTICIPANT");
  const old = state.cards[oldId]!, card = state.cards[replacementId]!, player = state.players[owner]!;
  const before = observers(state);
  const fieldIndex = player.zones.FIELD.indexOf(oldId);
  const newEntryId = createEntry(state, replacementId, "DISGUISE", entry.entryId);
  state.entries[newEntryId]!.grantedAbilities = structuredClone(entry.grantedAbilities);
  card.orientation = old.orientation;
  card.enteredTurn = old.enteredTurn;
  if (old.abilitiesSuppressed !== undefined) card.abilitiesSuppressed = old.abilitiesSuppressed;
  relocate(state, owner, replacementId, "HAND", "FIELD", false);
  relocate(state, owner, oldId, "FIELD", "DECK", false);
  player.zones.DECK.shift(); player.zones.DECK.push(oldId);
  player.zones.FIELD.splice(player.zones.FIELD.indexOf(replacementId), 1);
  player.zones.FIELD.splice(fieldIndex, 0, replacementId);
  entry.status = "REPLACED";
  for (const modifier of Object.values(state.modifiers)) if (modifier.targetEntryId === entry.entryId) modifier.targetEntryId = newEntryId;
  for (const attached of Object.values(state.cards)) if (attached.attachment?.hostEntryId === entry.entryId) attached.attachment.hostEntryId = newEntryId;
  if (owner === frame.playerId) {
    frame.attackerId = replacementId;
    const action = state.frames.findLast(f => f.kind === "ACTION");
    if (action?.kind === "ACTION") action.attackerId = replacementId;
  } else frame.defenderId = replacementId;
  fact(state, "DISGUISE_REPLACEMENT", owner, replacementId, oldId);
  emit(state, content, "CARD_MOVED", owner, oldId, "FIELD>DECK_BOTTOM", "DISGUISE", before);
  emit(state, content, "CARD_MOVED", owner, replacementId, "HAND>FIELD", "DISGUISE");
  emit(state, content, "DISGUISED", owner, replacementId, oldId, "DISGUISE");
}
