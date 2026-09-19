# Phase 4 UI implementation

Files owned by UI subtask: `src/ui/App.tsx`, `src/ui/styles.css`, `tests/ui-render.test.ts`, this report. Bootstrap/content/config/controller/engine are owned by the parent task.

App receives only LocalController projected snapshots via useSyncExternalStore. Handoff returns an entirely separate cover branch, so board, actions, decisions, logs and DevPanel are unmounted. Ready delegates to the controller. Board shows partner/case/field/evidence/file/remove, deck count, opponent hand count and viewer hand; visible cards show effective AP/LP, level, orientation, keywords, attachment counts and modifiers.

Actions come from the engine adapter with disabled rejection reasons; hover/focus highlights source and target cards. MULTI_SELECT decisions maintain local selected IDs, ORDERED decisions maintain an explicit reorder list, and submissions extend the provided submitIntent. All remaining decisions use supplied actions. No component implements game rule validation. UI renders controller error text with Unsupported Rule formatting.

DevPanel exists only under import.meta.env.DEV, collapsed by default. Explicit reveal/export/copy operations call exportSnapshot; ordinary board rendering does not. Private reveal warns about both players' hands/decks, can be hidden, and is unmounted during handoff. Import file/text routes through controller.importSnapshot. LegalActions/EventLog/PendingDecision inspect projected data; PendingEffects is visible only following explicit private reveal. Private reveal is an explicit point-in-time capture, identified as such, and can be refreshed by hiding/revealing again.

Verification: parent initial browser test was RED before App existed. Added two real-controller SSR tests that verify locked rendering has no board/private children and calls no export, ready rendering contains zones and decision, and submitting the first mulligan removes prior viewer card identity. `node --import tsx --test tests/ui-render.test.ts` passed 2/2; `npm run typecheck` passed. Parent owns full browser interaction, visual QA, build, and complete suite.

Responsive styling uses dark green felt, cream text cards and amber action indicators without official artwork. No online feature or rule implementation was added.
