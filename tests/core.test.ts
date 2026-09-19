import { coreProgram } from "../examples/programs.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine, transitionOrientation } from "../src/game/index.ts";
import type { Content, GameState, Rng } from "../src/game/index.ts";
import { conservation, fixture, main, mutable, nearRefresh, relocate, send, setup } from "./fixtures.ts";

function restore(state: GameState, content = fixture().content) { return GameEngine.restore(JSON.stringify(state), content); }
function finishTurn(engine: GameEngine) { assert.equal(send(engine, { kind: "END_MAIN" }).accepted, true); engine.runUntilDecision(); }
function eventFixture(op: "DRAW" | "GAIN_EVIDENCE" | "ADD_FILE" | "REMOVE_TOP", count: number) {
  const { content } = fixture();
  content.programs.draw = coreProgram([{ op, player: "SELF", count }]);
  const state = mutable(main(content));
  const id = state.turn.playerId;
  const card = state.players[id]!.zones.HAND[0]!;
  state.cards[card]!.definitionId = "e";
  return { state, id, card, content };
}
function playEvent(engine: GameEngine, cardId: string) {
  assert.equal(send(engine, { kind: "PLAY_CARD", cardId }).accepted, true);
}
function resolveChoices(engine: GameEngine) {
  for (let i = 0; i < 100; i++) {
    engine.runUntilDecision();
    const choice = engine.getState().choice;
    if (!choice || choice.kind !== "EFFECT_ORDER") return;
    assert.equal(send(engine, { kind: "CHOOSE_EFFECT", choiceId: choice.id, effectId: choice.candidates[0]! }).accepted, true);
  }
  assert.fail("fixture unexpectedly loops");
}

test("P0-01 / UT-001–004 deck construction", () => {
  const { options, content } = fixture();
  assert.doesNotThrow(() => GameEngine.create(options, content));
  for (const count of [39, 41]) {
    const invalid = structuredClone(options);
    invalid.players[0].deck = Array.from({ length: count }, (_, i) => "v" + Math.floor(i / 3));
    assert.throws(() => GameEngine.create(invalid, content), /DECK_SIZE/);
  }
  const invalid = structuredClone(options);
  invalid.players[0].deck[3] = "v0";
  assert.throws(() => GameEngine.create(invalid, content), /PRINTED_ID_LIMIT/);
  invalid.players[0].deck[3] = "p";
  assert.throws(() => GameEngine.create(invalid, content), /DECK_TYPE/);
  content.definitions.v0!.colors = ["GREEN"];
  assert.doesNotThrow(() => GameEngine.create(options, content));
});

test("P0-02 / UT-006 setup first player and reveal order", () => {
  const { options, content } = fixture();
  const rng: Rng = { algorithm: "last-index-v1", next: (state, max) => ({ value: max - 1, state: state + 1 }) };
  const engine = GameEngine.create(options, content, rng);
  assert.equal(engine.getState().firstPlayerId, "b");
  assert.equal(engine.getState().choice?.playerId, "b");
  assert.deepEqual(engine.getState().playerOrder.map(p => engine.getState().players[p]!.zones.HAND.length), [5, 5]);
  assert.equal(engine.getState().cards[engine.getState().players.a!.partnerId]!.face, "DOWN");
  send(engine, { kind: "MULLIGAN", choiceId: engine.getState().choice!.id, cardIds: [] });
  assert.equal(engine.getState().choice?.playerId, "a");
  send(engine, { kind: "MULLIGAN", choiceId: engine.getState().choice!.id, cardIds: [] });
  assert.equal(engine.getState().cards[engine.getState().players.a!.partnerId]!.face, "UP");
  assert.equal(engine.getState().turn.phase, "AUTO");
  assert.deepEqual(engine.getState().events.slice(0, 4).map(e => e.type), ["CARDS_PLACED", "DECK_SHUFFLED", "DECK_SHUFFLED", "FIRST_PLAYER_DECIDED"]);
});

