import assert from "node:assert/strict";
import { RepresentativeSession } from "./representative-session.ts";

export async function entryContactCombo(): Promise<RepresentativeSession> {
  const h = await RepresentativeSession.create(["F-COMBO-REACT", "F-COMBO-ENTER", "F-COMBO-CUT"], ["F-REMOVE-DRAW"]);
  const observer = h.play("F-COMBO-REACT"); h.drain(); h.nextTurn();
  const defender = h.play("F-REMOVE-DRAW"); h.drain();
  h.submit({ kind: "DEDUCE", cardId: defender }); h.drain(); h.nextTurn();
  const before = h.state, entrant = h.play("F-COMBO-ENTER");
  assert.deepEqual(h.state.pendingEffects.map(e => e.sourceId), [observer, entrant]);
  assert.equal(h.state.players[h.first]!.zones.SET.length, 0);
  h.settle(); const choice = h.state.choice!;
  assert.equal(choice.kind, "EFFECT_ORDER");
  const entrantEffect = h.state.pendingEffects.find(e => e.sourceId === entrant)!;
  h.submit({ kind: "CHOOSE_EFFECT", choiceId: choice.id, effectId: entrantEffect.id }); h.settle();
  // A whole program finishes before the observer's ordinary pending effect.
  assert.equal(h.state.choice?.kind, "EFFECT_ORDER");
  assert.equal(h.state.players[h.first]!.zones.HAND.length, before.players[h.first]!.zones.HAND.length);
  assert.equal(h.state.players[h.first]!.zones.SET.length, 1);
  assert.equal(h.state.players[h.first]!.zones.UNDER.length, 1);
  const emitted = h.state.events.slice(before.events.length);
  const draw = emitted.find(e => e.type === "CARD_DRAWN")!;
  const set = emitted.find(e => e.type === "CARD_MOVED" && e.detail === "DECK>SET")!;
  const under = emitted.find(e => e.type === "CARD_MOVED" && e.detail === "DECK>UNDER")!;
  const modifier = emitted.find(e => e.type === "MODIFIER_ADDED")!;
  assert.ok(draw.sequence < set.sequence && set.sequence < under.sequence && under.sequence < modifier.sequence);
  h.drain(); assert.equal(h.state.players[h.first]!.zones.HAND.length, before.players[h.first]!.zones.HAND.length + 1);
  h.submit({ kind: "DECLARE_ACTION", cardId: entrant, target: { kind: "CHARACTER", cardId: defender } }); h.drain();
  assert.equal(h.state.choice?.playerId, h.other);
  h.submit({ kind: "RESPOND_CONTACT", choiceId: h.state.choice!.id, response: "PASS" }); h.drain();
  const cut = h.hand("F-COMBO-CUT");
  h.submit({ kind: "RESPOND_CONTACT", choiceId: h.state.choice!.id, response: "CUT_IN", cardId: cut, abilityId: "draw-boost" }); h.drain();
  assert.equal(Object.keys(h.state.modifiers).length, 3); h.finishContact();
  assert.ok(h.state.players[h.other]!.zones.REMOVE.includes(defender));
  assert.equal(Object.keys(h.state.modifiers).length, 1);
  assert.equal(Object.values(h.state.modifiers)[0]!.duration, "UNTIL_TURN_END");
  assert.ok(h.state.events.some(e => e.type === "EFFECT_RESOLVED" && e.cardId === defender));
  h.nextTurn(); assert.equal(Object.keys(h.state.modifiers).length, 0);
  h.assertReplay(); return h;
}

export async function disguiseCombo(): Promise<RepresentativeSession> {
  const h = await RepresentativeSession.create(["F-COMBO-ENTER", "F-DISGUISE"], ["F-ACTIVE"]);
  const old = h.play("F-COMBO-ENTER"); h.drain(); h.submit({ kind: "DEDUCE", cardId: old }); h.drain(); h.nextTurn();
  assert.equal(Object.keys(h.state.modifiers).length, 0);
  const attacker = h.play("F-ACTIVE"); h.drain();
  h.submit({ kind: "DECLARE_ACTION", cardId: attacker, target: { kind: "CHARACTER", cardId: old } }); h.drain();
  assert.equal(h.state.choice?.playerId, h.other);
  h.submit({ kind: "RESPOND_CONTACT", choiceId: h.state.choice!.id, response: "PASS" }); h.drain();
  const replacement = h.hand("F-DISGUISE", h.first), before = h.state, previousEntry = before.cards[old]!.entryId!;
  assert.equal(Object.keys(before.modifiers).length, 1);
  h.submit({ kind: "RESPOND_CONTACT", choiceId: h.state.choice!.id, response: "DISGUISE", cardId: replacement }); h.drain();
  const entry = h.state.cards[replacement]!.entryId!;
  assert.notEqual(entry, previousEntry); assert.equal(h.state.entries[entry]!.previousEntryId, previousEntry);
  assert.equal(h.state.cards[replacement]!.orientation, "SLEEP");
  assert.equal(Object.values(h.state.modifiers)[0]!.targetEntryId, entry);
  for (const id of [...before.players[h.first]!.zones.SET, ...before.players[h.first]!.zones.UNDER]) assert.equal(h.state.cards[id]!.attachment?.hostEntryId, entry);
  assert.ok(!h.state.events.some(e => e.type === "CHARACTER_ENTERED" && e.cardId === replacement));
  assert.equal(h.state.players[h.first]!.zones.DECK.at(-1), old);
  h.reject({ kind: "RESPOND_CONTACT", choiceId: h.state.choice!.id, response: "DISGUISE", cardId: replacement }, h.first);
  h.finishContact();
  assert.ok(h.state.players[h.first]!.zones.FIELD.includes(replacement));
  assert.equal(Object.keys(h.state.modifiers).length, 0);
  assert.equal(h.state.players[h.first]!.zones.SET.length + h.state.players[h.first]!.zones.UNDER.length, 2);
  h.assertReplay(); return h;
}

