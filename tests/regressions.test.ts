import { coreProgram } from "../examples/programs.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../src/game/index.ts";
import type { Command } from "../src/game/index.ts";
import { fixture, main, mutable, relocate, send, setup } from "./fixtures.ts";

test("R-01 / UT-087 registry references must be own properties; valid prototype-like IDs work", () => {
  for (const programId of ["toString", "hasOwnProperty", "valueOf"]) {
    const { options, content } = fixture();
    content.definitions.v0!.triggers = [{ event: "TURN_END", player: "SELF", programId }];
    assert.throws(() => GameEngine.create(options, content), /PROGRAM/);
  }
  const { options, content } = fixture();
  options.players[0].deck[0] = "toString";
  assert.throws(() => GameEngine.create(options, content), /DECK_TYPE/);
  const engine = main();
  const state = engine.getState();
  const command: Command = { matchId: state.matchId, commandId: "toString", actorId: state.turn.playerId, expectedRevision: state.revision, intent: { kind: "ASSIST" } };
  assert.equal(engine.dispatch(command).accepted, true);
  assert.equal(engine.dispatch(command).accepted, true);
  Object.defineProperty(content.programs, "toString", { value: coreProgram([]), enumerable: true, configurable: true });
  content.definitions.v0!.triggers = [{ event: "TURN_END", player: "SELF", programId: "toString" }];
  options.players[0].deck[0] = "v0";
  assert.doesNotThrow(() => GameEngine.create(options, content));
});

test("R-02 / UT-084 malformed phase, procedure, processing and pending snapshots are rejected", () => {
  const { content } = fixture();
  const auto = mutable(setup());
  auto.frames = [];
  assert.throws(() => GameEngine.restore(JSON.stringify(auto), content), /FRAME|PROCEDURE/);
  const orphan = mutable(main());
  const p = orphan.players[orphan.turn.playerId]!;
  const cardId = p.zones.HAND[0]!;
  orphan.cards[cardId]!.definitionId = "e";
  relocate(orphan, p.id, "HAND", "PROCESSING", 1);
  assert.throws(() => GameEngine.restore(JSON.stringify(orphan), content), /PROCESSING|PROCEDURE/);
  const invalidFrame = mutable(main());
  invalidFrame.frames = [{ kind: "MOVE", playerId: invalidFrame.turn.playerId, to: "HAND", remaining: 1 }];
  assert.throws(() => GameEngine.restore(JSON.stringify(invalidFrame), content), /FRAME|PROCEDURE/);
  const pending = mutable(main());
  const source = pending.players[pending.turn.playerId]!.zones.HAND[0]!;
  pending.cards[source]!.definitionId = "e";
  pending.pendingEffects = [{ id: "effect-999", controllerId: pending.turn.playerId, sourceId: source, programId: "draw" }];
  assert.throws(() => GameEngine.restore(JSON.stringify(pending), content), /PENDING|PROCEDURE/);
  const setupOrphan = mutable(GameEngine.create(fixture().options, content));
  const openingPlayer = setupOrphan.players[setupOrphan.choice!.playerId]!;
  setupOrphan.cards[openingPlayer.zones.HAND[0]!]!.definitionId = "e";
  relocate(setupOrphan, openingPlayer.id, "HAND", "PROCESSING", 1);
  assert.throws(() => GameEngine.restore(JSON.stringify(setupOrphan), content), /SETUP|PROCESSING|PROCEDURE/);
  for (const invalidId of ["toString", "hasOwnProperty", "missing"]) {
    const badReference = mutable(main());
    badReference.frames = [{ kind: "CHECKPOINT" }, { kind: "MOVE", playerId: invalidId, to: "EVIDENCE", remaining: 1 }];
    assert.throws(() => GameEngine.restore(JSON.stringify(badReference), content), /FRAME/);
    const badEvent = mutable(main());
    badEvent.events[0]!.playerId = invalidId;
    assert.throws(() => GameEngine.restore(JSON.stringify(badEvent), content), /EVENT/);
    badEvent.events[0]!.playerId = null;
    badEvent.events[0]!.cardId = invalidId;
    assert.throws(() => GameEngine.restore(JSON.stringify(badEvent), content), /EVENT/);
  }
});

