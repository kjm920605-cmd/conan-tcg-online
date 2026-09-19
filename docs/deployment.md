# Closed Alpha deployment

本文件保留原同 origin Cookie／Caddy portable 部署程序。**使用者已指定 Railway、獨立 web/server/PostgreSQL；實際部署請使用 [Railway deployment](railway-deployment.md)。目前仍沒有已驗收的公開網址。** 本機 HTTPS/WSS 與不同網路的 Internet 驗收分開記錄於 [phase6-results.md](phase6-results.md)。不要將測試用 `alpha.example.com` 或 loopback 視為公開服務。

## Architecture / required services

```text
Device A / Device B
  HTTPS public origin
    → TLS reverse proxy (Caddy / hosting platform)
      → one Node 24.16+ process
          built React Web + /api/public-config + /api/alpha
          /health /live /ready + WSS upgrade /ws
          → existing RoomManager / MatchManager / GameEngine
          → production PostgreSQL
```

第一版使用同一 origin 的 Web 和 `/ws`，cookie 不需跨站設定。Alpha cookie 只管進入測試服務；PlayerSession、resumeToken、Room／Match authorization 繼續由原系統負責。每個 deployment 只能有 **一個 authoritative process**；不可開多個 Node worker、replica 或 rolling deployment 同時讀寫相同 active matches。

可選部署方式：既有 Linux 主機上以 `Dockerfile` + `deploy/compose.yaml` + Caddy 提供 HTTPS，或在支援長連線／WSS 與單一 instance 的容器平台運行同一 image，搭配平台 TLS。Production PostgreSQL 使用獨立 managed instance 或由管理者維護的 DB；不能使用工作區 loopback trust-auth 開發 DB。實際平台／DB／網域需先提供，沒有自動購買資源或建立帳號。

本輪 SQL／recovery 測試使用 PostgreSQL 18.6。Migration 在新空 schema 可重現建立五個 models：PlayerSession、Room、Match、MatchSnapshot、MatchCommand。其他 PostgreSQL 版本應先跑同一 DB integration suite。

## Environment configuration

`.env.example` 是 production **placeholder** 模板；`.env.development.example` 與 `.env.test.example` 分開。不要直接拿尚未替換的範例啟動。實際 `.env`、`.env.production`、`.env.test`、`deploy/*.env` 與私鑰都被忽略；Docker build context 排除所有實際 env 檔與 secrets。

| Variable | 用途／production 規則 |
|---|---|
| `NODE_ENV` | production 必須為 `production`；development/test 保留本機行為 |
| `MATCH_STORAGE` | production 只允許 `postgres`，無 DB failure memory fallback |
| `DATABASE_URL` | 真正 production PostgreSQL URL；不可貼入文件／log／前端。遠端 DB 使用 provider 的驗證 TLS 配置，例如 `sslmode=verify-full` 與必要 CA |
| `DATABASE_SCHEMA` | 預設 `public`；只允許小寫字母起頭的英數底線識別碼 |
| `WEB_PUBLIC_URL` | canonical `https://PUBLIC_HOST` origin；不可有帳密、query、fragment、額外 path 或本機／私有 host |
| `GAME_SERVER_PUBLIC_URL` | 本文件 Cookie 模式使用 `wss://相同HOST與PORT/ws`；Railway 分站使用 TICKET 模式，見專用文件 |
| `ALPHA_TRANSPORT` | portable 同 origin 設 `COOKIE`；Railway 獨立 domains 設 `TICKET` |
| `CORS_ORIGINS` | 明列同一 Web HTTPS origin；不可為 `*` 或任意外站 |
| `SESSION_SECRET` | 獨立隨機秘密，用於簽署 alpha session cookie，沒有改寫原 resumeToken 的 DB hash／驗證語義 |
| `ALPHA_ACCESS_SECRET` | 測試玩家輸入的共享通行碼；不同於 SESSION_SECRET；不包進 Web 或由 config API 回傳 |
| `ALPHA_TTL_SECONDS` | 60–86400，預設 28800（8 小時） |
| `TRUST_PROXY` | 預設 false；只有 app port 已被 network 隔離、且 proxy 覆写指定 header 時才設 true |
| `PROXY_IP_HEADER` | 此 Caddy 方案使用預設 `X_FORWARDED_FOR`；Railway 必須設定 `X_REAL_IP`，不可混用 |
| `LOG_LEVEL` | debug / info / warn / error / silent，預設 info |
| `HOST`、`PORT` | service bind；production 預設 0.0.0.0:8787。這是內部 listener，不是 Web 的公開 URL |
| `WEB_DIST_PATH` | 可選 built Web 目錄，預設 dist |
| `TLS_KEY_FILE`、`TLS_CERT_FILE` | 可選直接 Node HTTPS，必須成對；以掛載 secret file 提供。通常由外層 proxy 終止 TLS |
| `TEST_DATABASE_URL` | 專用測試 DB；絕不可指向 production。測試建立並清理自己的 schema |
| `OPENSSL_BIN` | 可選本機 TLS 測試憑證產生器路徑；非 production secret |
| `VITE_GAME_SERVER_URL` | 僅 development 使用；production 從 allowlisted runtime config 取得 WSS URL |

