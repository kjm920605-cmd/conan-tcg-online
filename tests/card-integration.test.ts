import assert from "node:assert/strict";
import test from "node:test";
import { compileContent, readCardCatalog } from "../src/cards/index.ts";
import { RepresentativeSession } from "../examples/representative-session.ts";

const catalog = await readCardCatalog(new URL("../data/", import.meta.url));

for (const cardId of ["F-PARTNER", "F-CASE"]) test("CARD " + cardId + " setup legality, state and events", async () => {
  const h = await RepresentativeSession.create();
  const definition = catalog.cards[cardId]!.definition;
  const card = Object.values(h.state.cards).find(c => c.ownerId === h.first && c.definitionId === cardId)!;
  assert.equal(card.face, "UP"); assert.ok(h.state.players[h.first]!.zones[definition.type === "PARTNER" ? "PARTNER" : "CASE"].includes(card.instanceId));
  h.reject({ kind: "PLAY_CARD", cardId: card.instanceId });
  assert.ok(h.state.events.some(e => e.type === "PARTNERS_CASES_REVEALED"));
  assert.equal(h.state.pendingEffects.length, 0); h.assertReplay();
});

test("CARD F-VANILLA no invented trigger or newcomer permission", async () => {
  const h = await RepresentativeSession.create(["F-VANILLA"]), id = h.play("F-VANILLA");
  assert.equal(h.state.pendingEffects.length, 0); h.drain();
  h.reject({ kind: "DEDUCE", cardId: id }); h.reject({ kind: "PLAY_CARD", cardId: id });
  assert.equal(h.state.cards[id]!.orientation, "ACTIVE");
  assert.equal(h.state.events.filter(e => e.type === "CHARACTER_ENTERED" && e.cardId === id).length, 1); h.assertReplay();
});

for (const [cardId, draw, set, under, modifiers] of [
  ["F-ENTER-DRAW", 1, 0, 0, 0], ["F-COMBO-REACT", 1, 0, 0, 0],
  ["F-SET", 0, 2, 0, 0], ["F-UNDER", 0, 0, 1, 0], ["F-COMBO-ENTER", 1, 1, 1, 1],
] as const) test("CARD " + cardId + " entry trigger waits for checkpoint and applies its program", async () => {
  const h = await RepresentativeSession.create([cardId]), before = h.state.players[h.first]!.zones.HAND.length;
  const id = h.play(cardId), deck = [...h.state.players[h.first]!.zones.DECK];
  assert.equal(h.state.pendingEffects.length, 1);
  assert.equal(h.state.players[h.first]!.zones.HAND.length, before - 1);
  assert.equal(h.state.players[h.first]!.zones.SET.length, 0);
  h.reject({ kind: "DECLARE_ABILITY", cardId: id, abilityId: "unknown" });
  h.settle(); assert.equal(h.state.choice?.kind, "EFFECT_ORDER"); h.drain();
  const zones = h.state.players[h.first]!.zones;
  assert.equal(zones.HAND.length, before - 1 + draw); assert.equal(zones.SET.length, set); assert.equal(zones.UNDER.length, under);
  assert.equal(Object.keys(h.state.modifiers).length, modifiers);
  if (set) assert.ok(zones.SET.includes(deck[draw]!));
  if (under) assert.ok(zones.UNDER.includes(deck[draw + set]!));
  assert.ok(h.state.events.some(e => e.type === "ABILITY_TRIGGERED" && e.cardId === id));
  assert.ok(h.state.events.some(e => e.type === "EFFECT_RESOLVED" && e.cardId === id));
  h.assertReplay();
});

test("CARD F-EVENT-DRAW stays processing until both draws finish", async () => {
  const h = await RepresentativeSession.create(["F-EVENT-DRAW"]), before = h.state.players[h.first]!.zones.HAND.length;
  const id = h.play("F-EVENT-DRAW");
  assert.ok(h.state.players[h.first]!.zones.PROCESSING.includes(id));
  assert.equal(h.state.players[h.first]!.zones.HAND.length, before - 1);
  h.reject({ kind: "PLAY_CARD", cardId: id }); h.drain();
  assert.equal(h.state.players[h.first]!.zones.HAND.length, before + 1);
  assert.ok(h.state.players[h.first]!.zones.REMOVE.includes(id));
  const completed = h.state.events.find(e => e.type === "EFFECT_RESOLVED" && e.cardId === id)!;
  const removed = h.state.events.find(e => e.type === "CARD_MOVED" && e.cardId === id && e.detail === "PROCESSING>REMOVE")!;
  assert.ok(completed.sequence < removed.sequence); h.assertReplay();
});

