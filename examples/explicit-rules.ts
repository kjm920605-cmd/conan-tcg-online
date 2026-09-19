import assert from "node:assert/strict";
import { GameEngine } from "../src/game/index.ts";
import type { Command, EffectProgram, Intent } from "../src/game/index.ts";
import { fixture } from "./synthetic-content.ts";

// Synthetic text only. The adapter never writes a snapshot or imports test fixture mutation.
const { content, options } = fixture();
content.version = "synthetic-explicit-3a";
const fieldProgram: Omit<EffectProgram, "instructions"> = {
  sourceRequirements: "FIELD_ENTRY", targetSelectionPoint: "RESOLUTION", targetZone: "FIELD",
  duration: "INSTANT", invalidTargetBehavior: "BLOCK",
};
content.programs.prepare = { ...fieldProgram, instructions: [{ op: "SET_CARD", target: "SOURCE", count: 1 }, { op: "STACK_UNDER", target: "SOURCE", count: 1 }] };
content.programs.investigate = { ...fieldProgram, instructions: [{ op: "INVOKE_KEYWORD", keyword: "INVESTIGATE_X" }] };
content.programs.cut = { ...fieldProgram, sourceRequirements: "INDEPENDENT", duration: "UNTIL_CONTACT_END", instructions: [{ op: "AP_MOD", target: "OWN_CONTACT", value: 2000 }] };
for (const definition of Object.values(content.definitions)) if (definition.type === "CHARACTER") {
  definition.keywords = [{ kind: "RAPID" }, { kind: "INVESTIGATE_X", value: 3 }];
  definition.disguise = true;
  definition.cutIns = [{ abilityId: "boost", programId: "cut" }];
  definition.declarations = ["prepare", "investigate"].map(programId => ({ abilityId: programId, programId, zones: ["FIELD"], timing: "OWN_MAIN", cost: "NONE" }));
}
let engine = GameEngine.create(options, content);
const log: ({ command: Command } | { advance: true })[] = [];
function submit(intent: Intent): void {
  const state = engine.getState();
  const command = { matchId: state.matchId, commandId: "explicit-" + log.length, actorId: state.choice?.playerId ?? state.turn.playerId, expectedRevision: state.revision, intent };
  const result = engine.dispatch(command); assert.ok(result.accepted, JSON.stringify(result));
  log.push({ command });
}
function drain(): void {
  for (let budget = 0; budget < 500; budget++) {
    if (engine.advance()) { log.push({ advance: true }); continue; }
    const choice = engine.getState().choice;
    if (choice?.kind === "EFFECT_ORDER") { submit({ kind: "CHOOSE_EFFECT", choiceId: choice.id, effectId: choice.candidates[0]! }); continue; }
    assert.equal(engine.getState().status, "PLAYING"); return;
  }
  throw new Error("Demo step budget");
}
while (engine.getState().status === "SETUP") submit({ kind: "MULLIGAN", choiceId: engine.getState().choice!.id, cardIds: [] });
drain();
const first = engine.getState().turn.playerId;
const defender = engine.getState().players[first]!.zones.HAND[0]!;
submit({ kind: "PLAY_CARD", cardId: defender }); drain();
submit({ kind: "DECLARE_ABILITY", cardId: defender, abilityId: "prepare" }); drain();
submit({ kind: "DEDUCE", cardId: defender }); drain();
submit({ kind: "END_MAIN" }); drain();
const second = engine.getState().turn.playerId, attacker = engine.getState().players[second]!.zones.HAND[0]!;
submit({ kind: "PLAY_CARD", cardId: attacker }); drain();
submit({ kind: "DECLARE_ACTION", cardId: attacker, target: { kind: "CHARACTER", cardId: defender } }); drain();
assert.equal(engine.getState().choice?.kind, "CONTACT_RESPONSE");
assert.equal(engine.getState().choice?.playerId, first);
engine = GameEngine.restore(engine.serialize(), content);
const disguise = engine.getState().players[first]!.zones.HAND[0]!;
submit({ kind: "RESPOND_CONTACT", choiceId: engine.getState().choice!.id, response: "DISGUISE", cardId: disguise }); drain();
const cut = engine.getState().players[second]!.zones.HAND[0]!;
submit({ kind: "RESPOND_CONTACT", choiceId: engine.getState().choice!.id, response: "CUT_IN", cardId: cut, abilityId: "boost" }); drain();
assert.equal(Object.keys(engine.getState().modifiers).length, 0);
assert.ok(engine.getState().players[first]!.zones.REMOVE.includes(disguise));
submit({ kind: "DECLARE_ABILITY", cardId: attacker, abilityId: "investigate" }); drain();
const choice = engine.getState().choice!; assert.equal(choice.kind, "INVESTIGATION_ORDER");
if (choice.kind !== "INVESTIGATION_ORDER") throw new Error("Expected investigation");
submit({ kind: "CHOOSE_INVESTIGATION_ORDER", choiceId: choice.id, cardIds: [...choice.candidates].reverse() }); drain();
const replay = GameEngine.create(options, content);
for (const item of log) {
  if ("command" in item) assert.ok(replay.dispatch(item.command).accepted);
  else assert.equal(replay.advance(), true);
}
assert.equal(replay.serialize(), engine.serialize());
console.log(JSON.stringify({ phase: "3A", commands: log.filter(x => "command" in x).length,
  fieldOccurrences: Object.keys(engine.getState().entries).length, cutIn: true, disguise: true,
  inheritedAttachments: true, investigation: choice.candidates.length, expiredModifiers: true,
  intermediateRestore: true, replayIdentical: true, status: engine.getState().status }));