SESSION_SECRET 與 ALPHA_ACCESS_SECRET 各生成至少 32 個隨機 bytes（例如 64 hex chars），用平台 secret store 或權限限制的 ignored env file 保存。Parser 拒絕短值、重複值、常見 placeholder 與兩者相同，但不能從文字證明 entropy。不要將 secrets 放 URL/query、Docker build args、VITE_ variables、shell history、CI output 或這些文件。

Alpha cookie 使用 `__Host-alpha`、Secure、HttpOnly、SameSite=Strict、Path=/，有簽章與到期時間。相同 secrets 的重啟保留 cookie；輪替其中任一 secret 使 alpha cookie 失效，玩家重新輸入通行碼即可使用原 PlayerSession resume。前端不保存 alpha code，也不能讀 HttpOnly cookie。正式 PlayerSession 的 resumeToken 仍只在該分頁 sessionStorage 保存，DB 保存 hash。

## Build / start / migration

本機 source build：

```sh
pnpm install --frozen-lockfile
npm test
npm run typecheck
npm run build
```

Production build 預設進入 Alpha／Online；Local bootstrap、Engine implementation、完整 catalog 與 DevPanel 不進 production Web。Development `npm run dev` 仍提供 Local / Online。不要把 `vite dev` 當作公開 Web Server。

使用已注入的 production environment：

```sh
node scripts/migrate.ts
npm start
```

Migration 必須成功後才發布服務。`scripts/migrate.ts` 以 transaction 套用 `db/migrations/0001_persistent_matches.sql`，記錄 `_migrations`，重跑不重建資料。Migration 失敗只輸出安全 machine code、exit 非零，不輸出 DB URL／SQL stack。不要手動修改 production table 或修改既有 migration 來偷偷改遊戲 snapshot。

建立容器：

```sh
docker build -t conan-alpha:RELEASE_ID .
```

Dockerfile 使用 Node 24.16.0 與 pnpm 11.19.0，build stage frozen install → typecheck → Web build → prune dev dependencies。Runtime 用 Node 原生 TypeScript stripping，非 root user，沒有 Vite／tsx 啟動依賴。部署使用已測試的 immutable image tag／digest；本環境沒有 Docker CLI，因此容器 build/run 必須在實際目標或有 Docker 的 CI 再驗證。

## Example single-host deployment

前提：主機可由網際網路連線、DNS 指向該主機、80／443 可用、可連 production PostgreSQL。禁止公開 DB port 與 Node 的 8787 port。`deploy/compose.yaml` 只發布 proxy 的 80/443，game service 沒有 host port mapping。

在主機使用私有 env file 設定上表 runtime variables。另以 Compose environment 設定以下非 secret deployment parameters：`GAME_IMAGE`（已建置 image）、`CADDY_IMAGE`（已審閱 pinned Caddy 2 image/digest）、`PUBLIC_HOST`（真實 DNS host）、`SERVER_ENV_FILE`（私有 env file 絕對路徑）。不要將 production secrets 放進 Compose 模板。先由操作者限制 env file 權限。

```sh
docker compose -f deploy/compose.yaml config --quiet
docker compose -f deploy/compose.yaml run --rm --no-deps game node scripts/migrate.ts
docker compose -f deploy/compose.yaml up -d
docker compose -f deploy/compose.yaml ps
```

