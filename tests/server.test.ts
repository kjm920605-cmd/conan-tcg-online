import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../src/server/index.ts';
import { fixture } from './fixtures.ts';

async function peer(port:number) {
 const ws=new WebSocket(`ws://127.0.0.1:${port}`); const messages:any[]=[];
 ws.on('message',data=>messages.push(JSON.parse(data.toString())));
 await new Promise<void>(resolve=>ws.once('open',resolve));
 const wait=async(type:string,predicate=(m:any)=>true)=>{for(let i=0;i<300;i++){const j=messages.findIndex(m=>m.type===type&&predicate(m));if(j>=0)return messages.splice(j,1)[0];await new Promise(r=>setTimeout(r,10));}throw new Error(`Missing ${type}: ${JSON.stringify(messages)}`);};
 return {ws,messages,wait,send:(m:any)=>ws.send(JSON.stringify(m))};
}
test('authoritative room/version/ownership/dedupe and authenticated replacement',async()=>{
 const {content,options}=fixture(); const server=await createGameServer({content,port:0,matchOptions:()=>options});
 const peers:Awaited<ReturnType<typeof peer>>[]=[];
 try {
 const a=await peer(server.port),b=await peer(server.port),c=await peer(server.port);peers.push(a,b,c);
 const identity=await a.wait('SESSION');await b.wait('SESSION');await c.wait('SESSION');
 a.send({type:'CREATE_ROOM'});const room=(await a.wait('ROOM_STATE')).room;
 b.send({type:'JOIN_ROOM',roomCode:room.roomCode});await b.wait('ROOM_STATE');
 c.send({type:'JOIN_ROOM',roomCode:room.roomCode});assert.equal((await c.wait('COMMAND_REJECTED')).code,'ROOM_FULL');
 a.send({type:'READY'});b.send({type:'READY'});
 const packet=(await a.wait('MATCH_STARTED')).packet; await b.wait('MATCH_STARTED');
 const owner=packet.decision.playerId==='A'?a:b,other=owner===a?b:a;
 const command={type:'GAME_COMMAND',commandId:'one',matchId:packet.matchId,expectedVersion:0,payload:{kind:'MULLIGAN',choiceId:packet.decision.id,cardIds:[]}};
 other.send(command);assert.equal((await other.wait('COMMAND_REJECTED')).code,'NOT_DECISION_OWNER');
 owner.send({...command,commandId:'wrong-choice',payload:{...command.payload,choiceId:'expired'}});assert.equal((await owner.wait('COMMAND_REJECTED')).code,'STALE_DECISION');
 assert.equal(server.manager.inspectMatch(packet.matchId)?.stateVersion,0);
 owner.send(command);assert.equal((await owner.wait('COMMAND_ACCEPTED')).stateVersion,1);
 const before=server.manager.inspectMatch(packet.matchId);
 owner.send(command);assert.equal((await owner.wait('COMMAND_ACCEPTED')).duplicate,true);
 assert.equal((await owner.wait('RESYNC_STATE')).packet.stateVersion,1);
 assert.deepEqual(server.manager.inspectMatch(packet.matchId),before);
 owner.send({...command,matchId:'another-match'});assert.equal((await owner.wait('COMMAND_REJECTED')).code,'MATCH_MISMATCH');
 other.send(command);assert.equal((await other.wait('COMMAND_REJECTED')).code,'COMMAND_ID_REUSED');
 owner.send({...command,payload:{...command.payload,cardIds:['bad']}});assert.equal((await owner.wait('COMMAND_REJECTED')).code,'COMMAND_ID_REUSED');
 other.send({...command,commandId:'stale'});assert.equal((await other.wait('COMMAND_REJECTED')).code,'STALE_STATE');await other.wait('RESYNC_STATE');
 c.send({type:'RESUME_MATCH',playerSessionId:identity.playerSessionId,resumeToken:'x'.repeat(64)});assert.equal((await c.wait('COMMAND_REJECTED')).code,'INVALID_SESSION');
 c.send({type:'RESUME_MATCH',playerSessionId:identity.playerSessionId,resumeToken:identity.resumeToken});await c.wait('RESYNC_STATE');
 await new Promise(r=>setTimeout(r,30));assert.equal(a.ws.readyState,WebSocket.CLOSED);
 assert.equal(server.manager.inspectMatch(packet.matchId)?.stateVersion,1);
 assert(!JSON.stringify(b.messages).includes(identity.resumeToken));
 c.send({type:'GAME_COMMAND',actorId:'B'});assert.equal((await c.wait('COMMAND_REJECTED')).code,'INVALID_MESSAGE');
 }finally{for(const p of peers)p.ws.terminate();await server.close();}
});

