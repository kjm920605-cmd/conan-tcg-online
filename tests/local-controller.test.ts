import assert from "node:assert/strict";
import test from "node:test";
import { readCardCatalog, compileContent } from "../src/cards/index.ts";
import { LocalController } from "../src/local/controller.ts";
import { fixtureOptions } from "../src/local/decks.ts";
import { GameEngine } from "../src/game/engine/GameEngine.ts";

const content = compileContent(await readCardCatalog(new URL("../data/", import.meta.url)));
const create = () => LocalController.create(content, fixtureOptions(42));

test("local setup requires Ready and hides both hands during every ownership handoff", () => {
  const c = create(); assert.equal(c.getSnapshot().view, null);
  c.ready(); const first = c.getSnapshot().view!.viewerId;
  const d = c.getSnapshot().decision!;
  assert.equal(d.kind, "MULLIGAN"); c.submit({ kind: "MULLIGAN", choiceId: d.id, cardIds: [] });
  assert.equal(c.getSnapshot().view, null); assert.notEqual(c.getSnapshot().requiredPlayerId, first);
  assert.deepEqual(c.getSnapshot().actions, []); assert.equal(c.getSnapshot().decision, null);
  c.ready(); assert.notEqual(c.getSnapshot().view!.viewerId, first);
});

test("local invalid intent and invalid snapshot preserve the current match", () => {
  const c = create(); c.ready(); const before = c.exportSnapshot();
  c.submit({ kind: "END_MAIN" }); assert.equal(c.exportSnapshot(), before);
  assert.ok(c.getSnapshot().error);
  assert.equal(c.importSnapshot('{"schemaVersion":3}'), false); assert.equal(c.exportSnapshot(), before);
  assert.equal(c.importSnapshot(before), true); assert.equal(c.getSnapshot().view, null);
  c.ready(); assert.equal(c.getSnapshot().decision!.kind, "MULLIGAN");
});

test("controller snapshots are stable for React subscription and restored sessions start locked", () => {
  const c = create(); assert.equal(c.getSnapshot(), c.getSnapshot());
  let notifications = 0; const off = c.subscribe(() => notifications++);
  c.ready(); assert.equal(notifications, 1); off();
  const saved = c.exportSnapshot(); const restored = LocalController.restore(content, saved);
  assert.equal(restored.getSnapshot().view, null); assert.equal(restored.exportSnapshot(), saved);
});

test("two fixed decks are distinct and pass Engine setup validation", () => {
  const options = fixtureOptions(7); assert.equal(options.players[0].deck.length, 40);
  assert.equal(options.players[1].deck.length, 40); assert.notDeepEqual(options.players[0].deck, options.players[1].deck);
  assert.equal(LocalController.create(content, options).getSnapshot().status, "SETUP");
});

test("restoring an automatic intermediate flow resumes through Engine before showing the board", () => {
  const engine = GameEngine.create(fixtureOptions(42), content);
  for (let n = 0; n < 2; n++) {
    const s = engine.getState();
    assert.ok(engine.dispatch({ matchId: s.matchId, commandId: `setup-${n}`, actorId: s.choice!.playerId, expectedRevision: s.revision, intent: { kind: "MULLIGAN", choiceId: s.choice!.id, cardIds: [] } }).accepted);
  }
  assert.ok(engine.getState().frames.length > 0);
  const c = LocalController.restore(content, engine.serialize()); c.ready();
  assert.equal(c.getSnapshot().view!.turn.phase, "MAIN");
  assert.equal(c.getSnapshot().view!.subflows.length, 0);
  assert.ok(c.getSnapshot().actions.some(a => a.intent.kind === "END_MAIN" && a.available));
});
