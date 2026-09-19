import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalController } from '../src/local/controller.ts';
import { fixtureOptions } from '../src/local/decks.ts';
import { RepresentativeSession } from '../examples/representative-session.ts';
import type { Intent, Rng } from '../src/game/model.ts';
import type { LegalAction } from '../src/game/client/index.ts';

const rng:Rng={algorithm:'fixture-ordered-v1',next(state,max){return {value:max-1,state:state+1};}};
function ready(c:LocalController){
 if(!c.getSnapshot().view)c.ready();
 const s=c.getSnapshot(); assert.ok(s.view); assert.equal(s.view.viewerId,s.requiredPlayerId);
 const other=s.view.playerOrder.find(id=>id!==s.view!.viewerId)!;
 assert.ok(s.view.players[other]!.zones.HAND.every(card=>card.hidden && !card.id && !card.name));
 return s;
}
function submit(c:LocalController,intent:Intent){
 const before=ready(c); const actor=before.requiredPlayerId;c.submit(intent);const after=c.getSnapshot();assert.equal(after.error,null);
 if(after.requiredPlayerId!==actor){assert.equal(after.view,null);assert.deepEqual(after.actions,[]);assert.equal(after.decision,null);}
}
function action(c:LocalController,match:(a:LegalAction)=>boolean){const a=ready(c).actions.find(a=>a.available && match(a));assert.ok(a,'Expected available action');submit(c,a.intent);}
function drain(c:LocalController){for(let n=0;n<100;n++){const s=ready(c);if(s.decision?.kind!=='EFFECT_ORDER')return;action(c,a=>a.intent.kind==='CHOOSE_EFFECT');}assert.fail('Effect budget');}
function card(c:LocalController,definitionId:string,zone:'HAND'|'FIELD'='HAND'){
 const s=ready(c),id=s.view!.players[s.requiredPlayerId]!.zones[zone].find(card=>card.definitionId===definitionId)?.id;assert.ok(id,definitionId);return id;
}
function restore(h:RepresentativeSession){const c=LocalController.restore(h.content,h.engine.serialize(),rng);assert.equal(c.getSnapshot().view,null);ready(c);return c;}
function finishContact(c:LocalController){for(let n=0;n<12;n++){drain(c);const s=ready(c);if(!s.decision)return;
 if(s.decision.kind==='GUARD')action(c,a=>a.intent.kind==='CHOOSE_GUARD' && a.intent.cardId===null);
 else if(s.decision.kind==='CONTACT_RESPONSE')action(c,a=>a.intent.kind==='RESPOND_CONTACT' && a.intent.response==='PASS');
 else assert.fail(`Unexpected ${s.decision.kind}`);
}assert.fail('Contact budget');}

test('local Next Hint offers optional hand play and intermediate choice restores privately',async()=>{
 const h=await RepresentativeSession.create(['F-ACTIVE','F-EVENT-DRAW']);const c=restore(h);
 action(c,a=>a.intent.kind==='NEXT_HINT');drain(c);assert.equal(ready(c).decision?.kind,'NEXT_HINT_CARD');
 const saved=c.exportSnapshot(),copy=LocalController.restore(h.content,saved,rng);assert.equal(copy.getSnapshot().view,null);
 ready(copy);assert.equal(copy.getSnapshot().decision?.kind,'NEXT_HINT_CARD');
 const event=card(copy,'F-EVENT-DRAW');action(copy,a=>a.intent.kind==='CHOOSE_NEXT_HINT_CARD' && a.intent.cardId===event);drain(copy);
 assert.ok(ready(copy).view!.players[h.first]!.zones.REMOVE.some(c=>c.id===event));
 action(c,a=>a.intent.kind==='CHOOSE_NEXT_HINT_CARD' && a.intent.cardId===null);drain(c);assert.equal(ready(c).decision,null);
});

