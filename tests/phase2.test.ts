import { coreProgram } from "../examples/programs.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../src/game/index.ts";
import type { CardDefinition, Intent } from "../src/game/index.ts";
import { conservation, fixture, main, mutable, relocate, setup } from "./fixtures.ts";
import { arena, effects, ok, passContact, roundtrip, send } from "./phase2-fixtures.ts";

test("P2-01 / UT-014–017 Next Hint skips Partner, recounts FILE and can use old or new hand card", () => {
  for (const useNew of [false, true]) {
    const a = arena();
    relocate(a.state, a.turn, "DECK", "FILE", 2);
    const oldHand = a.state.players[a.turn]!.zones.HAND[0]!;
    const taken = a.state.players[a.turn]!.zones.FILE[0]!;
    const engine = a.resume();
    ok(engine, { kind: "ASSIST" });
    ok(engine, { kind: "NEXT_HINT" }); effects(engine);
    const choice = engine.getState().choice!;
    assert.equal(choice.kind, "NEXT_HINT_CARD");
    assert.equal(engine.getState().players[a.turn]!.zones.FILE.length, 3);
    assert.ok(engine.getState().players[a.turn]!.zones.FILE.includes(a.state.players[a.turn]!.partnerId));
    assert.ok(engine.getState().players[a.turn]!.zones.HAND.includes(taken));
    ok(engine, { kind: "CHOOSE_NEXT_HINT_CARD", choiceId: choice.id, cardId: useNew ? taken : oldHand });
    effects(engine);
    assert.ok(engine.getState().players[a.turn]!.zones.FIELD.includes(useNew ? taken : oldHand));
    assert.equal(send(engine, { kind: "PLAY_CARD", cardId: engine.getState().players[a.turn]!.zones.HAND[0]! }).accepted, false);
    assert.ok(conservation(engine.getState()));
  }
});

test("P2-02 / UT-014,017 Next Hint skip, repeated use and Main-action exclusion", () => {
  const engine = main();
  const owner = engine.getState().turn.playerId;
  const cardId = engine.getState().players[owner]!.zones.HAND[0]!;
  ok(engine, { kind: "PLAY_CARD", cardId });
  ok(engine, { kind: "NEXT_HINT" }); effects(engine);
  const before = engine.serialize();
  for (const kind of ["ASSIST", "END_MAIN", "NEXT_HINT"] as const) assert.equal(send(engine, { kind }).accepted, false);
  assert.equal(engine.serialize(), before);
  const choice = engine.getState().choice!;
  ok(engine, { kind: "CHOOSE_NEXT_HINT_CARD", choiceId: choice.id, cardId: null }); effects(engine);
  assert.equal(engine.getState().players[owner]!.zones.FIELD.length, 1);
  assert.equal(send(engine, { kind: "NEXT_HINT" }).accepted, false);
  ok(engine, { kind: "END_MAIN" }); effects(engine);
  ok(engine, { kind: "END_MAIN" }); effects(engine);
  assert.equal(engine.getState().turn.usedNextHint, false);
  assert.equal(send(engine, { kind: "PLAY_CARD", cardId: engine.getState().players[owner]!.zones.HAND[0]! }).accepted, true);
});

test("P2-03 / UT-015,019 Next Hint validates level after removal and every Case color", () => {
  const a = arena();
  relocate(a.state, a.turn, "DECK", "FILE", 3);
  const id = a.state.players[a.turn]!.zones.HAND[0]!;
  const original = a.content.definitions[a.state.cards[id]!.definitionId]!;
  a.content.definitions.high = { ...original, definitionId: "high", printedId: "HIGH", type: "CHARACTER", ap: 1000, lp: 1, level: 4 };
  a.state.cards[id]!.definitionId = "high";
  const engine = a.resume();
  ok(engine, { kind: "NEXT_HINT" }); effects(engine);
  const choice = engine.getState().choice!;
  const before = engine.serialize();
  assert.equal(send(engine, { kind: "CHOOSE_NEXT_HINT_CARD", choiceId: choice.id, cardId: id }).accepted, false);
  assert.equal(engine.serialize(), before);
  const b = arena();
  const mismatch = b.state.players[b.turn]!.zones.HAND[0]!;
  b.content.definitions[b.state.cards[mismatch]!.definitionId]!.colors = ["BLUE", "GREEN"];
  const second = b.resume();
  ok(second, { kind: "NEXT_HINT" }); effects(second);
  assert.equal(send(second, { kind: "CHOOSE_NEXT_HINT_CARD", choiceId: second.getState().choice!.id, cardId: mismatch }).accepted, false);
});

