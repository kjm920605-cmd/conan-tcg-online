import type { Content, CreateOptions } from "../model.ts";
import { assertJson, check, exactKeys, identifier, integer } from "../persistence/json.ts";
import { validateProgram } from "./programs.ts";
import { triggerEvents } from "./triggers.ts";
import { validateKeywords } from "../rules/keywords.ts";

const common = ["definitionId", "printedId", "name", "recognizedNames", "colors", "support", "triggers", "cutIns"];
export function validateContent(content: Content): void {
  assertJson(content);
  check(identifier(content.version), "CONTENT_VERSION");
  exactKeys(content, ["version", "definitions", "programs"], "UNSUPPORTED_CONTENT");
  check(content.definitions && content.programs, "CONTENT");
  const hasProgram = (id: unknown): id is string => identifier(id) && Object.hasOwn(content.programs, id) && !!content.programs[id];
  for (const [id, program] of Object.entries(content.programs)) { check(identifier(id), "PROGRAM"); validateProgram(program); }
  for (const [id, definition] of Object.entries(content.definitions)) {
    check(identifier(id) && definition.definitionId === id && identifier(definition.printedId), "CONTENT_ID");
    check(typeof definition.name === "string" && Array.isArray(definition.recognizedNames) && definition.recognizedNames.length > 0 && definition.recognizedNames.every(n => typeof n === "string" && n.length > 0), "CONTENT_NAME");
    check(Array.isArray(definition.colors) && definition.colors.length > 0 && definition.colors.every(identifier) && new Set(definition.colors).size === definition.colors.length, "CONTENT_COLORS");
    check(definition.support === "VERIFIED_CORE", "UNSUPPORTED_CARD");
    check(Array.isArray(definition.triggers), "CONTENT_TRIGGERS");
    if (definition.cutIns !== undefined) {
      check(["CHARACTER", "EVENT"].includes(definition.type) && Array.isArray(definition.cutIns) && definition.cutIns.length > 0, "UNSUPPORTED_CUT_IN");
      check(new Set(definition.cutIns.map(a => a.abilityId)).size === definition.cutIns.length, "CUT_IN_ID");
      for (const ability of definition.cutIns) {
        exactKeys(ability, ["abilityId", "programId"], "UNSUPPORTED_CUT_IN");
        check(identifier(ability.abilityId) && hasProgram(ability.programId), "MISSING_PROGRAM");
        check(content.programs[ability.programId]!.sourceRequirements === "INDEPENDENT", "RULE_QUESTION_014");
      }
    }
    for (const trigger of definition.triggers) {
      check(!["MODIFIER_EXPIRED", "STAT_CHANGED", "DURATION_EXPIRED"].includes(trigger.event), "RULE_QUESTION_023");
      exactKeys(trigger, ["event", "player", "programId", "zones", "condition", ...(trigger.subject === undefined ? [] : ["subject"])], "UNSUPPORTED_TRIGGER");
      check(triggerEvents.includes(trigger.event) && ["SELF", "OPPONENT", "ANY"].includes(trigger.player), "UNSUPPORTED_TRIGGER");
      check(trigger.subject === undefined || ["SOURCE", "ANY"].includes(trigger.subject), "UNSUPPORTED_TRIGGER");
      check(hasProgram(trigger.programId), "MISSING_PROGRAM");
      if (trigger.zones !== undefined) check(definition.type === "CHARACTER" && Array.isArray(trigger.zones) && trigger.zones.length > 0 && new Set(trigger.zones).size === trigger.zones.length && trigger.zones.every(z => z === "FIELD" || (z === "PARTNER" && definition.mr === true)), "RULE_QUESTION_025");
      check(trigger.condition === undefined || trigger.condition === "TRACE_DISCOVERED", "UNSUPPORTED_CONDITION");
    }
    switch (definition.type) {
      case "PARTNER":
        exactKeys(definition, [...common, "type", "lp"], "UNSUPPORTED_CARD");
        check(integer(definition.lp, Number.MIN_SAFE_INTEGER), "CONTENT_NUMBER");
        break;
      case "CHARACTER":
        check(definition.mr === undefined || definition.mr === true, "UNSUPPORTED_MR");
        check(definition.disguise === undefined || definition.disguise === true, "UNSUPPORTED_DISGUISE");
        exactKeys(definition, [...common, "type", "level", "ap", "lp", "disguise", "mr", "declarations", ...(definition.keywords === undefined ? [] : ["keywords"])], "UNSUPPORTED_CARD");
        if (definition.declarations !== undefined) {
          check(Array.isArray(definition.declarations) && new Set(definition.declarations.map(a => a.abilityId)).size === definition.declarations.length, "UNSUPPORTED_DECLARATION");
          for (const ability of definition.declarations) {
            check(!Object.hasOwn(ability, "turn1") && !Object.hasOwn(ability, "usageLimit"), "RULE_QUESTION_027");
            exactKeys(ability, ["abilityId", "programId", "zones", "timing", "cost"], "UNSUPPORTED_DECLARATION");
            check(identifier(ability.abilityId) && hasProgram(ability.programId), "MISSING_PROGRAM");
            check(ability.timing === "OWN_MAIN" && ability.cost === "NONE", "UNSUPPORTED_DECLARATION");
            check(Array.isArray(ability.zones) && ability.zones.length > 0 && new Set(ability.zones).size === ability.zones.length && ability.zones.every(z => z === "FIELD" || (z === "PARTNER" && definition.mr === true)), "RULE_QUESTION_025");
            if (ability.zones.includes("PARTNER")) check(content.programs[ability.programId]!.sourceRequirements === "INDEPENDENT" && content.programs[ability.programId]!.targetZone === "NONE", "RULE_QUESTION_014");
          }
        }
        check([definition.level, definition.ap, definition.lp].every(n => integer(n, Number.MIN_SAFE_INTEGER)), "CONTENT_NUMBER");
        if (definition.keywords !== undefined) {
          validateKeywords(definition.keywords);
        }
        break;
      case "EVENT":
        exactKeys(definition, [...common, "type", "level", "programId"], "UNSUPPORTED_CARD");
        check(integer(definition.level, Number.MIN_SAFE_INTEGER) && hasProgram(definition.programId), "MISSING_PROGRAM");
        check(definition.triggers.length === 0, "UNSUPPORTED_EVENT_TRIGGER");
        break;
      case "CASE":
        exactKeys(definition, [...common, "type", "firstLevel", "secondLevel"], "UNSUPPORTED_CARD");
        check(integer(definition.firstLevel) && integer(definition.secondLevel), "CONTENT_NUMBER");
        break;
      default: throw new Error("UNSUPPORTED_CARD_TYPE");
    }
    const programs = definition.triggers.map(t => t.programId);
    for (const trigger of definition.triggers) {
      if (content.programs[trigger.programId]!.sourceRequirements === "FIELD_ENTRY") check(definition.type === "CHARACTER" && !(trigger.zones ?? []).includes("PARTNER"), "RULE_QUESTION_014");
    }
    if (definition.type === "EVENT") programs.push(definition.programId);
    if (definition.type !== "CHARACTER") {
      check(programs.every(p => !content.programs[p]!.instructions.some(i => ["SET_SOURCE_STATE", "REMOVE_SOURCE", "SUPPRESS_SOURCE_ABILITIES"].includes(i.op))), "UNSUPPORTED_SOURCE_STATE", "Only a field character can use source-state operations");
      check(programs.every(p => content.programs[p]!.sourceRequirements !== "FIELD_ENTRY"), "RULE_QUESTION_014");
    }
  }
}
export function validateDecks(options: CreateOptions, content: Content): void {
  assertJson(options);
  check(identifier(options.matchId) && integer(options.seed) && options.seed <= 0xffffffff, "OPTIONS");
  check(Array.isArray(options.players) && options.players.length === 2 && new Set(options.players.map(p => p.playerId)).size === 2, "PLAYERS");
  for (const player of options.players) {
    check(identifier(player.playerId), "PLAYER_ID");
    check(Object.hasOwn(content.definitions, player.partner) && Object.hasOwn(content.definitions, player.case) && content.definitions[player.partner]?.type === "PARTNER" && content.definitions[player.case]?.type === "CASE", "DECK_TYPE");
    check(Array.isArray(player.deck) && player.deck.length === 40, "DECK_SIZE");
    const counts = new Map<string, number>();
    for (const id of player.deck) {
      const definition = content.definitions[id];
      check(Object.hasOwn(content.definitions, id) && definition && ["CHARACTER", "EVENT"].includes(definition.type), "DECK_TYPE");
      const count = (counts.get(definition.printedId) ?? 0) + 1;
      check(count <= 3, "PRINTED_ID_LIMIT");
      counts.set(definition.printedId, count);
    }
  }
}