test('local deduction hands off to Mislead owner and accepts their selected batch',async()=>{
 const h=await RepresentativeSession.create(['F-ACTIVE'],['F-MISLEAD']);const source=h.play('F-ACTIVE');h.drain();h.nextTurn();
 const mislead=h.play('F-MISLEAD');h.drain();h.nextTurn();const c=restore(h);
 action(c,a=>a.intent.kind==='DEDUCE' && a.intent.cardId===source);drain(c);
 const s=ready(c);assert.equal(s.requiredPlayerId,h.other);assert.equal(s.decision?.mode,'MULTI_SELECT');assert.equal(s.decision?.kind,'MISLEAD');
 assert.ok(s.decision.candidates.some(c=>c.id===mislead));submit(c,{kind:'CHOOSE_MISLEAD',choiceId:s.decision.id,cardIds:[mislead]});drain(c);
 assert.equal(ready(c).view!.players[h.other]!.zones.FIELD.find(c=>c.id===mislead)?.orientation,'SLEEP');
});

test('local simultaneous effect order, Action, Contact and Cut-in cross private owners',async()=>{
 const h=await RepresentativeSession.create(['F-COMBO-REACT','F-COMBO-ENTER','F-COMBO-CUT'],['F-REMOVE-DRAW']);
 h.play('F-COMBO-REACT');h.drain();h.nextTurn();const defender=h.play('F-REMOVE-DRAW');h.drain();h.submit({kind:'DEDUCE',cardId:defender});h.drain();h.nextTurn();
 const c=restore(h),entrant=card(c,'F-COMBO-ENTER');action(c,a=>a.intent.kind==='PLAY_CARD' && a.intent.cardId===entrant);
 assert.equal(ready(c).decision?.kind,'EFFECT_ORDER');assert.equal(ready(c).actions.filter(a=>a.available).length,2);drain(c);
 action(c,a=>a.intent.kind==='DECLARE_ACTION' && a.sourceId===entrant && a.targetId===defender);drain(c);
 assert.equal(ready(c).requiredPlayerId,h.other);assert.equal(ready(c).decision?.kind,'CONTACT_RESPONSE');
 action(c,a=>a.intent.kind==='RESPOND_CONTACT' && a.intent.response==='PASS');drain(c);
 assert.equal(ready(c).requiredPlayerId,h.first);action(c,a=>a.intent.kind==='RESPOND_CONTACT' && a.intent.response==='CUT_IN');drain(c);finishContact(c);
 assert.ok(ready(c).view!.players[h.other]!.zones.REMOVE.some(c=>c.id===defender));
 assert.ok(ready(c).view!.events.some(e=>e.type==='CUT_IN_USED'));
});

test('local Guard and Contact choices are projected to their actual owners',async()=>{
 const h=await RepresentativeSession.create(['F-ACTIVE'],['F-ACTIVE']);const guard=h.play('F-ACTIVE');h.drain();
 h.submit({kind:'DEDUCE',cardId:h.state.players[h.first]!.partnerId});h.drain();h.nextTurn();const attacker=h.play('F-ACTIVE');h.drain();
 const c=restore(h);action(c,a=>a.intent.kind==='DECLARE_ACTION' && a.sourceId===attacker && a.intent.target.kind==='CASE');drain(c);
 assert.equal(ready(c).decision?.kind,'GUARD');assert.equal(ready(c).requiredPlayerId,h.first);
 action(c,a=>a.intent.kind==='CHOOSE_GUARD' && a.intent.cardId===guard);finishContact(c);
 assert.ok(ready(c).view!.events.some(e=>e.type==='GUARD_DECLARED'));
});

