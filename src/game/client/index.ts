import type { CardDefinition, Content, DeepReadonly, GameState, Intent, Orientation, Zone, CommandResult } from '../model.ts';
import type { GameEngine } from '../engine/GameEngine.ts';
import { currentStat } from '../rules/modifiers.ts';
import { keywords } from '../rules/keywords.ts';

export type CardView = { hidden: boolean; id?: string; instanceId?: string; definitionId?: string; name?: string; type?: CardDefinition['type']; face?: 'UP'|'DOWN'; orientation?: Orientation|null; entryId?: string|null; level?: number; ap?: number; lp?: number; firstLevel?: number; secondLevel?: number; colors?: string[]; keywords?: string[]; abilitiesSuppressed?: boolean; setCount?: number; underCount?: number };
export type LegalAction = { id: string; label: string; intent: Intent; sourceId?: string; targetId?: string; available: boolean; reason?: string; code?: string; category?: Extract<CommandResult,{accepted:false}>['category'] };
export type PendingDecision = { id:string; kind:string; playerId:string; mode:'ACTIONS'|'MULTI_SELECT'|'ORDERED'|'WAITING'; candidates:{id:string;label:string}[]; actions:LegalAction[]; submitIntent?:Intent };

export function projectGameState(state:DeepReadonly<GameState>,viewerId:string,content:Content) {
  if (!state.playerOrder.includes(viewerId)) throw new Error('VIEWER');
  const visible = new Set<string>();
  for(const player of Object.values(state.players)) for(const [zone,ids] of Object.entries(player.zones)) for(const id of ids) {
    if(state.cards[id]!.face==='UP' || (player.id===viewerId && zone==='HAND')) visible.add(id);
  }
  const cardView=(id:string):CardView=>{
    if(!visible.has(id)) return {hidden:true};
    const card=state.cards[id]!,def=content.definitions[card.definitionId]!;
    const result:CardView={hidden:false,id,instanceId:id,definitionId:card.definitionId,name:def.name,type:def.type,face:card.face,orientation:card.orientation,entryId:card.entryId,colors:[...def.colors],abilitiesSuppressed:!!card.abilitiesSuppressed};
    if('level' in def)result.level=def.level;
    if('ap' in def)result.ap=currentStat(state as GameState,content,id,'AP');
    if('lp' in def)result.lp=currentStat(state as GameState,content,id,'LP');
    if(def.type==='CASE'){result.firstLevel=def.firstLevel;result.secondLevel=def.secondLevel;}
    if(def.type==='CHARACTER')result.keywords=keywords(state as GameState,content,id).map(k=>'value' in k ? `${k.kind} ${k.value}`:k.kind);
    const attached=Object.values(state.cards).filter(c=>card.entryId && c.attachment?.hostEntryId===card.entryId);
    result.setCount=attached.filter(c=>c.attachment?.kind==='SET').length;result.underCount=attached.filter(c=>c.attachment?.kind==='UNDER').length;
    return result;
  };
  const players=Object.fromEntries(state.playerOrder.map(id=>{
    const player=state.players[id]!;
    return [id,{id,chapter:player.chapter,traceDiscovered:player.traceDiscovered,zones:Object.fromEntries(Object.entries(player.zones).map(([zone,ids])=>[zone,ids.map(cardView)])) as Record<Zone,CardView[]>}];
  }));
  // Free-form host event detail/cause is deliberately excluded, even for visible subjects.
  const events=state.events.map(e=>({sequence:e.sequence,type:e.type,playerId:e.playerId,cardId:e.cardId && visible.has(e.cardId)?e.cardId:null,detail:e.cardId && visible.has(e.cardId)?content.definitions[state.cards[e.cardId]!.definitionId]!.name:''}));
  const subflows=state.frames.map(f=>({kind:f.kind,step:'step' in f?f.step:null,playerId:'playerId' in f?f.playerId:null}));
  const modifiers=Object.values(state.modifiers).filter(m=>Object.values(state.cards).some(c=>c.entryId===m.targetEntryId && visible.has(c.instanceId))).map(m=>({targetEntryId:m.targetEntryId,stat:m.stat,value:m.value,duration:m.duration}));
  return {matchId:state.matchId,revision:state.revision,status:state.status,viewerId,playerOrder:[...state.playerOrder],firstPlayerId:state.firstPlayerId,turn:{...state.turn},players,events,subflows,modifiers,choice:state.choice?{id:state.choice.id,kind:state.choice.kind,playerId:state.choice.playerId}:null,blocked:state.blocked?{questionId:state.blocked.questionId,detail:'Unsupported rule requires clarification'}:null,outcome:state.outcome?{...state.outcome}:null};
}
export type PlayerView = ReturnType<typeof projectGameState>;

