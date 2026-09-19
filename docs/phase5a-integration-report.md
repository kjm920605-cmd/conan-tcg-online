# Phase 5A real WebSocket integration report

`tests/online-gameplay.test.ts` adds five real TCP/WebSocket two-peer integration tests. The helper starts the public server on an ephemeral localhost port, validates every inbound ServerMessage and outbound ClientMessage, and conducts Create/Join/Ready before gameplay. It uses only trusted content, CreateOptions and an injected deterministic RNG for fixtures; no GameState mutation, restore fixture, direct Engine dispatch or match manager command bypass is used. Host inspection is read-only for privacy and immutable-state assertions.

Coverage:

- Two mulligans, including a nonempty random redraw; both envelopes replay after advancement without changing state, RNG, receipts, revision or stateVersion.
- Two turns of normal character play and Partner Deduction, repeated Deduction envelope with no repeated sleep/evidence costs, then turn-three Action against Case, actual character Guard, Contact, Cut-in drawing two cards and remaining response passes.
- Wrong decision owner and stale choice id with the current outer stateVersion are rejected. Accepted Guard and Cut-in replay identically after their decision advances and have no additional costs or random changes.
- Disconnect and authenticated resume preserve the exact latest packet and server snapshot. The resumed actor performs ASSIST; attempting FILE Partner Deduction returns RULE_QUESTION_025 and RULE_BLOCKED without changing state, then END_MAIN continues legally.
- Both peers receive identical EMPTY_DECK GAME_FINISHED output from an actual multi-turn match. A later command is rejected with MATCH_STOPPED and preserves the finished state.
- A separate trusted content fixture legally gains FILE/evidence, uses ASSIST, advances through another turn, and ends with CASE_SOLVED. Replaying the accepted solving command does not change the terminal result.
- Legal triggered source departure produces RULE-QUESTION-012; removal followed by another source operation produces RULE-QUESTION-014. Both peers receive RULE_BLOCKED and GAME_VIEW status/blocked data, with null outcome. Unsupported questions are retained, not adjudicated.
- Every command checks both complete serialized PlayerPackets, including legalActions and decision, against every currently concealed instance id from trusted server inspection. WAITING decisions expose empty candidates/actions. Projection objects contain no RNG, receipts, pending effects or content fingerprint. Every received wire message must pass the shared strict runtime schema.

Validation: `node --import tsx --test tests/online-gameplay.test.ts`: **5 passed, 0 failed**. `npx tsc --noEmit`: **passed**. Initial integration attempts exposed fixture-flow assumptions (effects require CHOOSE_EFFECT; deck exhaustion may end during Deduction), which were corrected in tests. No server or protocol production changes were necessary.

Owned changes: `tests/online-fixtures.ts`, `tests/online-gameplay.test.ts`, this report. Broader regression/browser execution remains the parent task's integration gate.
