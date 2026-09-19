import test from 'node:test';
import assert from 'node:assert/strict';
import { ClientMessageSchema, ServerMessageSchema, IntentSchema } from '../packages/protocol/index.ts';
import { main, fixture } from './fixtures.ts';
import { projectGameState } from '../src/game/client/index.ts';
const command={type:'GAME_COMMAND',commandId:'c',matchId:'m',expectedVersion:0,payload:{kind:'END_MAIN'}};
test('protocol accepts fixed client envelopes and rejects spoofed authority',()=>{
 assert.equal(ClientMessageSchema.safeParse(command).success,true);
 for(const extra of [{playerId:'B'},{state:{}},{seed:1},{version:1}])assert.equal(ClientMessageSchema.safeParse({...command,...extra}).success,false);
 assert.equal(ClientMessageSchema.safeParse({...command,payload:{kind:'END_MAIN',playerId:'B'}}).success,false);
 assert.equal(ClientMessageSchema.safeParse({...command,expectedVersion:-1}).success,false);
});
test('protocol rejects unknown intents and nested targets',()=>{
 assert.equal(IntentSchema.safeParse({kind:'IMPORT_STATE',state:{}}).success,false);
 assert.equal(IntentSchema.safeParse({kind:'DECLARE_ACTION',cardId:'a',target:{kind:'CASE',cardId:'b',state:{}}}).success,false);
 assert.equal(IntentSchema.safeParse({kind:'RESPOND_CONTACT',choiceId:'x',response:'PASS',cardId:'secret'}).success,false);
});
test('protocol accepts actual projection but rejects arbitrary state and hidden identity recursively',()=>{
 const state=main().getState();const view=projectGameState(state,state.playerOrder[0],fixture().content);
 const message={type:'GAME_VIEW',packet:{matchId:'m',stateVersion:0,view,legalActions:[],decision:null}};
 assert.equal(ServerMessageSchema.safeParse(message).success,true);
 assert.equal(ServerMessageSchema.safeParse({...message,packet:{...message.packet,view:{...view,rng:{}}}}).success,false);
 const altered=structuredClone(message);Object.values(altered.packet.view.players)[0]!.zones.DECK[0]={hidden:true,id:'secret'};
 assert.equal(ServerMessageSchema.safeParse(altered).success,false);
});
test('waiting decision cannot transmit private candidates or actions',()=>{
 const message={type:'PENDING_DECISION',matchId:'m',stateVersion:0,decision:{id:'d',kind:'MULLIGAN',playerId:'B',mode:'WAITING',candidates:[],actions:[]}};
 assert.equal(ServerMessageSchema.safeParse(message).success,true);
 assert.equal(ServerMessageSchema.safeParse({...message,decision:{...message.decision,candidates:[{id:'secret',label:'secret'}]}}).success,false);
});
const intents=[
 ...['ASSIST','SOLVE_CASE','END_MAIN','NEXT_HINT'].map(kind=>({kind})),
 ...['PLAY_CARD','DEDUCE'].map(kind=>({kind,cardId:'c'})),
 ...['MULLIGAN','CHOOSE_MISLEAD','CHOOSE_INVESTIGATION_ORDER'].map(kind=>({kind,choiceId:'d',cardIds:['c']})),
 {kind:'CHOOSE_EFFECT',choiceId:'d',effectId:'e'},
 ...['CHOOSE_NEXT_HINT_CARD','CHOOSE_GUARD'].map(kind=>({kind,choiceId:'d',cardId:null})),
 {kind:'CHOOSE_SWITCH',choiceId:'d',cardId:'c'},
 {kind:'DECLARE_ACTION',cardId:'c',target:{kind:'CASE',cardId:'t'}},
 {kind:'DECLARE_ABILITY',cardId:'c',abilityId:'a'},
 {kind:'RESPOND_CONTACT',choiceId:'d',response:'PASS'},
 {kind:'RESPOND_CONTACT',choiceId:'d',response:'CUT_IN',cardId:'c',abilityId:'a'},
 {kind:'RESPOND_CONTACT',choiceId:'d',response:'DISGUISE',cardId:'c'},
];
for(const intent of intents)test(`intent roundtrip ${intent.kind} ${'response' in intent?intent.response:''}`,()=>{
 assert.deepEqual(IntentSchema.parse(intent),intent);
 assert.equal(IntentSchema.safeParse({...intent,state:{}}).success,false);
 for(const type of ['GAME_COMMAND','RESOLVE_DECISION','MULLIGAN'])assert.equal(ClientMessageSchema.safeParse({...command,type,payload:intent}).success,true);
});
const room={roomCode:'ABCDEF',status:'WAITING',seats:[{playerId:'A',occupied:true,ready:false,connected:true,deck:'Fixture Deck A'}],matchId:null};
const serverSamples=[
 {type:'SESSION',playerSessionId:'s',resumeToken:'t'}, {type:'ROOM_STATE',room},
 {type:'COMMAND_ACCEPTED',commandId:'c',matchId:'m',stateVersion:0,duplicate:false},
 {type:'COMMAND_REJECTED',commandId:null,code:'INVALID',message:'Invalid',stateVersion:null},
 {type:'PENDING_DECISION',matchId:'m',stateVersion:0,decision:null},
 ...['PLAYER_CONNECTED','PLAYER_DISCONNECTED'].map(type=>({type,playerId:'A',matchId:null})),
 {type:'RULE_BLOCKED',matchId:'m',stateVersion:0,questionId:'RQ-002'},
 {type:'GAME_FINISHED',matchId:'m',stateVersion:0,outcome:{winnerId:'A',loserId:'B',reason:'EMPTY_DECK'}},
];
for(const message of serverSamples)test(`server roundtrip ${message.type}`,()=>{
 assert.deepEqual(ServerMessageSchema.parse(message),message);
 assert.equal(ServerMessageSchema.safeParse({...message,gameState:{}}).success,false);
 const missing={...message} as Record<string,unknown>;delete missing[Object.keys(message)[1]!];assert.equal(ServerMessageSchema.safeParse(missing).success,false);
});
for(const message of [{type:'CREATE_ROOM'},{type:'JOIN_ROOM',roomCode:'ABC'},{type:'READY'},{type:'LEAVE_ROOM'},{type:'RESUME_MATCH',playerSessionId:'s',resumeToken:'t'},{type:'RESYNC',matchId:'m'}])test(`client roundtrip ${message.type}`,()=>{
 assert.deepEqual(ClientMessageSchema.parse(message),message);
 assert.equal(ClientMessageSchema.safeParse({...message,playerId:'B'}).success,false);
});
for(const type of ['MATCH_STARTED','GAME_VIEW','RESYNC_STATE'])test(`player packet roundtrip ${type}`,()=>{
 const state=main().getState(),view=projectGameState(state,state.playerOrder[0],fixture().content);
 const message={type,packet:{matchId:'m',stateVersion:0,view,legalActions:[{id:'a',label:'End',intent:{kind:'END_MAIN'},available:true}],decision:{id:'d',kind:'MULLIGAN',playerId:'A',mode:'MULTI_SELECT',candidates:[{id:'c',label:'Card'}],actions:[],submitIntent:{kind:'MULLIGAN',choiceId:'d',cardIds:[]}}}};
 assert.deepEqual(ServerMessageSchema.parse(message),message);
 assert.equal(ServerMessageSchema.safeParse({...message,packet:{...message.packet,legalActions:[{...message.packet.legalActions[0],playerId:'B'}]}}).success,false);
});
test('projection nested structures reject hidden engine fields',()=>{
 const state=main().getState(),view=projectGameState(state,state.playerOrder[0],fixture().content);
 const packet={matchId:'m',stateVersion:0,view,legalActions:[],decision:null};
 const mutations=[
 (v:any)=>{v.turn.rng={state:1}},
 (v:any)=>{Object.values<any>(v.players)[0].partnerId='secret'},
 (v:any)=>{Object.values<any>(v.players)[0].zones.SECRET=[]},
 (v:any)=>{v.events=[{sequence:1,type:'DRAW',playerId:'A',cardId:null,detail:'',cause:'secret'}]},
 (v:any)=>{v.subflows=[{kind:'EFFECT',step:null,playerId:null,effect:{sourceId:'secret'}}]},
 (v:any)=>{v.modifiers=[{targetEntryId:'e',stat:'AP',value:1,duration:'UNTIL_TURN_END',sourceEffectId:'secret'}]},
 (v:any)=>{v.choice={id:'c',kind:'MULLIGAN',playerId:'A',candidates:['secret']}},
 ];
 for(const mutate of mutations){const copy=structuredClone(packet);mutate(copy.view);assert.equal(ServerMessageSchema.safeParse({type:'GAME_VIEW',packet:copy}).success,false);}
});
test('malformed protocol primitives and unknown messages are rejected',()=>{
 for(const input of [null,[],42,'READY',{type:'UNKNOWN'},{type:'CREATE_ROOM',payload:{}},{...command,expectedVersion:0.5},{...command,expectedVersion:Infinity},{...command,commandId:''}])assert.equal(ClientMessageSchema.safeParse(input).success,false);
 for(const input of [null,[],{type:'UNKNOWN'},{type:'GAME_VIEW',packet:{state:{}}}])assert.equal(ServerMessageSchema.safeParse(input).success,false);
});
