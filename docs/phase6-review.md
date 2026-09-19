# Phase 6 deployment and Closed Alpha review

Initially reviewed 2026-09-12 against `docs/phase6-plan.md`; P1/P2 fixes independently re-reviewed and verified 2026-09-13. This is a bounded review of the deployment boundary, configuration, transport, persistence integration and production Web. No Git repository exists, so references describe the files inspected rather than an invented commit range. Production/Engine code was not edited by the reviewer; the reviewer wrote this report and a synthetic local reproducer.

## Current assessment after correction

**P1 and P2 resolved within the reviewed implementation.** Independent local reproduction and the targeted lifecycle/Caddy tests pass. No additional actionable issue was found in this follow-up, which was limited to the two fixes. Phase 6 Internet deployment remains incomplete: no actual public target/domain/access, container execution or different-network Device A/B evidence has been supplied.

P1 now reserves two slots in the same `totalPending` budget before WebSocket upgrade: one for connection initialization and one held until ordered disconnect cleanup finishes. Gameplay uses that same budget. Release callbacks are idempotent, rejected handshakes cancel both unused reservations, and completed admissions transfer reservation ownership to the connection lifecycle. Cleanup remains permitted even when the budget is full.

P2 now applies a filter to the default ERROR logger and deletes its `request` object while retaining operational error records. The local regression adapts the actual repository Caddyfile with a loopback HTTP listener and unreachable loopback upstream; these test-only substitutions do not establish public TLS or container behavior.

Independent follow-up execution on 2026-09-13:

| Check | Observed result |
| --- | --- |
| `node --import tsx tmp/phase6/review-queue-repro.mjs` | 128 upgrades accepted, 172 rejected; one session job began while blocked; 128 ran after release. The two slots per admission stay within the 256-slot budget. Exit 0. |
| `node --import tsx --test tests/production-lifecycle.test.ts` | 4 passed / 0 failed. Covers stalled connection initialization, mixed gameplay/lifecycle saturation, retained cleanup and shutdown drain, and cancellation of invalid handshakes with subsequent successful admission. Exit 0. |
| `tmp/phase6/caddy/caddy.exe version` | Confirmed `v2.10.2`. |
| `CADDY_BIN=tmp/phase6/caddy/caddy.exe` with `node scripts/test-caddy-redaction.ts` | Returned 502, preserved `http.log.error`, omitted its request object and all synthetic query/Cookie/User-Agent canaries. Exit 0. |

## Assessment at initial review

**With fixes (initial assessment; both findings are now resolved above).** Two actionable findings were sent to the coordinating agent for correction. Deployment and different-network acceptance remain incomplete independently of these findings: a real target/domain/access and Device A/B evidence are absent. Docker/Caddy execution was unavailable at the initial review; a local Caddy binary became available for follow-up verification. Local HTTPS/WSS browser contexts do not establish Internet deployment or different-network access.

## Findings

### P1 — Connection lifecycle work bypasses the shared pending-work bound

- Original locations: `src/server/index.ts:36` (only gameplay messages count toward `totalPending`), `src/server/index.ts:44` and `:47` (uncounted disconnect/connect), `src/server/production.ts:138` (upgrade checks live sockets only).
- A stalled store leaves `RoomManager.connect()` in the same serialized authority queue as gameplay. Closing a WebSocket removes it from the 100-live-client check, but its connect and disconnect jobs remain queued. Repeating this across admitted source IPs accumulates work without reaching the configured 256-pending guard. PostgreSQL timeouts then apply serially to the backlog, delaying legitimate matches and shutdown. This does not require any gameplay message.
- Reproduced locally with a deliberately paused in-memory store and 300 short-lived authorized WebSockets. The synthetic `X-Forwarded-For` values model separate clients at a trusted proxy, not spoofing through the supplied Caddy configuration. Initial output was `upgradedWhileAuthorityBlocked=300`, `databaseSessionJobsStartedBeforeRelease=1`, `configuredCommandQueueLimit=256`; after releasing the store, all 300 session jobs ran.
- Durable reproducer: `tmp/phase6/review-queue-repro.mjs`; run `node --import tsx tmp/phase6/review-queue-repro.mjs`. It uses no real credentials, PostgreSQL or public endpoints and reports rejected upgrades after a fix as well.
- Fix: reserve/count connect, gameplay and required disconnect cleanup in the same admission budget before upgrades are accepted; retain lifecycle ordering and always perform bounded cleanup. Add a delayed-store churn regression proving both bounded admission and recovery after the queue drains.
- Status after 2026-09-13 re-review: **resolved and independently verified** by the original reproducer and all four lifecycle regressions; details appear in the current assessment above.

