import type { Intent } from "../game/model.ts";
import type { LegalAction, PendingDecision, PlayerView } from "../game/client/index.ts";

export type ClientSnapshot = { requiredPlayerId: string; status: string; view: PlayerView | null; actions: LegalAction[]; decision: PendingDecision | null; error: string | null };
export type DevelopmentTools = { exportSnapshot(): string; importSnapshot(json: string): boolean };
/** UI boundary: no Engine, GameState, RNG or zone mutation API. */
export interface GameClient {
  getSnapshot(): ClientSnapshot;
  subscribe(listener: () => void): () => void;
  ready(): void;
  lock(): void;
  submit(intent: Intent): void;
  readonly development?: DevelopmentTools;
  readonly privateCoverLabel?: string;
}
