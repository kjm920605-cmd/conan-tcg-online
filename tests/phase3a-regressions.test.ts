import assert from "node:assert/strict";
import test from "node:test";
import { arena, effects, ok, passContact, roundtrip } from "./phase2-fixtures.ts";
import { explicit, hand, startContact } from "./phase3a-fixtures.ts";
import { GameEngine } from "../src/game/index.ts";

test("P3A-R restored grants reject unknown trigger semantics", () => {
  const a = arena(); a.content.programs.drawOne = explicit([{ op: "DRAW", player: "SELF", count: 1 }], { sourceRequirements: "INDEPENDENT", targetSelectionPoint: "NONE", targetZone: "NONE" });
  const card = a.add();
  a.state.entries[a.state.cards[card]!.entryId!]!.grantedAbilities.push({ kind: "TRIGGER", sourceId: card, trigger: { event: "UNKNOWN_TRIGGER" as never, player: "SELF", programId: "drawOne" } });
  assert.throws(() => a.resume(), /UNSUPPORTED_TRIGGER/);
});

test("P3A-R granted Mislead retains its paid value after suppression", () => {
  const a = arena(), source = a.add(a.turn, { lp: 2 });
  a.content.programs.suppress = explicit([{ op: "SUPPRESS_SOURCE_ABILITIES" }]);
  const guard = a.add(a.other, { triggers: [{ event: "MISLEAD_USED", player: "SELF", subject: "SOURCE", programId: "suppress" }] });
  a.state.entries[a.state.cards[guard]!.entryId!]!.grantedAbilities.push({ kind: "KEYWORD", sourceId: source, keyword: { kind: "MISLEAD_X", value: 1 } });
  const engine = a.resume(); ok(engine, { kind: "DEDUCE", cardId: source }); effects(engine);
  ok(engine, { kind: "CHOOSE_MISLEAD", choiceId: engine.getState().choice!.id, cardIds: [guard] });
  roundtrip(engine, a.content); effects(engine);
  assert.equal(engine.getState().players[a.turn]!.zones.EVIDENCE.length, 1);
});

test("P3A-R investigation continuation is bound to its parent instruction and fixed keyword", () => {
  const a = arena(); a.content.programs.investigate = explicit([{ op: "INVOKE_KEYWORD", keyword: "INVESTIGATE_X" }]);
  a.add(a.turn, { keywords: [{ kind: "INVESTIGATE_X", value: 3 }], triggers: [{ event: "TURN_END", player: "SELF", programId: "investigate" }] });
  const engine = a.resume(); ok(engine, { kind: "END_MAIN" }); effects(engine);
  const state = JSON.parse(engine.serialize()), frame = state.frames.at(-1);
  frame.count = 20; frame.revealed = state.players[a.other].zones.DECK.slice(0, 20);
  state.choice.candidates = [...frame.revealed];
  for (const id of frame.revealed) state.cards[id].face = "UP";
  assert.throws(() => GameEngine.restore(JSON.stringify(state), a.content), /PROCEDURE_INVESTIGATION/);
});

test("P3A-R field source programs cannot bind to Case or Partner-area triggers", () => {
  const a = arena(); a.content.programs.bad = explicit([{ op: "AP_MOD", target: "SOURCE", value: 1000 }], { duration: "UNTIL_TURN_END" });
  a.content.definitions.c!.triggers = [{ event: "TURN_END", player: "SELF", programId: "bad" }];
  assert.throws(() => a.resume(), /RULE_QUESTION_014/);
  a.content.definitions.c!.triggers = [];
  a.add(a.turn, { mr: true, triggers: [{ event: "TURN_END", player: "SELF", programId: "bad", zones: ["PARTNER"] }] });
  assert.throws(() => a.resume(), /RULE_QUESTION_014/);
});

test("P3A-R already pending fixed Investigate survives later printed ability suppression", () => {
  const a = arena(); a.content.programs.suppress = explicit([{ op: "SUPPRESS_SOURCE_ABILITIES" }]);
  a.content.programs.investigate = explicit([{ op: "INVOKE_KEYWORD", keyword: "INVESTIGATE_X" }]);
  a.add(a.turn, { keywords: [{ kind: "INVESTIGATE_X", value: 3 }], triggers: [
    { event: "TURN_END", player: "SELF", programId: "suppress" }, { event: "TURN_END", player: "SELF", programId: "investigate" },
  ] });
  const engine = a.resume(); ok(engine, { kind: "END_MAIN" }); effects(engine);
  const choice = engine.getState().choice!; assert.equal(choice.kind, "INVESTIGATION_ORDER");
  if (choice.kind !== "INVESTIGATION_ORDER") assert.fail();
  assert.equal(choice.candidates.length, 3); roundtrip(engine, a.content);
  ok(engine, { kind: "CHOOSE_INVESTIGATION_ORDER", choiceId: choice.id, cardIds: [...choice.candidates] }); effects(engine);
  assert.equal(engine.getState().status, "PLAYING");
});

