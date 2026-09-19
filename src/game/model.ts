export type PlayerId = string;
export type Orientation = "ACTIVE" | "SLEEP" | "STUN";
export type Zone = "DECK" | "HAND" | "FILE" | "EVIDENCE" | "REMOVE" | "PARTNER" | "CASE" | "FIELD" | "PROCESSING" | "SET" | "UNDER";
export type TriggerEvent = "ABILITY_DECLARED" | "CUT_IN_USED" | "DISGUISED" | "CARD_DRAWN" | "TURN_END" | "CARD_MOVED" | "CHARACTER_ENTERED" | "CHARACTER_REMOVED" | "ORIENTATION_CHANGED" | "NEXT_HINT_TAKEN" | "DEDUCTION_DECLARED" | "MISLEAD_USED" | "EVIDENCE_GAINED" | "DEDUCTION_ENDED" | "ACTION_DECLARED" | "GUARD_DECLARED" | "CONTACT_STARTED" | "CONTACT_PRIORITY" | "AP_COMPARED" | "CONTACT_ENDED" | "ACTION_ENDED";
export type Trigger = { event: TriggerEvent; player: "SELF" | "OPPONENT" | "ANY"; subject?: "SOURCE" | "ANY"; programId: string; zones?: ("FIELD" | "PARTNER")[]; condition?: "TRACE_DISCOVERED" };
export type Keyword = { kind: "RAPID" | "ASSAULT" | "ASSAULT_CHARACTER" | "ASSAULT_CASE" | "BULLET" | "TRACE" }
  | { kind: "MISLEAD" | "MISLEAD_X" | "INVESTIGATE_X"; value: number };
export type Declaration = { abilityId: string; programId: string; zones: ("FIELD" | "PARTNER")[]; timing: "OWN_MAIN"; cost: "NONE" };
type DefinitionBase = {
  definitionId: string;
  printedId: string;
  name: string;
  recognizedNames: string[];
  colors: string[];
  support: "VERIFIED_CORE" | "UNVERIFIED";
  triggers: Trigger[];
  cutIns?: { abilityId: string; programId: string }[];
};
export type CardDefinition = DefinitionBase & (
  | { type: "PARTNER"; lp: number }
  | { type: "CHARACTER"; level: number; ap: number; lp: number; keywords?: Keyword[]; disguise?: true; mr?: true; declarations?: Declaration[] }
  | { type: "EVENT"; level: number; programId: string }
  | { type: "CASE"; firstLevel: number; secondLevel: number }
);
export type Instruction =
  | { op: "DRAW" | "GAIN_EVIDENCE" | "ADD_FILE" | "REMOVE_TOP"; player: "SELF" | "OPPONENT"; count: number }
  | { op: "SET_SOURCE_STATE"; state: Orientation }
  | { op: "REMOVE_SOURCE" | "SUPPRESS_SOURCE_ABILITIES" }
  | { op: "REMOVE" | "ACTIVE" | "SLEEP" | "STUN"; target: "SOURCE" | "OWN_CONTACT" }
  | { op: "MOVE"; target: "SOURCE"; from: "FIELD"; to: "HAND" | "REMOVE" | "DECK" }
  | { op: "AP_MOD" | "LP_MOD"; target: "SOURCE" | "OWN_CONTACT"; value: number }
  | { op: "SET_CARD" | "STACK_UNDER"; target: "SOURCE"; count: number }
  | { op: "INVOKE_KEYWORD"; keyword: "INVESTIGATE_X" };