test("P0-03 / UT-007 mulligan 0/2/5 returns shuffles then draws", () => {
  for (const count of [0, 2, 5]) {
    const { options, content } = fixture();
    const engine = GameEngine.create(options, content);
    const choice = engine.getState().choice!;
    const hand = engine.getState().players[choice.playerId]!.zones.HAND;
    assert.equal(send(engine, { kind: "MULLIGAN", choiceId: choice.id, cardIds: hand.slice(0, count) }).accepted, true);
    assert.equal(engine.getState().players[choice.playerId]!.zones.HAND.length, 5);
    assert.equal(send(engine, { kind: "MULLIGAN", choiceId: choice.id, cardIds: [] }, choice.playerId).accepted, false);
    assert.ok(conservation(engine.getState()));
    if (count > 0) {
      const types = engine.getState().events.map(e => e.type);
      assert.ok(types.lastIndexOf("MULLIGAN_RETURNED") < types.lastIndexOf("DECK_SHUFFLED"));
      assert.ok(types.lastIndexOf("DECK_SHUFFLED") < types.lastIndexOf("CARD_DRAWN"));
    }
  }
});

test("P0-04 / UT-008 partner returns ACTIVE only at owner's next Auto first step", () => {
  const engine = main();
  const owner = engine.getState().turn.playerId;
  const partnerId = engine.getState().players[owner]!.partnerId;
  assert.equal(send(engine, { kind: "ASSIST" }).accepted, true);
  finishTurn(engine);
  assert.ok(engine.getState().players[owner]!.zones.FILE.includes(partnerId));
  assert.equal(send(engine, { kind: "END_MAIN" }).accepted, true);
  while (engine.getState().turn.phase !== "AUTO") engine.advance();
  assert.equal(engine.getState().turn.playerId, owner);
  const handCount = engine.getState().players[owner]!.zones.HAND.length;
  engine.advance();
  assert.ok(engine.getState().players[owner]!.zones.PARTNER.includes(partnerId));
  assert.equal(engine.getState().cards[partnerId]!.orientation, "ACTIVE");
  assert.equal(engine.getState().players[owner]!.zones.HAND.length, handCount);
  assert.ok(conservation(engine.getState()));
});

test("P0-05 / UT-009 every turn draws one; FILE first turn 1 otherwise 2", () => {
  const engine = main();
  const first = engine.getState().firstPlayerId;
  const other = engine.getState().playerOrder.find(p => p !== first)!;
  assert.equal(engine.getState().players[first]!.zones.HAND.length, 6);
  assert.equal(engine.getState().players[first]!.zones.FILE.length, 1);
  finishTurn(engine);
  assert.equal(engine.getState().players[other]!.zones.HAND.length, 6);
  assert.equal(engine.getState().players[other]!.zones.FILE.length, 2);
  finishTurn(engine);
  assert.equal(engine.getState().players[first]!.zones.HAND.length, 7);
  assert.equal(engine.getState().players[first]!.zones.FILE.length, 3);
});

test("P0-06 / UT-010 sequential FILE and evidence top order", () => {
  for (const op of ["ADD_FILE", "GAIN_EVIDENCE"] as const) {
    const f = eventFixture(op, 2);
    const expected = f.state.players[f.id]!.zones.DECK.slice(0, 2).reverse();
    const engine = restore(f.state, f.content);
    playEvent(engine, f.card); resolveChoices(engine);
    assert.deepEqual(engine.getState().players[f.id]!.zones[op === "ADD_FILE" ? "FILE" : "EVIDENCE"].slice(0, 2), expected);
    assert.ok(expected.every(id => engine.getState().cards[id]!.face === "DOWN"));
    assert.ok(conservation(engine.getState()));
  }
});