test("CARD F-REMOVE-DRAW triggers after formal removal and resolves independently", async () => {
  const h = await RepresentativeSession.create(["F-REMOVE-DRAW"]), id = h.play("F-REMOVE-DRAW"); h.drain();
  const before = h.state.players[h.first]!.zones.HAND.length;
  h.reject({ kind: "DECLARE_ABILITY", cardId: h.state.players[h.other]!.partnerId, abilityId: "leave" });
  h.submit({ kind: "DECLARE_ABILITY", cardId: id, abilityId: "leave" });
  h.settle(); assert.ok(h.state.players[h.first]!.zones.REMOVE.includes(id));
  assert.equal(h.state.players[h.first]!.zones.HAND.length, before);
  assert.equal(h.state.choice?.kind, "EFFECT_ORDER"); h.drain();
  assert.equal(h.state.players[h.first]!.zones.HAND.length, before + 1);
  assert.ok(h.state.events.some(e => e.type === "CHARACTER_REMOVED" && e.cardId === id && e.cause === "EFFECT")); h.assertReplay();
});

for (const [cardId, ability, stat, value] of [["F-AP-BOOST", "boost", "AP", 2000], ["F-LP-BOOST", "boost", "LP", 1]] as const)
test("CARD " + cardId + " validates source and uses a scoped modifier", async () => {
  const h = await RepresentativeSession.create([cardId]), id = h.play(cardId); h.drain();
  h.reject({ kind: "DECLARE_ABILITY", cardId: h.state.players[h.other]!.partnerId, abilityId: ability });
  h.submit({ kind: "DECLARE_ABILITY", cardId: id, abilityId: ability });
  assert.equal(Object.keys(h.state.modifiers).length, 0); h.drain();
  const modifier = Object.values(h.state.modifiers)[0]!;
  assert.equal(modifier.stat, stat); assert.equal(modifier.value, value); assert.equal(modifier.targetEntryId, h.state.cards[id]!.entryId);
  assert.ok(h.state.events.some(e => e.type === "MODIFIER_ADDED" && e.cardId === id));
  h.submit({ kind: "DEDUCE", cardId: id }); h.drain();
  assert.equal(h.state.players[h.first]!.zones.EVIDENCE.length, stat === "LP" ? 2 : 1);
  h.nextTurn(); assert.equal(Object.keys(h.state.modifiers).length, 0); h.assertReplay();
});

for (const [cardId, ability, expected] of [["F-ACTIVE", "wake", "ACTIVE"], ["F-SLEEP", "rest", "SLEEP"], ["F-STUN", "stun", "STUN"]] as const)
test("CARD " + cardId + " orientation declaration has no arbitrary target access", async () => {
  const h = await RepresentativeSession.create([cardId]), id = h.play(cardId); h.drain();
  if (expected === "ACTIVE") { h.submit({ kind: "DEDUCE", cardId: id }); h.drain(); }
  const before = h.state.cards[id]!.orientation;
  h.reject({ kind: "DECLARE_ABILITY", cardId: h.state.players[h.other]!.partnerId, abilityId: ability });
  h.submit({ kind: "DECLARE_ABILITY", cardId: id, abilityId: ability });
  assert.equal(h.state.cards[id]!.orientation, before); h.drain();
  assert.equal(h.state.cards[id]!.orientation, expected);
  assert.ok(h.state.events.some(e => e.type === "ORIENTATION_CHANGED" && e.cardId === id && e.detail === expected)); h.assertReplay();
});

test("CARD F-ACTIVATED-DRAW executes its bound Draw and MOVE; reentry stays blocked", async () => {
  const h = await RepresentativeSession.create(["F-ACTIVATED-DRAW"]), id = h.play("F-ACTIVATED-DRAW"); h.drain();
  const before = h.state.players[h.first]!.zones.HAND.length;
  h.reject({ kind: "DECLARE_ABILITY", cardId: id, abilityId: "p-evidence-two" });
  h.submit({ kind: "DECLARE_ABILITY", cardId: id, abilityId: "draw" });
  assert.equal(h.state.players[h.first]!.zones.HAND.length, before); h.drain();
  assert.equal(h.state.players[h.first]!.zones.HAND.length, before + 1);
  h.submit({ kind: "DECLARE_ABILITY", cardId: id, abilityId: "return" }); h.drain();
  assert.ok(h.state.players[h.first]!.zones.HAND.includes(id));
  assert.ok(h.state.events.some(e => e.cardId === id && e.type === "CARD_MOVED" && e.detail === "FIELD>HAND"));
  h.nextTurn(); h.nextTurn(); const rejected = h.reject({ kind: "PLAY_CARD", cardId: id });
  assert.equal(rejected.code, "RULE_QUESTION_027"); h.assertReplay();
});

