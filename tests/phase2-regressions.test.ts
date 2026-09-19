import { coreProgram } from "../examples/programs.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../src/game/index.ts";
import { mutable, relocate } from "./fixtures.ts";
import { arena, effects, ok, roundtrip } from "./phase2-fixtures.ts";

test("P2-R01 repeated Next Hint and nested Event finish before pending effects", () => {
  const a = arena();
  relocate(a.state, a.turn, "DECK", "FILE", 2);
  const id = a.state.players[a.turn]!.zones.HAND[0]!;
  a.content.programs.drawOne = coreProgram([{ op: "DRAW", player: "SELF", count: 1 }]);
  a.content.programs.noop = coreProgram([]);
  const base = a.content.definitions.v0!;
  a.content.definitions.eventFixture = { definitionId: "eventFixture", printedId: "eventFixture", name: "Synthetic Event", recognizedNames: ["fixture"], colors: base.colors, support: "VERIFIED_CORE", triggers: [], type: "EVENT", level: 0, programId: "drawOne" };
  a.state.cards[id]!.definitionId = "eventFixture";
  a.content.definitions.c!.triggers = [{ event: "CARD_DRAWN", player: "SELF", programId: "noop" }];
  const engine = a.resume();
  for (const cardId of [null, id]) {
    ok(engine, { kind: "NEXT_HINT" }); effects(engine);
    ok(engine, { kind: "CHOOSE_NEXT_HINT_CARD", choiceId: engine.getState().choice!.id, cardId });
    let steps = 0;
    while (engine.advance()) {
      roundtrip(engine, a.content);
      assert.ok(++steps < 60);
    }
    if (cardId) {
      assert.equal(engine.getState().choice?.kind, "EFFECT_ORDER");
      assert.ok(engine.getState().players[a.turn]!.zones.REMOVE.includes(id));
      assert.equal(engine.getState().players[a.turn]!.zones.PROCESSING.length, 0);
    }
    effects(engine);
  }
  assert.equal(engine.getState().turn.normalPlayUsed, false);
  assert.equal(engine.getState().turn.usedNextHint, true);
});

test("P2-R02 a newly triggered turn-player effect regains priority over remaining opponent effects", () => {
  const a = arena();
  a.content.programs.noop = coreProgram([]);
  a.content.programs.drawOpponent = coreProgram([{ op: "DRAW", player: "OPPONENT", count: 1 }]);
  a.content.definitions.c!.triggers = [{ event: "CARD_DRAWN", player: "SELF", programId: "noop" }];
  a.add(a.other, { triggers: [
    { event: "DEDUCTION_DECLARED", player: "OPPONENT", programId: "drawOpponent" },
    { event: "DEDUCTION_DECLARED", player: "OPPONENT", programId: "noop" },
  ] });
  const engine = a.resume();
  ok(engine, { kind: "DEDUCE", cardId: a.state.players[a.turn]!.partnerId }); engine.runUntilDecision();
  assert.equal(engine.getState().choice?.playerId, a.other);
  const draw = engine.getState().pendingEffects.find(e => e.programId === "drawOpponent")!;
  ok(engine, { kind: "CHOOSE_EFFECT", choiceId: engine.getState().choice!.id, effectId: draw.id });
  engine.runUntilDecision();
  assert.equal(engine.getState().choice?.playerId, a.turn);
  assert.equal(engine.getState().pendingEffects.filter(e => e.controllerId === a.other).length, 1);
  effects(engine);
});

test("P2-R03 FILE Partner trigger applicability still blocks RQ-025 with resumable diagnostics", () => {
  const a = arena();
  a.content.programs.noop = coreProgram([]);
  a.content.definitions[a.state.cards[a.state.players[a.turn]!.partnerId]!.definitionId]!.triggers = [{ event: "CARD_DRAWN", player: "ANY", programId: "noop" }];
  const engine = a.resume();
  ok(engine, { kind: "ASSIST" });
  ok(engine, { kind: "END_MAIN" }); effects(engine);
  assert.equal(engine.getState().status, "RULE_BLOCKED");
  assert.equal(engine.getState().blocked?.questionId, "RULE-QUESTION-025");
  assert.ok(engine.getState().players[a.turn]!.zones.FILE.includes(a.state.players[a.turn]!.partnerId));
  roundtrip(engine, a.content);
});

test("P2-R04 snapshots reject contradictory fixed AP priority and calculated deduction LP", () => {
  const a = arena();
  const attacker = a.add(a.turn, { ap: 500 }), defender = a.add(a.other, { ap: 1000 });
  a.state.cards[defender]!.orientation = "SLEEP";
  const engine = a.resume();
  ok(engine, { kind: "DECLARE_ACTION", cardId: attacker, target: { kind: "CHARACTER", cardId: defender } }); effects(engine);
  const bad = mutable(engine);
  const contact = bad.frames.find(f => f.kind === "CONTACT")!;
  if (contact.kind !== "CONTACT") assert.fail();
  contact.priority!.reverse();
  bad.choice!.playerId = a.other;
  assert.throws(() => GameEngine.restore(JSON.stringify(bad), a.content), /FRAME_PRIORITY/);
  const b = arena(), deduction = b.resume();
  ok(deduction, { kind: "DEDUCE", cardId: b.state.players[b.turn]!.partnerId });
  while (!deduction.getState().frames.some(f => f.kind === "DEDUCTION" && f.calculatedLP !== null)) deduction.advance();
  const corrupt = mutable(deduction);
  const frame = corrupt.frames.find(f => f.kind === "DEDUCTION")!;
  if (frame.kind !== "DEDUCTION") assert.fail();
  frame.calculatedLP = 9000;
  assert.throws(() => GameEngine.restore(JSON.stringify(corrupt), b.content), /FRAME_LP/);
});

