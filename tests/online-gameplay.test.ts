import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixtures.ts';
import { coreProgram } from '../examples/programs.ts';
import { online, available, mulligans } from './online-fixtures.ts';

test('real websocket multi-turn deduction/action/guard/contact/cut-in and resume continue privately',async()=>{
 const {content,options}=fixture();
 for(const d of Object.values(content.definitions))if(d.type==='CHARACTER')d.cutIns=[{abilityId:'draw-two',programId:'draw'}];
 const game=await online({content,matchOptions:()=>options});
 try{
 await mulligans(game,true);
 for(let turn=0;turn<2;turn++){
  await game.submit(available(game,'PLAY_CARD'));
  const actor=game.actor(),before=game.packets[actor]!.view.players[actor]!.zones.EVIDENCE.length;
  const command=await game.submit(available(game,'DEDUCE'));await game.duplicate(command,actor);
  assert.equal(game.packets[actor]!.view.players[actor]!.zones.EVIDENCE.length,before+2);
  await game.submit({kind:'END_MAIN'});
 }
 assert.equal(game.packets.A!.view.turn.number,3);
 const attacker=game.actor();await game.submit(available(game,'DECLARE_ACTION'));
 const defender=game.actor(),decision=game.packets[defender]!.decision!;
 assert.equal(decision.kind,'GUARD');
 const guard=game.packets[defender]!.legalActions.find(a=>a.available&&a.intent.kind==='CHOOSE_GUARD'&&a.intent.cardId!==null)!;assert(guard);
 const fresh=game.packets[defender]!;
 const wrong={type:'RESOLVE_DECISION' as const,commandId:'wrong-owner-fresh',matchId:fresh.matchId,expectedVersion:fresh.stateVersion,payload:guard.intent};
 game.peers[attacker as 'A'|'B'].send(wrong);assert.equal((await game.peers[attacker as 'A'|'B'].wait('COMMAND_REJECTED')).code,'NOT_DECISION_OWNER');
 game.peers[defender as 'A'|'B'].send({...wrong,commandId:'old-choice-fresh',payload:{kind:'CHOOSE_GUARD',choiceId:'old-choice',cardId:null}});
 assert.equal((await game.peers[defender as 'A'|'B'].wait('COMMAND_REJECTED')).code,'STALE_DECISION');
 const guardCommand=await game.submit(guard.intent,defender,'RESOLVE_DECISION');await game.duplicate(guardCommand,defender);
 assert.equal(game.packets.A!.decision!.kind,'CONTACT_RESPONSE');
 const responder=game.actor(),cut=game.packets[responder]!.legalActions.find(a=>a.available&&a.intent.kind==='RESPOND_CONTACT'&&a.intent.response==='CUT_IN')!;assert(cut);
 const cutCommand=await game.submit(cut.intent,responder,'RESOLVE_DECISION');await game.duplicate(cutCommand,responder);
 let passes=0;
 while(game.packets.A!.decision){assert(passes++<4);await game.submit(available(game,'RESPOND_CONTACT'));}
 assert(game.packets.A!.view.events.some(e=>e.type==='CUT_IN_USED'));
 assert(game.packets.A!.view.events.some(e=>e.type==='CONTACT_ENDED'));
 await game.resume(attacker as 'A'|'B');
 await game.submit({kind:'ASSIST'});
 const packet=game.packets[attacker]!,before=game.server.manager.inspectMatch(packet.matchId);
 game.peers[attacker as 'A'|'B'].send({type:'GAME_COMMAND',commandId:'unsupported-file-partner',matchId:packet.matchId,expectedVersion:packet.stateVersion,payload:{kind:'DEDUCE',cardId:packet.view.players[attacker]!.zones.FILE.find(c=>c.type==='PARTNER')!.id!}});
 assert.equal((await game.peers[attacker as 'A'|'B'].wait('COMMAND_REJECTED')).code,'RULE_QUESTION_025');
 assert.equal((await game.peers[attacker as 'A'|'B'].wait('RULE_BLOCKED')).questionId,'RULE_QUESTION_025');
 assert.deepEqual(game.server.manager.inspectMatch(packet.matchId),before);
 await game.submit({kind:'END_MAIN'});assert.equal(game.packets.A!.view.turn.number,4);game.privacy();
 }finally{await game.close()}
});

