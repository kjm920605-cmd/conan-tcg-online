import { coreProgram } from "./programs.ts";
import type { Content, CreateOptions } from "../src/game/index.ts";

// Synthetic rules fixtures, not official cards. No ability is inferred from a real name.
export function fixture(): { content: Content; options: CreateOptions } {
  const content: Content = { version: "synthetic-core-v1", definitions: {}, programs: { draw: coreProgram([{ op: "DRAW", player: "SELF", count: 2 }]) } };
  const base = { recognizedNames: ["fixture"], colors: ["BLUE"], support: "VERIFIED_CORE" as const, triggers: [] };
  content.definitions.p = { ...base, definitionId: "p", printedId: "P", name: "Partner fixture", type: "PARTNER", lp: 2 };
  content.definitions.c = { ...base, definitionId: "c", printedId: "C", name: "Case fixture", type: "CASE", firstLevel: 3, secondLevel: 2 };
  for (let i = 0; i < 14; i++) {
    content.definitions["v" + i] = { ...base, definitionId: "v" + i, printedId: "V" + i, name: "Vanilla fixture", type: "CHARACTER", level: 0, ap: 1000, lp: 2 };
  }
  content.definitions.e = { ...base, definitionId: "e", printedId: "E", name: "Event fixture", type: "EVENT", level: 0, programId: "draw" };
  const deck = Array.from({ length: 40 }, (_, i) => "v" + Math.floor(i / 3));
  return { content, options: { matchId: "test", seed: 123, players: [
    { playerId: "a", partner: "p", case: "c", deck: [...deck] },
    { playerId: "b", partner: "p", case: "c", deck: [...deck] },
  ] } };
}