test("P2-04 / UT-018 RQ-009 FILE only Partner is unsupported; RQ-025 never guesses actions", () => {
  const engine = main();
  const owner = engine.getState().turn.playerId;
  const partnerId = engine.getState().players[owner]!.partnerId;
  ok(engine, { kind: "ASSIST" });
  ok(engine, { kind: "NEXT_HINT" }); effects(engine);
  ok(engine, { kind: "CHOOSE_NEXT_HINT_CARD", choiceId: engine.getState().choice!.id, cardId: null }); effects(engine);
  const before = engine.serialize();
  const hint = send(engine, { kind: "NEXT_HINT" });
  assert.equal(hint.accepted, false);
  if (!hint.accepted) assert.equal(hint.code, "RULE_QUESTION_009");
  for (const intent of [{ kind: "DEDUCE", cardId: partnerId }, { kind: "ASSIST" }, { kind: "SOLVE_CASE" }] as Intent[]) {
    const result = send(engine, intent);
    assert.equal(result.accepted, false);
    if (!result.accepted) { assert.equal(result.code, "RULE_QUESTION_025"); assert.equal(result.category, "UnsupportedRule"); }
  }
  assert.equal(engine.serialize(), before);
});

test("P2-05 / UT-060 RQ-011 Next Hint take checkpoint precedes its hand-card choice", () => {
  const a = arena();
  a.content.programs.add = coreProgram([{ op: "ADD_FILE", player: "SELF", count: 1 }]);
  a.content.definitions.c!.triggers = [{ event: "NEXT_HINT_TAKEN", player: "SELF", programId: "add" }];
  const engine = a.resume();
  ok(engine, { kind: "NEXT_HINT" }); engine.runUntilDecision();
  assert.equal(engine.getState().choice?.kind, "EFFECT_ORDER");
  assert.equal(engine.getState().players[a.turn]!.zones.FILE.length, 0);
  effects(engine);
  assert.equal(engine.getState().players[a.turn]!.zones.FILE.length, 1);
  assert.equal(engine.getState().choice?.kind, "NEXT_HINT_CARD");
});

test("P2-06 / UT-005,021 Switch permits every orientation only when field is full", () => {
  for (const orientation of ["ACTIVE", "SLEEP", "STUN"] as const) {
    const a = arena();
    const removed = a.add(); a.state.cards[removed]!.orientation = orientation;
    for (let i = 0; i < 4; i++) a.add();
    const entering = a.state.players[a.turn]!.zones.HAND[0]!;
    const engine = a.resume();
    ok(engine, { kind: "PLAY_CARD", cardId: entering }); effects(engine);
    const choice = engine.getState().choice!;
    assert.equal(choice.kind, "SWITCH");
    const before = engine.serialize();
    assert.equal(send(engine, { kind: "CHOOSE_SWITCH", choiceId: choice.id, cardId: a.state.players[a.other]!.zones.HAND[0]! }).accepted, false);
    assert.equal(engine.serialize(), before);
    ok(engine, { kind: "CHOOSE_SWITCH", choiceId: choice.id, cardId: removed }); effects(engine);
    assert.equal(engine.getState().players[a.turn]!.zones.FIELD.length, 5);
    assert.ok(engine.getState().players[a.turn]!.zones.FIELD.includes(entering));
    assert.equal(engine.getState().players[a.turn]!.zones.REMOVE[0], removed);
    assert.ok(conservation(engine.getState()));
  }
  const a = arena(); for (let i = 0; i < 4; i++) a.add();
  const engine = a.resume();
  ok(engine, { kind: "PLAY_CARD", cardId: a.state.players[a.turn]!.zones.HAND[0]! });
  assert.equal(engine.getState().choice, null);
  assert.equal(send(engine, { kind: "CHOOSE_SWITCH", choiceId: "fake", cardId: a.state.players[a.turn]!.zones.FIELD[0]! }).accepted, false);
});

test("P2-07 / UT-021,061 Switch removal emits fact and source's pending effect survives leaving", () => {
  const a = arena();
  a.content.programs.drawOne = coreProgram([{ op: "DRAW", player: "SELF", count: 1 }]);
  const removed = a.add(a.turn, { triggers: [{ event: "CHARACTER_REMOVED", player: "SELF", subject: "SOURCE", programId: "drawOne" }] });
  for (let i = 0; i < 4; i++) a.add();
  const engine = a.resume();
  const entering = a.state.players[a.turn]!.zones.HAND[0]!;
  const hand = a.state.players[a.turn]!.zones.HAND.length;
  ok(engine, { kind: "PLAY_CARD", cardId: entering }); engine.runUntilDecision();
  ok(engine, { kind: "CHOOSE_SWITCH", choiceId: engine.getState().choice!.id, cardId: removed });
  engine.runUntilDecision();
  assert.equal(engine.getState().choice?.kind, "EFFECT_ORDER");
  assert.ok(engine.getState().players[a.turn]!.zones.FIELD.includes(entering));
  assert.ok(engine.getState().players[a.turn]!.zones.REMOVE.includes(removed));
  effects(engine);
  assert.equal(engine.getState().players[a.turn]!.zones.HAND.length, hand);
  const removal = engine.getState().events.find(e => e.type === "CHARACTER_REMOVED" && e.cardId === removed);
  assert.equal(removal?.cause, "SWITCH");
});

