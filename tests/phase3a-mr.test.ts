import assert from "node:assert/strict";
import test from "node:test";
import { arena, effects, ok, roundtrip, send } from "./phase2-fixtures.ts";
import { explicit, hand } from "./phase3a-fixtures.ts";

test("P3A-MR explicit Partner declaration dispatches only its bound independent program", () => {
  const a = arena(); a.content.programs.leave = explicit([{ op: "REMOVE", target: "SOURCE" }]);
  a.content.programs.drawOne = explicit([{ op: "DRAW", player: "SELF", count: 1 }], { sourceRequirements: "INDEPENDENT", targetSelectionPoint: "NONE", targetZone: "NONE" });
  const mr = a.add(a.other, { mr: true, triggers: [{ event: "TURN_END", player: "OPPONENT", programId: "leave" }],
    declarations: [{ abilityId: "draw", programId: "drawOne", zones: ["PARTNER"], timing: "OWN_MAIN", cost: "NONE" }] });
  const engine = a.resume(); ok(engine, { kind: "END_MAIN" }); effects(engine);
  const before = engine.getState().players[a.other]!.zones.HAND.length;
  const snapshot = engine.serialize();
  assert.equal(send(engine, { kind: "DECLARE_ABILITY", cardId: mr, abilityId: "leave" }).accepted, false);
  assert.equal(engine.serialize(), snapshot);
  ok(engine, { kind: "DECLARE_ABILITY", cardId: mr, abilityId: "draw" });
  roundtrip(engine, a.content); effects(engine);
  assert.equal(engine.getState().players[a.other]!.zones.HAND.length, before + 1);
});

test("P3A-MR declarations require explicit area and active printed ability, never FILE Partner", () => {
  const a = arena(); a.content.programs.drawOne = explicit([{ op: "DRAW", player: "SELF", count: 1 }], { sourceRequirements: "INDEPENDENT", targetSelectionPoint: "NONE", targetZone: "NONE" });
  const mr = a.add(a.turn, { mr: true, declarations: [{ abilityId: "draw", programId: "drawOne", zones: ["PARTNER"], timing: "OWN_MAIN", cost: "NONE" }] });
  const engine = a.resume();
  assert.equal(send(engine, { kind: "DECLARE_ABILITY", cardId: mr, abilityId: "draw" }).accepted, false);
  ok(engine, { kind: "ASSIST" }); effects(engine);
  const result = send(engine, { kind: "DECLARE_ABILITY", cardId: a.state.players[a.turn]!.partnerId, abilityId: "draw" });
  assert.ok(!result.accepted); assert.equal(result.code, "RULE_QUESTION_025");
});

test("P3A-MR unknown declaration limits are refused at content load", () => {
  const a = arena(); a.content.programs.drawOne = explicit([{ op: "DRAW", player: "SELF", count: 1 }], { sourceRequirements: "INDEPENDENT", targetSelectionPoint: "NONE", targetZone: "NONE" });
  a.add(a.turn, { mr: true, declarations: [{ abilityId: "draw", programId: "drawOne", zones: ["PARTNER"], timing: "OWN_MAIN", cost: "NONE", turn1: true } as never] });
  assert.throws(() => a.resume(), /RULE_QUESTION_027/);
});

