import type { Content, GameState, Orientation, Trigger, TriggerEvent, Zone } from "../model.ts";
import { block, fact, move as relocate, nextId } from "./state-helpers.ts";
import { transitionOrientation } from "../rules/orientation.ts";
import { existingMR, isMR } from "../rules/mr.ts";

type Observation = { cardId: string; zone: Zone };
export function observers(state: GameState): Observation[] {
  return state.playerOrder.flatMap(id => {
    const zones = state.players[id]!.zones;
    return (["CASE", "PARTNER", "FIELD"] as const).flatMap(zone => zones[zone].map(cardId => ({ cardId, zone })));
  });
}

/** Capture immutable program/source references now; never test ability validity again at resolution. */
export function emit(state: GameState, content: Content, event: TriggerEvent, actor: string, cardId: string | null = null, detail = "", cause = "RULE", before: Observation[] = []): void {
  fact(state, event, actor, cardId, detail);
  state.events.at(-1)!.cause = cause;
  if (state.status !== "PLAYING") return;
  const matches = (trigger: Trigger, owner: string, source: string) =>
    trigger.event === event && (trigger.player === "ANY" || (trigger.player === "SELF") === (actor === owner)) &&
    (trigger.subject !== "SOURCE" || source === cardId);
  for (const player of Object.values(state.players)) {
    const partner = state.cards[player.partnerId]!;
    if (player.zones.FILE.includes(partner.instanceId) && content.definitions[partner.definitionId]!.triggers.some(t => matches(t, player.id, partner.instanceId))) {
      block(state, "RULE-QUESTION-025", "Partner ability applicability while in FILE is unconfirmed");
      return;
    }
  }
  const observed = [...before, ...observers(state)];
  for (const sourceId of new Set(observed.map(o => o.cardId))) {
    const source = state.cards[sourceId]!;
    const definition = content.definitions[source.definitionId]!;
    const entry = source.entryId ? state.entries[source.entryId] : null;
    const granted = entry && observed.some(o => o.cardId === sourceId && o.zone === "FIELD") ? entry.grantedAbilities.flatMap(a => a.kind === "TRIGGER" ? [a.trigger] : []) : [];
    for (const trigger of [...(source.abilitiesSuppressed ? [] : definition.triggers), ...granted]) {
      if (!matches(trigger, source.ownerId, sourceId)) continue;
      if (trigger.condition === "TRACE_DISCOVERED" && !state.players[source.ownerId]!.traceDiscovered) continue;
      if (definition.type === "CHARACTER" && !observed.some(o => o.cardId === sourceId && (trigger.zones ?? ["FIELD"]).includes(o.zone as "FIELD" | "PARTNER"))) continue;
      const effect = { id: nextId(state, "effect"), controllerId: source.ownerId, sourceId, programId: trigger.programId, ...(source.entryId ? { sourceEntryId: source.entryId } : {}) };
      state.pendingEffects.push(effect);
      fact(state, "ABILITY_TRIGGERED", source.ownerId, sourceId, effect.id);
    }
  }
}

/** All gameplay zone changes share the same event/trigger boundary. Setup has no trigger detection. */
export function move(state: GameState, content: Content, playerId: string, cardId: string, from: Zone, to: Zone, cause = "RULE"): void {
  if (to === "FIELD" && isMR(state, content, cardId) && state.turn.playerId !== playerId && existingMR(state, content, playerId, cardId).length) {
    block(state, "RULE-QUESTION-019", "Opponent-turn MR uniqueness/return interaction is not adjudicated"); return;
  }
  const before = observers(state);
  const oldEntryId = from === "FIELD" ? state.cards[cardId]!.entryId : null;
  if (from === "SET" || from === "UNDER") state.cards[cardId]!.attachment = null;
  relocate(state, playerId, cardId, from, to, false);
  if (from === "FIELD" && state.cards[cardId]!.entryId) state.entries[state.cards[cardId]!.entryId!]!.status = "LEFT";
  emit(state, content, "CARD_MOVED", playerId, cardId, from + ">" + to, cause, before);
  if (from === "FIELD" && to === "REMOVE") emit(state, content, "CHARACTER_REMOVED", playerId, cardId, "", cause, before);
  if (to === "FIELD") emit(state, content, "CHARACTER_ENTERED", playerId, cardId, "", cause, before);
  if (from === "DECK" && to === "EVIDENCE") emit(state, content, "EVIDENCE_GAINED", playerId, cardId, "", cause, before);
  if (oldEntryId) {
    const attachments = [...state.players[playerId]!.zones.SET, ...state.players[playerId]!.zones.UNDER]
      .filter(id => state.cards[id]!.attachment?.hostEntryId === oldEntryId);
    for (const id of attachments) move(state, content, playerId, id, state.cards[id]!.attachment!.kind, "REMOVE", "HOST_LEFT");
  }
  if (from === "FIELD" && isMR(state, content, cardId) && state.turn.playerId !== playerId && to !== "PARTNER") {
    // p.26: visit the original destination first, then immediately go to Partner.
    move(state, content, playerId, cardId, to, "PARTNER", "MR_IMMEDIATE");
  }
  if (to === "FIELD" && isMR(state, content, cardId)) {
    for (const old of existingMR(state, content, playerId, cardId)) {
      move(state, content, playerId, old, state.players[playerId]!.zones.FIELD.includes(old) ? "FIELD" : "PARTNER", "REMOVE", "MR_ABILITY");
    }
  }
}
export function orient(state: GameState, content: Content, cardId: string, requested: Orientation): void {
  const card = state.cards[cardId]!;
  const next = transitionOrientation(card.orientation!, requested);
  if (next === card.orientation) return;
  card.orientation = next;
  emit(state, content, "ORIENTATION_CHANGED", card.ownerId, cardId, card.orientation);
}
export function checkpoint(state: GameState): void {
  state.frames.push({ kind: "CHECKPOINT" });
}
