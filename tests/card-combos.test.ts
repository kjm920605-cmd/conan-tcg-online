import assert from "node:assert/strict";
import test from "node:test";
import { entryContactCombo, disguiseCombo, mrCombo, traceRefreshCombo } from "../examples/representative-combos.ts";

for (const [name, run] of [
  ["entry -> observer pending -> compound instructions -> Contact -> Cut-in -> scoped expiry", entryContactCombo],
  ["Disguise inherits attachments and Contact modifier without ordinary entry", disguiseCombo],
  ["MR removal -> Partner ability -> new MR removes old occurrence", mrCombo],
  ["opponent Refresh -> discovered TRACE -> conditional Draw", traceRefreshCombo],
] as const) test("CARD-COMBO " + name + "; every step restores and the complete command log replays", async () => {
  const h = await run();
  assert.ok(h.restoreChecks > 50); assert.equal(h.state.status, "PLAYING");
  assert.equal(h.state.frames.length, 0); h.assertReplay();
});