test("P2-08 / UT-017,021 Next Hint supports nested Switch and restores its choice", () => {
  const a = arena(); for (let i = 0; i < 5; i++) a.add();
  const engine = a.resume();
  ok(engine, { kind: "NEXT_HINT" }); effects(engine);
  const cardId = engine.getState().players[a.turn]!.zones.HAND[0]!;
  ok(engine, { kind: "CHOOSE_NEXT_HINT_CARD", choiceId: engine.getState().choice!.id, cardId }); effects(engine);
  const copy = roundtrip(engine, a.content);
  ok(copy, { kind: "CHOOSE_SWITCH", choiceId: copy.getState().choice!.id, cardId: a.state.players[a.turn]!.zones.FIELD[0]! }); effects(copy);
  assert.equal(copy.getState().frames.length, 0);
  assert.equal(copy.getState().turn.normalPlayUsed, false);
  assert.equal(copy.getState().turn.usedNextHint, true);
});

test("P2-09 / UT-029 Rapid allows new Character deduction, plain new Character cannot", () => {
  for (const rapid of [false, true]) {
    const a = arena();
    const id = a.add(a.turn, { keywords: rapid ? [{ kind: "RAPID" }] : [] });
    a.state.cards[id]!.enteredTurn = a.state.turn.number;
    const engine = a.resume();
    assert.equal(send(engine, { kind: "DEDUCE", cardId: id }).accepted, rapid);
    if (rapid) { effects(engine); assert.equal(engine.getState().players[a.turn]!.zones.EVIDENCE.length, 2); }
  }
});

test("P2-10 / UT-031 multiple Mislead characters Sleep simultaneously and reduce only this deduction", () => {
  const a = arena();
  const first = a.add(a.other, { keywords: [{ kind: "MISLEAD", value: 1 }] });
  const second = a.add(a.other, { keywords: [{ kind: "MISLEAD", value: 2 }] });
  const partner = a.content.definitions.p!;
  if (partner.type !== "PARTNER") assert.fail(); partner.lp = 4;
  const engine = a.resume();
  ok(engine, { kind: "DEDUCE", cardId: a.state.players[a.turn]!.partnerId }); effects(engine);
  const choice = engine.getState().choice!;
  assert.equal(choice.kind, "MISLEAD");
  assert.equal(choice.playerId, a.other);
  assert.equal(engine.getState().players[a.turn]!.zones.EVIDENCE.length, 0);
  const before = engine.serialize();
  assert.equal(send(engine, { kind: "CHOOSE_MISLEAD", choiceId: choice.id, cardIds: [first, first] }).accepted, false);
  assert.equal(send(engine, { kind: "CHOOSE_MISLEAD", choiceId: choice.id, cardIds: [first] }, a.turn).accepted, false);
  assert.equal(engine.serialize(), before);
  ok(engine, { kind: "CHOOSE_MISLEAD", choiceId: choice.id, cardIds: [first, second] });
  assert.equal(engine.getState().cards[first]!.orientation, "SLEEP");
  assert.equal(engine.getState().cards[second]!.orientation, "SLEEP");
  effects(engine);
  assert.equal(engine.getState().players[a.turn]!.zones.EVIDENCE.length, 1);
  assert.equal((a.content.definitions.p as Extract<CardDefinition, { type: "PARTNER" }>).lp, 4);
  assert.equal(engine.getState().frames.length, 0);
});