test("P0-07 / UT-011 nine orientations and Sleep cost", () => {
  const expected = [["ACTIVE", "SLEEP", "STUN"], ["ACTIVE", "SLEEP", "STUN"], ["SLEEP", "STUN", "STUN"]];
  const states = ["ACTIVE", "SLEEP", "STUN"] as const;
  states.forEach((from, i) => states.forEach((to, j) => assert.equal(transitionOrientation(from, to), expected[i]![j])));
  const state = mutable(main());
  const id = state.players[state.turn.playerId]!.partnerId;
  state.cards[id]!.orientation = "STUN";
  const engine = restore(state);
  const before = engine.serialize();
  assert.equal(send(engine, { kind: "ASSIST" }).accepted, false);
  assert.equal(engine.serialize(), before);
});

test("P0-08 / UT-013,019 normal card play limits level/all colors without FILE cost", () => {
  const { content } = fixture();
  const state = mutable(main(content));
  const player = state.players[state.turn.playerId]!;
  const id = player.zones.HAND[0]!;
  const def = content.definitions[state.cards[id]!.definitionId]!;
  def.colors = ["BLUE", "GREEN"];
  let engine = restoreWithContent(state, content);
  assert.equal(send(engine, { kind: "PLAY_CARD", cardId: id }).accepted, false);
  def.colors = ["BLUE"];
  if (def.type !== "CHARACTER") assert.fail();
  def.level = 2;
  engine = restoreWithContent(state, content);
  assert.equal(send(engine, { kind: "PLAY_CARD", cardId: id }).accepted, false);
  def.level = 1;
  engine = restoreWithContent(state, content);
  assert.equal(send(engine, { kind: "PLAY_CARD", cardId: id }).accepted, true);
  assert.equal(engine.getState().players[player.id]!.zones.FILE.length, 1);
  assert.equal(engine.getState().cards[id]!.orientation, "ACTIVE");
  assert.equal(send(engine, { kind: "PLAY_CARD", cardId: player.zones.HAND[1]! }).accepted, false);
});

// Recreate a matching manifest through legitimate initialization, then copy its fingerprint.
function restoreWithContent(state: GameState, content: Content) {
  state.contentFingerprint = main(content).getState().contentFingerprint;
  return restore(state, content);
}

test("P0-09 / UT-022 Assist threshold is checked including partner and chapter persists", () => {
  for (const before of [5, 6]) {
    const state = mutable(main());
    const id = state.turn.playerId;
    relocate(state, id, "DECK", "FILE", before - state.players[id]!.zones.FILE.length);
    const engine = restore(state);
    assert.equal(send(engine, { kind: "ASSIST" }).accepted, true);
    assert.equal(engine.getState().players[id]!.chapter, before === 6 ? "RESOLUTION" : "CASE");
    finishTurn(engine); finishTurn(engine);
    assert.equal(engine.getState().players[id]!.chapter, before === 6 ? "RESOLUTION" : "CASE");
  }
});

test("P0-10 / UT-023 FILE/evidence quantity alone never flips chapter or wins", () => {
  const f = eventFixture("ADD_FILE", 7);
  const engine = restore(f.state, f.content);
  playEvent(engine, f.card); resolveChoices(engine);
  assert.equal(engine.getState().players[f.id]!.chapter, "CASE");
  const state = mutable(engine);
  state.players[f.id]!.chapter = "RESOLUTION";
  relocate(state, f.id, "DECK", "EVIDENCE", 5);
  const resumed = restore(state, f.content);
  assert.equal(resumed.getState().outcome, null);
});

test("P0-11 / UT-024–025 solve uses seat-specific level and spends Sleep below threshold", () => {
  for (const isFirst of [true, false]) for (const enough of [true, false]) {
    const engine = main();
    if (!isFirst) finishTurn(engine);
    const state = mutable(engine);
    const p = state.players[state.turn.playerId]!;
    assert.equal(send(engine, { kind: "SOLVE_CASE" }).accepted, false);
    p.chapter = "RESOLUTION";
    relocate(state, p.id, "DECK", "EVIDENCE", (isFirst ? 3 : 2) - (enough ? 0 : 1));
    const resumed = restore(state);
    assert.equal(send(resumed, { kind: "SOLVE_CASE" }).accepted, true);
    assert.equal(resumed.getState().cards[p.partnerId]!.orientation, "SLEEP");
    assert.equal(resumed.getState().status, enough ? "FINISHED" : "PLAYING");
    if (enough) assert.equal(resumed.getState().outcome?.winnerId, p.id);
  }
});

