import assert from "node:assert/strict";
import test from "node:test";
import { arena, effects, ok, passContact, roundtrip } from "./phase2-fixtures.ts";
import { explicit, hand, startContact } from "./phase3a-fixtures.ts";
import { relocate } from "./fixtures.ts";
import { keywords } from "../src/game/rules/keywords.ts";

test("P3A-24 Set and underneath use separate containers and are removed with their host", () => {
  const a = arena();
  a.content.programs.attach = explicit([{ op: "SET_CARD", target: "SOURCE", count: 2 }, { op: "STACK_UNDER", target: "SOURCE", count: 1 }]);
  a.content.programs.leave = explicit([{ op: "REMOVE", target: "SOURCE" }]);
  const id = a.add(a.turn, { triggers: [
    { event: "DEDUCTION_DECLARED", player: "SELF", subject: "SOURCE", programId: "attach" },
    { event: "TURN_END", player: "SELF", programId: "leave" },
  ] });
  const engine = a.resume(); ok(engine, { kind: "DEDUCE", cardId: id }); effects(engine);
  const attached = engine.getState().players[a.turn]!.zones;
  assert.equal(attached.SET.length, 2); assert.equal(attached.UNDER.length, 1);
  for (const card of [...attached.SET, ...attached.UNDER]) assert.equal(engine.getState().cards[card]!.attachment?.hostEntryId, engine.getState().cards[id]!.entryId);
  roundtrip(engine, a.content);
  ok(engine, { kind: "END_MAIN" }); effects(engine);
  const after = engine.getState();
  assert.equal(after.players[a.turn]!.zones.SET.length + after.players[a.turn]!.zones.UNDER.length, 0);
  for (const card of [...attached.SET, ...attached.UNDER]) {
    assert.ok(after.players[a.turn]!.zones.REMOVE.includes(card));
    assert.equal(after.cards[card]!.face, "UP"); assert.equal(after.cards[card]!.attachment, null);
  }
});
test("P3A-25 deck-top Set resumes its remaining count after immediate Refresh", () => {
  const a = arena(); a.content.programs.attach = explicit([{ op: "SET_CARD", target: "SOURCE", count: 2 }]);
  const id = a.add(a.turn, { triggers: [{ event: "TURN_END", player: "SELF", programId: "attach" }] });
  relocate(a.state, a.turn, "DECK", "REMOVE", a.state.players[a.turn]!.zones.DECK.length - 1);
  const engine = a.resume(); ok(engine, { kind: "END_MAIN" }); effects(engine);
  assert.equal(engine.getState().players[a.turn]!.zones.SET.length, 2);
  assert.ok(engine.getState().events.some(e => e.type === "REFRESHED" && e.playerId === a.turn)); roundtrip(engine, a.content);
});
test("P3A-26 Disguise inherits received effects, granted abilities and both attachment kinds", () => {
  const a = arena();
  a.content.programs.attach = explicit([{ op: "SET_CARD", target: "SOURCE", count: 1 }, { op: "STACK_UNDER", target: "SOURCE", count: 1 }, { op: "AP_MOD", target: "SOURCE", value: 1000 }], { duration: "UNTIL_CONTACT_END" });
  a.content.programs.drawOne = explicit([{ op: "DRAW", player: "SELF", count: 1 }], { sourceRequirements: "INDEPENDENT", targetSelectionPoint: "NONE", targetZone: "NONE" });
  const attacker = a.add(a.turn, { ap: 5000 }), defender = a.add(a.other, { ap: 1000, triggers: [{ event: "CONTACT_STARTED", player: "ANY", programId: "attach" }] });
  a.state.entries[a.state.cards[defender]!.entryId!]!.grantedAbilities.push(
    { kind: "KEYWORD", sourceId: attacker, keyword: { kind: "RAPID" } },
    { kind: "TRIGGER", sourceId: attacker, trigger: { event: "CONTACT_ENDED", player: "ANY", programId: "drawOne" } },
  );
  const card = hand(a, a.other, { ap: 6000, disguise: true });
  const engine = startContact(a, attacker, defender), before = engine.getState();
  ok(engine, { kind: "RESPOND_CONTACT", choiceId: before.choice!.id, response: "DISGUISE", cardId: card }); effects(engine);
  const state = JSON.parse(engine.serialize()), newEntry = state.cards[card].entryId;
  assert.ok(keywords(state, a.content, card).some(k => k.kind === "RAPID"));
  assert.equal(state.entries[newEntry].grantedAbilities.length, 2);
  for (const id of [...before.players[a.other]!.zones.SET, ...before.players[a.other]!.zones.UNDER]) assert.equal(state.cards[id].attachment.hostEntryId, newEntry);
  assert.ok(Object.values(state.modifiers).some((m: any) => m.targetEntryId === newEntry));
  roundtrip(engine, a.content); const handCount = engine.getState().players[a.other]!.zones.HAND.length;
  passContact(engine);
  assert.equal(engine.getState().players[a.other]!.zones.HAND.length, handCount + 1);
});
