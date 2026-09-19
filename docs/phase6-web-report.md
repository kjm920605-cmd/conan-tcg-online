# Phase 6 Web gate report

Date: 2026-09-12.

## Implemented scope

- `src/ui/ProductionBootstrap.tsx`: fetches the allowlisted public runtime configuration and checks Alpha access before mounting the online client. Configuration requires the actual page's HTTPS origin, the matching exact `wss://<host>/ws` URL and `alphaRequired: true`. Credentials, alternate origins, paths, query strings, fragments and normalized path tricks are rejected; extra configuration fields are discarded.
- All access requests use relative same-origin endpoints, `credentials: same-origin`, `cache: no-store` and `redirect: error`. The password input clears on submission; access codes are not written to storage or logs. API errors use allowlisted stable codes without reflecting response diagnostics.
- Existing cookies can enter directly after the access check. An expired-cookie reconnect requests authentication and keeps the existing online client mounted but hidden until verification completes, preserving its credentials and pending command queue. No automatic PlayerSession reset occurs.
- `src/ui/main.tsx`: production always mounts the production bootstrap, including when the URL says `mode=local`. Development retains local/online selection. The Local bootstrap import is behind a compile-time DEV condition.
- `src/ui/OnlineScreen.tsx`: accepts the runtime server URL and asynchronous reconnect gate. Normal reconnect and explicit new-session actions pass through the gate. The existing URL-keyed sessionStorage credential format is retained.
- `src/client/errors.ts`: friendly messages preserve the requested stable machine codes, including `INVALID_SESSION`; existing rule-question behavior remains.
- Final accessible selectors: region `Alpha access`, input label `Alpha 通行碼`, submit button `進入 Alpha`.

## Verification

TDD red failures were observed for the missing friendly errors, absent production bootstrap/reconnect helper and production bundle entry before implementation. The final focused command was:

```text
node --import tsx --test tests/production-web.test.ts tests/online-client.test.ts tests/ui-render.test.ts tests/game-client.test.ts
```

Result: **13 passed, 0 failed** (7 new production Web tests and 6 unchanged regression tests).

The production Web tests cover runtime URL validation, safe HTTP options and responses, a blank password form, absence of an online client during initial SSR, reconnect waiting for authorization, stable friendly error codes, and a real in-memory Vite production build. Build module checks exclude `src/game`, `src/cards`, `src/local`, card data, LocalBootstrap and localGameClient. Bundle text checks exclude developer snapshot tools and secret configuration variable names.

`npm run typecheck`: **passed**, exit 0.

The parent integration task separately reported 2/2 production HTTPS/WSS browser tests passing with the final Chinese selectors. This report's independently run evidence is the focused suite and typecheck above.

## Boundaries

Only the assigned UI, error, Web test and report files were edited. Engine, rule/card data, server transport, dependency/config/env files and existing tests were not modified by this task. Handoff and projection regressions pass. Actual Internet deployment and different-network acceptance remain the parent task's gates; local SSR/build tests are not public deployment evidence.
