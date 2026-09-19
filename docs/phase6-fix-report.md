# Phase 6 review corrections

Date: 2026-09-13 (Asia/Taipei). These changes affect deployment and development loading only. The 85 protected Engine, rule and card-data files remain byte-identical to the Phase 6 baseline.

## P1: bounded connection lifecycle

`bindGameSockets` now reserves two units before production WebSocket admission: one for the connect job and one for eventual disconnect cleanup. These use the same 256-unit budget as queued gameplay. Connect completion releases its unit; cleanup releases its unit only after its authoritative queue job completes. A closed socket cannot bypass the budget by disappearing from the live-client count. Invalid or aborted handshakes release both unused reservations. Shutdown prevents new reservations and drains admitted work. No RoomManager or Engine sequencing was changed by this fix.

`tests/production-lifecycle.test.ts` was executed against the original implementation: **3 failed, 1 passed**. After the fix: **4 passed**. Coverage:

- Paused session store + 300 short-lived upgrades admits 128, rejects 172 with HTTP 429; rejected clients create no session. Service resumes after the queue drains.
- Four active clients with 32 queued messages share capacity with lifecycle jobs; overflow is rejected before execution.
- A stalled disconnect keeps its reservation; server close waits for cleanup.
- Invalid WebSocket handshakes do not leak capacity or create sessions.

The original reviewer reproducer remains under ignored `tmp/phase6/review-queue-repro.mjs`; durable regression coverage is in `tests/`.

## P2: Caddy runtime error redaction

The default ERROR logger now uses a JSON filter deleting the complete `request` field, including URI/query and headers. HTTP access logs remain disabled. The application keeps its existing allowlist logger; safe Caddy operational error messages remain available.

`scripts/test-caddy-redaction.ts` adapts the repository Caddyfile, substitutes only local test transport/admin settings, starts the actual proxy with an unavailable upstream, and submits synthetic query/cookie/header canaries. It requires a 502 and an `http.log.error` record, then verifies that neither request objects nor canaries appear in logs. Before the filter it **failed with request-data exposure**; after the filter it **passed**.

Reproduction (set `CADDY_BIN` to an installed binary path):

```sh
node scripts/test-caddy-redaction.ts
```

Verified artifact: official **Caddy 2.10.2 Windows amd64**, downloaded to ignored `tmp/phase6/caddy/`. Archive SHA-256: `9fd1ef9be5d9b05852b66ccc25f96f23d8651bcab20779861a745bdffa273722`. This proves local runtime redaction, not Docker execution, a public certificate or Internet deployment. An operator must validate the selected pinned container image on the target.

Sources: [Caddy runtime log configuration](https://caddyserver.com/docs/caddyfile/options#log), [filter encoder](https://caddyserver.com/docs/caddyfile/directives/log#filter), [tested release](https://github.com/caddyserver/caddy/releases/tag/v2.10.2).

## Development first-load regression

The original Local E2E failed twice at its initial five-second handoff assertion. The trace showed React's loading fallback and an unfinished request for `LocalBootstrap.tsx`; no Engine action had occurred. The same test passed with a prepared Vite process. Development now warms the Local and Online entry modules using [Vite server.warmup](https://vite.dev/config/server-options.html#server-warmup). The complete original Browser suite then passed **8/8** from a newly started server. Existing test assertions and timeouts were retained; production bundle exclusion remains tested.

Broad checks and external acceptance gaps are recorded in [phase6-results.md](phase6-results.md). All eight BLOCKING RQs remain unchanged. Both security corrections were independently reverified; see [phase6-review.md](phase6-review.md).