test('leave invalidates waiting seat; disconnect preserves match and seat; own projection is private',async()=>{
 const {content,options}=fixture();const server=await createGameServer({content,port:0,matchOptions:()=>options});const peers:Awaited<ReturnType<typeof peer>>[]=[];
 try{
 const a=await peer(server.port),b=await peer(server.port),c=await peer(server.port);peers.push(a,b,c);
 const old=await a.wait('SESSION');await b.wait('SESSION');await c.wait('SESSION');
 a.send({type:'CREATE_ROOM'});const room=(await a.wait('ROOM_STATE')).room;
 a.send({type:'LEAVE_ROOM'});const current=await a.wait('SESSION');assert.notEqual(current.playerSessionId,old.playerSessionId);
 c.send({type:'RESUME_MATCH',playerSessionId:old.playerSessionId,resumeToken:old.resumeToken});assert.equal((await c.wait('COMMAND_REJECTED')).code,'INVALID_SESSION');
 a.send({type:'CREATE_ROOM'});const next=(await a.wait('ROOM_STATE')).room;
 b.send({type:'JOIN_ROOM',roomCode:next.roomCode});await b.wait('ROOM_STATE');a.send({type:'READY'});b.send({type:'READY'});
 const ap=(await a.wait('MATCH_STARTED')).packet,bp=(await b.wait('MATCH_STARTED')).packet;
 assert(ap.view.players.B.zones.HAND.every((x:any)=>JSON.stringify(x)==='{"hidden":true}'));
 assert(bp.view.players.A.zones.HAND.every((x:any)=>JSON.stringify(x)==='{"hidden":true}'));
 const waiting=ap.decision.playerId==='A'?bp.decision:ap.decision;assert.deepEqual(waiting.candidates,[]);assert.deepEqual(waiting.actions,[]);
 assert(!('rng' in ap.view));assert(!('commandReceipts' in ap.view));
 a.ws.close();await b.wait('PLAYER_DISCONNECTED');const snapshot=server.manager.inspectMatch(ap.matchId);assert.equal(snapshot?.stateVersion,0);assert.equal(snapshot?.state.outcome,null);
 c.send({type:'JOIN_ROOM',roomCode:next.roomCode});assert.equal((await c.wait('COMMAND_REJECTED')).code,'ROOM_FULL');
 c.send({type:'RESUME_MATCH',playerSessionId:current.playerSessionId,resumeToken:current.resumeToken});const resynced=(await c.wait('RESYNC_STATE')).packet;assert.deepEqual(resynced,ap);
 assert.notEqual(room.roomCode,next.roomCode);
 }finally{for(const p of peers)p.ws.terminate();await server.close();}
});

test('malformed and oversized frames are bounded and do not kill server',async()=>{
 const {content,options}=fixture();const server=await createGameServer({content,port:0,matchOptions:()=>options});const a=await peer(server.port);
 try{await a.wait('SESSION');a.ws.send('{');assert.equal((await a.wait('COMMAND_REJECTED')).code,'INVALID_MESSAGE');
 a.send({type:'CREATE_ROOM',snapshot:{}});assert.equal((await a.wait('COMMAND_REJECTED')).code,'INVALID_MESSAGE');
 const closed=new Promise<number>(resolve=>a.ws.once('close',resolve));a.ws.send('x'.repeat(65537));assert.equal(await closed,1009);
 const b=await peer(server.port);await b.wait('SESSION');b.send({type:'CREATE_ROOM'});await b.wait('ROOM_STATE');b.ws.terminate();
 }finally{a.ws.terminate();await server.close();}
});
