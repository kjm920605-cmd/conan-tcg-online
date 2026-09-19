import type { CardDefinition, EffectProgram, Instruction } from "../src/game/index.ts";
import { relocate } from "./fixtures.ts";
import { arena, effects, ok } from "./phase2-fixtures.ts";

export function explicit(instructions: Instruction[], overrides: Partial<EffectProgram> = {}): EffectProgram {
  return { sourceRequirements: "FIELD_ENTRY", targetSelectionPoint: "RESOLUTION", targetZone: "FIELD",
    duration: "INSTANT", invalidTargetBehavior: "BLOCK", instructions, ...overrides };
}
export function hand(a: ReturnType<typeof arena>, owner: string, values: Partial<CardDefinition> = {}): string {
  const id = a.state.players[owner]!.zones.DECK[0]!, definitionId = "hand-" + id;
  a.content.definitions[definitionId] = { ...a.content.definitions.v0!, ...values, definitionId, printedId: definitionId } as CardDefinition;
  a.state.cards[id]!.definitionId = definitionId;
  relocate(a.state, owner, "DECK", "HAND", 1);
  return id;
}
export function startContact(a: ReturnType<typeof arena>, attacker: string, defender: string) {
  a.state.cards[defender]!.orientation = "SLEEP";
  const engine = a.resume();
  ok(engine, { kind: "DECLARE_ACTION", cardId: attacker, target: { kind: "CHARACTER", cardId: defender } }); effects(engine);
  if (engine.getState().choice?.kind === "GUARD") {
    ok(engine, { kind: "CHOOSE_GUARD", choiceId: engine.getState().choice!.id, cardId: null }); effects(engine);
  }
  return engine;
}
