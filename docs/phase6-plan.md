# Phase 6 Internet Deployment / Closed Alpha — Implementation Plan

> Agentic workers: use subagent-driven-development for bounded independent work and TDD for behavior changes. Existing user scope authorizes implementation; missing deployment target does not block portable code/tests. No Git repository exists; do not invent commits. Track completion here.

Date: 2026-09-12.

## Goal and architecture

Expose the existing authoritative online fixture game through HTTPS/WSS with a separate closed-alpha access gate, safe configuration, observability, rate limits and durable recovery. Game rules, RNG, effect timing and snapshot semantics remain unchanged.

Recommended topology: one public origin, reverse proxy / platform TLS → one Node service serving built Web, access API and `/ws` → PostgreSQL. A portable Docker image can run behind Caddy or a provider's TLS terminator. Separate Web/CDN and Game origins require cookie/site-policy coordination without adding value for this alpha; multi-server ownership is outside scope. Public deployment target/domain/access was requested from the user; no account, paid resource, DNS record or actual public URL is assumed.

## Global constraints

- Do not modify `src/game/`, rule documents or card data. Baseline SHA-256 manifest: `tmp/phase6/protected-baseline.json`.
- RQ-002/009/012/013/014/023/025/027 remain BLOCKING. If Engine changes become necessary, explain and stop.
- Do not add Accounts, Ranking, Matchmaking, Deck Builder, official pool, Social or Payment.
- DB commit remains before gameplay ACK/view; preserve receipts, session token hashes, single runtime, projection and full snapshot restore.
- No secret in bundle, client response, source configuration or logs. Never log request bodies, cookies, URLs with queries, tokens, private state or raw DB errors.
- All old tests remain; public Internet and two-network acceptance cannot be claimed from local tests.

## Task 1: Security primitives and configuration

Create `src/server/config.ts`, `src/server/access.ts`, `src/server/rate-limit.ts` and focused `tests/production-security.test.ts`.

Interfaces consumed by transport:

```ts
type ProductionSettings = {
  webPublicUrl: string; gameServerPublicUrl: string; allowedOrigins: string[];
  sessionSecret: string; alphaAccessSecret: string;
  trustProxy: boolean; alphaTtlSeconds: number;
};
type ServerConfig = {
  mode: 'development' | 'test' | 'production'; host: string; port: number;
  storage: 'postgres' | 'memory'; databaseUrl?: string; databaseSchema: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent'; production?: ProductionSettings;
};
readServerConfig(env: Record<string, string | undefined>): ServerConfig;
class AlphaAccess {
  constructor(settings: ProductionSettings, now?: () => number);
  acceptCode(code: unknown): boolean;
  issueCookie(): string; // Secure, HttpOnly, SameSite=Strict, Path=/, __Host- prefix
  verifyCookie(header: string | undefined): boolean;
}
class RateLimiter {
  constructor(now?: () => number);
  consume(key: string, policy: { limit: number; windowMs: number }): boolean;
}
```

Production env must fail closed for missing/placeholder/short/reused secrets, memory storage, invalid DB URL/schema/port/log level, non-HTTPS Web/non-WSS server, local public URL, credentials/query in URLs and wildcard/malformed CORS. This release uses the same public origin (matching host/port), `/ws` path and an exact origin allowlist. Explicit TRUST_PROXY only behind a restricted proxy. Development/test keep current behavior; do not read real `.env` secrets in tests. Signed expiring alpha cookie survives server restart with same secret; code is never returned; alpha identity is separate from PlayerSession. Limit buckets expire, memory is bounded, saturation fails closed without deleting live protections.

- [x] Write failing security/config tests, observe failure.
- [x] Implement exact interfaces and verify tests/typecheck; test tamper/expiry/rotation/cookie flags and rate reset/bounds.
- [x] Review and integrate; no dependencies added unless needed.

## Task 2: Production transport and observability

Create `src/server/production.ts`, `src/server/logging.ts`; modify `src/server/index.ts`, `src/server/managers.ts`, `apps/server/index.ts`, `src/server/persistence/postgres.ts` without changing Engine.

Keep `createGameServer` usable by old tests. Share its WebSocket binding with production HTTP/S server. Authenticate Origin + alpha cookie at upgrade before creating PlayerSession; continue existing session/match authorization after upgrade. Add heartbeat, connection and pending-work bounds, per-IP upgrade/access limits and per-session/connection command limits. Never trust forwarded client IP unless explicitly behind the configured private proxy; one-node local buckets are acceptable. Bound request bodies and malformed traffic before the manager queue.