test("P2-11 / UT-030,031 Mislead may skip; invalid Sleep/Stun/plain/foreign candidates rejected", () => {
  const a = arena();
  const active = a.add(a.other, { keywords: [{ kind: "MISLEAD", value: 1 }] });
  const sleeping = a.add(a.other, { keywords: [{ kind: "MISLEAD", value: 1 }] }); a.state.cards[sleeping]!.orientation = "SLEEP";
  const stun = a.add(a.other, { keywords: [{ kind: "MISLEAD", value: 1 }] }); a.state.cards[stun]!.orientation = "STUN";
  const plain = a.add(a.other);
  const own = a.add(a.turn, { keywords: [{ kind: "MISLEAD", value: 1 }] });
  const engine = a.resume();
  ok(engine, { kind: "DEDUCE", cardId: a.state.players[a.turn]!.partnerId }); effects(engine);
  const choice = engine.getState().choice!;
  if (choice.kind !== "MISLEAD") assert.fail();
  assert.deepEqual(choice.candidates, [active]);
  for (const id of [sleeping, stun, plain, own]) assert.equal(send(engine, { kind: "CHOOSE_MISLEAD", choiceId: choice.id, cardIds: [id] }).accepted, false);
  ok(engine, { kind: "CHOOSE_MISLEAD", choiceId: choice.id, cardIds: [] }); effects(engine);
  assert.equal(engine.getState().players[a.turn]!.zones.EVIDENCE.length, 2);
  assert.equal(engine.getState().cards[active]!.orientation, "ACTIVE");
});

test("P2-12 / UT-030,031 zero or negative final LP gives zero evidence", () => {
  for (const reduction of [2, 3]) {
    const a = arena();
    const mislead = a.add(a.other, { keywords: [{ kind: "MISLEAD", value: reduction }] });
    const engine = a.resume();
    const deck = engine.getState().players[a.turn]!.zones.DECK.length;
    ok(engine, { kind: "DEDUCE", cardId: a.state.players[a.turn]!.partnerId }); effects(engine);
    ok(engine, { kind: "CHOOSE_MISLEAD", choiceId: engine.getState().choice!.id, cardIds: [mislead] }); effects(engine);
    assert.equal(engine.getState().players[a.turn]!.zones.EVIDENCE.length, 0);
    assert.equal(engine.getState().players[a.turn]!.zones.DECK.length, deck);
  }
});

test("P2-13 / UT-060 declaration and Mislead checkpoints resolve before calculating LP", () => {
  const a = arena();
  a.content.programs.drawOne = coreProgram([{ op: "DRAW", player: "SELF", count: 1 }]);
  a.content.definitions.c!.triggers = [{ event: "DEDUCTION_DECLARED", player: "SELF", programId: "drawOne" }];
  const mislead = a.add(a.other, { keywords: [{ kind: "MISLEAD", value: 1 }], triggers: [{ event: "MISLEAD_USED", player: "SELF", subject: "SOURCE", programId: "drawOne" }] });
  const engine = a.resume();
  ok(engine, { kind: "DEDUCE", cardId: a.state.players[a.turn]!.partnerId }); engine.runUntilDecision();
  assert.equal(engine.getState().choice?.kind, "EFFECT_ORDER");
  effects(engine);
  assert.equal(engine.getState().choice?.kind, "MISLEAD");
  ok(engine, { kind: "CHOOSE_MISLEAD", choiceId: engine.getState().choice!.id, cardIds: [mislead] });
  engine.runUntilDecision();
  assert.equal(engine.getState().choice?.kind, "EFFECT_ORDER");
  assert.equal(engine.getState().players[a.turn]!.zones.EVIDENCE.length, 0);
  effects(engine);
  assert.equal(engine.getState().players[a.turn]!.zones.EVIDENCE.length, 1);
});

test("P2-14 / UT-049–052,060 evidence gain completes through Refresh before ordinary trigger drain", () => {
  const a = arena();
  a.content.programs.drawOne = coreProgram([{ op: "DRAW", player: "SELF", count: 1 }]);
  a.content.definitions.c!.triggers = [{ event: "EVIDENCE_GAINED", player: "SELF", programId: "drawOne" }];
  relocate(a.state, a.turn, "DECK", "REMOVE", a.state.players[a.turn]!.zones.DECK.length - 1);
  const first = a.state.players[a.turn]!.zones.DECK[0]!;
  const engine = a.resume();
  ok(engine, { kind: "DEDUCE", cardId: a.state.players[a.turn]!.partnerId });
  engine.runUntilDecision();
  assert.equal(engine.getState().choice?.kind, "EFFECT_ORDER");
  assert.equal(engine.getState().players[a.turn]!.zones.EVIDENCE.length, 2);
  assert.equal(engine.getState().players[a.turn]!.zones.EVIDENCE[1], first);
  assert.equal(engine.getState().events.filter(e => e.type === "REFRESHED").length, 1);
  assert.equal(engine.getState().pendingEffects.length, 3); // 2 own gains and the opponent's Refresh evidence
  effects(engine);
  assert.ok(conservation(engine.getState()));
});

