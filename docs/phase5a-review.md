# Phase 5A security and correctness review

Reviewed 2026-09-09: `src/server/managers.ts`, `src/server/index.ts`, `packages/protocol/index.ts`, `src/client/OnlineGameClient.ts`, with the existing projection implementation and Phase 5A plan. Read-only code review; only this report was written. Findings below describe the reviewed version and require follow-up verification after fixes.

Follow-up status, 2026-09-09: all three P2 findings below are **fixed and verified**. Original counterexamples are retained below, followed by the verification evidence.

## Findings

### P2 — Leaving a waiting room retains the departed room in the client

`OnlineGameClient.leaveRoom()` only sends the request. The server removes the seat and returns a fresh `SESSION`, but that client's `SESSION` handler does not clear its cached room. The resulting lobby still describes the departed room and allows a Ready request that the server rejects with `NOT_IN_ROOM`.

Verified against a real ephemeral WebSocket server using the actual `OnlineGameClient`: create room → leave → wait for server processing. `getLobbySnapshot().room` retained the same code and `connection` stayed `CONNECTED`; Ready subsequently produced `NOT_IN_ROOM`.

Minimal fix: clear departed room/game/pending state in the explicit leave lifecycle, while preserving the documented active-match reconnect credentials. Add a waiting-room leave regression asserting the room is null after the new session acknowledgment and a new room can be created. Parent agent has been notified and owns the fix.

### P2 — Room update enables cached actions before reconnect projection arrives

The client `ROOM_STATE` handler unconditionally sets `#resuming = false`. The server sends successful match resume messages in the order `SESSION`, `ROOM_STATE`, `RESYNC_STATE`. Consequently the middle message publishes the old packet's actions while the authoritative reconnect packet is still pending. This violates the planned disable-until-resync behavior and can produce obsolete submissions. Server version and decision checks still prevent an unauthorized or stale state mutation.

Verified by delivering runtime-valid messages through a controlled WebSocket implementation to the actual client with a real engine-generated packet. After resumed `SESSION`, actions were empty and `hasSession` false. After `ROOM_STATE`, before delivering any `RESYNC_STATE`, actions had length 1 and `hasSession` became true.

Minimal fix: a matched room update must not complete an in-progress resume; wait for its authoritative packet. A waiting room with no match may complete resume on `ROOM_STATE`. Normal peer room updates on an already connected client should remain ordinary lobby updates. Add a controlled-message regression covering the gap between room and projection messages. Parent agent has been notified and owns the fix.

## Reviewed boundaries with no additional concrete bypass found

- Actor identity is taken from the socket-bound session, not room code or gameplay payload. Strict wire objects reject extra actor/state/seed fields.
- Resume verifies the credential before reassignment. The old connection is removed from the authority map before it is closed; its subsequent close/error cannot clear the replacement connection. Wrong tokens and other-room active sessions are rejected.
- Match IDs are checked before gameplay and resync. Receipts bind command ID to actor and full message fingerprint; another seat cannot reuse an accepted command ID. Expected version gates new transactions, and choice ownership/choice ID are checked before dispatch.
- Command execution restores a private draft of the shared Engine, applies the command and bounded continuation, then swaps the engine only on success. No rule implementation was copied into the transport.
- Each seat gets its own projection and decision. Non-owner decisions contain empty candidates/actions; hidden cards contain only the hidden marker. The inspected projection excludes raw RNG, receipts, card tables, effect/frame payloads and free-form event causes. Resync uses the same projection path.
- The online client imports protocol runtime validation and game types, and exposes no full-state restore/export capability. Every received message traverses `ServerMessageSchema` before publication. Old socket callbacks check socket identity; older packets of the same match cannot overwrite newer versions.
- Transport bounds frame size and rejects malformed/binary input. Existing tests cover malformed frames, oversized close, owner/version/idempotency cases, private hand projection and authenticated replacement. This review does not substitute for the parent's final integration/browser gates.

Parent separately identified and owns the stale-rejection naming alignment and fresh-projection response for duplicate command acknowledgments. Account persistence, deployment hardening, rate limiting, matchmaking and other excluded production features were not requested as findings.

## Follow-up verification and UI integration review

The updated client clears its room, packet and pending commands when a changed session is acknowledged outside a resume. Its `ROOM_STATE` branch only completes resume when no match exists, leaving matched sessions disabled until the new projection. Both changes resolve the original counterexamples without discarding active-match reconnect credentials.

Independently ran `node --import tsx --test tests/online-client.test.ts`: **3 passed, 0 failed**. These cover projected seat resume, waiting-room leave/new-room creation, and a real WebSocket reconnect after the server state advances while the peer is disconnected. The latter observes all publications and rejects exposing the old version as a usable connected session.

Inspected `src/ui/main.tsx`, `OnlineScreen.tsx`, `LocalBootstrap.tsx`, and `App.tsx`: the entry point lazily selects one mode; only LocalBootstrap imports card content, fixture decks and LocalController. OnlineScreen constructs OnlineGameClient and persists only session credentials in sessionStorage keyed by server URL. The shared App imports game structures as types and renders only the supplied projection. Full-state dev tools require an explicit `controller.development` capability, which OnlineGameClient does not provide. No source-level online Engine initialization or complete-state API path was found.

### P2 — Active-match invalid-session recovery control is unreachable

In the reviewed OnlineScreen, the `INVALID_SESSION` explanation and `New anonymous session` button are nested inside the `lobby.stateVersion === null` lobby branch. An already-started match keeps its cached packet/version when disconnected. If the server restarts, Reconnect is rejected with `INVALID_SESSION`, but the non-null version keeps rendering App, so the only supplied resetSession control is absent. Repeated Reconnect reuses the invalid credentials. Reloading the whole page provides a workaround, but the active client lacks the intended in-app recovery action.

This is a source-level control-flow finding: `disconnect` and rejected resume retain `#packet`, and the UI branch excludes the recovery button whenever that packet has a version. Minimal fix: render invalid-session recovery outside the lobby-versus-game conditional. Parent agent has been notified; this report has not yet verified that fix.

Browser counterexample subsequently confirmed by `e2e/online-recovery.spec.ts`: establish a real two-browser match, close one routed connection, simulate a restarted server issuing a temporary session and rejecting the old resume token, then inspect the still-loaded page. `INVALID_SESSION` and retained stateVersion assertions passed; the test failed exactly because `New anonymous session` was absent. Command: `node node_modules/@playwright/test/cli.js test e2e/online-recovery.spec.ts --reporter=line` (1 failed as expected, exit 1). The regression also asserts that using the recovery control clears the board and enables Create Room once fixed. Direct package CLI was used because the stale `.bin/playwright` resolved a duplicate Playwright installation.

Parent verification: moved INVALID_SESSION recovery outside the lobby/game conditional. `npm run test:e2e -- e2e/online-recovery.spec.ts` passed 1/1, including retained version, visible recovery button, cleared board, and enabled Create Room. Final `npm run test:e2e` passed all 8/8; `npm test` and regression each passed 264/264. No reviewed P2 remains open. These checks do not claim production hardening beyond the requested MVP scope.
