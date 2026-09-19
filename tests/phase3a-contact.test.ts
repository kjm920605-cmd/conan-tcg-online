import assert from "node:assert/strict";
import test from "node:test";
import { GameEngine } from "../src/game/index.ts";
import { arena, effects, ok, passContact, roundtrip, send } from "./phase2-fixtures.ts";
import { explicit, hand, startContact } from "./phase3a-fixtures.ts";
import { relocate } from "./fixtures.ts";

test("P3A-Cut-in continues after its own physical card is shuffled by Refresh", () => {
  const a = arena(), attacker = a.add(a.turn, { ap: 5000 }), defender = a.add(a.other);
  a.content.programs.refreshCut = explicit([{ op: "DRAW", player: "SELF", count: 1 }, { op: "AP_MOD", target: "OWN_CONTACT", value: 5000 }], { sourceRequirements: "INDEPENDENT", duration: "UNTIL_CONTACT_END" });
  const card = hand(a, a.other, { cutIns: [{ abilityId: "refresh", programId: "refreshCut" }] });
  relocate(a.state, a.other, "DECK", "REMOVE", a.state.players[a.other]!.zones.DECK.length - 1);
  const engine = startContact(a, attacker, defender), copy = GameEngine.restore(engine.serialize(), a.content);
  const intent = { kind: "RESPOND_CONTACT", choiceId: engine.getState().choice!.id, response: "CUT_IN", cardId: card, abilityId: "refresh" } as const;
  ok(engine, intent); ok(copy, intent); effects(engine); effects(copy);
  assert.equal(engine.serialize(), copy.serialize()); assert.ok(engine.getState().players[a.other]!.zones.DECK.includes(card));
  assert.equal(Object.keys(engine.getState().modifiers).length, 1); roundtrip(engine, a.content); passContact(engine);
  assert.ok(engine.getState().players[a.other]!.zones.FIELD.includes(defender));
});

test("P3A disabled Disguise is illegal; disabled Cut-in still spends its one response without effect", () => {
  const a = arena(), attacker = a.add(a.turn, { ap: 5000 }), defender = a.add(a.other), card = cut(a, a.other);
  const disguised = hand(a, a.other, { disguise: true });
  a.state.cards[card]!.abilitiesSuppressed = true; a.state.cards[disguised]!.abilitiesSuppressed = true;
  const engine = startContact(a, attacker, defender), before = engine.serialize();
  assert.equal(send(engine, { kind: "RESPOND_CONTACT", choiceId: engine.getState().choice!.id, response: "DISGUISE", cardId: disguised }).accepted, false);
  assert.equal(engine.serialize(), before);
  ok(engine, { kind: "RESPOND_CONTACT", choiceId: engine.getState().choice!.id, response: "CUT_IN", cardId: card, abilityId: "boost" }); effects(engine);
  assert.equal(Object.keys(engine.getState().modifiers).length, 0);
  assert.equal(send(engine, { kind: "RESPOND_CONTACT", choiceId: engine.getState().choice!.id, response: "DISGUISE", cardId: disguised }, a.other).accepted, false);
  assert.ok(engine.getState().players[a.other]!.zones.REMOVE.includes(card)); passContact(engine);
});

test("P3A Disguise MR interaction stays RQ-019", () => {
  const a = arena(), attacker = a.add(a.turn, { ap: 5000 }), defender = a.add(a.other, { mr: true });
  const card = hand(a, a.other, { disguise: true }); const engine = startContact(a, attacker, defender), before = engine.serialize();
  const result = send(engine, { kind: "RESPOND_CONTACT", choiceId: engine.getState().choice!.id, response: "DISGUISE", cardId: card });
  assert.ok(!result.accepted); assert.equal(result.code, "RULE_QUESTION_019"); assert.equal(engine.serialize(), before);
});