test("P2-15 / UT-060 RQ-011 Auto draw checkpoint precedes FILE and no longer blocks", () => {
  const { content } = fixture();
  content.programs.one = coreProgram([{ op: "ADD_FILE", player: "SELF", count: 1 }]);
  content.definitions.c!.triggers = [{ event: "CARD_DRAWN", player: "SELF", programId: "one" }];
  const engine = setup(content);
  engine.runUntilDecision();
  assert.equal(engine.getState().status, "PLAYING");
  assert.equal(engine.getState().choice?.kind, "EFFECT_ORDER");
  assert.equal(engine.getState().players[engine.getState().turn.playerId]!.zones.FILE.length, 0);
  effects(engine);
  assert.equal(engine.getState().turn.phase, "MAIN");
  assert.equal(engine.getState().players[engine.getState().turn.playerId]!.zones.FILE.length, 2);
});

test("P2-16 / UT-059,061 already pending effect resolves after its source ability is suppressed", () => {
  const a = arena();
  a.content.programs.suppress = coreProgram([{ op: "SUPPRESS_SOURCE_ABILITIES" }]);
  a.content.programs.drawOne = coreProgram([{ op: "DRAW", player: "SELF", count: 1 }]);
  const id = a.add(a.turn, { triggers: [
    { event: "DEDUCTION_DECLARED", player: "SELF", subject: "SOURCE", programId: "suppress" },
    { event: "DEDUCTION_DECLARED", player: "SELF", subject: "SOURCE", programId: "drawOne" },
  ] });
  const engine = a.resume();
  const hand = engine.getState().players[a.turn]!.zones.HAND.length;
  ok(engine, { kind: "DEDUCE", cardId: id }); engine.runUntilDecision();
  const pending = engine.getState().pendingEffects.find(e => e.programId === "suppress")!;
  ok(engine, { kind: "CHOOSE_EFFECT", choiceId: engine.getState().choice!.id, effectId: pending.id }); effects(engine);
  assert.equal(engine.getState().players[a.turn]!.zones.HAND.length, hand + 1);
  assert.equal(engine.getState().cards[id]!.abilitiesSuppressed, true);
});

test("P2-17 / UT-032 Action validates source, new entry, target owner/state and Case evidence", () => {
  const a = arena();
  const attacker = a.add();
  const defender = a.add(a.other);
  const engine = a.resume();
  const before = engine.serialize();
  for (const intent of [
    { kind: "DECLARE_ACTION", cardId: a.state.players[a.turn]!.partnerId, target: { kind: "CHARACTER", cardId: defender } },
    { kind: "DECLARE_ACTION", cardId: attacker, target: { kind: "CHARACTER", cardId: defender } },
    { kind: "DECLARE_ACTION", cardId: attacker, target: { kind: "CHARACTER", cardId: attacker } },
    { kind: "DECLARE_ACTION", cardId: attacker, target: { kind: "CASE", cardId: a.state.players[a.other]!.caseId } },
  ] as Intent[]) assert.equal(send(engine, intent).accepted, false);
  assert.equal(engine.serialize(), before);
  a.state.cards[defender]!.orientation = "SLEEP"; a.state.cards[attacker]!.enteredTurn = a.state.turn.number;
  assert.equal(send(a.resume(), { kind: "DECLARE_ACTION", cardId: attacker, target: { kind: "CHARACTER", cardId: defender } }).accepted, false);
});

test("P2-18 / UT-034 Guard allows new ACTIVE Character without AP restriction and sleeps it", () => {
  const a = arena();
  const attacker = a.add(a.turn, { ap: 5000 });
  const original = a.add(a.other); a.state.cards[original]!.orientation = "STUN";
  const guard = a.add(a.other, { ap: -1000 }); a.state.cards[guard]!.enteredTurn = a.state.turn.number;
  const engine = a.resume();
  ok(engine, { kind: "DECLARE_ACTION", cardId: attacker, target: { kind: "CHARACTER", cardId: original } }); effects(engine);
  assert.equal(engine.getState().cards[attacker]!.orientation, "SLEEP");
  const choice = engine.getState().choice!;
  assert.equal(choice.kind, "GUARD");
  assert.equal(choice.playerId, a.other);
  assert.equal(send(engine, { kind: "CHOOSE_GUARD", choiceId: choice.id, cardId: original }).accepted, false);
  assert.equal(send(engine, { kind: "CHOOSE_GUARD", choiceId: choice.id, cardId: guard }, a.turn).accepted, false);
  ok(engine, { kind: "CHOOSE_GUARD", choiceId: choice.id, cardId: guard });
  assert.equal(engine.getState().cards[guard]!.orientation, "SLEEP");
  passContact(engine);
  assert.ok(engine.getState().players[a.other]!.zones.FIELD.includes(original));
  assert.ok(engine.getState().players[a.other]!.zones.REMOVE.includes(guard));
});