test('real websocket complete match broadcasts empty-deck result and immutable finished result',async()=>{
 const {content,options}=fixture(),game=await online({content,matchOptions:()=>options});
 try{
 await mulligans(game);
 for(let turn=0;turn<30&&game.packets.A!.view.status!=='FINISHED';turn++){
  const actor=game.actor(),p=game.packets[actor]!,player=p.view.players[actor]!;
  if(player.chapter==='RESOLUTION'&&player.zones.EVIDENCE.length>=3){await game.submit(available(game,'SOLVE_CASE'));break;}
  await game.submit(available(game,'DEDUCE'));if(game.server.manager.inspectMatch(game.packets.A!.matchId)!.state.status!=='FINISHED')await game.submit({kind:'END_MAIN'});
 }
 assert.equal(game.packets.A!.view.status,'FINISHED');assert.equal(game.packets.B!.view.status,'FINISHED');
 const a=await game.peers.A.wait('GAME_FINISHED'),b=await game.peers.B.wait('GAME_FINISHED');assert.deepEqual(a,b);assert.equal(a.outcome.reason,'EMPTY_DECK');
 const before=game.server.manager.inspectMatch(a.matchId);game.peers.A.send({type:'GAME_COMMAND',commandId:'after-finish',matchId:a.matchId,expectedVersion:a.stateVersion,payload:{kind:'END_MAIN'}});
 assert.equal((await game.peers.A.wait('COMMAND_REJECTED')).code,'MATCH_FINISHED');assert.deepEqual(game.server.manager.inspectMatch(a.matchId),before);
 }finally{await game.close()}
});

for(const rule of ['012','014'] as const)test(`real websocket legal source departure preserves RULE_BLOCKED ${rule}`,async()=>{
 const {content,options}=fixture();
 content.programs.depart=coreProgram(rule==='012'?[{op:'REMOVE_SOURCE'}]:[{op:'REMOVE_SOURCE'},{op:'SET_SOURCE_STATE',state:'SLEEP'}]);
 for(const d of Object.values(content.definitions))if(d.type==='CHARACTER'){
  d.keywords=[{kind:'RAPID'}];d.triggers=[{event:'DEDUCTION_DECLARED',player:'SELF',subject:'SOURCE',programId:'depart'}];
 }
 const game=await online({content,matchOptions:()=>options});
 try{
 await mulligans(game);const actor=game.actor();await game.submit(available(game,'PLAY_CARD'));
 const card=game.packets[actor]!.view.players[actor]!.zones.FIELD[0]!;
 await game.submit({kind:'DEDUCE',cardId:card.id!});
 while(game.packets.A!.decision?.kind==='EFFECT_ORDER')await game.submit(available(game,'CHOOSE_EFFECT'),game.actor(),'RESOLVE_DECISION');
 assert.equal(game.packets.A!.view.status,'RULE_BLOCKED');assert.equal(game.packets.B!.view.status,'RULE_BLOCKED');
 assert.equal(game.packets.A!.view.blocked?.questionId,`RULE-QUESTION-${rule}`);
 for(const peer of [game.peers.A,game.peers.B])assert.equal((await peer.wait('RULE_BLOCKED')).questionId,`RULE-QUESTION-${rule}`);
 assert.equal(game.packets.A!.view.outcome,null);assert.equal(game.packets.B!.view.outcome,null);game.privacy();
 }finally{await game.close()}
});



test('real websocket case solved outcome follows legal fixture effects and later turn',async()=>{
 const {content,options}=fixture();
 content.programs.prepare=coreProgram([{op:'ADD_FILE',player:'SELF',count:6},{op:'GAIN_EVIDENCE',player:'SELF',count:3}]);
 for(const d of Object.values(content.definitions))if(d.type==='CHARACTER')d.triggers=[{event:'CHARACTER_ENTERED',player:'SELF',subject:'SOURCE',programId:'prepare'}];
 const game=await online({content,matchOptions:()=>options});
 try{
 await mulligans(game);const winner=game.actor();await game.submit(available(game,'PLAY_CARD'));
 while(game.packets.A!.decision?.kind==='EFFECT_ORDER')await game.submit(available(game,'CHOOSE_EFFECT'));
 await game.submit({kind:'ASSIST'});assert.equal(game.packets[winner]!.view.players[winner]!.chapter,'RESOLUTION');
 await game.submit({kind:'END_MAIN'});await game.submit({kind:'END_MAIN'});
 const command=await game.submit(available(game,'SOLVE_CASE'));await game.duplicate(command,winner);
 for(const peer of [game.peers.A,game.peers.B]){
  const result=await peer.wait('GAME_FINISHED');assert.equal(result.outcome.reason,'CASE_SOLVED');assert.equal(result.outcome.winnerId,winner);
 }
 assert.equal(game.packets.A!.view.status,'FINISHED');assert.equal(game.packets.B!.view.status,'FINISHED');game.privacy();
 }finally{await game.close()}
});