export async function mrCombo(): Promise<RepresentativeSession> {
  const h = await RepresentativeSession.create(["F-MR", "F-MR"], ["F-AP-BOOST"]);
  const old = h.play("F-MR"); h.drain(); h.submit({ kind: "DEDUCE", cardId: old }); h.drain(); h.nextTurn();
  const attacker = h.play("F-AP-BOOST"); h.drain();
  h.submit({ kind: "DECLARE_ABILITY", cardId: attacker, abilityId: "boost" }); h.drain();
  h.submit({ kind: "DECLARE_ACTION", cardId: attacker, target: { kind: "CHARACTER", cardId: old } }); h.finishContact();
  assert.deepEqual(h.state.events.filter(e => e.type === "CARD_MOVED" && e.cardId === old).map(e => e.detail), ["DECK>HAND", "HAND>FIELD", "FIELD>REMOVE", "REMOVE>PARTNER"]);
  assert.ok(h.state.players[h.first]!.zones.PARTNER.includes(old));
  h.nextTurn();
  h.reject({ kind: "DEDUCE", cardId: old });
  h.reject({ kind: "DECLARE_ACTION", cardId: old, target: { kind: "CHARACTER", cardId: attacker } });
  const hand = h.state.players[h.first]!.zones.HAND.length;
  h.submit({ kind: "DECLARE_ABILITY", cardId: old, abilityId: "partner-draw" }); h.drain();
  assert.equal(h.state.players[h.first]!.zones.HAND.length, hand + 1);
  const fresh = h.play("F-MR"); h.drain();
  assert.notEqual(fresh, old); assert.ok(h.state.players[h.first]!.zones.REMOVE.includes(old));
  assert.deepEqual(h.state.players[h.first]!.zones.PARTNER, [h.state.players[h.first]!.partnerId]);
  assert.ok(h.state.players[h.first]!.zones.FIELD.includes(fresh));
  h.assertReplay(); return h;
}

export async function traceRefreshCombo(): Promise<RepresentativeSession> {
  const h = await RepresentativeSession.create(["F-TRACE"], ["F-ACTIVATED-DRAW", "F-EVENT-DRAW"]);
  const trace = h.play("F-TRACE"); h.drain(); h.nextTurn();
  const drawer = h.play("F-ACTIVATED-DRAW"); h.drain();
  h.submit({ kind: "NEXT_HINT" }); h.drain();
  h.submit({ kind: "CHOOSE_NEXT_HINT_CARD", choiceId: h.state.choice!.id, cardId: h.hand("F-EVENT-DRAW") }); h.drain();
  assert.equal(h.state.players[h.other]!.zones.REMOVE.length, 1);
  for (let n = 0; !h.state.players[h.first]!.traceDiscovered; n++) {
    assert.ok(n < 40, "Expected one bounded Refresh");
    h.submit({ kind: "DECLARE_ABILITY", cardId: drawer, abilityId: "draw" }); h.drain();
  }
  assert.equal(h.state.players[h.other]!.traceDiscovered, false);
  assert.equal(h.state.events.filter(e => e.type === "REFRESHED" && e.playerId === h.other).length, 1);
  h.nextTurn(); const before = h.state.players[h.first]!.zones.HAND.length;
  h.submit({ kind: "DECLARE_ABILITY", cardId: trace, abilityId: "trace" }); h.drain();
  assert.equal(h.state.players[h.first]!.zones.HAND.length, before + 1);
  assert.ok(h.state.players[h.first]!.traceDiscovered);
  h.assertReplay(); return h;
}