test("P2-19 / UT-036–040 Contact priority and AP comparisons never remove attacker", () => {
  for (const [attackerAP, defenderAP] of [[500, 1000], [1000, 1000], [1500, 1000]]) {
    const a = arena();
    const attacker = a.add(a.turn, { ap: attackerAP! });
    const defender = a.add(a.other, { ap: defenderAP! }); a.state.cards[defender]!.orientation = "SLEEP";
    const engine = a.resume();
    ok(engine, { kind: "DECLARE_ACTION", cardId: attacker, target: { kind: "CHARACTER", cardId: defender } }); effects(engine);
    assert.equal(engine.getState().choice?.kind, "CONTACT_RESPONSE");
    assert.equal(engine.getState().choice?.playerId, attackerAP! < defenderAP! ? a.turn : a.other);
    passContact(engine);
    assert.ok(engine.getState().players[a.turn]!.zones.FIELD.includes(attacker));
    assert.equal(engine.getState().players[a.other]!.zones.REMOVE.includes(defender), attackerAP! >= defenderAP!);
    const types = engine.getState().events.map(e => e.type);
    assert.ok(types.indexOf("CONTACT_STARTED") < types.indexOf("CONTACT_PRIORITY"));
    assert.ok(types.indexOf("CONTACT_ENDED") < types.indexOf("ACTION_ENDED"));
    assert.equal(engine.getState().frames.length, 0);
  }
});

test("P2-20 / UT-036,045 guarded Case contacts guard; unguarded Case transfers exactly one evidence", () => {
  for (const guarded of [false, true]) {
    const a = arena();
    const attacker = a.add(a.turn, { ap: 2000, lp: -10 });
    const guard = guarded ? a.add(a.other, { ap: 1000 }) : null;
    relocate(a.state, a.other, "DECK", "EVIDENCE", 2);
    const removed = a.state.players[a.other]!.zones.EVIDENCE[0]!;
    const engine = a.resume();
    ok(engine, { kind: "DECLARE_ACTION", cardId: attacker, target: { kind: "CASE", cardId: a.state.players[a.other]!.caseId } }); effects(engine);
    if (guard) ok(engine, { kind: "CHOOSE_GUARD", choiceId: engine.getState().choice!.id, cardId: guard });
    passContact(engine);
    assert.equal(engine.getState().players[a.other]!.zones.EVIDENCE.length, guarded ? 2 : 1);
    assert.equal(engine.getState().players[a.turn]!.zones.EVIDENCE.length, guarded ? 0 : 1);
    if (!guarded) assert.ok(engine.getState().players[a.other]!.zones.REMOVE.includes(removed));
    assert.ok(conservation(engine.getState()));
  }
});

test("P2-21 / UT-039,060 guard and Contact-start pending resolve before priority/AP", () => {
  const a = arena();
  a.content.programs.drawOne = coreProgram([{ op: "DRAW", player: "SELF", count: 1 }]);
  const attacker = a.add(a.turn, { triggers: [{ event: "CONTACT_STARTED", player: "SELF", subject: "SOURCE", programId: "drawOne" }] });
  const original = a.add(a.other); a.state.cards[original]!.orientation = "SLEEP";
  const guard = a.add(a.other, { triggers: [{ event: "GUARD_DECLARED", player: "SELF", subject: "SOURCE", programId: "drawOne" }] });
  const engine = a.resume();
  ok(engine, { kind: "DECLARE_ACTION", cardId: attacker, target: { kind: "CHARACTER", cardId: original } }); effects(engine);
  ok(engine, { kind: "CHOOSE_GUARD", choiceId: engine.getState().choice!.id, cardId: guard });
  engine.runUntilDecision();
  assert.equal(engine.getState().choice?.kind, "EFFECT_ORDER");
  assert.ok(!engine.getState().events.some(e => e.type === "CONTACT_STARTED"));
  const effect = engine.getState().pendingEffects[0]!;
  ok(engine, { kind: "CHOOSE_EFFECT", choiceId: engine.getState().choice!.id, effectId: effect.id });
  engine.runUntilDecision();
  assert.equal(engine.getState().choice?.kind, "EFFECT_ORDER");
  assert.ok(!engine.getState().events.some(e => e.type === "CONTACT_PRIORITY"));
  passContact(engine);
});