### P2 — Proxy error logging still records full request URLs

- Original location: `deploy/Caddyfile:3`–`:5`. Setting only the default log level to `ERROR`, while omitting an HTTP access log, does not redact runtime error logs.
- During an unreachable/stopped game upstream, Caddy's HTTP error logger records a request object whose URI contains the original query string. A request such as `/?alpha=PRIVATE_CANARY` can therefore place its query in proxy logs, violating the explicit no-query-URLs logging constraint. The application logger itself avoids this. Default Caddy redaction covers Cookie and Authorization header values; this finding does **not** claim those headers leak.
- Primary-source verification at initial review: Caddy v2.10.2 [server.go](https://github.com/caddyserver/caddy/blob/v2.10.2/modules/caddyhttp/server.go#L402) emits 5xx failures at ERROR; [marshalers.go](https://github.com/caddyserver/caddy/blob/v2.10.2/modules/caddyhttp/marshalers.go#L43) serializes the raw request URI and applies credential redaction only to named headers. The upstream source examined then retained this behavior. Caddy runtime verification was subsequently performed during the follow-up above.
- Fix: filter/delete request objects for every runtime error logger that can include them, or suppress those namespaces and preserve safe operational diagnostics separately. Validate the chosen pinned Caddy artifact with a stopped upstream and query/header canaries before public deployment.
- Status after 2026-09-13 re-review: **resolved and independently verified with local Caddy 2.10.2**. The actual Caddyfile's logger filter preserves proxy errors and removes request/query/header canaries. Verification of the operator-selected container image remains unavailable.

## Checks with no additional actionable finding

- Origin and alpha-cookie checks occur before `handleUpgrade()` and before `PlayerSession` creation. Same-origin HTTP JSON admission, exact CORS/preflight, secure HttpOnly Strict cookies, expiry/rotation and independent resume credentials are consistent with the plan.
- The provided Compose file publishes only Caddy's HTTP/HTTPS ports; game has no host port. Caddy overwrites forwarded client IP and the app uses it only under explicit `TRUST_PROXY=true`. Other deployment topologies must preserve that private-proxy boundary.
- Production HTTP/WSS bounds payloads, checks messages before gameplay queueing, provides heartbeat and fixed-size rate buckets, and returns safe domain/transport errors without raw database exceptions. The lifecycle exception recorded as P1 has been corrected and verified above.
- `RoomManager` still creates a draft Engine, commits the snapshot/receipt first, and publishes the new authority/ACK afterward. A failed commit evicts cached authority; restored sessions still require the original token hash and successful compatible snapshot validation before rebinding. Logging does not add Engine operations.
- Readiness checks PostgreSQL connectivity, the migration marker and all five required tables. Production startup errors and migration failures emit fixed codes. Runtime entry files use erasable TypeScript; the Docker runtime copies their server, package, data and migration dependencies. Frozen lockfile build, non-root runtime, read-only filesystem and immutable operator-selected image references are present. Actual container build/start, migration and rollback remain unexecuted here.
- The production client validates same-origin HTTPS/WSS configuration, avoids build-time server secrets, submits codes in a JSON POST, clears the form, and keeps the client mounted during reauthorization so pending commands and resume credentials survive. Existing client/game authority boundaries remain intact.
- A focused scan of the currently built JavaScript found no `GameEngine`, `LocalGameClient`, `Developer tools`, `Reveal private snapshot`, `exportSnapshot`, `SESSION_SECRET` or `DATABASE_URL` markers. This is a marker scan, not a proof against arbitrary secrets. Real `.env` files were not read.
- Independently compared the protected baseline manifest against the workspace: **85 files checked, 0 mismatches**. Engine, rule documents and card data remain identical to that baseline; existing blocking rule questions were not resolved or reclassified by this review.

## Evidence limits

The coordinator reported passing security (15), transport (9), targeted server/durability checks, production TLS browser tests (2) and subsequently `npm test` (307/307). This reviewer did not rerun all broad tests. The initial 85-file baseline comparison and local churn reproduction, followed by the corrected churn reproduction, four lifecycle tests and local Caddy 2.10.2 redaction test, were executed directly by the reviewer. The follow-up changed only this report, not production code. Public TLS certificates, deployed WSS/readiness, real hosted PostgreSQL restart recovery, the chosen Docker/Caddy container artifact and devices on different networks still require deployment evidence.