test("R-03 / UT-079 JSON arrays and properties must roundtrip without omissions or getter execution", () => {
  const { content, options } = fixture();
  const sparse = Array<string>(1);
  Object.defineProperty(sparse, "extra", { value: "GREEN", enumerable: true });
  content.definitions.v0!.colors = sparse;
  assert.throws(() => GameEngine.create(options, content), /JSON/);
  const accessor = fixture();
  let reads = 0;
  Object.defineProperty(accessor.content, "version", { enumerable: true, get() { reads++; return "v1"; } });
  assert.throws(() => GameEngine.create(accessor.options, accessor.content), /JSON_ACCESSOR/);
  assert.equal(reads, 0);
  const hidden = fixture();
  Object.defineProperty(hidden.content.definitions.v0, "hidden", { value: 1, enumerable: false });
  assert.throws(() => GameEngine.create(hidden.options, hidden.content), /JSON/);
});

test("R-04 / UT-011 state changes through effect resolver and Auto preserve separate instances", () => {
  const { content } = fixture();
  content.programs.stun = coreProgram([{ op: "SET_SOURCE_STATE", state: "STUN" }]);
  content.definitions.v0!.triggers = [{ event: "TURN_END", player: "SELF", programId: "stun" }];
  const state = mutable(main(content));
  const p = state.players[state.turn.playerId]!;
  const id = p.zones.DECK.find(cardId => state.cards[cardId]!.definitionId === "v0")!;
  const index = p.zones.DECK.indexOf(id);
  [p.zones.DECK[0], p.zones.DECK[index]] = [p.zones.DECK[index]!, p.zones.DECK[0]!];
  relocate(state, p.id, "DECK", "FIELD", 1);
  const another = Object.values(state.cards).find(c => c.definitionId === "v0" && c.instanceId !== id)!;
  const engine = GameEngine.restore(JSON.stringify(state), content);
  send(engine, { kind: "END_MAIN" }); engine.runUntilDecision();
  const choice = engine.getState().choice!;
  if (choice.kind !== "EFFECT_ORDER") assert.fail();
  send(engine, { kind: "CHOOSE_EFFECT", choiceId: choice.id, effectId: choice.candidates[0]! });
  engine.runUntilDecision();
  assert.equal(engine.getState().cards[id]!.orientation, "STUN");
  assert.equal(engine.getState().cards[another.instanceId]!.orientation, null);
  send(engine, { kind: "END_MAIN" }); engine.runUntilDecision();
  assert.equal(engine.getState().cards[id]!.orientation, "SLEEP");
  assert.equal(send(engine, { kind: "DEDUCE", cardId: id }).accepted, false);
});

test("R-05 / UT-059 non-turn effect creates turn-player pending which gets priority again", () => {
  const { content } = fixture();
  content.programs.drawOpponent = coreProgram([{ op: "DRAW", player: "OPPONENT", count: 1 }]);
  content.programs.add = coreProgram([{ op: "ADD_FILE", player: "SELF", count: 1 }]);
  content.definitions.c!.triggers = [
    { event: "TURN_END", player: "OPPONENT", programId: "drawOpponent" },
    { event: "TURN_END", player: "OPPONENT", programId: "add" },
    { event: "CARD_DRAWN", player: "SELF", programId: "add" },
  ];
  const state = mutable(setup(content));
  // Trusted fixture at Main: no Auto draw, whose trigger would correctly be blocked.
  state.frames = []; state.turn.phase = "MAIN";
  const engine = GameEngine.restore(JSON.stringify(state), content);
  send(engine, { kind: "END_MAIN" }); engine.runUntilDecision();
  let choice = engine.getState().choice!;
  assert.notEqual(choice.playerId, state.turn.playerId);
  const effect = engine.getState().pendingEffects.find(e => e.programId === "drawOpponent")!;
  send(engine, { kind: "CHOOSE_EFFECT", choiceId: choice.id, effectId: effect.id });
  engine.runUntilDecision();
  choice = engine.getState().choice!;
  assert.equal(choice.playerId, state.turn.playerId);
  assert.equal(engine.getState().pendingEffects.length, 2);
  assert.equal(engine.getState().status, "PLAYING");
});
