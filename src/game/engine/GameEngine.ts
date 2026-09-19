import type { Command, CommandResult, Content, CreateOptions, DeepReadonly, GameState, Intent, Rng } from "../model.ts";
import { assertJson, check, exactKeys, fingerprint, freeze, integer } from "../persistence/json.ts";
import { validateContent } from "../content/validate.ts";
import { validateState } from "./invariants.ts";
import { createState } from "./create.ts";
import { applyCommand } from "../procedures/commands.ts";
import { advanceState } from "../procedures/advance.ts";
import { seededRng } from "../random/rng.ts";

/** Trusted host API. No public mutable state, arbitrary effect command or state setter. */
export class GameEngine {
  #state: GameState;
  #content: Content;
  #rng: Rng;

  private constructor(state: GameState, content: Content, rng: Rng) {
    validateState(state, content);
    this.#state = state;
    this.#content = content;
    this.#rng = rng;
  }
  static #contentCopy(content: Content): Content {
    validateContent(content);
    return freeze(structuredClone(content)) as Content;
  }
  static create(options: CreateOptions, content: Content, rng: Rng = seededRng): GameEngine {
    const copy = this.#contentCopy(content);
    return new GameEngine(createState(options, copy, rng), copy, rng);
  }
  /** Restore is for trusted persistence, never a client command or client-supplied snapshot. */
  static restore(json: string, content: Content, rng: Rng = seededRng): GameEngine {
    const copy = this.#contentCopy(content);
    const state = JSON.parse(json) as GameState;
    check(state && state.contentFingerprint === fingerprint(copy), "CONTENT_MISMATCH");
    check(state.rng?.algorithm === rng.algorithm, "RNG_MISMATCH");
    return new GameEngine(state, copy, rng);
  }
  getState(): DeepReadonly<GameState> { return freeze(structuredClone(this.#state)); }
  serialize(): string { return JSON.stringify(this.#state); }

  /** Run the real command validator against an isolated state; never commit the draft. */
  preview(actorId: string, intent: Intent): CommandResult {
    const copy = new GameEngine(structuredClone(this.#state), this.#content, this.#rng);
    let commandId = `preview-${this.#state.revision}`;
    while (Object.hasOwn(this.#state.commandReceipts, commandId)) commandId += "-next";
    return copy.dispatch({ matchId: this.#state.matchId, commandId, actorId, expectedRevision: this.#state.revision, intent });
  }

  dispatch(command: Command): CommandResult {
    try {
      assertJson(command);
      exactKeys(command, ["matchId", "commandId", "actorId", "expectedRevision", "intent"], "COMMAND_FIELDS");
      const commandFingerprint = fingerprint(command);
      const receipt = Object.hasOwn(this.#state.commandReceipts, command.commandId) ? this.#state.commandReceipts[command.commandId] : undefined;
      if (receipt) {
        check(receipt.fingerprint === commandFingerprint, "COMMAND_ID_REUSED");
        return { accepted: true, revision: receipt.revision, duplicate: true };
      }
      const draft = structuredClone(this.#state);
      applyCommand(draft, this.#content, this.#rng, command);
      draft.revision++;
      draft.commandReceipts[command.commandId] = { fingerprint: commandFingerprint, revision: draft.revision };
      validateState(draft, this.#content);
      this.#state = draft;
      return { accepted: true, revision: draft.revision, duplicate: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.split(":")[0]!.replace("RULE-QUESTION-", "RULE_QUESTION_");
      const category = code.startsWith("RULE_QUESTION_") ? "UnsupportedRule" : code.startsWith("UNSUPPORTED") ? "UnsupportedFeature" : "InvalidCommand";
      return { accepted: false, code, message, category };
    }
  }
  /** Exactly one automatic step. Revision advances only when something happens. */
  advance(): boolean {
    const draft = structuredClone(this.#state);
    if (!advanceState(draft, this.#content, this.#rng)) return false;
    draft.revision++;
    validateState(draft, this.#content);
    this.#state = draft;
    return true;
  }
  runUntilDecision(budget = 10000): "IDLE" | "STEP_LIMIT" {
    check(integer(budget, 1), "STEP_BUDGET");
    for (let i = 0; i < budget; i++) if (!this.advance()) return "IDLE";
    return this.#state.status !== "PLAYING" || this.#state.choice || this.#state.frames.length === 0 ? "IDLE" : "STEP_LIMIT";
  }
}
