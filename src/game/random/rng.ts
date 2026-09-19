import type { GameState, Rng } from "../model.ts";
import { check, integer } from "../persistence/json.ts";

// Versioned, pure xorshift32. Rejection sampling avoids modulo bias.
export const seededRng: Rng = Object.freeze({
  algorithm: "xorshift32-rejection-v1",
  next(state: number, exclusiveMax: number) {
    check(integer(exclusiveMax, 1) && exclusiveMax <= 0xffffffff, "RNG_BOUND");
    let next = state >>> 0;
    const limit = Math.floor(0xffffffff / exclusiveMax) * exclusiveMax;
    do {
      next = next || 0x6d2b79f5;
      next ^= next << 13; next ^= next >>> 17; next ^= next << 5;
      next >>>= 0;
    } while (next > limit);
    return { value: (next - 1) % exclusiveMax, state: next };
  },
});
export function randomInt(state: GameState, rng: Rng, max: number): number {
  const next = rng.next(state.rng.state, max);
  check(integer(next.value) && next.value < max && integer(next.state), "RNG_RESULT");
  state.rng.state = next.state;
  state.rng.cursor++;
  return next.value;
}
export function shuffle(state: GameState, rng: Rng, cards: string[]): void {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(state, rng, i + 1);
    [cards[i], cards[j]] = [cards[j]!, cards[i]!];
  }
}