test("P0-12 / UT-029–030 fixed LP deduction and new-character restriction", () => {
  for (const lp of [-1, 0, 2]) {
    const { content } = fixture();
    const partner = content.definitions.p!;
    if (partner.type !== "PARTNER") assert.fail();
    partner.lp = lp;
    const engine = main(content);
    const p = engine.getState().players[engine.getState().turn.playerId]!;
    const expected = p.zones.DECK.slice(0, Math.max(lp, 0)).reverse();
    assert.equal(send(engine, { kind: "DEDUCE", cardId: p.partnerId }).accepted, true);
    resolveChoices(engine);
    assert.deepEqual(engine.getState().players[p.id]!.zones.EVIDENCE, expected);
    assert.equal(engine.getState().cards[p.partnerId]!.orientation, "SLEEP");
  }
  const engine = main();
  const card = engine.getState().players[engine.getState().turn.playerId]!.zones.HAND[0]!;
  send(engine, { kind: "PLAY_CARD", cardId: card });
  assert.equal(send(engine, { kind: "DEDUCE", cardId: card }).accepted, false);
});

test("P0-13 / UT-049 exact last draw triggers immediate refresh", () => {
  const f = eventFixture("DRAW", 1);
  relocate(f.state, f.id, "DECK", "REMOVE", f.state.players[f.id]!.zones.DECK.length - 1);
  const engine = restore(f.state, f.content);
  playEvent(engine, f.card); resolveChoices(engine);
  assert.ok(engine.getState().players[f.id]!.zones.DECK.length > 0);
  assert.equal(engine.getState().events.filter(e => e.type === "REFRESHED").length, 1);
});

test("P0-14 / UT-050 empty Remove loses and stops the original operation", () => {
  const f = eventFixture("DRAW", 5);
  relocate(f.state, f.id, "DECK", "FILE", f.state.players[f.id]!.zones.DECK.length - 1);
  const initial = f.state.players[f.id]!.zones.HAND.length;
  const engine = restore(f.state, f.content);
  playEvent(engine, f.card); resolveChoices(engine);
  assert.equal(engine.getState().outcome?.loserId, f.id);
  assert.equal(engine.getState().players[f.id]!.zones.HAND.length, initial);
  assert.equal(engine.getState().players[f.id]!.zones.PROCESSING[0], f.card);
});

test("P0-15 / UT-051,058 refresh rebuild, opponent evidence and trace", () => {
  const { state, id, other, content } = nearRefresh();
  const engine = restore(state, content);
  send(engine, { kind: "DEDUCE", cardId: state.players[id]!.partnerId });
  resolveChoices(engine);
  assert.equal(engine.getState().players[other]!.zones.EVIDENCE.length, 1);
  assert.equal(engine.getState().players[other]!.traceDiscovered, true);
  assert.equal(engine.getState().players[id]!.traceDiscovered, false);
  assert.equal(engine.getState().players[id]!.zones.REMOVE.length, 0);
});

test("P0-16 / UT-052 draw/file/evidence resume remaining quantity", () => {
  for (const op of ["DRAW", "ADD_FILE", "GAIN_EVIDENCE"] as const) {
    const f = eventFixture(op, 3);
    const zone = op === "DRAW" ? "HAND" : op === "ADD_FILE" ? "FILE" : "EVIDENCE";
    relocate(f.state, f.id, "DECK", "REMOVE", f.state.players[f.id]!.zones.DECK.length - 1);
    const initial = f.state.players[f.id]!.zones[zone].length;
    const engine = restore(f.state, f.content);
    playEvent(engine, f.card); resolveChoices(engine);
    assert.equal(engine.getState().players[f.id]!.zones[zone].length, initial + 3 - (zone === "HAND" ? 1 : 0));
    assert.ok(conservation(engine.getState()));
  }
});

