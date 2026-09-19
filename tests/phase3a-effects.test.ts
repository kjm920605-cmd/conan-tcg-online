import assert from "node:assert/strict";
import test from "node:test";
import { GameEngine } from "../src/game/index.ts";
import { explicit } from "./phase3a-fixtures.ts";
import { fixture } from "./fixtures.ts";
import { arena, effects, ok, passContact, roundtrip } from "./phase2-fixtures.ts";

test("P3A-08 programs must declare every semantic field; old arrays are not a load fallback", () => {
  for (const field of ["sourceRequirements", "targetSelectionPoint", "targetZone", "duration", "invalidTargetBehavior"]) {
    const { content, options } = fixture(); const program = explicit([]) as unknown as Record<string, unknown>;
    delete program[field]; content.programs.draw = program as never;
    assert.throws(() => GameEngine.create(options, content), /RULE_QUESTION_014|RULE_QUESTION_023/);
  }
  const { content, options } = fixture(); content.programs.draw = [] as never;
  assert.throws(() => GameEngine.create(options, content), /UNSUPPORTED_PROGRAM/);
});
test("P3A-09 unknown rebinding, duration and source reads fail at content load", () => {
  for (const fields of [{ targetSelectionPoint: "TRIGGER" }, { invalidTargetBehavior: "RETARGET" }, { sourceRequirements: "LAST_KNOWN" }, { duration: "REPEAT_UNTIL_STABLE" }]) {
    const { content, options } = fixture();
    content.programs.draw = explicit([], fields as never);
    assert.throws(() => GameEngine.create(options, content), (error: any) => error.category === "UnsupportedRule");
  }
});
test("P3A-10 source AP modifier affects Contact priority and expires at Contact end", () => {
  const a = arena();
  a.content.programs.boost = explicit([{ op: "AP_MOD", target: "SOURCE", value: 2000 }], { duration: "UNTIL_CONTACT_END" });
  const attacker = a.add(a.turn, { ap: 1000, triggers: [{ event: "CONTACT_STARTED", player: "SELF", subject: "SOURCE", programId: "boost" }] });
  const defender = a.add(a.other, { ap: 2000 }); a.state.cards[defender]!.orientation = "SLEEP";
  const engine = a.resume(); ok(engine, { kind: "DECLARE_ACTION", cardId: attacker, target: { kind: "CHARACTER", cardId: defender } }); effects(engine);
  assert.equal(engine.getState().choice!.playerId, a.other);
  assert.equal(Object.keys(engine.getState().modifiers).length, 1); roundtrip(engine, a.content);
  passContact(engine);
  assert.ok(engine.getState().players[a.other]!.zones.REMOVE.includes(defender));
  assert.equal(Object.keys(engine.getState().modifiers).length, 0);
});
for (const op of ["ACTIVE", "SLEEP", "STUN"] as const) test("P3A-state " + op + " uses the orientation event pipeline", () => {
  const a = arena(); a.content.programs.state = explicit([{ op, target: "SOURCE" }]);
  const id = a.add(a.turn, { triggers: [{ event: "TURN_END", player: "SELF", programId: "state" }] });
  a.state.cards[id]!.orientation = op === "ACTIVE" ? "SLEEP" : "ACTIVE";
  const engine = a.resume(); ok(engine, { kind: "END_MAIN" }); effects(engine);
  assert.equal(engine.getState().cards[id]!.orientation, op);
  assert.ok(engine.getState().events.some(e => e.type === "ORIENTATION_CHANGED" && e.cardId === id));
});
test("P3A-14 fixed LP modifier before calculation is used and expires at turn end", () => {
  const a = arena(); a.content.programs.lp = explicit([{ op: "LP_MOD", target: "SOURCE", value: 1 }], { duration: "UNTIL_TURN_END" });
  const id = a.add(a.turn, { lp: 2, triggers: [{ event: "DEDUCTION_DECLARED", player: "SELF", subject: "SOURCE", programId: "lp" }] });
  const engine = a.resume(); ok(engine, { kind: "DEDUCE", cardId: id }); effects(engine);
  assert.equal(engine.getState().players[a.turn]!.zones.EVIDENCE.length, 3); roundtrip(engine, a.content);
  ok(engine, { kind: "END_MAIN" }); effects(engine);
  assert.equal(Object.keys(engine.getState().modifiers).length, 0);
});
for (const op of ["REMOVE", "MOVE"] as const) test("P3A-move " + op + " archives entry through formal movement", () => {
  const a = arena(); a.content.programs.leave = explicit([op === "REMOVE" ? { op, target: "SOURCE" } : { op, target: "SOURCE", from: "FIELD", to: "HAND" }]);
  const id = a.add(a.turn, { triggers: [{ event: "TURN_END", player: "SELF", programId: "leave" }] });
  const engine = a.resume(); const entryId = engine.getState().cards[id]!.entryId!;
  ok(engine, { kind: "END_MAIN" }); effects(engine);
  assert.equal(engine.getState().entries[entryId]!.status, "LEFT");
  assert.ok(engine.getState().players[a.turn]!.zones[op === "MOVE" ? "HAND" : "REMOVE"].includes(id));
  roundtrip(engine, a.content);
});
test("P3A-17 expiry-trigger content is rejected with RQ-023 rather than a cleanup loop", () => {
  const { content, options } = fixture();
  content.definitions.v0!.triggers = [{ event: "MODIFIER_EXPIRED", player: "SELF", programId: "draw" } as never];
  assert.throws(() => GameEngine.create(options, content), /RULE_QUESTION_023/);
});
