# Phase 4 engine-facing client adapter

Implemented `src/game/client/index.ts` and isolated `GameEngine.preview(actorId, intent)`.

- `projectGameState` exposes face-up cards publicly and the viewer's own hand. Other concealed cards are anonymous placeholders, retaining only zone counts. No raw state, RNG, receipts, pending programs, hidden frame identifiers, or arbitrary event detail/cause is returned. Investigation reveals appear while face-up and disappear from the complete projection after resealing.
- Public cards include orientation, effective AP/LP through existing engine stat functions, active keywords, attachment counts, and suppression. Public modifiers and subflow kind/step summaries are included.
- `getLegalActions` enumerates candidate intents and runs every candidate through the actual engine command validator on a copied state. Disabled choices retain the actual error code/category. Partner deduction includes the FILE Partner RQ-025 refusal. No timing, eligibility, or effect rules are reimplemented.
- `getPendingDecision` supplies action decisions, Mulligan/Mislead batch templates, and Investigation ordered templates. Other viewers receive `WAITING` with no candidates or intents. User-selected arrays still go through normal engine dispatch validation.

Verification: initial tests failed with missing client module. Then `node --test tests/player-view.test.ts tests/legal-actions.test.ts` passed all 8 tests. Full suite during parallel implementation: 197 passed, one failed only because the parent's browser-hash module had not yet been created. Existing 185 tests passed. A final integrated suite is the parent's responsibility.

Eight BLOCKING rule questions, content, effect programs, snapshot schema, RNG state, and existing gameplay rules are unchanged. Preview does not automatically resolve effects; it reports whether the command can be accepted at the current decision boundary.

## Controller gameplay integration

Added `tests/local-gameplay.test.ts`: all 9 tests pass. Tests drive actual LocalController intents and projected views, with command-only RepresentativeSession snapshots for intermediate scenarios; no GameState mutation is used.

Coverage: optional Next Hint decline and Event play; restore pending choice; Deduction/Mislead selected batch; simultaneous effect ordering; Action/Guard/Contact/Cut-in; Disguise and retained attachment counts; public Investigation reveal and ordered selection followed by identity hiding; RQ-025 display with atomic rejection; resuming intermediate automatic frames; and a complete fixed 40-card Setup → Mulligan → many turns → normal empty-deck loss match. Every required-actor transition asserts that the controller removes the view, actions and decision until Ready, and each exposed view checks the other hand has no identifiers or names.

Commands: `node --test tests/local-gameplay.test.ts` (9/9), `npm run typecheck` (passed). No implementation fixes were needed in this bounded integration pass; the parent's concurrent resume-on-Ready change passes the intermediate-frame test.