不要執行會把 env 展開列印的 `docker compose config` 並保存或分享輸出；使用 `--quiet` 驗 syntax。Caddy config 以 PUBLIC_HOST 提供 HTTPS，代理 `/ws`，覆写 X-Forwarded-For；沒有啟用 HTTP access logs 或 log_credentials。若平台自行終止 TLS，需提供等價 WSS upgrade forwarding、idle timeout 與 network isolation；不能假設任意平台的預設值都符合。

## Health / readiness / errors

| Endpoint | 行為 |
|---|---|
| GET `/health`、`/live` | 200 `{"status":"ok"}`，process liveness |
| GET `/ready` | DB connectivity、migration marker 與五張必要 tables 通過才 200；故障 503，安全 `DATABASE_UNAVAILABLE` |
| GET `/api/public-config` | 只含 webPublicUrl／gameServerPublicUrl／alphaRequired，無 secret |
| GET `/api/alpha` | 只含 authenticated boolean |
| POST `/api/alpha` | exact Origin + JSON code → secure cookie；不回傳 code |
| WSS `/ws` | Origin 與 cookie 通過才建立 PlayerSession，後續沿用原 strict protocol |

HTTP error 只有 `{error:{code,requestId}}`；Client 有可理解訊息。WebSocket 仍使用原 COMMAND_REJECTED，保留 STALE_STATE、STALE_DECISION、NOT_DECISION_OWNER、INVALID_SESSION、ROOM_NOT_FOUND、ROOM_FULL、MATCH_FINISHED、VERSION_INCOMPATIBLE 與規則錯誤。新增 SERVER_ERROR／DATABASE_UNAVAILABLE／RATE_LIMITED／ALPHA_ACCESS_REQUIRED 等外層錯誤，不回 raw stack。

CORS 回應以 exact allowlist + `Vary: Origin`，mutation／upgrade 拒絕缺少或不合法 Origin。Headers 包含 CSP、HSTS、nosniff、DENY framing、no-referrer。Alpha API body 上限 8 KiB；WS frame 上限 64 KiB；關閉 compression，heartbeat 檢查失效連線。

## Rate limits and logging

單 process、每來源 IP 的分鐘窗口：Alpha 10、upgrade 30、Create 6、Join 20、Resume 30、其餘合法 protocol messages 600；另 raw frame 1200、一般 HTTP 300、health 120。限額在 Engine legality 之前，不能取代 Engine validation。連線數與待處理工作也有限制；closed cleanup 必須完成才釋放其佔用。超限回 RATE_LIMITED／HTTP 429；同一 NAT 共用限額，重啟重置本機 rate buckets。這是 basic alpha protection，不是多節點或大型 DDoS 防護。

Structured JSON logs 只記錄 allowlisted metadata：server-generated request/connection ID、room/match ID、stateVersion、command type、固定錯誤碼、HTTP status／duration。可追蹤建立／加入房間、match start、command accept/duplicate/reject、disconnect/reconnect、restore、transaction failure 與 finished。沒有 command payload、token、cookie、alpha code、DB URL、private hand 或完整 state；logger sink 故障不影響交易。

```sh
docker compose -f deploy/compose.yaml logs --since 10m game
```

不要為除錯改成 `console.log(request)`／`console.log(error)`／`console.log(GameState)`。Server log 的 correlation ID 用來對應 HTTP error；遊戲事件使用 match ID／stateVersion。Token、玩家手牌等資料不應被複製到 incident report。

Caddy 的 default ERROR logger 也刪除完整 request 欄位，避免 upstream 故障時將 query／headers 寫入 error log。已用本機 Caddy 2.10.2 與 synthetic canaries 驗證；選定其他 proxy image／版本時，設定 `CADDY_BIN` 後執行 `node scripts/test-caddy-redaction.ts`，再於部署目標驗證。這項檢查會保留並要求 operational proxy error 存在，不是關掉所有診斷；詳見 [修正報告](phase6-fix-report.md)。

## Restart recovery / rollback

成功 command：原 strict protocol／session／match／version 檢查 → 隔離 Engine draft → PostgreSQL transaction（receipt、snapshot、Match version／metadata）→ COMMIT → runtime swap → ACK／各自投影。部署層不改這個順序。DB 失敗丟棄 draft／cache，後續重新載入 durable state；不切 memory、不重開局、不重複 RNG。