test("P3A-27 MR removal on opponent turn visits Remove before Partner and triggers removal", () => {
  const a = arena(); a.content.programs.leave = explicit([{ op: "REMOVE", target: "SOURCE" }]);
  a.content.programs.drawOne = explicit([{ op: "DRAW", player: "SELF", count: 1 }], { sourceRequirements: "INDEPENDENT", targetSelectionPoint: "NONE", targetZone: "NONE" });
  const mr = a.add(a.other, { mr: true, triggers: [
    { event: "TURN_END", player: "OPPONENT", programId: "leave" },
    { event: "CHARACTER_REMOVED", player: "SELF", subject: "SOURCE", programId: "drawOne" },
  ] });
  const engine = a.resume(), before = engine.getState().players[a.other]!.zones.HAND.length;
  ok(engine, { kind: "END_MAIN" }); effects(engine);
  assert.ok(engine.getState().players[a.other]!.zones.PARTNER.includes(mr));
  assert.ok(!engine.getState().players[a.other]!.zones.REMOVE.includes(mr));
  const moves = engine.getState().events.filter(e => e.type === "CARD_MOVED" && e.cardId === mr).map(e => e.detail);
  assert.deepEqual(moves, ["FIELD>REMOVE", "REMOVE>PARTNER"]);
  assert.equal(engine.getState().players[a.other]!.zones.HAND.length, before + 2);
  for (const intent of [{ kind: "DEDUCE", cardId: mr }, { kind: "DECLARE_ACTION", cardId: mr, target: { kind: "CASE", cardId: a.state.players[a.turn]!.caseId } }] as const) assert.equal(send(engine, intent).accepted, false);
  roundtrip(engine, a.content);
});
test("P3A-28 own-turn MR departure stays in its destination", () => {
  const a = arena(); a.content.programs.leave = explicit([{ op: "MOVE", target: "SOURCE", from: "FIELD", to: "HAND" }]);
  const mr = a.add(a.turn, { mr: true, triggers: [{ event: "TURN_END", player: "SELF", programId: "leave" }] });
  const engine = a.resume(); ok(engine, { kind: "END_MAIN" }); effects(engine);
  assert.ok(engine.getState().players[a.turn]!.zones.HAND.includes(mr));
  assert.ok(!engine.getState().players[a.turn]!.zones.PARTNER.includes(mr));
});
test("P3A-29 normal MR entry removes existing own Field and Partner MR by MR rule", () => {
  const a = arena(); const old = a.add(a.turn, { mr: true }), fresh = hand(a, a.turn, { mr: true });
  const engine = a.resume(); ok(engine, { kind: "PLAY_CARD", cardId: fresh }); effects(engine);
  assert.deepEqual(engine.getState().players[a.turn]!.zones.FIELD, [fresh]);
  assert.ok(engine.getState().players[a.turn]!.zones.REMOVE.includes(old));
  assert.ok(engine.getState().events.some(e => e.type === "CHARACTER_REMOVED" && e.cardId === old && e.cause === "MR_ABILITY"));
  roundtrip(engine, a.content);
});
test("P3A-30 Partner MR only observes explicitly enabled area abilities", () => {
  const a = arena(); a.content.programs.leave = explicit([{ op: "REMOVE", target: "SOURCE" }]);
  a.content.programs.drawOne = explicit([{ op: "DRAW", player: "SELF", count: 1 }], { sourceRequirements: "INDEPENDENT", targetSelectionPoint: "NONE", targetZone: "NONE" });
  const mr = a.add(a.other, { mr: true, triggers: [
    { event: "TURN_END", player: "OPPONENT", programId: "leave" },
    { event: "CARD_DRAWN", player: "SELF", programId: "drawOne" },
    { event: "TURN_END", player: "SELF", programId: "drawOne", zones: ["PARTNER"] },
  ] });
  const engine = a.resume(); ok(engine, { kind: "END_MAIN" }); effects(engine);
  assert.equal(engine.getState().status, "PLAYING"); assert.ok(engine.getState().players[a.other]!.zones.PARTNER.includes(mr));
  const before = engine.getState().players[a.other]!.zones.HAND.length;
  ok(engine, { kind: "END_MAIN" }); effects(engine);
  assert.equal(engine.getState().players[a.other]!.zones.HAND.length, before + 1);
});
test("P3A-31 a new own-turn MR removes the old MR from Partner without moving the Partner card", () => {
  const a = arena(); a.content.programs.leave = explicit([{ op: "REMOVE", target: "SOURCE" }]);
  const old = a.add(a.other, { mr: true, triggers: [{ event: "TURN_END", player: "OPPONENT", programId: "leave" }] });
  const fresh = hand(a, a.other, { mr: true });
  const engine = a.resume(); ok(engine, { kind: "END_MAIN" }); effects(engine);
  assert.ok(engine.getState().players[a.other]!.zones.PARTNER.includes(old));
  ok(engine, { kind: "PLAY_CARD", cardId: fresh }); effects(engine);
  assert.deepEqual(engine.getState().players[a.other]!.zones.PARTNER, [a.state.players[a.other]!.partnerId]);
  assert.ok(engine.getState().players[a.other]!.zones.REMOVE.includes(old));
  assert.ok(engine.getState().players[a.other]!.zones.FIELD.includes(fresh)); roundtrip(engine, a.content);
});