test("P0-17 / UT-053 resolving Event is excluded from refresh", () => {
  const f = eventFixture("DRAW", 2);
  relocate(f.state, f.id, "DECK", "REMOVE", f.state.players[f.id]!.zones.DECK.length - 1);
  const engine = restore(f.state, f.content);
  playEvent(engine, f.card);
  resolveChoices(engine);
  assert.deepEqual(engine.getState().players[f.id]!.zones.REMOVE, [f.card]);
  assert.ok(!engine.getState().players[f.id]!.zones.DECK.includes(f.card));
  assert.equal(engine.getState().players[f.id]!.zones.PROCESSING.length, 0);
});

test("P0-18 / UT-055 remove top effect does not continue into refreshed deck", () => {
  const f = eventFixture("REMOVE_TOP", 5);
  relocate(f.state, f.id, "DECK", "FILE", f.state.players[f.id]!.zones.DECK.length - 2);
  const engine = restore(f.state, f.content);
  playEvent(engine, f.card); resolveChoices(engine);
  assert.equal(engine.getState().players[f.id]!.zones.DECK.length, 2);
  assert.deepEqual(engine.getState().players[f.id]!.zones.REMOVE, [f.card]);
  assert.equal(engine.getState().events.filter(e => e.type === "REFRESHED").length, 1);
});

test("P0-19 / UT-057 nested refresh returns to original procedure", () => {
  const { state, id, other, content } = nearRefresh();
  relocate(state, other, "DECK", "REMOVE", state.players[other]!.zones.DECK.length - 1);
  const engine = restore(state, content);
  send(engine, { kind: "DEDUCE", cardId: state.players[id]!.partnerId });
  resolveChoices(engine);
  assert.equal(engine.getState().events.filter(e => e.type === "REFRESHED").length, 2);
  assert.equal(engine.getState().players[id]!.zones.EVIDENCE.length, 3);
  assert.equal(engine.getState().players[other]!.zones.EVIDENCE.length, 1);
  assert.equal(engine.getState().frames.length, 0);
  assert.ok(conservation(engine.getState()));
});

function effectsFixture() {
  const { content } = fixture();
  content.programs.one = coreProgram([{ op: "DRAW", player: "SELF", count: 1 }]);
  content.programs.two = coreProgram([{ op: "ADD_FILE", player: "SELF", count: 1 }]);
  content.definitions.c!.triggers = [
    { event: "TURN_END", player: "ANY", programId: "one" },
    { event: "TURN_END", player: "ANY", programId: "two" },
  ];
  return { content, engine: main(content) };
}
test("P0-20 / UT-059 turn-player priority and arbitrary own selection, never LIFO", () => {
  const { content, engine } = effectsFixture();
  const turn = engine.getState().turn.playerId;
  send(engine, { kind: "END_MAIN" }); engine.runUntilDecision();
  const choice = engine.getState().choice!;
  assert.equal(choice.kind, "EFFECT_ORDER");
  assert.equal(choice.playerId, turn);
  const own = engine.getState().pendingEffects.filter(e => e.controllerId === turn);
  assert.equal(own.length, 2);
  const otherEffect = engine.getState().pendingEffects.find(e => e.controllerId !== turn)!;
  assert.equal(send(engine, { kind: "CHOOSE_EFFECT", choiceId: choice.id, effectId: otherEffect.id }).accepted, false);
  // Choose the first inserted one; LIFO would force the second.
  assert.equal(send(engine, { kind: "CHOOSE_EFFECT", choiceId: choice.id, effectId: own[0]!.id }).accepted, true);
  engine.runUntilDecision();
  assert.equal(engine.getState().choice?.playerId, turn);
  const resumed = restore(mutable(engine), content);
  assert.deepEqual(resumed.getState(), engine.getState());
  resolveChoices(engine);
  const resolved = engine.getState().events.filter(e => e.type === "EFFECT_RESOLVED");
  assert.equal(resolved[0]!.detail, own[0]!.id);
});

