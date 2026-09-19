import type { Content, FieldEntry, GameState } from "../model.ts";
import { check, exactKeys, identifier, integer } from "../persistence/json.ts";
import { fixedAbilityKeywords, keywordValue, validateKeywords } from "../rules/keywords.ts";
import { currentStat } from "../rules/modifiers.ts";
import { triggerEvents } from "../content/triggers.ts";

export function validateFeatures(state: GameState, content: Content): void {
  check(state.entries && !Array.isArray(state.entries) && state.modifiers && !Array.isArray(state.modifiers), "FEATURE_SCHEMA");
  for (const entry of Object.values(state.entries)) {
    if (entry.creation === "PLAY") check(entry.previousEntryId === null, "ENTRY_ANCESTRY");
    else {
      const previous = entry.previousEntryId ? state.entries[entry.previousEntryId] : null;
      check(previous && previous.status === "REPLACED" && previous.ownerId === entry.ownerId && previous.instanceId !== entry.instanceId, "ENTRY_ANCESTRY");
      const seen = new Set<string>([entry.entryId]);
      let cursor: FieldEntry | null = previous;
      while (cursor) {
        check(!seen.has(cursor.entryId), "ENTRY_CYCLE"); seen.add(cursor.entryId);
        cursor = cursor.previousEntryId ? state.entries[cursor.previousEntryId]! : null;
      }
    }
    check(Array.isArray(entry.grantedAbilities), "ENTRY_GRANTS");
    const grantedKeywords = [];
    for (const grant of entry.grantedAbilities) {
      check(Object.hasOwn(state.cards, grant.sourceId), "ENTRY_GRANT_SOURCE");
      if (grant.kind === "KEYWORD") {
        exactKeys(grant, ["kind", "sourceId", "keyword"], "ENTRY_GRANT");
        grantedKeywords.push(grant.keyword);
      } else {
        check(grant.kind === "TRIGGER", "ENTRY_GRANT");
        exactKeys(grant, ["kind", "sourceId", "trigger"], "ENTRY_GRANT");
        const t = grant.trigger;
        exactKeys(t, ["event", "player", "subject", "programId", "condition"], "ENTRY_GRANT");
        check(!["MODIFIER_EXPIRED", "DURATION_EXPIRED", "STAT_CHANGED"].includes(t.event), "RULE_QUESTION_023");
        check(triggerEvents.includes(t.event), "UNSUPPORTED_TRIGGER");
        check(content.definitions && Object.hasOwn(content.programs, t.programId) && ["SELF", "OPPONENT", "ANY"].includes(t.player), "ENTRY_GRANT");
        check(t.subject === undefined || ["SOURCE", "ANY"].includes(t.subject), "ENTRY_GRANT");
        check(t.condition === undefined || t.condition === "TRACE_DISCOVERED", "ENTRY_GRANT");
      }
    }
    const definition = content.definitions[state.cards[entry.instanceId]!.definitionId]!;
    check(definition.type === "CHARACTER", "ENTRY_TYPE");
    validateKeywords([...(definition.keywords ?? []), ...grantedKeywords]);
  }
  for (const card of Object.values(state.cards)) {
    const player = state.players[card.ownerId]!;
    const attachmentZone = player.zones.SET.includes(card.instanceId) ? "SET" : player.zones.UNDER.includes(card.instanceId) ? "UNDER" : null;
    check((card.attachment !== null) === (attachmentZone !== null), "ATTACHMENT_LOCATION");
    if (card.attachment) {
      exactKeys(card.attachment, ["kind", "hostEntryId"], "ATTACHMENT_SCHEMA");
      const host = state.entries[card.attachment.hostEntryId];
      check(card.attachment.kind === attachmentZone && host?.status === "PRESENT" && host.ownerId === card.ownerId && host.instanceId !== card.instanceId, "ATTACHMENT_HOST");
    }
    if (card.entryId !== null) check(state.entries[card.entryId]!.instanceId === card.instanceId, "ENTRY_REFERENCE");
  }
  for (const [id, modifier] of Object.entries(state.modifiers)) {
    check(!Object.hasOwn(modifier, "onExpire"), "RULE_QUESTION_023");
    exactKeys(modifier, ["id", "targetEntryId", "sourceEffectId", "stat", "value", "duration", "scopeId"], "MODIFIER_SCHEMA");
    check(identifier(id) && modifier.id === id && Object.hasOwn(state.entries, modifier.targetEntryId) && identifier(modifier.sourceEffectId) && ["AP", "LP"].includes(modifier.stat) && integer(modifier.value, Number.MIN_SAFE_INTEGER), "MODIFIER_REFERENCE");
    check(["UNTIL_CONTACT_END", "UNTIL_ACTION_END", "UNTIL_TURN_END"].includes(modifier.duration), "MODIFIER_DURATION");
    if (modifier.duration === "UNTIL_TURN_END") check(modifier.scopeId === "turn-" + state.turn.number, "MODIFIER_SCOPE");
    else {
      const kind = modifier.duration === "UNTIL_CONTACT_END" ? "CONTACT" : "ACTION";
      check(state.frames.some(f => f.kind === kind && f.id === modifier.scopeId), "MODIFIER_SCOPE");
    }
  }
  for (const player of Object.values(state.players)) for (const id of player.zones.FIELD) {
    currentStat(state, content, id, "AP"); currentStat(state, content, id, "LP");
  }
  const effects = [...state.pendingEffects, ...state.frames.flatMap(f => f.kind === "EFFECT" ? [f.effect] : [])];
  for (const effect of effects) {
    if (effect.sourceEntryId !== undefined) check(Object.hasOwn(state.entries, effect.sourceEntryId) && state.entries[effect.sourceEntryId]!.instanceId === effect.sourceId, "EFFECT_ENTRY_REFERENCE");
    if (content.programs[effect.programId]!.sourceRequirements === "FIELD_ENTRY") check(effect.sourceEntryId !== undefined, "EFFECT_ENTRY_REFERENCE");
  }
  for (const [index, frame] of state.frames.entries()) {
    if (frame.kind === "INVESTIGATION") {
      const parent = state.frames[index - 1];
      check(parent?.kind === "EFFECT" && parent.effect.sourceId === frame.sourceId && parent.effect.controllerId === frame.playerId, "PROCEDURE_INVESTIGATION");
      const instruction = content.programs[parent.effect.programId]!.instructions[parent.cursor - 1];
      check(instruction?.op === "INVOKE_KEYWORD" && instruction.keyword === "INVESTIGATE_X" && frame.count === keywordValue(fixedAbilityKeywords(state, content, frame.sourceId), "INVESTIGATE_X"), "PROCEDURE_INVESTIGATION");
    }
    if (frame.kind === "CONTACT") {
      check(frame.priorityAP === null || (Array.isArray(frame.priorityAP) && frame.priorityAP.length === 2 && frame.priorityAP.every(n => integer(n, Number.MIN_SAFE_INTEGER))), "FRAME_PRIORITY_SAMPLE");
      check((frame.priority === null) === (frame.priorityAP === null), "FRAME_PRIORITY_SAMPLE");
      if (frame.responseIndex === 3) check(frame.responses[0] === "PASS" && frame.responses[1] !== "PASS", "FRAME_RESPONSE");
    } else if (frame.kind === "DEDUCTION") {
      check((frame.sampledLP === null) === (frame.calculatedLP === null) && (frame.sampledLP === null || integer(frame.sampledLP, Number.MIN_SAFE_INTEGER)), "FRAME_LP");
    } else if (frame.kind === "MOVE") {
      if (frame.to === "SET" || frame.to === "UNDER") check(typeof frame.hostEntryId === "string" && Object.hasOwn(state.entries, frame.hostEntryId) && state.entries[frame.hostEntryId]!.ownerId === frame.playerId, "FRAME_ATTACHMENT");
      else check(frame.hostEntryId === undefined, "FRAME_ATTACHMENT");
    }
  }
}
