# Phase 4 focused boundary review

Date: 2026-09-08. Read-only implementation review of the Phase 4 plan, client projection/action adapter, GameEngine.preview, local controller, App and browser bootstrap. This report is the only file written by the reviewer. Broad tests and browser verification are owned by the parent task and were not repeated here.

## Findings

No remaining concrete privacy, legality, handoff, or restore blocker was identified in the reviewed implementation after the controller continuation fix below. This is a focused code review, not a claim that the complete browser acceptance matrix has passed.

### Resolved during review: restored automatic frames could stall

Previously `LocalController.restore/importSnapshot` accepted a valid snapshot with pending automatic frames and no choice, but `ready()` only exposed its view. The action adapter correctly offered no main actions while frames remained, leaving no UI path to advance. The parent fixed `ready()` to call bounded `#advance()` before `#refresh()` (`src/local/controller.ts:52`). The revised refresh still removes the viewer if advancement changes the required actor. Code inspection confirms the fix addresses both restored AUTO frames and frames that advance into another player's decision. The parent owns its regression test result.

## Boundary checks

- `src/game/client/index.ts:12`: face-up cards are public; only the viewer's HAND is an additional visibility exception. Own DECK, FILE, EVIDENCE, SET and UNDER do not gain visibility from ownership. Concealed cards expose no instance/definition identifier.
- `src/game/client/index.ts:34`: projected events exclude raw detail and cause, and check card identifiers against current visibility. Previously revealed investigation cards lose their event identity again after returning face down. Frame projection omits source IDs, revealed arrays and pending-effect internals.
- Decisions expose candidate details only to their owner. Current choice kinds originate from validated engine choices: own hand, public field, public investigation reveal, or effect identifiers. Opponent-owned choices return WAITING with no candidates or actions.
- `src/game/client/index.ts:77` and `GameEngine.ts:42`: action availability comes from dispatch on an isolated engine state. The original state, receipts and seeded RNG state are not committed by preview. The adapter does not invent a second legality validator; multi-selection and ordering are validated by the engine when submitted.
- `src/local/controller.ts:40`: required actor prioritizes `choice.playerId` over turn owner, covering Mislead, Guard, Contact and effect-order responses. A different required actor clears the viewer synchronously and removes view, actions and decision from the published snapshot.
- `src/ui/App.tsx:100`: handoff returns a separate tree before rendering board, decisions or developer tools. Developer state and import text are unmounted, rather than concealed with CSS. Ready resets highlight state. Neither serialized engine data nor localStorage stores viewer readiness.
- Developer Reveal/Export/Copy are explicitly labeled as full private-state access, are behind the development flag, and reveal data only after an explicit action. Ordinary board/decision props use projected data. Local browser storage and developer export remain trusted host features, as the plan specifies; they are not a network privacy boundary.
- `src/local/controller.ts:70`: import calls GameEngine.restore before replacing the active engine, rejects oversized text, and locks successful imports. Invalid restore preserves the existing engine. `src/ui/main.tsx` imports styles and restores through the controller.
- UnsupportedRule codes remain engine errors or RULE_BLOCKED status; the UI formats them without adjudicating them. No reviewed Phase 4 adapter/controller code resolves a BLOCKING question.

## Verification limits

Inspected existing projection/controller tests and the relevant engine move, investigation, choice and declaration rules. Did not rerun the parent-owned full suite or E2E. Browser checks should explicitly cover handoff after a revealed developer snapshot, mid-contact handoff, hidden investigation ordering after confirmation, and restored pending decisions. Generic optional/target decision kinds outside the current engine Choice union remain unsupported, as already scoped in the Phase 4 plan.
