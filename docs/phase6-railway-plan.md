# Phase 6 Railway deployment plan

User-selected provider: Railway. One project, production environment, `web`, `server`, PostgreSQL. Source: `https://github.com/kjm920605-cmd/conan-tcg-online`, branch `main`. Generated Railway domains; no custom domain. Actual secrets are entered only by the user in Railway Variables.

## Design

Keep the root workspace and shared source; add a small standalone Web host and reviewed per-service Railway Dashboard settings. New Railway services cannot use deprecated Config as Code, so the settings JSON is explicitly an operator checklist, not auto-consumed config. The server uses the existing Engine once. Web runtime receives only public endpoints plus listener/log/proxy configuration. It serves built assets and proxies only the bounded Alpha API to that fixed HTTPS server origin. It has no Engine, database connection or signing secret. Public runtime config is generated at startup, not Vite secret substitution.

Preserve the Secure/HttpOnly/Strict Alpha cookie as a first-party Web cookie. The proxy passes the cookie to the Game Server for validation. A bounded POST issues a short-lived, origin-bound socket ticket. The browser holds the ticket only in memory and supplies it in a WebSocket subprotocol (never URL/query). The server validates admission before Session creation and echoes only the fixed application protocol. A live connection remains authorized only until the original Alpha expiry. Reconnect obtains a fresh ticket; original PlayerSession/resume credentials and pending commands survive. Existing same-origin cookie transport remains available and tested.

Alternatives considered: third-party cookies with SameSite=None are unreliable on mobile privacy settings; long-lived JavaScript-stored Alpha bearer credentials weaken the existing HttpOnly boundary. A same-origin WSS proxy would avoid these but would not meet the requested direct public Game Server endpoint. The limited API proxy + short ticket retains the requested topology and cookie protection.

Railway default healthy deployment switching can overlap processes. Server autodeploy must be disabled for this single-authority release; explicitly remove/stop the old deployment before deploying the selected main commit. Keep one replica, no Serverless, zero overlap. Do not claim overlap=0 alone prevents startup concurrency. First deployment has no previous authority. Document restart/rollback evidence at real endpoints before COMPLETE.

## Work / gates

- [ ] Inspect GitHub source and Railway UI access without reading secrets; bind same repository/main to both services only after concrete configs are ready.
- [x] TDD: opt-in split-origin config, signed socket admission, expiry/tamper/origin checks, strict alpha proxy/static Web, no arbitrary upstream/secret values.
- [x] Implement standalone Web host, ticket transport, UI reconnect integration. No Engine/rules/data edits.
- [x] Add per-service Docker/Railway Dashboard settings, root watch paths, start/predeploy/health commands and placeholder env examples. No broad package refactor; not yet applied remotely.
- [x] Test two distinct HTTPS origins, direct WSS, first-party cookie, refresh, process restart, duplicate commands, private projection and finished state. Preserve old suites.
- [x] Run all Node/regression 333, DB 24, browser 8+4+3, typecheck/build/demo and 85 protected hashes; review and fix idle expiry / proxy IP. Docker execution and real edge verification remain external gates.
- [ ] User sets real secrets in Railway Variables; do not request values or inspect them. Publish source/config and configure project/services when access permits.
- [ ] Use actual Railway endpoints for public smoke and match/restart recovery; record URLs without secrets and exact deployed revision.
- [ ] User Device A Wi-Fi and Device B 5G/different-network acceptance. Phase 6 stays INCOMPLETE until actual evidence exists.
- [x] Update deployment guide and phase6-results with current counts, files and external blockers.

This plan implements the user's explicit topology. Routine implementation is already authorized; no extra design approval is required. Missing Railway login/access or user-managed Variables cannot be assumed from elapsed time.
