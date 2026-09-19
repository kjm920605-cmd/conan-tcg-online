import assert from "node:assert/strict";
import test from "node:test";
import { GameEngine } from "../src/game/index.ts";
import type { Keyword } from "../src/game/index.ts";
import { fixture, main, mutable, relocate } from "./fixtures.ts";
import { arena, effects, ok, passContact, roundtrip, send } from "./phase2-fixtures.ts";

test("P3A-01 physical cards and field occurrences have separate stable identities", () => {
  const { content } = fixture(); const engine = main(content);
  const before = engine.getState(); const id = before.players[before.turn.playerId]!.zones.HAND[0]!;
  ok(engine, { kind: "PLAY_CARD", cardId: id }); effects(engine);
  const state = engine.getState(); const entryId = state.cards[id]!.entryId;
  assert.ok(entryId); assert.notEqual(entryId, id);
  assert.equal(state.entries[entryId]!.instanceId, id);
  assert.equal(state.entries[entryId]!.status, "PRESENT");
  assert.equal(state.cards[id]!.definitionId, before.cards[id]!.definitionId);
  roundtrip(engine, content);
});

for (const [kind, character, caseTarget, deduction] of [
  ["RAPID", true, true, true], ["ASSAULT", true, true, false],
  ["ASSAULT_CHARACTER", true, false, false], ["ASSAULT_CASE", false, true, false],
] as const) test("P3A-keyword " + kind + " grants only its explicit newcomer permissions", () => {
  for (const target of ["CHARACTER", "CASE", "DEDUCTION"] as const) {
    const a = arena(); const id = a.add(a.turn, { keywords: [{ kind } as Keyword] });
    a.state.cards[id]!.enteredTurn = a.state.turn.number;
    const enemy = a.add(a.other); a.state.cards[enemy]!.orientation = "SLEEP";
    relocate(a.state, a.other, "DECK", "EVIDENCE", 1);
    const engine = a.resume();
    const result = target === "DEDUCTION" ? send(engine, { kind: "DEDUCE", cardId: id }) : send(engine, { kind: "DECLARE_ACTION", cardId: id, target: { kind: target, cardId: target === "CASE" ? a.state.players[a.other]!.caseId : enemy } });
    assert.equal(result.accepted, target === "CHARACTER" ? character : target === "CASE" ? caseTarget : deduction);
  }
});

test("P3A-06 BULLET prevents Guard even when the opponent has active newcomers", () => {
  const a = arena(); const attacker = a.add(a.turn, { keywords: [{ kind: "BULLET" }] });
  const defender = a.add(a.other); a.state.cards[defender]!.orientation = "SLEEP"; a.add(a.other);
  const engine = a.resume(); ok(engine, { kind: "DECLARE_ACTION", cardId: attacker, target: { kind: "CHARACTER", cardId: defender } }); effects(engine);
  assert.equal(engine.getState().choice?.kind, "CONTACT_RESPONSE"); passContact(engine);
});

test("P3A-07 MISLEAD_X keeps the existing simultaneous Sleep and reduction flow", () => {
  const a = arena(); const mislead = a.add(a.other, { keywords: [{ kind: "MISLEAD_X", value: 2 }] });
  const engine = a.resume(); ok(engine, { kind: "DEDUCE", cardId: a.state.players[a.turn]!.partnerId }); effects(engine);
  ok(engine, { kind: "CHOOSE_MISLEAD", choiceId: engine.getState().choice!.id, cardIds: [mislead] }); effects(engine);
  assert.equal(engine.getState().cards[mislead]!.orientation, "SLEEP");
  assert.equal(engine.getState().players[a.turn]!.zones.EVIDENCE.length, 0);
});
