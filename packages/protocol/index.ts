import { z } from 'zod';
import type { Intent } from '../../src/game/model.ts';
import type { PlayerView, LegalAction, PendingDecision } from '../../src/game/client/index.ts';
const id=z.string().min(1).max(256), text=z.string().max(16384), count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ids=z.array(id).max(1000);
const strict=z.strictObject;
// JSON omits undefined optional properties; normalize direct in-process parses too.
function defined<T extends object>(value:T):{[K in keyof T]:Exclude<T[K],undefined>}{
 return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined)) as {[K in keyof T]:Exclude<T[K],undefined>};
}
export const IntentSchema: z.ZodType<Intent> = z.union([
 strict({kind:z.enum(['ASSIST','SOLVE_CASE','END_MAIN','NEXT_HINT'])}),
 strict({kind:z.enum(['PLAY_CARD','DEDUCE']),cardId:id}),
 strict({kind:z.enum(['MULLIGAN','CHOOSE_MISLEAD','CHOOSE_INVESTIGATION_ORDER']),choiceId:id,cardIds:ids}),
 strict({kind:z.literal('CHOOSE_EFFECT'),choiceId:id,effectId:id}),
 strict({kind:z.enum(['CHOOSE_NEXT_HINT_CARD','CHOOSE_GUARD']),choiceId:id,cardId:id.nullable()}),
 strict({kind:z.literal('CHOOSE_SWITCH'),choiceId:id,cardId:id}),
 strict({kind:z.literal('DECLARE_ACTION'),cardId:id,target:strict({kind:z.enum(['CHARACTER','CASE']),cardId:id})}),
 strict({kind:z.literal('DECLARE_ABILITY'),cardId:id,abilityId:id}),
 strict({kind:z.literal('RESPOND_CONTACT'),choiceId:id,response:z.literal('PASS')}),
 strict({kind:z.literal('RESPOND_CONTACT'),choiceId:id,response:z.literal('CUT_IN'),cardId:id,abilityId:id}),
 strict({kind:z.literal('RESPOND_CONTACT'),choiceId:id,response:z.literal('DISGUISE'),cardId:id}),
]);
export const LegalActionSchema:z.ZodType<LegalAction>=strict({id,label:text,intent:IntentSchema,sourceId:id.optional(),targetId:id.optional(),available:z.boolean(),reason:text.optional(),code:text.optional(),category:z.enum(['UnsupportedRule','UnsupportedFeature','InvalidCommand']).optional()}).transform(defined);
const decisionBase={id,kind:id,playerId:id};
export const PendingDecisionSchema:z.ZodType<PendingDecision>=z.union([
 strict({...decisionBase,mode:z.literal('WAITING'),candidates:z.array(z.never()).length(0),actions:z.array(z.never()).length(0)}),
 strict({...decisionBase,mode:z.enum(['ACTIONS','MULTI_SELECT','ORDERED']),candidates:z.array(strict({id,label:text})).max(1000),actions:z.array(LegalActionSchema).max(10000),submitIntent:IntentSchema.optional()}).transform(defined),
]);
const visible={hidden:z.literal(false),id,instanceId:id,definitionId:id,name:text,face:z.enum(['UP','DOWN']),orientation:z.enum(['ACTIVE','SLEEP','STUN']).nullable(),entryId:id.nullable(),colors:z.array(text),abilitiesSuppressed:z.boolean(),setCount:count,underCount:count};
export const CardViewSchema=z.union([
 strict({hidden:z.literal(true)}),
 strict({...visible,type:z.literal('PARTNER'),lp:z.number()}),
 strict({...visible,type:z.literal('CHARACTER'),level:count,ap:z.number(),lp:z.number(),keywords:z.array(text)}),
 strict({...visible,type:z.literal('EVENT'),level:count}),
 strict({...visible,type:z.literal('CASE'),firstLevel:count,secondLevel:count}),
]);
const cards=z.array(CardViewSchema).max(1000);
const zones=strict({DECK:cards,HAND:cards,FILE:cards,EVIDENCE:cards,REMOVE:cards,PARTNER:cards,CASE:cards,FIELD:cards,PROCESSING:cards,SET:cards,UNDER:cards});
const outcome=strict({winnerId:id,loserId:id,reason:z.enum(['EMPTY_DECK','CASE_SOLVED'])});
const choiceKind=z.enum(['MULLIGAN','EFFECT_ORDER','NEXT_HINT_CARD','SWITCH','MISLEAD','GUARD','INVESTIGATION_ORDER','CONTACT_RESPONSE']);
export const PlayerViewSchema:z.ZodType<PlayerView>=strict({
 matchId:id,revision:count,status:z.enum(['SETUP','PLAYING','RULE_BLOCKED','FINISHED']),viewerId:id,playerOrder:z.array(id).length(2),firstPlayerId:id,
 turn:strict({number:count,playerId:id,phase:z.enum(['AUTO','MAIN','END']),normalPlayUsed:z.boolean(),usedNextHint:z.boolean()}),
 players:z.record(id,strict({id,chapter:z.enum(['CASE','RESOLUTION']),traceDiscovered:z.boolean(),zones})),
 events:z.array(strict({sequence:count,type:text,playerId:id.nullable(),cardId:id.nullable(),detail:text})),
 subflows:z.array(strict({kind:z.enum(['NEXT_HINT','ENTRY','DEDUCTION','ACTION','CONTACT','CASE_ACTION','AUTO','END','CHECKPOINT','MOVE','REFRESH','EFFECT','INVESTIGATION','FINISH_EVENT']),step:z.union([z.enum(['TAKE','CHOOSE','DONE','DEDUCTION_DECLARE','MISLEAD_WINDOW','EFFECT_CHECKPOINT','CALCULATE_LP','GAIN_EVIDENCE','GAIN_CHECKPOINT','DEDUCTION_END','ACTION_DECLARE','GUARD_WINDOW','AFTER_GUARD','ACTION_END','CONTACT_START','CONTACT_PRIORITY','CONTACT_RESPONSE','AP_COMPARE','CONTACT_END','TAKE_EVIDENCE','RELEASE_EVIDENCE','REBUILD','PENALTY','REVEAL','ORDER']),count]).nullable(),playerId:id.nullable()})),
 modifiers:z.array(strict({targetEntryId:id,stat:z.enum(['AP','LP']),value:z.number(),duration:z.enum(['UNTIL_CONTACT_END','UNTIL_ACTION_END','UNTIL_TURN_END'])})),
 choice:strict({id,kind:choiceKind,playerId:id}).nullable(),blocked:strict({questionId:id,detail:text}).nullable(),outcome:outcome.nullable(),
});
export const RoomStateSchema=strict({roomCode:id,status:z.enum(['WAITING','PLAYING','FINISHED','RULE_BLOCKED']),seats:z.array(strict({playerId:z.enum(['A','B']),occupied:z.boolean(),ready:z.boolean(),connected:z.boolean(),deck:z.enum(['Fixture Deck A','Fixture Deck B'])})).max(2),matchId:id.nullable()});
export type RoomState=z.infer<typeof RoomStateSchema>;
export const PlayerPacketSchema=strict({matchId:id,stateVersion:count,view:PlayerViewSchema,legalActions:z.array(LegalActionSchema).max(10000),decision:PendingDecisionSchema.nullable()});
export type PlayerPacket=z.infer<typeof PlayerPacketSchema>;
export const ClientMessageSchema=z.union([
 strict({type:z.literal('CREATE_ROOM')}),strict({type:z.literal('LEAVE_ROOM')}),strict({type:z.literal('READY')}),strict({type:z.literal('JOIN_ROOM'),roomCode:id}),
 strict({type:z.literal('RESUME_MATCH'),playerSessionId:id,resumeToken:id}),strict({type:z.literal('RESYNC'),matchId:id}),
 strict({type:z.enum(['GAME_COMMAND','RESOLVE_DECISION','MULLIGAN']),commandId:id,matchId:id,expectedVersion:count,payload:IntentSchema}),
]);
export type ClientMessage=z.infer<typeof ClientMessageSchema>;
export const ServerMessageSchema=z.union([
 strict({type:z.literal('SESSION_RESTORED')}),
 strict({type:z.literal('SESSION'),playerSessionId:id,resumeToken:id}),strict({type:z.literal('ROOM_STATE'),room:RoomStateSchema}),
 strict({type:z.enum(['MATCH_STARTED','GAME_VIEW','RESYNC_STATE']),packet:PlayerPacketSchema}),
 strict({type:z.literal('COMMAND_ACCEPTED'),commandId:id,matchId:id,stateVersion:count,duplicate:z.boolean()}),
 strict({type:z.literal('COMMAND_REJECTED'),commandId:id.nullable(),code:text,message:text,stateVersion:count.nullable()}),
 strict({type:z.literal('PENDING_DECISION'),matchId:id,stateVersion:count,decision:PendingDecisionSchema.nullable()}),
 strict({type:z.enum(['PLAYER_CONNECTED','PLAYER_DISCONNECTED']),playerId:id,matchId:id.nullable()}),
 strict({type:z.literal('RULE_BLOCKED'),matchId:id,stateVersion:count,questionId:id}),
 strict({type:z.literal('GAME_FINISHED'),matchId:id,stateVersion:count,outcome}),
]);
export type ServerMessage=z.infer<typeof ServerMessageSchema>;