test("CARD F-EVIDENCE gains ordered evidence only after its declaration program starts", async () => {
  const h = await RepresentativeSession.create(["F-EVIDENCE"]), id = h.play("F-EVIDENCE"); h.drain();
  const top = h.state.players[h.first]!.zones.DECK.slice(0, 2);
  h.reject({ kind: "DECLARE_ABILITY", cardId: h.state.players[h.other]!.partnerId, abilityId: "evidence" });
  h.submit({ kind: "DECLARE_ABILITY", cardId: id, abilityId: "evidence" });
  assert.equal(h.state.players[h.first]!.zones.EVIDENCE.length, 0); h.drain();
  assert.deepEqual(h.state.players[h.first]!.zones.EVIDENCE, [...top].reverse());
  assert.equal(h.state.events.filter(e => e.type === "EVIDENCE_GAINED" && e.playerId === h.first).length, 2); h.assertReplay();
});

test("CARD F-INVESTIGATE preserves reveal timing and validates the opponent's bottom order", async () => {
  const h = await RepresentativeSession.create(["F-INVESTIGATE"]), id = h.play("F-INVESTIGATE"); h.drain();
  const deck = [...h.state.players[h.other]!.zones.DECK];
  h.submit({ kind: "DECLARE_ABILITY", cardId: id, abilityId: "investigate" });
  assert.ok(!h.state.events.some(e => e.type === "INVESTIGATION_REVEALED")); h.drain();
  const choice = h.state.choice!; assert.equal(choice.kind, "INVESTIGATION_ORDER"); assert.equal(choice.playerId, h.other);
  h.reject({ kind: "CHOOSE_INVESTIGATION_ORDER", choiceId: choice.id, cardIds: [deck[0]!, deck[0]!, deck[0]!] });
  h.submit({ kind: "CHOOSE_INVESTIGATION_ORDER", choiceId: choice.id, cardIds: deck.slice(0, 3).reverse() }); h.drain();
  assert.deepEqual(h.state.players[h.other]!.zones.DECK, [...deck.slice(3), ...deck.slice(0, 3).reverse()]);
  assert.ok(h.state.events.some(e => e.type === "INVESTIGATION_ORDERED" && e.cardId === id)); h.assertReplay();
});

test("CARD F-TRACE undiscovered condition is evaluated at resolution", async () => {
  const h = await RepresentativeSession.create(["F-TRACE"]), id = h.play("F-TRACE"); h.drain();
  const before = h.state.players[h.first]!.zones.HAND.length;
  h.reject({ kind: "DECLARE_ABILITY", cardId: id, abilityId: "missing" });
  h.submit({ kind: "DECLARE_ABILITY", cardId: id, abilityId: "trace" });
  assert.equal(h.state.players[h.first]!.zones.HAND.length, before); h.drain();
  assert.equal(h.state.players[h.first]!.zones.HAND.length, before);
  assert.ok(h.state.events.some(e => e.type === "EFFECT_RESOLVED" && e.cardId === id)); h.assertReplay();
});

for (const cardId of ["F-CUTIN", "F-COMBO-CUT"]) test("CARD " + cardId + " Contact legality, selected effect, state and expiry", async () => {
  const h = await RepresentativeSession.create(["F-AP-BOOST", cardId], ["F-REMOVE-DRAW"]);
  const attacker = h.play("F-AP-BOOST"); h.drain(); h.nextTurn();
  const defender = h.play("F-REMOVE-DRAW"); h.drain(); h.submit({ kind: "DEDUCE", cardId: defender }); h.drain(); h.nextTurn();
  h.submit({ kind: "DECLARE_ACTION", cardId: attacker, target: { kind: "CHARACTER", cardId: defender } }); h.drain();
  h.submit({ kind: "RESPOND_CONTACT", choiceId: h.state.choice!.id, response: "PASS" }); h.drain();
  const card = h.hand(cardId), ability = catalog.cards[cardId]!.definition.cutIns![0]!.abilityId;
  h.reject({ kind: "RESPOND_CONTACT", choiceId: h.state.choice!.id, response: "CUT_IN", cardId: attacker, abilityId: ability });
  h.submit({ kind: "RESPOND_CONTACT", choiceId: h.state.choice!.id, response: "CUT_IN", cardId: card, abilityId: ability });
  assert.ok(h.state.players[h.first]!.zones.REMOVE.includes(card)); assert.equal(Object.keys(h.state.modifiers).length, 0);
  h.drain(); assert.equal(Object.keys(h.state.modifiers).length, 1); h.finishContact();
  assert.ok(h.state.players[h.other]!.zones.REMOVE.includes(defender)); assert.equal(Object.keys(h.state.modifiers).length, 0);
  assert.equal(h.state.events.filter(e => e.type === "CUT_IN_USED" && e.cardId === card).length, 1); h.assertReplay();
});

