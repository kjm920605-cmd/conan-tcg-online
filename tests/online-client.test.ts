import assert from "node:assert/strict";
import test from "node:test";
import { compileContent, readCardCatalog } from "../src/cards/index.ts";
import { createGameServer } from "../src/server/index.ts";
import { OnlineGameClient } from "../src/client/OnlineGameClient.ts";

function wait(c: OnlineGameClient, predicate: () => boolean): Promise<void> {
  if (predicate()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { off(); reject(new Error("online client timed out: " + JSON.stringify(c.getLobbySnapshot()))); }, 10000);
    const off = c.subscribe(() => { if (predicate()) { clearTimeout(timeout); off(); resolve(); } });
  });
}
test("two OnlineGameClients only hold projected state, resume their fixed seats and cannot export a snapshot", async () => {
  const content = compileContent(await readCardCatalog(new URL("../data/", import.meta.url)));
  const server = await createGameServer({ content, port: 0 });
  const url = `ws://127.0.0.1:${server.port}`;
  const a = new OnlineGameClient(url), b = new OnlineGameClient(url);
  try {
    a.connect(); b.connect(); await wait(a, () => a.getLobbySnapshot().hasSession); await wait(b, () => b.getLobbySnapshot().hasSession);
    a.createRoom(); await wait(a, () => !!a.getLobbySnapshot().room);
    b.joinRoom(a.getLobbySnapshot().room!.roomCode); await wait(b, () => !!b.getLobbySnapshot().room);
    a.roomReady(); b.roomReady(); await wait(a, () => !!a.getSnapshot().view); await wait(b, () => !!b.getSnapshot().view);
    assert.equal(a.getSnapshot().view!.viewerId, "A"); assert.equal(b.getSnapshot().view!.viewerId, "B");
    assert.equal("development" in a, false); assert.equal("exportSnapshot" in a, false);
    assert.ok(a.getSnapshot().view!.players.B!.zones.HAND.every(c => c.hidden && !c.id));
    assert.ok(!("rng" in a.getSnapshot().view!));
    const actor = a.getSnapshot().decision?.mode === "WAITING" ? b : a;
    const d = actor.getSnapshot().decision!;
    actor.submit({ kind: "MULLIGAN", choiceId: d.id, cardIds: [] });
    await wait(actor, () => actor.getLobbySnapshot().stateVersion === 1);
    b.disconnect(); assert.equal(b.getSnapshot().actions.length, 0);
    b.connect(); await wait(b, () => b.getLobbySnapshot().connection === "CONNECTED" && b.getLobbySnapshot().stateVersion === 1);
    assert.equal(b.getSnapshot().view!.viewerId, "B");
    assert.equal(b.getSnapshot().decision?.id, a.getSnapshot().decision?.id);
  } finally { a.dispose(); b.dispose(); await server.close(); }
});

test("leaving a waiting room clears the lobby after the new anonymous session is acknowledged", async () => {
  const content = compileContent(await readCardCatalog(new URL("../data/", import.meta.url)));
  const server = await createGameServer({ content, port: 0 });
  const c = new OnlineGameClient(`ws://127.0.0.1:${server.port}`);
  try {
    c.connect(); await wait(c, () => c.getLobbySnapshot().hasSession);
    c.createRoom(); await wait(c, () => !!c.getLobbySnapshot().room);
    c.leaveRoom(); await wait(c, () => c.getLobbySnapshot().room === null);
    c.createRoom(); await wait(c, () => !!c.getLobbySnapshot().room);
    assert.equal(c.getLobbySnapshot().error, null);
  } finally { c.dispose(); await server.close(); }
});

test("match reconnect keeps commands disabled until the fresh projection arrives", async () => {
  const content = compileContent(await readCardCatalog(new URL("../data/", import.meta.url)));
  const server = await createGameServer({ content, port: 0 });
  const a = new OnlineGameClient(`ws://127.0.0.1:${server.port}`), b = new OnlineGameClient(`ws://127.0.0.1:${server.port}`);
  try {
    a.connect(); b.connect(); await wait(a, () => a.getLobbySnapshot().hasSession); await wait(b, () => b.getLobbySnapshot().hasSession);
    a.createRoom(); await wait(a, () => !!a.getLobbySnapshot().room); b.joinRoom(a.getLobbySnapshot().room!.roomCode); await wait(b, () => !!b.getLobbySnapshot().room);
    a.roomReady(); b.roomReady(); await wait(a, () => !!a.getSnapshot().view); await wait(b, () => !!b.getSnapshot().view);
    if (b.getSnapshot().decision?.playerId === "B") {
      b.submit({ kind: "MULLIGAN", choiceId: b.getSnapshot().decision!.id, cardIds: [] });
      await wait(a, () => a.getLobbySnapshot().stateVersion === 1); await wait(b, () => b.getLobbySnapshot().stateVersion === 1);
    }
    const old = b.getLobbySnapshot().stateVersion!; b.disconnect();
    a.submit({ kind: "MULLIGAN", choiceId: a.getSnapshot().decision!.id, cardIds: [] });
    await wait(a, () => a.getLobbySnapshot().stateVersion === old + 1);
    let exposedStale = false;
    b.subscribe(() => { const s = b.getLobbySnapshot(); if (s.connection === "CONNECTED" && s.hasSession && s.stateVersion === old) exposedStale = true; });
    b.connect(); await wait(b, () => b.getLobbySnapshot().stateVersion === old + 1);
    assert.equal(exposedStale, false);
  } finally { a.dispose(); b.dispose(); await server.close(); }
});