test("P2-22 / UT-038 old extension-only Cut-in/Disguise requests without a card never consume response", () => {
  const a = arena(); const attacker = a.add(); const defender = a.add(a.other);
  a.state.cards[defender]!.orientation = "SLEEP";
  const engine = a.resume();
  ok(engine, { kind: "DECLARE_ACTION", cardId: attacker, target: { kind: "CHARACTER", cardId: defender } }); effects(engine);
  const before = engine.serialize();
  for (const response of ["CUT_IN", "DISGUISE"]) {
    const result = send(engine, { kind: "RESPOND_CONTACT", choiceId: engine.getState().choice!.id, response } as Intent);
    assert.equal(result.accepted, false);
    if (!result.accepted) assert.equal(result.category, "UnsupportedFeature");
  }
  assert.equal(engine.serialize(), before);
  passContact(engine);
});

test("P2-23 / UT-041 Contact participant departure ends Contact without AP comparison", () => {
  const a = arena();
  a.content.programs.leave = coreProgram([{ op: "REMOVE_SOURCE" }]);
  const attacker = a.add(a.turn, { triggers: [{ event: "CONTACT_STARTED", player: "SELF", subject: "SOURCE", programId: "leave" }] });
  const defender = a.add(a.other); a.state.cards[defender]!.orientation = "SLEEP";
  const engine = a.resume();
  ok(engine, { kind: "DECLARE_ACTION", cardId: attacker, target: { kind: "CHARACTER", cardId: defender } }); effects(engine);
  assert.equal(engine.getState().frames.length, 0);
  assert.ok(!engine.getState().events.some(e => e.type === "AP_COMPARED"));
  assert.ok(engine.getState().events.some(e => e.type === "CONTACT_ENDED"));
  assert.ok(engine.getState().players[a.other]!.zones.FIELD.includes(defender));
});

test("P2-24 / UT-088 unresolved deduction source and guard-boundary departures preserve rule blocks", () => {
  for (const situation of ["DEDUCTION", "GUARD"] as const) {
    const a = arena(); a.content.programs.leave = coreProgram([{ op: "REMOVE_SOURCE" }]);
    const attacker = a.add();
    if (situation === "DEDUCTION") {
      a.content.definitions[a.state.cards[attacker]!.definitionId]!.triggers = [{ event: "DEDUCTION_DECLARED", player: "SELF", subject: "SOURCE", programId: "leave" }];
      const engine = a.resume();
      ok(engine, { kind: "DEDUCE", cardId: attacker }); effects(engine);
      assert.equal(engine.getState().blocked?.questionId, "RULE-QUESTION-012");
      assert.equal(engine.getState().players[a.turn]!.zones.EVIDENCE.length, 0);
    } else {
      const defender = a.add(a.other); a.state.cards[defender]!.orientation = "SLEEP";
      const guard = a.add(a.other, { triggers: [{ event: "GUARD_DECLARED", player: "SELF", subject: "SOURCE", programId: "leave" }] });
      const engine = a.resume();
      ok(engine, { kind: "DECLARE_ACTION", cardId: attacker, target: { kind: "CHARACTER", cardId: defender } }); effects(engine);
      ok(engine, { kind: "CHOOSE_GUARD", choiceId: engine.getState().choice!.id, cardId: guard }); effects(engine);
      assert.equal(engine.getState().blocked?.questionId, "RULE-QUESTION-013");
      roundtrip(engine, a.content);
    }
  }
});

test("P2-25 / UT-078,084 serialize every Action/Guard/Contact step and choice", () => {
  const a = arena(); const attacker = a.add(); const defender = a.add(a.other);
  a.state.cards[defender]!.orientation = "SLEEP"; a.add(a.other);
  const engine = a.resume();
  ok(engine, { kind: "DECLARE_ACTION", cardId: attacker, target: { kind: "CHARACTER", cardId: defender } });
  let steps = 0;
  while (engine.getState().frames.length) {
    const restored = roundtrip(engine, a.content);
    const choice = engine.getState().choice;
    if (choice?.kind === "GUARD") {
      const intent: Intent = { kind: "CHOOSE_GUARD", choiceId: choice.id, cardId: null };
      ok(engine, intent); ok(restored, intent);
    } else if (choice?.kind === "CONTACT_RESPONSE") {
      const intent: Intent = { kind: "RESPOND_CONTACT", choiceId: choice.id, response: "PASS" };
      ok(engine, intent); ok(restored, intent);
    } else {
      assert.equal(engine.advance(), restored.advance());
    }
    assert.equal(engine.serialize(), restored.serialize());
    assert.ok(++steps < 100);
  }
});