for (const [event, duration] of [["CONTACT_ENDED", "UNTIL_CONTACT_END"], ["ACTION_ENDED", "UNTIL_ACTION_END"], ["TURN_END", "UNTIL_TURN_END"]] as const)
test("P3A-R-expiry " + event + " cannot create a modifier in its ending scope", () => {
  const a = arena();
  a.content.programs.late = explicit([{ op: "AP_MOD", target: "SOURCE", value: 2000 }], { duration });
  const attacker = a.add(a.turn, { ap: 1000, triggers: [{ event, player: "SELF", subject: event === "TURN_END" ? "ANY" : "SOURCE", programId: "late" }] });
  const defender = a.add(a.other, { ap: 2000 });
  const engine = startContact(a, attacker, defender); passContact(engine);
  if (event === "TURN_END") { ok(engine, { kind: "END_MAIN" }); effects(engine); }
  assert.equal(engine.getState().blocked?.questionId, "RULE-QUESTION-023");
  assert.equal(Object.keys(engine.getState().modifiers).length, 0);
  roundtrip(engine, a.content);
});
test("P3A-R-disguise departing source retains its already detected movement trigger", () => {
  const a = arena();
  a.content.programs.drawOne = explicit([{ op: "DRAW", player: "SELF", count: 1 }], { sourceRequirements: "INDEPENDENT", targetSelectionPoint: "NONE", targetZone: "NONE" });
  const attacker = a.add(a.turn, { ap: 4000 });
  const defender = a.add(a.other, { triggers: [{ event: "CARD_MOVED", player: "SELF", subject: "SOURCE", programId: "drawOne" }] });
  const card = hand(a, a.other, { disguise: true, ap: 5000 });
  const engine = startContact(a, attacker, defender), count = engine.getState().players[a.other]!.zones.HAND.length;
  ok(engine, { kind: "RESPOND_CONTACT", choiceId: engine.getState().choice!.id, response: "DISGUISE", cardId: card }); effects(engine);
  assert.equal(engine.getState().players[a.other]!.zones.HAND.length, count);
  assert.ok(engine.getState().events.some(e => e.type === "ABILITY_TRIGGERED" && e.cardId === defender));
  roundtrip(engine, a.content); passContact(engine);
});

test("P3A-R-snapshot rejects dangling, malformed or expired modifier records", () => {
  const a = arena();
  a.content.programs.boost = explicit([{ op: "AP_MOD", target: "SOURCE", value: 1000 }], { duration: "UNTIL_CONTACT_END" });
  const attacker = a.add(a.turn, { triggers: [{ event: "CONTACT_STARTED", player: "SELF", subject: "SOURCE", programId: "boost" }] }), defender = a.add(a.other);
  const engine = startContact(a, attacker, defender);
  for (const patch of [{ targetEntryId: "absent" }, { duration: "LOOP" }, { scopeId: "old-contact" }, { stat: "BAD" }, { value: 0.5 }, { onExpire: "draw" }]) {
    const state = JSON.parse(engine.serialize()); Object.assign(Object.values(state.modifiers)[0]!, patch);
    assert.throws(() => GameEngine.restore(JSON.stringify(state), a.content), /MODIFIER|RULE_QUESTION_023/);
  }
});
test("P3A-R-snapshot rejects dangling attachments and forged replacement ancestry", () => {
  const a = arena(); const attacker = a.add(), defender = a.add(a.other);
  const engine = startContact(a, attacker, defender);
  const state = JSON.parse(engine.serialize());
  state.cards[attacker].attachment = { kind: "SET", hostEntryId: state.cards[defender].entryId };
  assert.throws(() => GameEngine.restore(JSON.stringify(state), a.content), /ATTACHMENT/);
  const broken = JSON.parse(engine.serialize());
  broken.entries[broken.cards[defender].entryId].previousEntryId = broken.cards[attacker].entryId;
  assert.throws(() => GameEngine.restore(JSON.stringify(broken), a.content), /ENTRY/);
});
test("P3A-R-snapshot rejects fake response retries and malformed priority samples", () => {
  const a = arena(), attacker = a.add(), defender = a.add(a.other), engine = startContact(a, attacker, defender);
  for (const patch of [{ priorityAP: ["high", 2] }, { responseIndex: 3, responses: ["CUT_IN", "CUT_IN", "CUT_IN"] }]) {
    const state = JSON.parse(engine.serialize()); Object.assign(state.frames.find((f: any) => f.kind === "CONTACT"), patch);
    assert.throws(() => GameEngine.restore(JSON.stringify(state), a.content), /FRAME_|CHOICE_/);
  }
});
