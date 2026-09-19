import { GameEngine } from "../game/engine/GameEngine.ts";
import type { Content, CreateOptions, Intent, Rng } from "../game/model.ts";
import { seededRng } from "../game/random/rng.ts";
import { freeze } from "../game/persistence/json.ts";
import { getLegalActions, getPendingDecision, projectGameState } from "../game/client/index.ts";
import type { ClientSnapshot, GameClient } from "../client/GameClient.ts";
import { displayError } from "../client/errors.ts";
export { displayError } from "../client/errors.ts";

export type LocalSnapshot = ClientSnapshot;

/** Trusted local host. React receives only this controller's projected snapshot. */
export class LocalController implements GameClient {
  readonly development = { exportSnapshot: () => this.exportSnapshot(), importSnapshot: (json: string) => this.importSnapshot(json) };
  #engine: GameEngine;
  #content: Content;
  #rng: Rng;
  #viewer: string | null = null;
  #error: string | null = null;
  #snapshot!: LocalSnapshot;
  #listeners = new Set<() => void>();
  private constructor(engine: GameEngine, content: Content, rng: Rng) {
    this.#engine = engine; this.#content = freeze(structuredClone(content)) as Content; this.#rng = rng;
    this.#refresh();
  }
  static create(content: Content, options: CreateOptions, rng: Rng = seededRng): LocalController {
    return new LocalController(GameEngine.create(options, content, rng), content, rng);
  }
  static restore(content: Content, json: string, rng: Rng = seededRng): LocalController {
    return new LocalController(GameEngine.restore(json, content, rng), content, rng);
  }
  getSnapshot = (): LocalSnapshot => this.#snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener); return () => { this.#listeners.delete(listener); };
  };
  #refresh(): void {
    const state = this.#engine.getState();
    const requiredPlayerId = state.choice?.playerId ?? state.turn.playerId;
    if (this.#viewer !== requiredPlayerId) this.#viewer = null;
    const view = this.#viewer ? projectGameState(state, this.#viewer, this.#content) : null;
    this.#snapshot = freeze({ requiredPlayerId, status: state.status, view,
      actions: this.#viewer ? getLegalActions(this.#engine, this.#content, this.#viewer) : [],
      decision: this.#viewer ? getPendingDecision(this.#engine, this.#content, this.#viewer) : null,
      error: state.blocked ? displayError(state.blocked.questionId) : this.#error,
    }) as LocalSnapshot;
    for (const notify of this.#listeners) notify();
  }
  ready(): void { this.#viewer = this.#snapshot.requiredPlayerId; this.#advance(); this.#refresh(); }
  lock(): void { this.#viewer = null; this.#error = null; this.#refresh(); }
  submit(intent: Intent): void {
    if (!this.#viewer) return;
    const state = this.#engine.getState();
    const result = this.#engine.dispatch({ matchId: state.matchId, actorId: this.#viewer, expectedRevision: state.revision,
      commandId: `local-${state.revision}-${state.nextId}`, intent });
    this.#error = result.accepted ? null : displayError(result.code, result.message);
    if (result.accepted) this.#advance();
    this.#refresh();
  }
  #advance(): void {
    try {
      if (this.#engine.runUntilDecision(2000) === "STEP_LIMIT") this.#error = "Automatic step limit reached; export the snapshot for diagnosis.";
    } catch (e) { this.#error = displayError(e instanceof Error ? e.message : String(e)); }
  }
  /** Explicit developer export: includes both players' private information. */
  exportSnapshot(): string { return this.#engine.serialize(); }
  importSnapshot(json: string): boolean {
    try {
      if (json.length > 10_000_000) throw new Error("Snapshot exceeds the local import size limit.");
      const restored = GameEngine.restore(json, this.#content, this.#rng);
      this.#engine = restored; this.#viewer = null; this.#error = null; this.#refresh(); return true;
    } catch (e) { this.#error = `Snapshot import failed: ${e instanceof Error ? e.message : String(e)}`; this.#refresh(); return false; }
  }
}
