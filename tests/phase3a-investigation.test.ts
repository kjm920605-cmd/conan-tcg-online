import assert from "node:assert/strict";
import test from "node:test";
import { GameEngine } from "../src/game/index.ts";
import { arena, effects, ok, roundtrip, send } from "./phase2-fixtures.ts";
import { explicit } from "./phase3a-fixtures.ts";
import { relocate } from "./fixtures.ts";

for (const available of [5, 2]) test("P3A-Investigate reveals available top cards and opponent chooses bottom order: " + available, () => {
  const a = arena();
  a.content.programs.investigate = explicit([{ op: "INVOKE_KEYWORD", keyword: "INVESTIGATE_X" }, { op: "GAIN_EVIDENCE", player: "SELF", count: 1 }]);
  const source = a.add(a.turn, { keywords: [{ kind: "INVESTIGATE_X", value: 3 }], triggers: [{ event: "TURN_END", player: "SELF", programId: "investigate" }] });
  relocate(a.state, a.other, "DECK", "REMOVE", a.state.players[a.other]!.zones.DECK.length - available);
  const initial = [...a.state.players[a.other]!.zones.DECK], revealed = initial.slice(0, 3), ordered = [...revealed].reverse();
  const engine = a.resume(), rng = engine.getState().rng.cursor;
  ok(engine, { kind: "END_MAIN" }); effects(engine);
  const choice = engine.getState().choice!;
  assert.equal(choice.kind, "INVESTIGATION_ORDER"); assert.equal(choice.playerId, a.other);
  if (choice.kind !== "INVESTIGATION_ORDER") assert.fail();
  assert.deepEqual(choice.candidates, revealed); assert.deepEqual(engine.getState().players[a.other]!.zones.DECK, initial);
  const copy = roundtrip(engine, a.content), before = engine.serialize();
  assert.equal(send(engine, { kind: "CHOOSE_INVESTIGATION_ORDER", choiceId: choice.id, cardIds: [revealed[0]!, revealed[0]!] }).accepted, false);
  assert.equal(engine.serialize(), before);
  const intent = { kind: "CHOOSE_INVESTIGATION_ORDER", choiceId: choice.id, cardIds: ordered } as const;
  ok(engine, intent); ok(copy, intent);
  assert.deepEqual(engine.getState().players[a.other]!.zones.DECK, [...initial.slice(revealed.length), ...ordered]);
  const parent = engine.getState().frames.find(f => f.kind === "EFFECT");
  assert.ok(parent?.kind === "EFFECT"); assert.deepEqual(parent.foundCards, revealed);
  assert.equal(engine.getState().rng.cursor, rng); roundtrip(engine, a.content);
  while (engine.getState().frames.some(f => f.kind === "EFFECT")) { assert.equal(engine.advance(), copy.advance()); }
  assert.equal(engine.serialize(), copy.serialize());
  assert.equal(engine.getState().players[a.turn]!.zones.EVIDENCE.length, 1);
  assert.ok(!engine.getState().events.some(e => e.type === "REFRESHED"));
  assert.ok(engine.getState().events.some(e => e.type === "INVESTIGATION_REVEALED" && e.cardId === source));
});
test("P3A-TRACE is a persistent player fact and program condition is checked at resolution", () => {
  for (const discovered of [false, true]) {
    const a = arena(); a.content.programs.trace = explicit([{ op: "GAIN_EVIDENCE", player: "SELF", count: 1 }], { sourceRequirements: "INDEPENDENT", targetSelectionPoint: "NONE", targetZone: "NONE", condition: "TRACE_DISCOVERED" });
    a.add(a.turn, { keywords: [{ kind: "TRACE" }], triggers: [{ event: "TURN_END", player: "SELF", programId: "trace" }] });
    const engine = a.resume(); ok(engine, { kind: "END_MAIN" }); effects(engine);
    // effects() resolves the pending program; undiscovered state gives no evidence.
    assert.equal(engine.getState().players[a.turn]!.zones.EVIDENCE.length, 0);
    const state = JSON.parse(engine.serialize()); state.players[a.turn].traceDiscovered = discovered;
    const continued = GameEngine.restore(JSON.stringify(state), a.content);
    ok(continued, { kind: "END_MAIN" }); effects(continued);
    ok(continued, { kind: "END_MAIN" }); effects(continued);
    assert.equal(continued.getState().players[a.turn]!.zones.EVIDENCE.length, discovered ? 1 : 0);
    assert.equal(continued.getState().players[a.turn]!.traceDiscovered, discovered);
  }
});
