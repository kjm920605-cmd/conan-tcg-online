import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../src/server/index.ts';
import type { ServerOptions } from '../src/server/index.ts';
import { ServerMessageSchema, ClientMessageSchema } from '../packages/protocol/index.ts';
import type { PlayerPacket, ServerMessage, ClientMessage } from '../packages/protocol/index.ts';
import type { Intent, Rng } from '../src/game/model.ts';
export const orderedRng:Rng={algorithm:'online-ordered',next:(state,max)=>({value:max-1,state:state+1})};
export async function connect(port:number){
 const ws=new WebSocket(`ws://127.0.0.1:${port}`),messages:ServerMessage[]=[],errors:unknown[]=[];
 ws.on('message',data=>{try{messages.push(ServerMessageSchema.parse(JSON.parse(data.toString())));}catch(error){errors.push(error);}});
 await new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
 return {ws,messages,errors,send:(message:ClientMessage)=>ws.send(JSON.stringify(ClientMessageSchema.parse(message))),
 async wait<T extends ServerMessage['type']>(type:T,predicate:(message:Extract<ServerMessage,{type:T}> extends never?ServerMessage:Extract<ServerMessage,{type:T}>)=>boolean=()=>true):Promise<any>{
  for(let i=0;i<200;i++){assert.deepEqual(errors,[]);const j=messages.findIndex(m=>m.type===type&&predicate(m as never));if(j>=0)return messages.splice(j,1)[0];await new Promise(r=>setTimeout(r,5));}
  throw Error(`Missing ${type}: ${JSON.stringify(messages)}`);
 }};
}
export async function online(options:ServerOptions){
 const server=await createGameServer({...options,port:0,rng:options.rng??orderedRng});
 const peers={A:await connect(server.port),B:await connect(server.port)};
 const all=[peers.A,peers.B],credentials={A:await peers.A.wait('SESSION'),B:await peers.B.wait('SESSION')};
 peers.A.send({type:'CREATE_ROOM'});const room=(await peers.A.wait('ROOM_STATE')).room;
 peers.B.send({type:'JOIN_ROOM',roomCode:room.roomCode});await peers.B.wait('ROOM_STATE');
 peers.A.send({type:'READY'});peers.B.send({type:'READY'});
 const packets:Record<string,PlayerPacket>={A:(await peers.A.wait('MATCH_STARTED')).packet,B:(await peers.B.wait('MATCH_STARTED')).packet};let next=0;
 function privacy(){
  const state=server.manager.inspectMatch(packets.A!.matchId)!.state;
  for(const viewer of ['A','B']){
   const packet=packets[viewer]!,serialized=JSON.stringify(packet);
   for(const [owner,p] of Object.entries(state.players))for(const [zone,ids]of Object.entries(p.zones))for(const id of ids){
    if(state.cards[id]!.face==='UP'||owner===viewer&&zone==='HAND')continue;
    assert(!serialized.includes(JSON.stringify(id)),`Hidden ${id} leaked to ${viewer}`);
   }
   if(packet.decision?.mode==='WAITING'){assert.deepEqual(packet.decision.candidates,[]);assert.deepEqual(packet.decision.actions,[]);}
   for(const key of ['rng','commandReceipts','pendingEffects','contentFingerprint'])assert(!Object.hasOwn(packet.view,key));
  }
 }
 privacy();
 return {server,peers,packets,credentials,privacy,
 actor:()=>packets.A!.decision?.playerId??packets.A!.view.turn.playerId,
 async submit(payload:Intent,actor=packets.A!.decision?.playerId??packets.A!.view.turn.playerId,type:'GAME_COMMAND'|'RESOLVE_DECISION'|'MULLIGAN'='GAME_COMMAND'){
  const p=peers[actor as 'A'|'B'],packet=packets[actor]!;
  const command={type,commandId:`online-${++next}`,matchId:packet.matchId,expectedVersion:packet.stateVersion,payload};p.send(command);
  const result=await p.wait('COMMAND_ACCEPTED',m=>m.commandId===command.commandId);
  for(const id of ['A','B'])packets[id]=(await peers[id as 'A'|'B'].wait('GAME_VIEW',m=>('packet' in m)&&m.packet.stateVersion===result.stateVersion)).packet;
  privacy();return command;
 },
 async duplicate(command:Extract<ClientMessage,{commandId:string}>,actor:string){const before=server.manager.inspectMatch(command.matchId);peers[actor as 'A'|'B'].send(command);const receipt=await peers[actor as 'A'|'B'].wait('COMMAND_ACCEPTED',m=>m.commandId===command.commandId);assert.equal(receipt.duplicate,true);assert.deepEqual(server.manager.inspectMatch(command.matchId),before)},
 async resume(actor:'A'|'B'){
  const before=server.manager.inspectMatch(packets.A!.matchId);const observer=peers[actor==='A'?'B':'A'];peers[actor].ws.close();await observer.wait('PLAYER_DISCONNECTED');
  const fresh=await connect(server.port);all.push(fresh);await fresh.wait('SESSION');fresh.send({type:'RESUME_MATCH',playerSessionId:credentials[actor].playerSessionId,resumeToken:credentials[actor].resumeToken});
  const packet:PlayerPacket=(await fresh.wait('RESYNC_STATE')).packet;assert.deepEqual(packet,packets[actor]);assert.deepEqual(server.manager.inspectMatch(packet.matchId),before);peers[actor]=fresh;
 },
 async close(){for(const peer of all){assert.deepEqual(peer.errors,[]);peer.ws.terminate();}await server.close()},
 };
}
export type Online=Awaited<ReturnType<typeof online>>;
export function available(game:Online,kind:Intent['kind'],actor=game.actor()){
 const action=game.packets[actor]!.legalActions.find(a=>a.available&&a.intent.kind===kind);assert(action,`No ${kind} for ${actor}: ${JSON.stringify(game.packets[actor]!.legalActions)}`);return action.intent;
}
export async function mulligans(game:Online,swap=false){
 for(let n=0;n<2;n++){const actor=game.actor(),d=game.packets[actor]!.decision!;const cardIds=swap&&n===0?[d.candidates.at(-1)!.id]:[];
 const command=await game.submit({kind:'MULLIGAN',choiceId:d.id,cardIds},actor,'MULLIGAN');await game.duplicate(command,actor);}
}