HTTP: `/health`/`/live` minimal liveness; `/ready` checks DB connectivity and required migration tables; `/api/public-config` returns only Web/WSS URLs and gate flag; `/api/alpha` checks access/code with exact Origin and JSON content type. Secure cookie gate for `/ws`; static built UI shows access form first. Health never emits config, SQL, stack or state. CORS exact origin, Vary, credentials as needed, no wildcard. CSP/security headers disallow framing and unconfigured connections. Optional Node TLS cert/key files for production-like TLS tests or direct HTTPS; usual deployment terminates at proxy.

Structured logging emits fixed event names and allowlisted scalar fields: generated connection/request ID, server match ID, stateVersion, known command kind/status/code. Redact or hash attacker-controlled IDs, never spread arbitrary error/object. Manager observers report room create/join, match start, command accept/duplicate/reject, DB failure, restore, disconnect/reconnect, finish. No logging effects on authority. Production wire translates generic internal errors to SERVER_ERROR / DATABASE_UNAVAILABLE while preserving known rule/domain errors.

- [x] Add transport HTTP/WSS tests for unauthorized upgrade, exact Origin/preflight, health/DB failure, bounded rate, safe errors/logs and privacy.
- [x] Implement production server and share transport with existing server.
- [x] Verify commit/recovery regression and code review.

## Task 3: Production Web and deployment artifact

Create `src/ui/ProductionBootstrap.tsx`, production/config UI tests; modify `src/ui/main.tsx`, `src/ui/OnlineScreen.tsx`, `src/client/errors.ts`, `vite.config.ts` only as needed. Production builds default to Online and exclude Local bootstrap/Engine/dev tools; development keeps Local UI. Runtime allowlisted public config selects WSS URL; no secret build variables. Access form uses HTTPS POST and clears submitted code. Session resume credentials remain distinct and preserved when alpha access expires. Friendly errors retain stable machine codes.

Create Dockerfile/.dockerignore and portable Caddy/Compose deployment files with env placeholders and durable DB volume or external PostgreSQL URL. Pin known runtime/tool versions; build with frozen pnpm lockfile. Reproducible migration command must run before service. No direct public DB/app port when behind proxy. Document single replica, stop-old-before-start-new rollback and keep compatible snapshot versions. Update `.env.example` with placeholders only; separate development and test examples from production. Do not replace actual local env credentials.

- [x] Add production bundle/config/error tests before implementing Web gate.
- [x] Build and verify no secrets/Engine/developer tools in production browser assets.
- [x] Add deployment artifacts and validate available tooling; report unavailable container execution honestly.

## Task 4: Production-like TLS recovery and public deployment

Add Playwright production-like config and tests running real built Web, HTTPS/WSS, isolated PostgreSQL schemas and actual Server child-process restarts. Locally generated certificate is for tests only; do not weaken public TLS config. Verify Alpha gate, two independent contexts, gameplay, privacy, refresh/reconnect, pending state, command dedupe, same version/projection/RNG, finished result across restart. Retain original eight E2E and four restart tests.

Create deployment smoke command/checklist; verify public HTTPS certificate, WSS, health/readiness, Alpha policy and run cross-network manual/automated checklist only after actual deployment target access is supplied. Require evidence from Device A and B on different networks; do not impersonate this with browser contexts on one machine.

- [x] Production-like TLS E2E + DB recovery + all old tests.
- [ ] Deployment target/domain/credentials availability resolved.
- [ ] Deploy, migrate, public smoke and restart recovery verified.
- [ ] Different-network Closed Alpha match verified.

## Task 5: Documentation and final gates

- [x] `npm test`, `npm run test:regression`, `npm run test:db`, typecheck, demo, production build, all browser suites.
- [x] Verify protected baseline hashes identical and secrets absent from source/bundle/logs.
- [x] Final bounded security/code review and fix actual findings.
- [x] Write `docs/deployment.md` (architecture, config, migrations, build/start, health, deploy/rollback, recovery/log inspection/limits), `docs/phase6-results.md` (actual target/endpoints/tests/cross-network/security/recovery/limits/RQ/full files).
- [x] Stop Phase 6 only; if external deployment/cross-network evidence is unavailable, clearly mark Phase 6 incomplete and identify the exact missing resource/evidence.