export function getLegalActions(engine:GameEngine,content:Content,playerId:string):LegalAction[] {
 const state=engine.getState(),player=state.players[playerId]; if(!player)throw new Error('VIEWER');
 if(state.choice && state.choice.playerId!==playerId)return [];
 const candidates:{intent:Intent;label:string;sourceId?:string;targetId?:string}[]=[];
 const visibleIds=new Set(Object.values(projectGameState(state,playerId,content).players).flatMap(p=>Object.values(p.zones).flatMap(cards=>cards.flatMap(c=>c.id?[c.id]:[]))));
 const name=(id:string)=>visibleIds.has(id)?content.definitions[state.cards[id]!.definitionId]!.name:'Hidden card';
 const add=(intent:Intent,label:string,sourceId?:string,targetId?:string)=>candidates.push({intent,label,...(sourceId?{sourceId}:{}),...(targetId?{targetId}:{})});
 const contact=(choiceId:string)=>{
   add({kind:'RESPOND_CONTACT',choiceId,response:'PASS'},'Pass');
   for(const id of player.zones.HAND){const def=content.definitions[state.cards[id]!.definitionId]!;
     for(const cut of def.cutIns??[]) add({kind:'RESPOND_CONTACT',choiceId,response:'CUT_IN',cardId:id,abilityId:cut.abilityId},`Cut-in: ${name(id)} / ${cut.abilityId}`,id);
     if(def.type==='CHARACTER' && def.disguise)add({kind:'RESPOND_CONTACT',choiceId,response:'DISGUISE',cardId:id},`Disguise: ${name(id)}`,id);
   }
 };
 const choice=state.choice;
 if(choice){const choiceId=choice.id;
   switch(choice.kind){
    case 'MULLIGAN': add({kind:'MULLIGAN',choiceId,cardIds:[]},'Keep hand');break;
    case 'MISLEAD': add({kind:'CHOOSE_MISLEAD',choiceId,cardIds:[]},'Pass Mislead');break;
    case 'INVESTIGATION_ORDER': break;
    case 'CONTACT_RESPONSE':contact(choiceId);break;
    case 'EFFECT_ORDER':for(const id of choice.candidates){const effect=state.pendingEffects.find(e=>e.id===id);add({kind:'CHOOSE_EFFECT',choiceId,effectId:id},effect?`Resolve ${name(effect.sourceId)}`:'Resolve effect');}break;
    case 'NEXT_HINT_CARD':add({kind:'CHOOSE_NEXT_HINT_CARD',choiceId,cardId:null},'Decline');for(const id of choice.candidates)add({kind:'CHOOSE_NEXT_HINT_CARD',choiceId,cardId:id},`Next Hint: ${name(id)}`,id);break;
    case 'SWITCH':for(const id of choice.candidates)add({kind:'CHOOSE_SWITCH',choiceId,cardId:id},`Switch: ${name(id)}`,id);break;
    case 'GUARD':add({kind:'CHOOSE_GUARD',choiceId,cardId:null},'No guard');for(const id of choice.candidates)add({kind:'CHOOSE_GUARD',choiceId,cardId:id},`Guard: ${name(id)}`,id);break;
   }
 } else if(state.status==='PLAYING' && state.turn.playerId===playerId && state.turn.phase==='MAIN' && state.frames.length===0 && state.pendingEffects.length===0){
   for(const kind of ['NEXT_HINT','ASSIST','SOLVE_CASE','END_MAIN'] as const)add({kind},kind.replaceAll('_',' '));
   if(visibleIds.has(player.partnerId))add({kind:'DEDUCE',cardId:player.partnerId},`Deduce: ${name(player.partnerId)}`,player.partnerId);
   for(const id of player.zones.HAND)add({kind:'PLAY_CARD',cardId:id},`Play ${name(id)}`,id);
   const opponent=state.players[state.playerOrder.find(id=>id!==playerId)!]!;
   for(const id of player.zones.FIELD){add({kind:'DEDUCE',cardId:id},`Deduce: ${name(id)}`,id);
     for(const targetId of [...opponent.zones.FIELD,...opponent.zones.CASE])add({kind:'DECLARE_ACTION',cardId:id,target:{kind:opponent.zones.CASE.includes(targetId)?'CASE':'CHARACTER',cardId:targetId}},`Action: ${name(id)} → ${name(targetId)}`,id,targetId);
   }
   for(const id of [...player.zones.FIELD,...player.zones.PARTNER]){const def=content.definitions[state.cards[id]!.definitionId]!;if(def.type==='CHARACTER')for(const ability of def.declarations??[])add({kind:'DECLARE_ABILITY',cardId:id,abilityId:ability.abilityId},`Ability: ${name(id)} / ${ability.abilityId}`,id);}
 }
 return candidates.map((c,index)=>{const result=engine.preview(playerId,c.intent);return {...c,id:`action-${state.revision}-${index}`,available:result.accepted,...(!result.accepted?{reason:result.code,code:result.code,category:result.category}:{})};});
}

export function getPendingDecision(engine:GameEngine,content:Content,playerId:string):PendingDecision|null {
 const state=engine.getState(),choice=state.choice;if(!choice)return null;
 const base={id:choice.id,kind:choice.kind,playerId:choice.playerId};
 if(choice.playerId!==playerId)return {...base,mode:'WAITING',candidates:[],actions:[]};
 const actions=getLegalActions(engine,content,playerId);
 const ids=choice.kind==='MULLIGAN'?state.players[playerId]!.zones.HAND:'candidates' in choice?choice.candidates:[];
 const candidates=ids.map(id=>({id,label:state.cards[id]?content.definitions[state.cards[id]!.definitionId]!.name:'Pending effect'}));
 if(choice.kind==='MULLIGAN'||choice.kind==='MISLEAD')return {...base,mode:'MULTI_SELECT',candidates,actions,submitIntent:{kind:choice.kind==='MULLIGAN'?'MULLIGAN':'CHOOSE_MISLEAD',choiceId:choice.id,cardIds:[]}};
 if(choice.kind==='INVESTIGATION_ORDER')return {...base,mode:'ORDERED',candidates,actions,submitIntent:{kind:'CHOOSE_INVESTIGATION_ORDER',choiceId:choice.id,cardIds:[...ids]}};
 return {...base,mode:'ACTIONS',candidates,actions};
}