export type Duration = "UNTIL_CONTACT_END" | "UNTIL_ACTION_END" | "UNTIL_TURN_END";
export type EffectProgram = {
  sourceRequirements: "INDEPENDENT" | "FIELD_ENTRY";
  targetSelectionPoint: "NONE" | "RESOLUTION";
  targetZone: "NONE" | "FIELD";
  duration: "INSTANT" | Duration;
  invalidTargetBehavior: "BLOCK";
  instructions: Instruction[];
  condition?: "TRACE_DISCOVERED";
};
export type Modifier = { id: string; targetEntryId: string; sourceEffectId: string; stat: "AP" | "LP"; value: number; duration: Duration; scopeId: string };
export type Content = {
  version: string;
  definitions: Record<string, CardDefinition>;
  programs: Record<string, EffectProgram>;
};
export type CardInstance = {
  instanceId: string;
  definitionId: string;
  ownerId: PlayerId;
  face: "UP" | "DOWN";
  orientation: Orientation | null;
  enteredTurn: number | null;
  entryId: string | null;
  attachment: { kind: "SET" | "UNDER"; hostEntryId: string } | null;
  abilitiesSuppressed?: boolean;
};
/** Engineering identity only. A new occurrence does not adjudicate reset/retain rules. */
export type FieldEntry = {
  entryId: string;
  instanceId: string;
  ownerId: PlayerId;
  createdTurn: number;
  creation: "PLAY" | "DISGUISE";
  status: "PRESENT" | "LEFT" | "REPLACED";
  previousEntryId: string | null;
  grantedAbilities: ({ kind: "KEYWORD"; sourceId: string; keyword: Keyword } | { kind: "TRIGGER"; sourceId: string; trigger: Trigger })[];
};
export type PlayerState = {
  id: PlayerId;
  partnerId: string;
  caseId: string;
  chapter: "CASE" | "RESOLUTION";
  traceDiscovered: boolean;
  assistReturnOnOwnAuto: boolean;
  zones: Record<Zone, string[]>;
};
export type PendingEffect = { id: string; controllerId: PlayerId; sourceId: string; programId: string; sourceEntryId?: string };
export type ActionTarget = { kind: "CHARACTER" | "CASE"; cardId: string };
export type GameplayFrame =
  | { kind: "NEXT_HINT"; playerId: PlayerId; step: "TAKE" | "CHOOSE" | "DONE" }
  | { kind: "ENTRY"; playerId: PlayerId; cardId: string }
  | { kind: "DEDUCTION"; id: string; playerId: PlayerId; sourceId: string; step: "DEDUCTION_DECLARE" | "MISLEAD_WINDOW" | "EFFECT_CHECKPOINT" | "CALCULATE_LP" | "GAIN_EVIDENCE" | "GAIN_CHECKPOINT" | "DEDUCTION_END" | "DONE"; misleadIds: string[]; lpReduction: number; calculatedLP: number | null; sampledLP: number | null }
  | { kind: "ACTION"; id: string; playerId: PlayerId; attackerId: string; target: ActionTarget; guardId: string | null; step: "ACTION_DECLARE" | "GUARD_WINDOW" | "AFTER_GUARD" | "ACTION_END" | "DONE" }
  | { kind: "CONTACT"; id: string; playerId: PlayerId; attackerId: string; defenderId: string; step: "CONTACT_START" | "CONTACT_PRIORITY" | "CONTACT_RESPONSE" | "AP_COMPARE" | "CONTACT_END" | "DONE"; priority: [PlayerId, PlayerId] | null; responseIndex: number; responses: ("PASS" | "CUT_IN" | "DISGUISE")[]; priorityAP: [number, number] | null }
  | { kind: "CASE_ACTION"; playerId: PlayerId; defenderPlayerId: PlayerId; evidenceId: string | null; step: "TAKE_EVIDENCE" | "RELEASE_EVIDENCE" | "GAIN_EVIDENCE" | "DONE" };
export type Frame = GameplayFrame
  | { kind: "AUTO"; step: number }
  | { kind: "END"; step: number }
  | { kind: "CHECKPOINT" }
  | { kind: "MOVE"; playerId: PlayerId; to: "HAND" | "FILE" | "EVIDENCE" | "REMOVE" | "SET" | "UNDER"; remaining: number; hostEntryId?: string }
  | { kind: "REFRESH"; playerId: PlayerId; step: "REBUILD" | "PENALTY" | "DONE" }
  | { kind: "EFFECT"; effect: PendingEffect; cursor: number; foundCards?: string[] }
  | { kind: "INVESTIGATION"; playerId: PlayerId; deckOwnerId: PlayerId; sourceId: string; count: number; revealed: string[]; step: "REVEAL" | "ORDER" | "DONE" }
  | { kind: "FINISH_EVENT"; playerId: PlayerId; cardId: string };
