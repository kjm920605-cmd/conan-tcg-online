import { GameEngine } from "../src/game/index.ts";
import type { Intent } from "../src/game/index.ts";
import { fixture } from "./synthetic-content.ts";

// Synthetic CLI demonstration: the adapter only submits intentions.
const { options, content } = fixture();
const engine = GameEngine.create(options, content);
function submit(intent: Intent): void {
  const state = engine.getState();
  const result = engine.dispatch({
    matchId: state.matchId, commandId: "demo-" + state.revision,
    actorId: state.choice?.playerId ?? state.turn.playerId,
    expectedRevision: state.revision, intent,
  });
  if (!result.accepted) throw new Error(result.message);
}
while (engine.getState().status === "SETUP") {
  submit({ kind: "MULLIGAN", choiceId: engine.getState().choice!.id, cardIds: [] });
}
for (let turns = 0; turns < 20 && engine.getState().status === "PLAYING"; turns++) {
  engine.runUntilDecision();
  const state = engine.getState();
  const player = state.players[state.turn.playerId]!;
  if (player.chapter === "RESOLUTION") submit({ kind: "SOLVE_CASE" });
  else if (player.zones.EVIDENCE.length < 3) submit({ kind: "DEDUCE", cardId: player.partnerId });
  else submit({ kind: "ASSIST" });
  engine.runUntilDecision();
  console.log(JSON.stringify({
    turn: state.turn.number, player: player.id,
    chapter: engine.getState().players[player.id]!.chapter,
    evidence: engine.getState().players[player.id]!.zones.EVIDENCE.length,
    file: engine.getState().players[player.id]!.zones.FILE.length,
  }));
  if (engine.getState().status === "PLAYING") submit({ kind: "END_MAIN" });
}
const restored = GameEngine.restore(engine.serialize(), content);
if (restored.serialize() !== engine.serialize()) throw new Error("Roundtrip mismatch");
if (restored.getState().status !== "FINISHED") throw new Error("Demo did not finish");
console.log(JSON.stringify({ outcome: restored.getState().outcome, restored: true }));
