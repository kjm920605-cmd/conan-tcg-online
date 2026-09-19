import type { Orientation } from "../model.ts";
import { check } from "../persistence/json.ts";

export function transitionOrientation(from: Orientation, requested: Orientation): Orientation {
  check(["ACTIVE", "SLEEP", "STUN"].includes(from) && ["ACTIVE", "SLEEP", "STUN"].includes(requested), "ORIENTATION");
  if (from === "STUN") return requested === "ACTIVE" ? "SLEEP" : "STUN";
  return requested;
}