test('local Disguise replaces visible field card and retains attachment counts',async()=>{
 const h=await RepresentativeSession.create(['F-COMBO-ENTER','F-DISGUISE'],['F-ACTIVE']);const old=h.play('F-COMBO-ENTER');h.drain();
 h.submit({kind:'DEDUCE',cardId:old});h.drain();h.nextTurn();const attacker=h.play('F-ACTIVE');h.drain();
 const c=restore(h);action(c,a=>a.intent.kind==='DECLARE_ACTION' && a.sourceId===attacker && a.targetId===old);drain(c);
 action(c,a=>a.intent.kind==='RESPOND_CONTACT' && a.intent.response==='PASS');drain(c);const replacement=card(c,'F-DISGUISE');
 action(c,a=>a.intent.kind==='RESPOND_CONTACT' && a.intent.response==='DISGUISE' && a.intent.cardId===replacement);drain(c);finishContact(c);
 const changed=ready(c).view!.players[h.first]!.zones.FIELD.find(c=>c.id===replacement);assert.ok(changed);assert.equal(changed.setCount,1);assert.equal(changed.underCount,1);
 assert.equal(JSON.stringify(ready(c)).includes(old),false);
});

test('local unsupported FILE Partner deduction displays RQ without changing state',async()=>{
 const h=await RepresentativeSession.create();const c=restore(h);action(c,a=>a.intent.kind==='ASSIST');drain(c);
 const unsupported=ready(c).actions.find(a=>a.intent.kind==='DEDUCE' && a.code==='RULE_QUESTION_025');assert.ok(unsupported);assert.equal(unsupported.available,false);
 const before=c.exportSnapshot();c.submit(unsupported.intent);assert.equal(c.exportSnapshot(),before);assert.match(c.getSnapshot().error!,/RQ-025/);
});

test('local restore resumes an intermediate automatic frame before exposing an actionable view',async()=>{
 const h=await RepresentativeSession.create();h.submit({kind:'END_MAIN'});
 assert.ok(h.state.frames.length>0);assert.equal(h.state.choice,null);
 const c=LocalController.restore(h.content,h.engine.serialize(),rng);assert.equal(c.getSnapshot().view,null);
 c.ready();if(!c.getSnapshot().view)c.ready();
 const s=ready(c);assert.equal(s.requiredPlayerId,h.other);assert.equal(s.view!.turn.phase,'MAIN');assert.ok(s.actions.some(a=>a.available));
});

test('local investigation orders public revealed cards then removes their identities from views',async()=>{
 const h=await RepresentativeSession.create(['F-INVESTIGATE']);h.play('F-INVESTIGATE');h.drain();const c=restore(h);
 action(c,a=>a.intent.kind==='DECLARE_ABILITY' && a.intent.abilityId==='investigate');drain(c);
 const d=ready(c).decision!;assert.equal(d.mode,'ORDERED');assert.equal(d.kind,'INVESTIGATION_ORDER');assert.equal(d.playerId,h.other);
 const ids=d.candidates.map(candidate=>candidate.id);assert.equal(ids.length,3);
 for(const id of ids)assert.ok(JSON.stringify(ready(c).view).includes(id));
 submit(c,{kind:'CHOOSE_INVESTIGATION_ORDER',choiceId:d.id,cardIds:ids.reverse()});drain(c);
 for(const id of ids)assert.equal(JSON.stringify(ready(c)).includes(id),false);
});

test('local full 40-card match runs Setup, Mulligan, turns and normal Deck Loss',async()=>{
 const h=await RepresentativeSession.create();const c=LocalController.create(h.content,fixtureOptions(42));let turns=0;
 for(let n=0;n<180 && c.getSnapshot().status!=='FINISHED';n++){
   const s=ready(c);assert.notEqual(s.status,'RULE_BLOCKED');
   if(s.decision?.kind==='MULLIGAN')submit(c,{kind:'MULLIGAN',choiceId:s.decision.id,cardIds:[]});
   else if(s.decision?.kind==='EFFECT_ORDER')action(c,a=>a.intent.kind==='CHOOSE_EFFECT');
   else {assert.equal(s.decision,null);action(c,a=>a.intent.kind==='END_MAIN');turns++;}
 }
 assert.equal(c.getSnapshot().status,'FINISHED');const s=ready(c);assert.equal(s.view!.outcome?.reason,'EMPTY_DECK');assert.ok(turns>10);
 assert.ok(s.view!.events.some(e=>e.type==='MULLIGAN_COMPLETED'));
});
