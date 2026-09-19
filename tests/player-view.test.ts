import test from 'node:test';
import assert from 'node:assert/strict';
import { main, fixture, mutable } from './fixtures.ts';
import { projectGameState } from '../src/game/client/index.ts';
import { arena, effects, ok } from './phase2-fixtures.ts';
import { explicit } from './phase3a-fixtures.ts';
test('player projection excludes all private identities including event details and frames', () => {
 const state = mutable(main()); const viewer = state.playerOrder[0];
 const hidden = state.players[state.playerOrder[1]]!.zones.HAND[0]!;
 state.events.push({sequence:999,type:'CARD_DRAWN',playerId:state.playerOrder[1],cardId:hidden,detail:JSON.stringify({secret:hidden}),cause:hidden});
 state.frames.push({kind:'FINISH_EVENT',playerId:state.playerOrder[1],cardId:hidden});
 const view = projectGameState(state,viewer,fixture().content);
 assert.equal(JSON.stringify(view).includes(hidden),false);
 assert.equal(JSON.stringify(view).includes(state.players[viewer]!.zones.HAND[0]!),true);
 state.cards[hidden]!.face='UP';
 assert.equal(JSON.stringify(projectGameState(state,viewer,fixture().content)).includes(hidden),true);
});
test('every concealed zone excludes IDs and definitions, including own FILE and evidence',()=>{
 const state=mutable(main());const viewer=state.playerOrder[0];const content=fixture().content;
 for(const owner of state.playerOrder)for(const zone of ['DECK','FILE','EVIDENCE','SET','UNDER'] as const){
   const id=state.players[owner]!.zones.DECK.pop()!;state.players[owner]!.zones[zone].push(id);state.cards[id]!.face='DOWN';
   const key=`secret-definition-${owner}-${zone}`;content.definitions[key]={...content.definitions[state.cards[id]!.definitionId]!,definitionId:key,name:key};state.cards[id]!.definitionId=key;
   const serialized=JSON.stringify(projectGameState(state,viewer,content));assert.equal(serialized.includes(id),false);assert.equal(serialized.includes(key),false);
 }
});
test('investigate reveal appears publicly and disappears after cards return face down',()=>{
 const a=arena();a.content.programs.investigate=explicit([{op:'INVOKE_KEYWORD',keyword:'INVESTIGATE_X'}]);
 a.add(a.turn,{keywords:[{kind:'INVESTIGATE_X',value:3}],triggers:[{event:'TURN_END',player:'SELF',programId:'investigate'}]});
 const engine=a.resume();ok(engine,{kind:'END_MAIN'});effects(engine);const choice=engine.getState().choice!;
 assert.equal(choice.kind,'INVESTIGATION_ORDER');if(choice.kind!=='INVESTIGATION_ORDER')assert.fail();
 for(const viewer of [a.turn,a.other])for(const id of choice.candidates)assert.equal(JSON.stringify(projectGameState(engine.getState(),viewer,a.content)).includes(id),true);
 ok(engine,{kind:'CHOOSE_INVESTIGATION_ORDER',choiceId:choice.id,cardIds:[...choice.candidates]});
 for(const viewer of [a.turn,a.other])for(const id of choice.candidates)assert.equal(JSON.stringify(projectGameState(engine.getState(),viewer,a.content)).includes(id),false);
});