test("P0-21 / UT-060 triggered effects wait until current effect is complete", () => {
  const { content } = fixture();
  content.programs.one = coreProgram([{ op: "DRAW", player: "SELF", count: 2 }]);
  content.programs.two = coreProgram([{ op: "ADD_FILE", player: "SELF", count: 1 }]);
  content.definitions.c!.triggers = [
    { event: "TURN_END", player: "SELF", programId: "one" },
    { event: "CARD_DRAWN", player: "SELF", programId: "two" },
  ];
    // Isolate End timing from Auto using a trusted snapshot; Auto checkpoints have separate coverage.
  const state = mutable(setup(content));
  state.turn.phase = "MAIN"; state.frames = [];
  const engine = restore(state, content);
  send(engine, { kind: "END_MAIN" }); engine.runUntilDecision();
  const choice = engine.getState().choice!;
  if (choice.kind !== "EFFECT_ORDER") assert.fail();
  send(engine, { kind: "CHOOSE_EFFECT", choiceId: choice.id, effectId: choice.candidates[0]! });
  engine.runUntilDecision();
  assert.equal(engine.getState().pendingEffects.length, 2);
  const types = engine.getState().events.slice(-6).map(e => e.type);
  assert.ok(types.lastIndexOf("CARD_DRAWN") < types.indexOf("EFFECT_RESOLVED"));
  assert.equal(engine.getState().status, "PLAYING");
});

test("P0-22 / UT-076 End effects finish before expiry and handoff", () => {
  const { engine } = effectsFixture();
  send(engine, { kind: "END_MAIN" }); resolveChoices(engine);
  const types = engine.getState().events.map(e => e.type);
  assert.ok(types.lastIndexOf("EFFECT_RESOLVED") < types.lastIndexOf("END_EFFECTS_EXPIRED"));
  assert.ok(types.lastIndexOf("END_EFFECTS_EXPIRED") < types.lastIndexOf("TURN_STARTED"));
  assert.equal(engine.getState().turn.phase, "MAIN");
});

test("P0-23 / UT-078,084 roundtrip every nested procedure step and choice; version checks", () => {
  const { state, id, other, content } = nearRefresh();
  relocate(state, other, "DECK", "REMOVE", state.players[other]!.zones.DECK.length - 1);
  const engine = restore(state, content);
  send(engine, { kind: "DEDUCE", cardId: state.players[id]!.partnerId });
  let steps = 0;
  while (engine.getState().frames.length) {
    const copy = GameEngine.restore(engine.serialize(), content);
    assert.equal(copy.advance(), engine.advance());
    assert.equal(copy.serialize(), engine.serialize());
    assert.ok(++steps < 100);
  }
  const { options } = fixture();
  const opening = GameEngine.create(options, content);
  assert.equal(GameEngine.restore(opening.serialize(), content).serialize(), opening.serialize());
  const bad = mutable(opening) as unknown as Record<string, unknown>;
  bad.schemaVersion = 999;
  assert.throws(() => GameEngine.restore(JSON.stringify(bad), content), /VERSION/);
  const changed = structuredClone(content); changed.version = "different";
  assert.throws(() => GameEngine.restore(engine.serialize(), changed), /CONTENT/);
});

test("P0-24 / UT-080,082 command rejection is atomic and duplicate is idempotent", () => {
  const engine = main();
  const s = engine.getState();
  const command = { matchId: s.matchId, commandId: "stable-id", actorId: s.turn.playerId, expectedRevision: s.revision, intent: { kind: "ASSIST" as const } };
  for (const invalid of [{ ...command, actorId: "intruder" }, { ...command, expectedRevision: -1 }]) {
    const before = engine.serialize();
    assert.equal(engine.dispatch(invalid).accepted, false);
    assert.equal(engine.serialize(), before);
  }
  assert.equal(engine.dispatch(command).accepted, true);
  const after = engine.serialize();
  assert.deepEqual(engine.dispatch(command), { accepted: true, revision: engine.getState().revision, duplicate: true });
  assert.equal(engine.serialize(), after);
  assert.equal(engine.dispatch({ ...command, intent: { kind: "END_MAIN" } }).accepted, false);
});