export type Choice =
  | { id: string; kind: "MULLIGAN"; playerId: PlayerId }
  | { id: string; kind: "EFFECT_ORDER" | "NEXT_HINT_CARD" | "SWITCH" | "MISLEAD" | "GUARD" | "INVESTIGATION_ORDER"; playerId: PlayerId; candidates: string[] }
  | { id: string; kind: "CONTACT_RESPONSE"; playerId: PlayerId };
export type GameEvent = { sequence: number; type: string; playerId: PlayerId | null; cardId: string | null; detail: string; cause?: string };
export type GameState = {
  schemaVersion: 3;
  engineVersion: "0.3.0";
  rulesetVersion: "pdf-2.5+explicit-3a";
  contentFingerprint: string;
  matchId: string;
  revision: number;
  nextId: number;
  status: "SETUP" | "PLAYING" | "RULE_BLOCKED" | "FINISHED";
  playerOrder: [PlayerId, PlayerId];
  firstPlayerId: PlayerId;
  players: Record<PlayerId, PlayerState>;
  cards: Record<string, CardInstance>;
  entries: Record<string, FieldEntry>;
  modifiers: Record<string, Modifier>;
  turn: { number: number; playerId: PlayerId; phase: "AUTO" | "MAIN" | "END"; normalPlayUsed: boolean; usedNextHint: boolean };
  mulligansCompleted: number;
  choice: Choice | null;
  frames: Frame[];
  pendingEffects: PendingEffect[];
  rng: { algorithm: string; state: number; cursor: number };
  events: GameEvent[];
  commandReceipts: Record<string, { fingerprint: string; revision: number }>;
  blocked: { questionId: string; detail: string } | null;
  outcome: { winnerId: PlayerId; loserId: PlayerId; reason: "EMPTY_DECK" | "CASE_SOLVED" } | null;
};
export type DeckInput = { playerId: PlayerId; partner: string; case: string; deck: string[] };
export type CreateOptions = { matchId: string; players: [DeckInput, DeckInput]; seed: number };
export type Intent =
  | { kind: "MULLIGAN"; choiceId: string; cardIds: string[] }
  | { kind: "CHOOSE_EFFECT"; choiceId: string; effectId: string }
  | { kind: "ASSIST" | "SOLVE_CASE" | "END_MAIN" | "NEXT_HINT" }
  | { kind: "PLAY_CARD" | "DEDUCE"; cardId: string }
  | { kind: "CHOOSE_NEXT_HINT_CARD" | "CHOOSE_GUARD"; choiceId: string; cardId: string | null }
  | { kind: "CHOOSE_SWITCH"; choiceId: string; cardId: string }
  | { kind: "CHOOSE_MISLEAD"; choiceId: string; cardIds: string[] }
  | { kind: "CHOOSE_INVESTIGATION_ORDER"; choiceId: string; cardIds: string[] }
  | { kind: "DECLARE_ACTION"; cardId: string; target: ActionTarget }
  | { kind: "DECLARE_ABILITY"; cardId: string; abilityId: string }
  | { kind: "RESPOND_CONTACT"; choiceId: string; response: "PASS" }
  | { kind: "RESPOND_CONTACT"; choiceId: string; response: "CUT_IN"; cardId: string; abilityId: string }
  | { kind: "RESPOND_CONTACT"; choiceId: string; response: "DISGUISE"; cardId: string };
export type Command = { matchId: string; commandId: string; actorId: PlayerId; expectedRevision: number; intent: Intent };
export type CommandResult = { accepted: true; revision: number; duplicate: boolean } | { accepted: false; code: string; message: string; category: "UnsupportedRule" | "UnsupportedFeature" | "InvalidCommand" };
export type DeepReadonly<T> = T extends object ? { readonly [P in keyof T]: DeepReadonly<T[P]> } : T;
export interface Rng {
  readonly algorithm: string;
  next(state: number, exclusiveMax: number): { value: number; state: number };
}