test("P2-26 / UT-078,084 restore Mislead selection and deduction Refresh continuation", () => {
  const a = arena(); a.add(a.other, { keywords: [{ kind: "MISLEAD", value: 1 }] });
  relocate(a.state, a.turn, "DECK", "REMOVE", a.state.players[a.turn]!.zones.DECK.length - 1);
  const engine = a.resume();
  ok(engine, { kind: "DEDUCE", cardId: a.state.players[a.turn]!.partnerId }); effects(engine);
  const copy = roundtrip(engine, a.content);
  const intent: Intent = { kind: "CHOOSE_MISLEAD", choiceId: engine.getState().choice!.id, cardIds: [] };
  ok(engine, intent); ok(copy, intent);
  let steps = 0;
  while (engine.getState().frames.length) {
    const resumed = roundtrip(engine, a.content);
    assert.equal(resumed.advance(), engine.advance());
    assert.equal(resumed.serialize(), engine.serialize());
    assert.ok(++steps < 100);
  }
  effects(copy);
  assert.equal(copy.serialize(), engine.serialize());
});

test("P2-27 / UT-084 damaged gameplay choices, source IDs and step cursors are rejected", () => {
  const a = arena(); const attacker = a.add(); const defender = a.add(a.other);
  a.state.cards[defender]!.orientation = "SLEEP";
  const engine = a.resume();
  ok(engine, { kind: "DECLARE_ACTION", cardId: attacker, target: { kind: "CHARACTER", cardId: defender } }); effects(engine);
  const badChoice = mutable(engine); badChoice.choice!.playerId = "toString";
  assert.throws(() => GameEngine.restore(JSON.stringify(badChoice), a.content), /CHOICE/);
  const badFrame = mutable(engine);
  const contact = badFrame.frames.find(f => f.kind === "CONTACT")!;
  Object.assign(contact, { attackerId: "toString" });
  assert.throws(() => GameEngine.restore(JSON.stringify(badFrame), a.content), /FRAME|REFERENCE|PROCEDURE/);
  Object.assign(contact, { attackerId: attacker, step: "UNKNOWN" });
  assert.throws(() => GameEngine.restore(JSON.stringify(badFrame), a.content), /FRAME|STEP/);
});

test("P2-28 / UT-087 immediate replacement/negation and unimplemented or duplicate keywords are rejected", () => {
  for (const change of [
    (d: Record<string, unknown>) => { d.keywords = [{ kind: "DISGUISE" }]; },
    (d: Record<string, unknown>) => { d.keywords = [{ kind: "MISLEAD", value: 1 }, { kind: "MISLEAD", value: 2 }]; },
    (d: Record<string, unknown>) => { d.triggers = [{ event: "CARD_DRAWN", player: "SELF", programId: "draw", timing: "IMMEDIATE_REPLACEMENT" }]; },
  ]) {
    const { content, options } = fixture();
    change(content.definitions.v0 as unknown as Record<string, unknown>);
    assert.throws(() => GameEngine.create(options, content), /UNSUPPORTED|RULE_QUESTION_028/);
  }
});

test("P2-29 / UT-027,080 stale/repeated choice answers are atomic and do not consume RNG", () => {
  const engine = main();
  ok(engine, { kind: "NEXT_HINT" }); effects(engine);
  const choice = engine.getState().choice!;
  const before = engine.serialize();
  assert.equal(send(engine, { kind: "CHOOSE_NEXT_HINT_CARD", choiceId: "stale", cardId: null }).accepted, false);
  assert.equal(engine.serialize(), before);
  ok(engine, { kind: "CHOOSE_NEXT_HINT_CARD", choiceId: choice.id, cardId: null }); effects(engine);
  const after = engine.serialize();
  assert.equal(send(engine, { kind: "CHOOSE_NEXT_HINT_CARD", choiceId: choice.id, cardId: null }).accepted, false);
  assert.equal(engine.serialize(), after);
});

test("P2-30 / UT-061,088 removed Character retains archival identity but reentry stays RQ-027", () => {
  const a = arena(); a.content.programs.leave = coreProgram([{ op: "REMOVE_SOURCE" }]);
  const id = a.add(a.turn, { triggers: [{ event: "DEDUCTION_ENDED", player: "SELF", subject: "SOURCE", programId: "leave" }] });
  const engine = a.resume();
  ok(engine, { kind: "DEDUCE", cardId: id }); effects(engine);
  assert.ok(engine.getState().players[a.turn]!.zones.REMOVE.includes(id));
  const state = mutable(engine);
  relocate(state, a.turn, "REMOVE", "HAND", 1);
  const restored = GameEngine.restore(JSON.stringify(state), a.content);
  const result = send(restored, { kind: "PLAY_CARD", cardId: id });
  assert.equal(result.accepted, false);
  if (!result.accepted) assert.equal(result.code, "RULE_QUESTION_027");
});
