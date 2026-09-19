import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { hashText } from "../src/game/persistence/hash.ts";
import { canonical, fingerprint } from "../src/game/persistence/json.ts";

test("browser SHA-256 preserves canonical fingerprints including Unicode and long input", () => {
  for (const text of ["", "abc", "名探偵コナン / 柯南", "x".repeat(10000), canonical({ b: [1, null], a: "推理" })]) {
    assert.equal(hashText(text), createHash("sha256").update(text).digest("hex"));
  }
  assert.equal(fingerprint({ b: 2, a: 1 }), createHash("sha256").update('{"a":1,"b":2}').digest("hex"));
});
