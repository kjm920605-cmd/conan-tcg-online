# Phase 5B runtime review

Reviewed 2026-09-09, including a final follow-up. Scope: current `src/server/managers.ts`, `src/server/match.ts`, `src/server/persistence/model.ts`, `src/server/persistence/memory.ts`, `src/server/index.ts`, `packages/protocol/index.ts`, `docs/phase5b-plan.md`, and subsequently `src/server/persistence/postgres.ts`, `src/server/persistence/schema.ts`, `db/migrations/0001_persistent_matches.sql`, `src/client/OnlineGameClient.ts`, and `apps/server/index.ts`. Prior Engine implementation, broad UI, and multi-server scaling are outside this review. No Git repository or historical diff was assumed. No production files were edited.

## Final findings

No unresolved actionable correctness or security finding was identified in the final bounded scope. This is a code review and targeted verification result, not a claim that the root task's full PostgreSQL/browser gates have completed.

## Resolved initial finding

### P2 — Close or recover a connection whose initial session transaction fails — fixed

Location: `src/server/managers.ts:48–52`, with the generic error handler at lines 30–32 and the session guard in `receive()`.

If `createSession()` rejects during a transient database outage, `connect()` never calls `#attach()`. The generic queue handler sends `PERSISTENCE_ERROR`, but leaves the connection open and absent from `#connections`. After the database recovers, every message on that connection, including an authenticated resume request, is rejected as `INVALID_SESSION`. There is no wire command that retries initial session creation. A client must independently discard the apparently connected socket before recovery is possible.

Reproduced with a `MemoryStore` subclass whose first `createSession()` throws and whose subsequent calls work, using the actual `RoomManager`. After `connect()` and then `CREATE_ROOM`, the observed result was `closed: false` and rejection codes `[PERSISTENCE_ERROR, INVALID_SESSION]`. Close failed-initialization connections after reporting the error, or implement an explicit safe retry path; preserve existing durable resume credentials on the client. Add a fail-once initialization test proving a new connection can recover.

Final disposition: `connect()` now catches initialization persistence failure, sends the structured error, and closes the connection. The new boundary test verifies that the failed socket closes and a subsequent connection successfully creates a room. Client restore rejection disconnects while retaining original credentials; a separate test verifies successful retry after storage recovery.

## Verified architecture

- Gameplay prepares a separate restored Engine draft; successful receipts, snapshots, and match metadata are awaited before runtime swap and ACK. Every exception from `commitGameplay()` evicts the cached runtime, so a lost COMMIT response cannot cause continued use of a guessed state version.
- One promise queue serializes connection, room, resume, and gameplay work. Rejections are caught before the queue is reused. Lazy loading occurs inside this queue and caches one runtime per match ID.
- Restore checks current content/engine/ruleset compatibility, snapshot version and hash, record identity/status/outcome, then calls `GameEngine.restore()` without advancing the Engine. Packet generation retains the existing projection boundary.
- Resume compares SHA-256 token hashes with `timingSafeEqual`, validates a match before changing authentication bindings, and removes the previous connection mapping before closing that connection. Durable records contain no plaintext token.
- Actor selection comes from durable room membership; duplicate receipts require the same actor and canonical envelope. Views are generated separately for each seat. No new raw snapshot or hash payload was found in the protocol.
- `MATCH_FINISHED` and `SESSION_RESTORED` are intentional behavior and are not regressions in this review. RQ-002/009/012/013/014/023/025/027 remain BLOCKING.
- PostgreSQL gameplay transaction combines version CAS, command insert, snapshot insert, and room status update. Its promise resolves after the Drizzle transaction commits. SQL keys enforce unique command IDs and accepted result versions per match; snapshot keys prevent overwriting a version. The room-to-match foreign key is deferred so initial room/match/snapshot creation can commit together.
- The migration validates token hashes and bounds match/snapshot versions, checks terminal timestamps/outcomes, and preserves required session/match foreign keys. Schema identifiers are restricted before interpolation. Normal server startup selects PostgreSQL and requires `DATABASE_URL`; memory mode is explicitly selected and never used as a database-error fallback.

## Executed checks and remaining evidence

Final independently executed command: `node --import tsx --test tests/server.test.ts tests/persistent-memory.test.ts tests/durability-boundary.test.ts`: **11 passed, 0 failed**. Coverage includes active restart with equal packet/state/decision and duplicate receipt, waiting-room readiness, roomless resume, wrong token, connection replacement, ownership, stale/reused commands, hidden opponent hands/options, disconnect persistence, malformed frames, and payload bounds.

The five added boundary tests verify initialization recovery, no ACK/view/runtime mutation before delayed commit, pre-commit failure recovery, commit-success-then-throw recovery with duplicate receipt and unchanged durable state, and client retry with retained credentials. These directly close the important initial review evidence gaps around commit uncertainty and queue recovery.

Also read `tests/db/store.test.ts` and `tests/db/recovery.test.ts`. They exercise real transactional rollback, simultaneous resumes, waiting/active/pending/blocked/finished recovery, incompatible versions/RNG, snapshot corruption/missing latest version, hash-only tokens, duplicate receipts, and unavailable PostgreSQL. Their final execution and browser process-restart evidence remain owned by the root task; this reviewer did not rerun those suites. The root reported browser A/B/C/D passing 4/4 during the final review dispatch.

The initial minor RNG diagnostic observation is also resolved: a configured RNG algorithm mismatch now returns `VERSION_INCOMPATIBLE` before Engine restoration; malformed state remains rejected.