test("P3A action modifier survives Contact end and expires after Action end effects", () => {
  const a = arena(); a.content.programs.boostAction = explicit([{ op: "AP_MOD", target: "SOURCE", value: 1000 }], { duration: "UNTIL_ACTION_END" });
  const attacker = a.add(a.turn, { triggers: [{ event: "ACTION_DECLARED", player: "SELF", subject: "SOURCE", programId: "boostAction" }] }), defender = a.add(a.other, { ap: 5000 });
  const engine = startContact(a, attacker, defender);
  for (let i = 0; i < 2; i++) { ok(engine, { kind: "RESPOND_CONTACT", choiceId: engine.getState().choice!.id, response: "PASS" }); if (i === 0) effects(engine); }
  while (!engine.getState().events.some(e => e.type === "ACTION_ENDED")) assert.equal(engine.advance(), true);
  assert.equal(Object.keys(engine.getState().modifiers).length, 1); roundtrip(engine, a.content); effects(engine);
  assert.equal(Object.keys(engine.getState().modifiers).length, 0);
});

function cut(a: ReturnType<typeof arena>, owner: string, value = 2000) {
  const programId = "cut-" + owner;
  a.content.programs[programId] = explicit([{ op: "AP_MOD", target: "OWN_CONTACT", value }], { sourceRequirements: "INDEPENDENT", duration: "UNTIL_CONTACT_END" });
  return hand(a, owner, { colors: ["RED"], level: 99, cutIns: [{ abilityId: "boost", programId }] });
}
test("P3A-18 Cut-in ignores Case color and FILE level, moves to Remove before effect", () => {
  const a = arena(), attacker = a.add(a.turn, { ap: 1000 }), defender = a.add(a.other, { ap: 2000 }), card = cut(a, a.turn);
  const engine = startContact(a, attacker, defender);
  ok(engine, { kind: "RESPOND_CONTACT", choiceId: engine.getState().choice!.id, response: "CUT_IN", cardId: card, abilityId: "boost" });
  assert.ok(engine.getState().players[a.turn]!.zones.REMOVE.includes(card));
  assert.equal(Object.keys(engine.getState().modifiers).length, 0);
  effects(engine); assert.equal(Object.keys(engine.getState().modifiers).length, 1);
  assert.equal(engine.getState().choice!.playerId, a.other); roundtrip(engine, a.content);
  passContact(engine);
  assert.ok(engine.getState().players[a.other]!.zones.REMOVE.includes(defender));
  assert.equal(Object.keys(engine.getState().modifiers).length, 0);
});
test("P3A-19 first pass plus second action grants exactly one first-player retry", () => {
  const a = arena(), attacker = a.add(a.turn, { ap: 1000 }), defender = a.add(a.other, { ap: 2000 });
  const first = cut(a, a.turn), second = cut(a, a.other);
  const engine = startContact(a, attacker, defender);
  ok(engine, { kind: "RESPOND_CONTACT", choiceId: engine.getState().choice!.id, response: "PASS" }); effects(engine);
  ok(engine, { kind: "RESPOND_CONTACT", choiceId: engine.getState().choice!.id, response: "CUT_IN", cardId: second, abilityId: "boost" }); effects(engine);
  assert.equal(engine.getState().choice!.playerId, a.turn); roundtrip(engine, a.content);
  ok(engine, { kind: "RESPOND_CONTACT", choiceId: engine.getState().choice!.id, response: "CUT_IN", cardId: first, abilityId: "boost" }); effects(engine);
  assert.equal(engine.getState().frames.length, 0);
  assert.equal(engine.getState().events.filter(e => e.type === "CUT_IN_USED").length, 2);
});
test("P3A-20 a card with two Cut-ins resolves only the selected ability", () => {
  const a = arena(), attacker = a.add(), defender = a.add(a.other);
  const card = cut(a, a.other, 2000);
  a.content.programs.drawCut = explicit([{ op: "DRAW", player: "SELF", count: 1 }], { sourceRequirements: "INDEPENDENT", targetSelectionPoint: "NONE", targetZone: "NONE" });
  const definition = a.content.definitions[a.state.cards[card]!.definitionId]!;
  definition.cutIns!.push({ abilityId: "draw", programId: "drawCut" });
  const engine = startContact(a, attacker, defender), before = engine.getState().players[a.other]!.zones.HAND.length;
  ok(engine, { kind: "RESPOND_CONTACT", choiceId: engine.getState().choice!.id, response: "CUT_IN", cardId: card, abilityId: "draw" }); effects(engine);
  assert.equal(engine.getState().players[a.other]!.zones.HAND.length, before);
  assert.equal(Object.keys(engine.getState().modifiers).length, 0); passContact(engine);
});
test("P3A-21 Disguise changes physical carrier through a replacement occurrence, never play", () => {
  const a = arena(), attacker = a.add(a.turn, { ap: 5000 }), defender = a.add(a.other, { ap: 1000 });
  a.content.programs.drawOne = explicit([{ op: "DRAW", player: "SELF", count: 1 }], { sourceRequirements: "INDEPENDENT", targetSelectionPoint: "NONE", targetZone: "NONE" });
  const card = hand(a, a.other, { ap: 6000, disguise: true, triggers: [
    { event: "DISGUISED", player: "SELF", subject: "SOURCE", programId: "drawOne" },
    { event: "CHARACTER_ENTERED", player: "SELF", subject: "SOURCE", programId: "drawOne" },
  ] });
  const engine = startContact(a, attacker, defender), before = engine.getState(), oldEntry = before.cards[defender]!.entryId!;
  ok(engine, { kind: "RESPOND_CONTACT", choiceId: before.choice!.id, response: "DISGUISE", cardId: card });
  const replaced = engine.getState();
  assert.equal(replaced.players[a.other]!.zones.DECK.at(-1), defender);
  assert.equal(replaced.cards[defender]!.face, "DOWN");
  assert.equal(replaced.cards[card]!.orientation, "SLEEP");
  assert.notEqual(replaced.cards[card]!.entryId, oldEntry);
  assert.equal(replaced.entries[oldEntry]!.status, "REPLACED");
  assert.equal(replaced.entries[replaced.cards[card]!.entryId!]!.previousEntryId, oldEntry);
  assert.equal(replaced.events.filter(e => e.type === "CHARACTER_ENTERED").length, before.events.filter(e => e.type === "CHARACTER_ENTERED").length);
  roundtrip(engine, a.content); effects(engine);
  assert.equal(engine.getState().players[a.other]!.zones.HAND.length, before.players[a.other]!.zones.HAND.length);
  passContact(engine); assert.ok(engine.getState().players[a.other]!.zones.FIELD.includes(card));
});
test("P3A-22 Disguise cross-color or over-level stays RQ-010 without consuming a response", () => {
  for (const extra of [{ colors: ["RED"] }, { level: 99 }]) {
    const a = arena(), attacker = a.add(a.turn, { ap: 4000 }), defender = a.add(a.other);
    const card = hand(a, a.other, { disguise: true, ...extra });
    const engine = startContact(a, attacker, defender), before = engine.serialize();
    const result = send(engine, { kind: "RESPOND_CONTACT", choiceId: engine.getState().choice!.id, response: "DISGUISE", cardId: card });
    assert.equal(result.accepted, false);
    if (!result.accepted) assert.equal(result.code, "RULE_QUESTION_010");
    assert.equal(engine.serialize(), before);
  }
});
test("P3A-23 Contact command replay and restore preserve modifier, choice and RNG", () => {
  const a = arena(), attacker = a.add(), defender = a.add(a.other), card = cut(a, a.other);
  const engine = startContact(a, attacker, defender), copy = GameEngine.restore(engine.serialize(), a.content);
  const intent = { kind: "RESPOND_CONTACT", choiceId: engine.getState().choice!.id, response: "CUT_IN", cardId: card, abilityId: "boost" } as const;
  ok(engine, intent); ok(copy, intent);
  for (let i = 0; i < 50; i++) {
    roundtrip(engine, a.content); assert.equal(engine.serialize(), copy.serialize());
    if (engine.getState().choice) break;
    assert.equal(engine.advance(), copy.advance());
  }
  passContact(engine); passContact(copy); assert.equal(engine.serialize(), copy.serialize());
});
