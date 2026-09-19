import assert from "node:assert/strict";
import test from "node:test";
import { readCardCatalog, compileContent } from "../src/cards/index.ts";
import { fixtureOptions } from "../src/local/decks.ts";
import { LocalGameClient } from "../src/client/localGameClient.ts";
import type { GameClient } from "../src/client/GameClient.ts";

test("LocalGameClient preserves the shared UI contract and explicit development capabilities", async () => {
  const content = compileContent(await readCardCatalog(new URL("../data/", import.meta.url)));
  const client: GameClient = LocalGameClient.create(content, fixtureOptions());
  assert.equal(client.getSnapshot().view, null); client.ready();
  assert.ok(client.getSnapshot().view); assert.ok(client.development);
  const saved = client.development.exportSnapshot(); assert.ok(client.development.importSnapshot(saved));
  assert.equal(client.getSnapshot().view, null);
});