test("P2-R05 Auto Partner activation emits its trigger, unchanged ACTIVE characters do not", () => {
  const a = arena();
  a.content.programs.noop = coreProgram([]);
  const partner = a.state.players[a.turn]!.partnerId;
  a.content.definitions[a.state.cards[partner]!.definitionId]!.triggers = [{ event: "ORIENTATION_CHANGED", player: "SELF", subject: "SOURCE", programId: "noop" }];
  const active = a.add(a.turn, { triggers: [{ event: "ORIENTATION_CHANGED", player: "SELF", subject: "SOURCE", programId: "noop" }] });
  a.state.cards[partner]!.orientation = "SLEEP";
  a.state.turn.phase = "AUTO"; a.state.frames = [{ kind: "AUTO", step: 0 }];
  const engine = a.resume();
  engine.runUntilDecision();
  assert.equal(engine.getState().choice?.kind, "EFFECT_ORDER");
  assert.equal(engine.getState().pendingEffects[0]?.sourceId, partner);
  effects(engine);
  assert.equal(engine.getState().events.filter(e => e.type === "ORIENTATION_CHANGED" && e.cardId === active).length, 0);
  assert.equal(engine.getState().cards[partner]!.orientation, "ACTIVE");
});

test("P2-R06 AP comparison captures defender triggers before comparison removal", () => {
  const a = arena();
  a.content.programs.drawOne = coreProgram([{ op: "DRAW", player: "SELF", count: 1 }]);
  const attacker = a.add(a.turn, { ap: 2000 });
  const defender = a.add(a.other, { ap: 1000, triggers: [{ event: "AP_COMPARED", player: "OPPONENT", programId: "drawOne" }] });
  a.state.cards[defender]!.orientation = "SLEEP";
  const engine = a.resume(), hand = a.state.players[a.other]!.zones.HAND.length;
  ok(engine, { kind: "DECLARE_ACTION", cardId: attacker, target: { kind: "CHARACTER", cardId: defender } });
  for (let i = 0; i < 2; i++) {
    effects(engine);
    ok(engine, { kind: "RESPOND_CONTACT", choiceId: engine.getState().choice!.id, response: "PASS" });
  }
  engine.runUntilDecision();
  assert.equal(engine.getState().choice?.kind, "EFFECT_ORDER");
  assert.ok(engine.getState().players[a.other]!.zones.REMOVE.includes(defender));
  effects(engine);
  assert.equal(engine.getState().players[a.other]!.zones.HAND.length, hand + 1);
});

test("P2-R07 Case victory cannot overwrite an unresolved FILE Partner trigger block", () => {
  const a = arena();
  a.content.programs.noop = coreProgram([]);
  const opponent = a.state.players[a.other]!;
  a.content.definitions[a.state.cards[opponent.partnerId]!.definitionId]!.triggers = [{ event: "ORIENTATION_CHANGED", player: "OPPONENT", programId: "noop" }];
  relocate(a.state, a.other, "PARTNER", "FILE", 1);
  a.state.cards[opponent.partnerId]!.face = "UP";
  a.state.cards[opponent.partnerId]!.orientation = "SLEEP";
  opponent.assistReturnOnOwnAuto = true;
  a.state.players[a.turn]!.chapter = "RESOLUTION";
  relocate(a.state, a.turn, "DECK", "EVIDENCE", 10);
  const engine = a.resume();
  ok(engine, { kind: "SOLVE_CASE" });
  assert.equal(engine.getState().status, "RULE_BLOCKED");
  assert.equal(engine.getState().blocked?.questionId, "RULE-QUESTION-025");
  assert.equal(engine.getState().outcome, null);
  roundtrip(engine, a.content);
});

test("P2-R08 finished snapshots preserve pending effects for diagnostics without executing them", () => {
  const a = arena();
  a.content.programs.drawOne = coreProgram([{ op: "DRAW", player: "SELF", count: 1 }]);
  a.content.definitions.c!.triggers = [{ event: "ORIENTATION_CHANGED", player: "SELF", programId: "drawOne" }];
  a.state.players[a.turn]!.chapter = "RESOLUTION";
  relocate(a.state, a.turn, "DECK", "EVIDENCE", 10);
  const engine = a.resume(), hand = a.state.players[a.turn]!.zones.HAND.length;
  ok(engine, { kind: "SOLVE_CASE" });
  assert.equal(engine.getState().status, "FINISHED");
  assert.equal(engine.getState().pendingEffects.length, 1);
  assert.equal(engine.advance(), false);
  assert.equal(engine.getState().players[a.turn]!.zones.HAND.length, hand);
  roundtrip(engine, a.content);
});