test("CARD F-DISGUISE replaces a physical carrier without ordinary entry", async () => {
  const h = await RepresentativeSession.create(["F-REMOVE-DRAW", "F-DISGUISE"], ["F-ACTIVE"]);
  const old = h.play("F-REMOVE-DRAW"); h.drain(); h.submit({ kind: "DEDUCE", cardId: old }); h.drain(); h.nextTurn();
  const attacker = h.play("F-ACTIVE"); h.drain(); h.submit({ kind: "DECLARE_ACTION", cardId: attacker, target: { kind: "CHARACTER", cardId: old } }); h.drain();
  const replacement = h.hand("F-DISGUISE", h.first), before = h.state.players[h.first]!.zones.HAND.length;
  h.reject({ kind: "RESPOND_CONTACT", choiceId: h.state.choice!.id, response: "DISGUISE", cardId: old });
  h.submit({ kind: "RESPOND_CONTACT", choiceId: h.state.choice!.id, response: "DISGUISE", cardId: replacement });
  assert.equal(h.state.players[h.first]!.zones.DECK.at(-1), old); assert.equal(h.state.cards[replacement]!.orientation, "SLEEP");
  assert.equal(h.state.players[h.first]!.zones.HAND.length, before - 1); h.drain();
  assert.equal(h.state.players[h.first]!.zones.HAND.length, before);
  assert.ok(!h.state.events.some(e => e.type === "CHARACTER_ENTERED" && e.cardId === replacement));
  assert.ok(h.state.events.some(e => e.type === "DISGUISED" && e.cardId === replacement)); h.finishContact(); h.assertReplay();
});

test("CARD F-MISLEAD pays Sleep before evidence and rejects illegal participants", async () => {
  const h = await RepresentativeSession.create(["F-MISLEAD"], ["F-LP-BOOST"]), mislead = h.play("F-MISLEAD"); h.drain(); h.nextTurn();
  const source = h.play("F-LP-BOOST"); h.drain(); h.submit({ kind: "DECLARE_ABILITY", cardId: source, abilityId: "boost" }); h.drain();
  h.submit({ kind: "DEDUCE", cardId: source }); h.drain();
  assert.equal(h.state.choice?.kind, "MISLEAD");
  h.reject({ kind: "CHOOSE_MISLEAD", choiceId: h.state.choice!.id, cardIds: [source] });
  h.submit({ kind: "CHOOSE_MISLEAD", choiceId: h.state.choice!.id, cardIds: [mislead] });
  assert.equal(h.state.cards[mislead]!.orientation, "SLEEP"); h.drain();
  assert.equal(h.state.players[h.other]!.zones.EVIDENCE.length, 0);
  assert.ok(h.state.events.some(e => e.type === "MISLEAD_USED" && e.cardId === mislead)); h.assertReplay();
});

test("CARD F-MR normal entry and explicit Partner-only declaration boundary", async () => {
  const h = await RepresentativeSession.create(["F-MR"]), id = h.play("F-MR"); h.drain();
  h.reject({ kind: "DECLARE_ABILITY", cardId: id, abilityId: "partner-draw" });
  assert.ok(h.state.players[h.first]!.zones.FIELD.includes(id)); assert.equal(h.state.pendingEffects.length, 0);
  assert.ok(h.state.events.some(e => e.type === "CHARACTER_ENTERED" && e.cardId === id));
  h.submit({ kind: "DEDUCE", cardId: id }); h.drain(); assert.equal(h.state.players[h.first]!.zones.EVIDENCE.length, 1); h.assertReplay();
});

for (const cardId of ["F-SEARCH", "F-RETURN", "F-EXPIRY", "F-FILE-PARTNER"]) test("CARD " + cardId + " remains inspectable but cannot execute its incomplete text", async () => {
  const h = await RepresentativeSession.create(), before = h.engine.serialize();
  assert.ok(catalog.cards[cardId]!.unsupportedMechanics.length > 0);
  assert.throws(() => compileContent(catalog, [cardId]));
  assert.ok(!Object.hasOwn(h.content.definitions, cardId));
  assert.equal(h.engine.serialize(), before); assert.equal(h.state.pendingEffects.length, 0); h.assertReplay();
});
