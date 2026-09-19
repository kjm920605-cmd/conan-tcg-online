# Phase 6 Task 1: security primitives

Date: 2026-09-12. Scope: configuration, shared alpha admission and process-local rate limiting. No Engine, rules, card data, package or actual environment files were edited or read.

## Implemented interfaces

- `src/server/config.ts`: exports the exact `ProductionSettings`, `ServerConfig` and `readServerConfig(env)` interfaces in the plan. The reader uses only the supplied map; all error messages contain fixed field names, never submitted values.
- `src/server/access.ts`: exports `AlphaAccess(settings, now?)` with `acceptCode`, `issueCookie` and `verifyCookie`. SHA-256 digest comparison and HMAC-SHA-256 cookie verification use constant-time comparisons. Cookies contain a version, expiry, 192-bit random nonce and signature. They contain no alpha code, PlayerSession or game state. Signature parsing rejects noncanonical base64url, duplicates, control characters, malformed tokens and headers over 8 KiB.
- `src/server/rate-limit.ts`: exports `RateLimiter(now?).consume(key, policy)`. At most 10,000 buckets and 512 characters per key; positive safe integer quotas/windows; maximum window 24 hours. Live quotas are never evicted at saturation. Expired records are swept at most once per second during traffic; a requested expired key is reset immediately. Saturation can conservatively deny a new key for up to one second after another bucket expires. There are no background timers or retained resources to close.

## Configuration contract

`NODE_ENV` defaults to `development`. Existing PostgreSQL-by-default startup behavior remains: missing `DATABASE_URL` fails; ephemeral mode requires explicit `MATCH_STORAGE=memory` and is forbidden in production. Development/test retain loopback host and port 8787 defaults and may explicitly use port 0. Production defaults to host `0.0.0.0`; its port must be 1–65535. Database schema validation matches the existing persistence schema rule. Log levels are `debug`, `info`, `warn`, `error`, `silent` (default `info`).

Production requires `WEB_PUBLIC_URL`, `GAME_SERVER_PUBLIC_URL`, `CORS_ORIGINS`, `SESSION_SECRET` and `ALPHA_ACCESS_SECRET`. Public endpoints must be canonical HTTPS origin / WSS `/ws`, with identical host and port. Web URL may end with one slash and is normalized to the origin. Local/private hosts, unsafe schemes, credentials, query markers, fragments, normalized path tricks, wildcard and foreign/malformed origins are rejected. The same-origin allowlist is deduplicated.

Secrets must be distinct, 32–512 characters, have at least eight distinct characters, and must not be repetitive or contain known placeholder forms/whitespace. This catches weak fixtures and common deployment mistakes; it cannot establish randomness. Deployment must generate independent random secrets. Errors do not echo them.

`TRUST_PROXY` accepts only explicit `true` or `false`, default `false`. Transport must enforce the restricted-proxy assumption before trusting forwarded IP headers. `ALPHA_TTL_SECONDS` defaults to 28800 (eight hours), bounded to 60–86400. This follows root coordination for the exact `CORS_ORIGINS` name and TTL limits.

Alpha cookies use `__Host-alpha`, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, and a bounded `Max-Age`; no `Domain` attribute. Same-secret restart preserves valid cookies. Rotation of either deployment secret invalidates old cookies. Cookie admission remains entirely separate from authenticated PlayerSession/resume credentials. Settings include secrets by design for server consumers and must never be serialized into a client response/log.

## Verification evidence

1. Wrote the 15 focused tests before implementation. `node --import tsx --test tests/production-security.test.ts` exited 1: 0 pass / 15 fail, with explicit missing-implementation assertions for the three modules.
2. Implemented the modules. The same command exited 0: 15 pass / 0 fail. Coverage includes config rejection matrices, exact origins, safe error content, developer/test compatibility, code input bounds, cookie flags/opacity, mutation of every token character, same-secret restart, exact expiry boundary, rotation of either secret, duplicate/malformed cookies, quota reset, key isolation, policy changes and 25,000-key saturation.
3. Initial aggregate `npm run typecheck` found two incorrect test assertion overloads, plus the root-owned not-yet-created production transport module. Corrected the assertion overloads without changing runtime behavior.
4. Focused strict typecheck exited 0:

   ```text
   node node_modules/typescript/bin/tsc --noEmit --target ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --allowImportingTsExtensions --verbatimModuleSyntax --erasableSyntaxOnly --skipLibCheck src/server/config.ts src/server/access.ts src/server/rate-limit.ts tests/production-security.test.ts
   ```

5. Final focused plus existing authoritative-server regression command exited 0: 18 pass / 0 fail:

   ```text
   node --import tsx --test tests/production-security.test.ts tests/server.test.ts
   ```

6. Re-ran aggregate `npm run typecheck` after the root transport module became available: exited 0 with no diagnostics.

No dependencies were added. Aggregate integration tests, HTTP/WSS/proxy behavior, PostgreSQL recovery, deployment and cross-network acceptance remain root integration responsibilities. These unit/regression checks do not constitute a public deployment claim.