test("P0-25 / UT-081 injected RNG and command replay are deterministic", () => {
  const { options, content } = fixture();
  let calls = 0;
  const rng: Rng = { algorithm: "test-v1", next: (state, max) => { calls++; return { value: state % max, state: state + 1 }; } };
  const a = GameEngine.create(options, content, rng);
  const b = GameEngine.create(options, content, rng);
  for (let i = 0; i < 2; i++) {
    const choice = a.getState().choice!;
    const command = { matchId: options.matchId, commandId: "replay-" + i, actorId: choice.playerId, expectedRevision: a.getState().revision, intent: { kind: "MULLIGAN" as const, choiceId: choice.id, cardIds: a.getState().players[choice.playerId]!.zones.HAND.slice(0, 2) } };
    assert.equal(a.dispatch(command).accepted, true);
    assert.equal(b.dispatch(command).accepted, true);
  }
  a.runUntilDecision(); b.runUntilDecision();
  assert.equal(a.serialize(), b.serialize());
  assert.ok(calls > 150);
  assert.equal(GameEngine.restore(a.serialize(), content, rng).serialize(), a.serialize());
  assert.throws(() => GameEngine.restore(a.serialize(), content), /RNG/);
});

test("P0-26 / UT-079,085–086 immutable snapshots, independent cards and conservation", () => {
  const { options, content } = fixture();
  const engine = GameEngine.create(options, content);
  assert.throws(() => { (engine.getState() as GameState).revision = 100; }, TypeError);
  assert.throws(() => { (engine.getState() as GameState).players.a!.zones.DECK.pop(); }, TypeError);
  content.definitions.p!.name = "mutated outside";
  assert.ok(conservation(engine.getState()));
  const s = mutable(engine);
  s.players.a!.zones.HAND.push(s.players.a!.zones.DECK[0]!);
  assert.throws(() => restore(s), /LOCATION/);
  const same = Object.values(engine.getState().cards).filter(c => c.definitionId === "v0");
  assert.equal(new Set(same.map(c => c.instanceId)).size, 6);
  const invalid = fixture();
  if (invalid.content.definitions.p!.type !== "PARTNER") assert.fail();
  invalid.content.definitions.p!.lp = Number.NaN;
  assert.throws(() => GameEngine.create(invalid.options, invalid.content), /JSON|NUMBER/);
});

test("P0-27 / UT-087 unknown opcodes, unverified data and missing programs rejected", () => {
  for (const change of [
    (c: Content) => { c.programs.draw = [{ op: "UNKNOWN" }] as never; },
    (c: Content) => { c.definitions.p!.support = "UNVERIFIED"; },
    (c: Content) => { delete c.programs.draw; },
  ]) {
    const { options, content } = fixture();
    change(content);
    assert.throws(() => GameEngine.create(options, content), /UNSUPPORTED|PROGRAM/);
  }
});

test("P0-28 / UT-088–089 confirmed Auto trigger pauses at checkpoint; step limit is not outcome", () => {
  const { content } = fixture();
  content.programs.one = coreProgram([{ op: "ADD_FILE", player: "SELF", count: 1 }]);
  content.definitions.c!.triggers = [{ event: "CARD_DRAWN", player: "SELF", programId: "one" }];
  const engine = setup(content);
  engine.runUntilDecision();
  assert.equal(engine.getState().status, "PLAYING");
  assert.equal(engine.getState().choice?.kind, "EFFECT_ORDER");
  assert.equal(engine.getState().pendingEffects.length, 1);
  assert.equal(GameEngine.restore(engine.serialize(), content).serialize(), engine.serialize());
  const safe = setup();
  assert.equal(safe.runUntilDecision(1), "STEP_LIMIT");
  assert.equal(safe.getState().outcome, null);
  safe.runUntilDecision();
  assert.equal(safe.getState().turn.phase, "MAIN");
});
