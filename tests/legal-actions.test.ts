import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/index.ts';
import { fixture, main } from './fixtures.ts';
import { getLegalActions,getPendingDecision } from '../src/game/client/index.ts';
import { arena, effects, ok } from './phase2-fixtures.ts';
import { explicit } from './phase3a-fixtures.ts';
test('candidate preview agrees with dispatch and leaves serialization unchanged',()=>{
 const engine=main(); const content=fixture().content; const before=engine.serialize(); const actor=engine.getState().turn.playerId;
 const actions=getLegalActions(engine,content,actor); assert.ok(actions.length>3);
 for(const action of actions) assert.equal(engine.preview(actor,action.intent).accepted,action.available);
 assert.equal(engine.serialize(),before);
});
test('partner deduction is surfaced and FILE partner uses actual RQ025 rejection',()=>{
 const engine=main(),content=fixture().content,actor=engine.getState().turn.playerId;
 const partner=engine.getState().players[actor]!.partnerId;
 assert.ok(getLegalActions(engine,content,actor).some(a=>a.intent.kind==='DEDUCE' && a.sourceId===partner && a.available));
 ok(engine,{kind:'ASSIST'}); engine.runUntilDecision();
 const action=getLegalActions(engine,content,actor).find(a=>a.intent.kind==='DEDUCE' && a.sourceId===partner)!;
 assert.equal(action.available,false);assert.equal(action.code,'RULE_QUESTION_025');assert.equal(action.category,'UnsupportedRule');
});
test('Mislead is a user-selected batch validated by preview',()=>{
 const a=arena();const source=a.add();const defender=a.add(a.other,{keywords:[{kind:'MISLEAD_X',value:1}]});
 const engine=a.resume();ok(engine,{kind:'DEDUCE',cardId:source});effects(engine);
 const decision=getPendingDecision(engine,a.content,a.other)!; assert.equal(decision.mode,'MULTI_SELECT');
 assert.ok(decision.candidates.some(c=>c.id===defender));
 const template=decision.submitIntent!;assert.ok('cardIds' in template);
 assert.equal(engine.preview(a.other,{...template,cardIds:[defender]}).accepted,true);
 assert.equal(engine.preview(a.other,{...template,cardIds:[defender,defender]}).accepted,false);
});
test('investigation is ordered and only owner gets candidate payload',()=>{
 const a=arena();a.content.programs.investigate=explicit([{op:'INVOKE_KEYWORD',keyword:'INVESTIGATE_X'}]);
 a.add(a.turn,{keywords:[{kind:'INVESTIGATE_X',value:3}],triggers:[{event:'TURN_END',player:'SELF',programId:'investigate'}]});
 const engine=a.resume();ok(engine,{kind:'END_MAIN'});effects(engine);
 const decision=getPendingDecision(engine,a.content,a.other)!;assert.equal(decision.mode,'ORDERED');assert.equal(decision.candidates.length,3);
 assert.equal(engine.preview(a.other,decision.submitIntent!).accepted,true);
 assert.equal(getPendingDecision(engine,a.content,a.turn)!.mode,'WAITING');
});
test('mulligan exposes structured selection only to its owner',()=>{
 const {options,content}=fixture(); const engine=GameEngine.create(options,content); const state=engine.getState(); const owner=state.choice!.playerId;
 const own=getPendingDecision(engine,content,owner)!; assert.equal(own.mode,'MULTI_SELECT'); assert.equal(own.candidates.length,state.players[owner]!.zones.HAND.length);
 const other=state.playerOrder.find(id=>id!==owner)!;
 assert.deepEqual(getPendingDecision(engine,content,other)!.candidates,[]); assert.deepEqual(getLegalActions(engine,content,other),[]);
});
