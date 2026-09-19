import type { GameState, PendingEffect } from "../model.ts";
import { check } from "../persistence/json.ts";
import { otherPlayer } from "../engine/state-helpers.ts";

/** Pending effects are a selectable collection, not a FIFO or a LIFO stack. */
export class EffectQueue {
  static eligible(state: GameState): PendingEffect[] {
    const turn = state.pendingEffects.filter(e => e.controllerId === state.turn.playerId);
    return turn.length ? turn : state.pendingEffects.filter(e => e.controllerId === otherPlayer(state, state.turn.playerId));
  }
  static take(state: GameState, actor: string, effectId: string): PendingEffect {
    const effect = this.eligible(state).find(e => e.controllerId === actor && e.id === effectId);
    check(effect, "EFFECT_PRIORITY");
    state.pendingEffects.splice(state.pendingEffects.findIndex(e => e.id === effectId), 1);
    return effect;
  }
}
