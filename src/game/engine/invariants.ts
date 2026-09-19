import type { Content, GameState, PendingEffect } from "../model.ts";
import { assertJson, check, exactKeys, identifier, integer } from "../persistence/json.ts";
import { zones } from "./state-helpers.ts";
import { EffectQueue } from "../effects/EffectQueue.ts";
import { validateProcedures } from "./procedure-invariants.ts";
import { validateGameplayChoice, validateGameplayFrame } from "./gameplay-invariants.ts";
import { validateFeatures } from "./feature-invariants.ts";

/** Called on trusted restore and before every committed transition. */
export function validateState(state: GameState, content: Content): void {
  assertJson(state);
  exactKeys(state, ["schemaVersion", "engineVersion", "rulesetVersion", "contentFingerprint", "matchId", "revision", "nextId", "status", "playerOrder", "firstPlayerId", "players", "cards", "entries", "modifiers", "turn", "mulligansCompleted", "choice", "frames", "pendingEffects", "rng", "events", "commandReceipts", "blocked", "outcome"], "STATE_SCHEMA");
  check(state.schemaVersion === 3 && state.engineVersion === "0.3.0" && state.rulesetVersion === "pdf-2.5+explicit-3a", "VERSION");
  check(identifier(state.matchId) && integer(state.revision) && integer(state.nextId, 1), "STATE_COUNTER");
  check(Array.isArray(state.playerOrder) && state.playerOrder.length === 2 && new Set(state.playerOrder).size === 2 && state.playerOrder.every(identifier), "PLAYERS");
  check(state.playerOrder.includes(state.firstPlayerId) && Object.keys(state.players).length === 2 && state.playerOrder.every(id => Object.hasOwn(state.players, id)), "PLAYERS");
  check(["SETUP", "PLAYING", "RULE_BLOCKED", "FINISHED"].includes(state.status), "STATE_STATUS");
  exactKeys(state.turn, ["number", "playerId", "phase", "normalPlayUsed", "usedNextHint"], "TURN_SCHEMA");
  check(typeof state.turn.usedNextHint === "boolean", "TURN_SCHEMA");
  check(integer(state.turn.number, 1) && state.playerOrder.includes(state.turn.playerId) && ["AUTO", "MAIN", "END"].includes(state.turn.phase) && typeof state.turn.normalPlayUsed === "boolean", "TURN");
  exactKeys(state.rng, ["algorithm", "state", "cursor"], "RNG_SCHEMA");
  check(identifier(state.rng.algorithm) && integer(state.rng.state) && integer(state.rng.cursor), "RNG");
  check(Array.isArray(state.frames) && Array.isArray(state.pendingEffects) && Array.isArray(state.events), "STATE_COLLECTION");
  const locations = new Set<string>();
  for (const id of state.playerOrder) {
    const player = state.players[id]!;
    exactKeys(player, ["id", "partnerId", "caseId", "chapter", "traceDiscovered", "assistReturnOnOwnAuto", "zones"], "PLAYER_SCHEMA");
    check(player.id === id && ["CASE", "RESOLUTION"].includes(player.chapter) && typeof player.traceDiscovered === "boolean" && typeof player.assistReturnOnOwnAuto === "boolean", "PLAYER");
    exactKeys(player.zones, zones, "ZONE_SCHEMA");
    check(Object.keys(player.zones).length === zones.length, "ZONE_SCHEMA");
    for (const zone of zones) {
      const cards = player.zones[zone];
      check(Array.isArray(cards), "ZONE_SCHEMA");
      for (const cardId of cards) {
        check(identifier(cardId) && !locations.has(cardId), "LOCATION", "A physical card must have exactly one location");
        locations.add(cardId);
        const card = state.cards[cardId];
        check(Object.hasOwn(state.cards, cardId) && card && card.instanceId === cardId && card.ownerId === id, "LOCATION_OWNER");
        exactKeys(card, ["instanceId", "definitionId", "ownerId", "face", "orientation", "enteredTurn", "entryId", "attachment", "abilitiesSuppressed"], "CARD_SCHEMA");
        check(card.entryId === null || (identifier(card.entryId) && Object.hasOwn(state.entries, card.entryId) && state.entries[card.entryId]!.instanceId === cardId), "ENTRY_REFERENCE");
        check(card.abilitiesSuppressed === undefined || typeof card.abilitiesSuppressed === "boolean", "CARD_SCHEMA");
        const definition = content.definitions[card.definitionId];
        check(Object.hasOwn(content.definitions, card.definitionId) && definition, "CONTENT_REFERENCE");
        check(["UP", "DOWN"].includes(card.face) && (card.orientation === null || ["ACTIVE", "SLEEP", "STUN"].includes(card.orientation)), "CARD_STATE");
        check(card.enteredTurn === null || (integer(card.enteredTurn) && card.enteredTurn <= state.turn.number), "ENTRY_TURN");
        if (definition.type === "PARTNER") {
          check(cardId === player.partnerId && ["PARTNER", "FILE"].includes(zone) && card.orientation !== null && card.enteredTurn === null, "PARTNER_LOCATION");
        } else if (definition.type === "CASE") {
          check(cardId === player.caseId && zone === "CASE" && card.orientation === null && card.enteredTurn === null, "CASE_LOCATION");
        } else {
          check(zone !== "CASE" && (zone !== "PARTNER" || (definition.type === "CHARACTER" && definition.mr === true)), "CARD_LOCATION");
          if (zone === "FIELD") check(definition.type === "CHARACTER" && card.orientation !== null && card.enteredTurn !== null, "FIELD_STATE");
          else if (definition.type === "EVENT") check(card.orientation === null && card.enteredTurn === null && card.abilitiesSuppressed === undefined, "EVENT_STATE");
          else check((card.orientation === null) === (card.enteredTurn === null), "CHARACTER_ARCHIVE");
        }
      }
    }
    check(player.zones.FIELD.length <= 5, "FIELD_CAPACITY");
    check(content.definitions[state.cards[player.partnerId]?.definitionId ?? ""]?.type === "PARTNER", "PARTNER");
    check(content.definitions[state.cards[player.caseId]?.definitionId ?? ""]?.type === "CASE", "CASE");
    check(player.zones.CASE.length === 1 && player.zones.CASE[0] === player.caseId, "CASE_LOCATION");
    check(player.zones.PARTNER.includes(player.partnerId) === !player.assistReturnOnOwnAuto && player.zones.FILE.includes(player.partnerId) === player.assistReturnOnOwnAuto, "ASSIST_STATE");
    check(Object.values(player.zones).flat().length === 42, "CARD_CONSERVATION");
  }
  check(locations.size === 84 && Object.keys(state.cards).length === 84 && Object.keys(state.cards).every(id => locations.has(id)), "LOCATION");
  for (const [id, entry] of Object.entries(state.entries)) {
    exactKeys(entry, ["entryId", "instanceId", "ownerId", "createdTurn", "creation", "status", "previousEntryId", "grantedAbilities"], "ENTRY_SCHEMA");
    check(identifier(id) && entry.entryId === id && Object.hasOwn(state.cards, entry.instanceId) && state.cards[entry.instanceId]!.ownerId === entry.ownerId && integer(entry.createdTurn) && entry.createdTurn <= state.turn.number, "ENTRY_REFERENCE");
    check(["PLAY", "DISGUISE"].includes(entry.creation) && ["PRESENT", "LEFT", "REPLACED"].includes(entry.status), "ENTRY_STATE");
    check(entry.previousEntryId === null || (Object.hasOwn(state.entries, entry.previousEntryId) && entry.previousEntryId !== id), "ENTRY_REFERENCE");
    if (entry.status === "PRESENT") check(state.cards[entry.instanceId]!.entryId === id && state.players[entry.ownerId]!.zones.FIELD.includes(entry.instanceId), "ENTRY_LOCATION");
  }
  for (const player of Object.values(state.players)) for (const id of player.zones.FIELD) {
    const entry = state.entries[state.cards[id]!.entryId!];
    check(entry?.status === "PRESENT" && entry.instanceId === id, "ENTRY_LOCATION");
  }
  function effectValid(effect: PendingEffect) {
    exactKeys(effect, ["id", "controllerId", "sourceId", "programId", "sourceEntryId"], "EFFECT_SCHEMA");
    const card = state.cards[effect.sourceId];
    check(identifier(effect.id) && Object.hasOwn(state.cards, effect.sourceId) && state.playerOrder.includes(effect.controllerId) && card && card.ownerId === effect.controllerId && identifier(effect.programId) && Object.hasOwn(content.programs, effect.programId), "EFFECT_REFERENCE");
    const definition = content.definitions[card.definitionId]!;
    check(definition.triggers.some(t => t.programId === effect.programId) || (card.entryId && state.entries[card.entryId]?.grantedAbilities.some(a => a.kind === "TRIGGER" && a.trigger.programId === effect.programId)) || definition.cutIns?.some(a => a.programId === effect.programId) || (definition.type === "CHARACTER" && definition.declarations?.some(a => a.programId === effect.programId)) || (definition.type === "EVENT" && definition.programId === effect.programId), "EFFECT_SOURCE_PROGRAM");
  }
  const effectIds = new Set<string>();
  for (const effect of state.pendingEffects) {
    effectValid(effect);
    check(!effectIds.has(effect.id), "EFFECT_ID"); effectIds.add(effect.id);
  }
  for (const frame of state.frames) {
    switch (frame.kind) {
      case "AUTO":
      case "END":
        exactKeys(frame, ["kind", "step"], "FRAME_SCHEMA");
        check(integer(frame.step) && frame.step <= (frame.kind === "AUTO" ? 4 : 2) && state.turn.phase === frame.kind, "FRAME_STEP");
        break;
      case "MOVE":
        exactKeys(frame, ["kind", "playerId", "to", "remaining", "hostEntryId"], "FRAME_SCHEMA");
        check(state.playerOrder.includes(frame.playerId) && ["HAND", "FILE", "EVIDENCE", "REMOVE", "SET", "UNDER"].includes(frame.to) && integer(frame.remaining), "FRAME_MOVE");
        break;
      case "REFRESH":
        exactKeys(frame, ["kind", "playerId", "step"], "FRAME_SCHEMA");
        check(state.playerOrder.includes(frame.playerId) && ["REBUILD", "PENALTY", "DONE"].includes(frame.step), "FRAME_REFRESH");
        if (frame.step === "REBUILD") check(!state.players[frame.playerId]!.zones.DECK.length, "FRAME_REFRESH_DECK");
        break;
      case "EFFECT":
        exactKeys(frame, ["kind", "effect", "cursor", "foundCards"], "FRAME_SCHEMA"); effectValid(frame.effect);
        check(!effectIds.has(frame.effect.id), "EFFECT_ID"); effectIds.add(frame.effect.id);
        check(integer(frame.cursor) && frame.cursor <= content.programs[frame.effect.programId]!.instructions.length, "FRAME_CURSOR");
        if (frame.foundCards !== undefined) check(Array.isArray(frame.foundCards) && new Set(frame.foundCards).size === frame.foundCards.length && frame.foundCards.every(id => Object.hasOwn(state.cards, id)), "FRAME_FOUND");
        break;
      case "INVESTIGATION":
        exactKeys(frame, ["kind", "playerId", "deckOwnerId", "sourceId", "count", "revealed", "step"], "FRAME_SCHEMA");
        check(state.playerOrder.includes(frame.playerId) && state.playerOrder.includes(frame.deckOwnerId) && frame.playerId !== frame.deckOwnerId && Object.hasOwn(state.cards, frame.sourceId) && state.cards[frame.sourceId]!.ownerId === frame.playerId && integer(frame.count), "FRAME_INVESTIGATION");
        check(["REVEAL", "ORDER", "DONE"].includes(frame.step) && Array.isArray(frame.revealed) && new Set(frame.revealed).size === frame.revealed.length && frame.revealed.length <= frame.count, "FRAME_INVESTIGATION");
        if (frame.step === "REVEAL") check(frame.revealed.length === 0, "FRAME_INVESTIGATION");
        else if (frame.step === "ORDER") check(JSON.stringify(frame.revealed) === JSON.stringify(state.players[frame.deckOwnerId]!.zones.DECK.slice(0, frame.count)), "FRAME_INVESTIGATION");
        break;
      case "FINISH_EVENT":
        exactKeys(frame, ["kind", "playerId", "cardId"], "FRAME_SCHEMA");
        check(state.playerOrder.includes(frame.playerId) && state.players[frame.playerId]!.zones.PROCESSING.includes(frame.cardId), "FRAME_EVENT");
        check(content.definitions[state.cards[frame.cardId]!.definitionId]!.type === "EVENT", "FRAME_EVENT");
        break;
      case "CHECKPOINT": exactKeys(frame, ["kind"], "FRAME_SCHEMA"); break;
      default: validateGameplayFrame(state, content, frame);
    }
  }
  for (const player of Object.values(state.players)) {
    if (!player.zones.DECK.length) check(state.frames.some(f => f.kind === "REFRESH" && f.playerId === player.id && f.step === "REBUILD"), "EMPTY_DECK_WITHOUT_REFRESH");
  }
  if (state.playerOrder.every(id => state.players[id]!.zones.DECK.length === 0)) {
    check(state.status === "RULE_BLOCKED" && state.blocked?.questionId === "RULE-QUESTION-002", "RULE-QUESTION-002", "Simultaneous empty decks are not adjudicated");
  }
  check(integer(state.mulligansCompleted) && state.mulligansCompleted <= 2, "MULLIGAN_STATE");
  if (state.status === "SETUP") check(state.mulligansCompleted < 2 && state.frames.length === 0 && state.choice?.kind === "MULLIGAN", "SETUP_STATE");
  else check(state.mulligansCompleted === 2, "SETUP_STATE");
  if (state.choice) {
    check(identifier(state.choice.id) && state.playerOrder.includes(state.choice.playerId), "CHOICE_STATE");
    if (state.choice.kind === "MULLIGAN") {
      exactKeys(state.choice, ["id", "kind", "playerId"], "CHOICE_SCHEMA");
      check(state.status === "SETUP" && state.choice.playerId === (state.mulligansCompleted === 0 ? state.firstPlayerId : state.playerOrder.find(id => id !== state.firstPlayerId)), "CHOICE_STATE");
    } else if (state.choice.kind === "EFFECT_ORDER") {
      exactKeys(state.choice, ["id", "kind", "playerId", "candidates"], "CHOICE_SCHEMA");
      check(state.choice.kind === "EFFECT_ORDER" && state.frames.at(-1)?.kind === "CHECKPOINT", "CHOICE_STATE");
      const eligible = EffectQueue.eligible(state);
      check(state.choice.playerId === eligible[0]?.controllerId && JSON.stringify(state.choice.candidates) === JSON.stringify(eligible.map(e => e.id)), "CHOICE_CANDIDATES");
    } else if (state.choice.kind === "INVESTIGATION_ORDER") {
      exactKeys(state.choice, ["id", "kind", "playerId", "candidates"], "CHOICE_SCHEMA");
      const frame = state.frames.at(-1);
      check(frame?.kind === "INVESTIGATION" && frame.step === "ORDER" && state.choice.playerId === frame.deckOwnerId && JSON.stringify(state.choice.candidates) === JSON.stringify(frame.revealed), "CHOICE_INVESTIGATION");
    } else validateGameplayChoice(state, content, state.choice);
  }
  check((state.status === "FINISHED") === (state.outcome !== null), "OUTCOME");
  if (state.outcome) {
    exactKeys(state.outcome, ["winnerId", "loserId", "reason"], "OUTCOME_SCHEMA");
    check(state.playerOrder.includes(state.outcome.winnerId) && state.playerOrder.includes(state.outcome.loserId) && state.outcome.winnerId !== state.outcome.loserId && ["EMPTY_DECK", "CASE_SOLVED"].includes(state.outcome.reason), "OUTCOME");
  }
  check((state.status === "RULE_BLOCKED") === (state.blocked !== null), "BLOCK_STATE");
  if (state.blocked) {
    exactKeys(state.blocked, ["questionId", "detail"], "BLOCK_SCHEMA");
    check(/^RULE-QUESTION-0(0[1-9]|1[0-9]|2[0-8])$/.test(state.blocked.questionId) && typeof state.blocked.detail === "string", "BLOCK_STATE");
  }
  state.events.forEach((event, i) => {
    exactKeys(event, ["sequence", "type", "playerId", "cardId", "detail", "cause"], "EVENT_SCHEMA");
    check(event.cause === undefined || typeof event.cause === "string", "EVENT_SCHEMA");
    check(event.sequence === i + 1 && typeof event.type === "string" && typeof event.detail === "string" && (event.playerId === null || state.playerOrder.includes(event.playerId)) && (event.cardId === null || Object.hasOwn(state.cards, event.cardId)), "EVENT");
  });
  for (const [id, receipt] of Object.entries(state.commandReceipts)) {
    exactKeys(receipt, ["fingerprint", "revision"], "RECEIPT_SCHEMA");
    check(identifier(id) && typeof receipt.fingerprint === "string" && integer(receipt.revision, 1) && receipt.revision <= state.revision, "RECEIPT");
  }
  validateFeatures(state, content);
  validateProcedures(state);
}