重啟時先停舊 process，等待 shutdown drain 或 deadline 結束，再啟動新 process。玩家按 Reconnect／refresh，cookie gate 通過後用原 resumeToken 恢復 seat、Match、version、decision、pending／effect cursor、RNG 或 RULE_BLOCKED。Finished 仍可看結果，新 gameplay 被拒絕。

```sh
docker compose -f deploy/compose.yaml stop game
docker compose -f deploy/compose.yaml up -d --no-deps game
```

Rollback 使用事先保存、相容 engine/ruleset/card fingerprint 的舊 immutable image：停舊 process → 改 GAME_IMAGE → 以相同 DB／secrets 啟動 → 檢查 readiness 與恢復測試。不得 scale-up／rolling overlap，也不要自動 rollback DB 或清除 volume。若 snapshot version 不相容，保留資料並回 VERSION_INCOMPATIBLE；沒有隱式 migration。資料庫 backup／restore 由 production DB 的操作流程負責，啟用測試前應確認可恢復備份。

## Deployment smoke and different-network checklist

`WEB_PUBLIC_URL` 與 `ALPHA_TEST_CODE` 透過 private test environment 注入後執行：

```sh
npm run smoke:deployment
```

Smoke 使用正常 TLS certificate verification，檢查 HTTPS Web、health／ready、public config、錯 Origin 拒絕、alpha cookie、WSS SESSION。它不列印 credentials，也**不宣稱**已完成整局、restart 或跨網路測試。禁止用 `NODE_TLS_REJECT_UNAUTHORIZED=0` 或 ignore certificate errors 執行公開 smoke。

最後需要 Device A 與 Device B 真正位於不同網路，例如家用寬頻與手機行動網路。記錄測試日期、公開 origin、release image／版本與網路類型；不需記錄秘密或完整 IP。

- [ ] 兩端開啟公開 HTTPS URL，確認有效憑證、無 mixed-content／CSP errors。
- [ ] 未通過 gate 不能建立 WebSocket session；輸入 Alpha code 後進入。
- [ ] A Create／B Join，同 Room／不同 seat；Ready → Mulligan。
- [ ] 多回合出牌／推理／可用互動；對手 hidden hand／private IDs 不在 network payload 或 DOM。
- [ ] 中途斷線／refresh → 原座位、Match、stateVersion／decision 繼續。
- [ ] 記錄 active Match/version → 管理者 restart Game Server → 雙方重新連線，same Match/seat/version/pending → 繼續。
- [ ] 重送已接受 command ID → duplicate，不增加 version／RNG／成本。
- [ ] 完成 Game → restart → 結果仍可讀，新的 gameplay 回 MATCH_FINISHED。
- [ ] 將實際結果／失敗與證據摘要填入 phase6-results；不得只勾選而沒有執行。

本機 `npm run test:e2e:production` 用臨時 self-signed certificate、測試 hostname 映射、兩個獨立 Browser Context 和真正 PostgreSQL／Node 子程序驗證同一程式。它刻意與公開 smoke 分開，不是 Internet 或不同網路的證據。原 `test:e2e`、`test:e2e:restart`、DB／Engine regression 必須一起維持通過。

## Known limitations / protected rules

無公開目標／部署存取前不能發布；缺少不同網路裝置操作證據前不能宣稱 Closed Alpha 驗收完成。本環境沒有 Docker，容器 build／run 與公開 proxy TLS 尚待目標平台執行驗證；本機 Caddy runtime log redaction 已驗證。其他限制沿用 Phase 5B：單 process authority、無 account recovery／retention／GC／snapshot migration／online replay service／multi-server failover。Alpha 是共享碼，不提供每位測試者單獨撤銷；輪替 code 會要求所有人重新驗 gate，但不更換 PlayerSession。

RQ-002、009、012、013、014、023、025、027 **全數 BLOCKING**。Engine、RNG、effect timing、序列化語義與官方規則不因部署而修改。若未來 infrastructure 需要 Engine 變更，先說明並停止，不自動重構。

實作參考：[ws authentication/HTTP integration](https://github.com/websockets/ws#client-authentication)、[Secure／HttpOnly cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)、[Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)、[Docker multi-stage build](https://docs.docker.com/build/building/multi-stage/)。上述是 infrastructure 來源，不是遊戲規則來源。
