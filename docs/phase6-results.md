# Phase 6 — Internet Deployment / Closed Alpha

完整程式品質驗證紀錄：2026-09-13–14；首次提交前的 Node tests／typecheck／build 重驗：2026-09-19–20；GitHub 發布進度更新：2026-09-20（Asia/Taipei）。本次續作僅修改部署設定與文件，沒有修改遊戲程式。

**狀態：Railway project 與服務設定已建立；Phase 6 的公開部署／跨網路驗收尚未完成。** 已登入既有帳號，在 Conan TCG Closed Alpha 的 production 保存 web／server 設定並建立 Postgres。兩個 application service 均已連接指定 repository／main；尚未執行 application build、migration 或部署，尚無公開 URLs。本機 HTTPS/WSS 測試不等於 Internet Deployment；未升級付費方案或建立新帳號。

## Deployment target / endpoints

| 項目 | 實際狀態 |
|---|---|
| 平台／主機／部署方式 | Railway；Conan TCG Closed Alpha／production，獨立 Web／Server Docker services，基本設定已保存、尚未部署 |
| Source | https://github.com/kjm920605-cmd/conan-tcg-online ，兩服務指定 main；首次來源提交 `69e5caf`（243 files）已成功推送，本機 main 已追蹤 origin/main |
| 公開 HTTPS Web URL | 尚無 |
| 公開 WSS URL | 尚無；獨立 Server Railway generated domain 的 `/ws` |
| Production PostgreSQL | Railway Postgres 已建立，2026-09-19 Dashboard 為 Online；尚未跑 application migration。下列 DB tests 仍是專用本機 PostgreSQL 18.6，不能代表遠端 DB 驗收 |
| 公開憑證／DNS／firewall | 尚未驗證 |
| Public deployment smoke | 腳本已建立；沒有公開目標，尚未執行 |
| 不同 network 的 Device A／B | 尚未執行；沒有跨網路驗收證據 |

### Railway 實際設定紀錄

[Project Dashboard](https://railway.com/project/15e27d1c-b0c7-47c6-aa43-61143d50a2e7?environmentId=7d26e95b-d842-4326-bfd3-3fc13df37660)。Project ID：`15e27d1c-b0c7-47c6-aa43-61143d50a2e7`；production ID：`7d26e95b-d842-4326-bfd3-3fc13df37660`。

| Service | Service ID | 已保存設定 |
|---|---|---|
| web | `5988bde1-9a27-40c4-af19-fd6200bcc4b8` | 根目錄 build；`deploy/web.Dockerfile`；`node apps/web/index.ts`；`/ready`／120 秒；15 個 watch paths；5 個非秘密 Variables |
| server | `bbc10174-5293-4d0f-9430-42c60301093a` | 根目錄 build；`Dockerfile`；`node apps/server/index.ts`；pre-deploy `node scripts/migrate.ts`；`/ready`／120 秒；15 個 watch paths；9 個非秘密 Variables |
| Postgres | `e5a67b83-a506-49f5-a698-9461c3447285` | Railway PostgreSQL service／volume；未開放 public DB TCP proxy |

2026-09-19 審查 34 項 staged changes 後，以 Railway 官方支援的 **Alt + Deploy** 僅保存設定、不觸發部署；Server Deployments 顯示沒有 active deployment。這不是 application release。[Railway staged changes](https://docs.railway.com/deployments/staged-changes)

同日 Project canvas 確認 Postgres **Online**、web／server 均為 **Service is offline**，沒有待套用變更。沒有公開遊戲服务可供驗收。

web／server 均已確認 **Auto deploy is disabled**，保留 main 來源供後續手動發布；各 1 replica、Serverless Off。2026-09-19 的 `Connected branch does not exist` 發生在首次 push 前；2026-09-20 已確認 Git push 成功建立遠端 main，後續部署應選實際存在的 main revision。手動停用 autodeploy 的操作依 [官方 GitHub autodeploys](https://docs.railway.com/deployments/github-autodeploys)。

共同非秘密 Variables：`NODE_ENV=production`、`HOST=0.0.0.0`、`TRUST_PROXY=true`、`PROXY_IP_HEADER=X_REAL_IP`、`LOG_LEVEL=info`。Server 另有 `MATCH_STORAGE=postgres`、`DATABASE_SCHEMA=public`、`ALPHA_TRANSPORT=TICKET`、`ALPHA_TTL_SECONDS=28800`。未讀取或填入任何真實 secret。

2026-09-20 僅核對 Variables 名稱：server 有 10 個欄位，已出現使用者新增的 `DATABASE_URL`，畫面仍有 1 個待套用變更；未讀取其值或驗證實際 DB 連線。尚缺使用者本人設定 `SESSION_SECRET`、`ALPHA_ACCESS_SECRET`；生成 domain 後再填兩服務的 `WEB_PUBLIC_URL`／`GAME_SERVER_PUBLIC_URL` 及 server 的 exact `CORS_ORIGINS`。公開 domain 尚待操作前確認。`PORT` 由 Railway 提供。完整目標設定仍見部署文件；`deploy/railway-settings.json` 的 `applied:false` 表示整份清單尚未完成，不能當成尚未做任何設定或已經上線。

測試中的 `alpha.example.com`／`game.example.net` 由測試 DNS 映射到 loopback，使用短效 self-signed certificate。它们不是可分享或供外部玩家使用的遊戲網址。公開 smoke 必須使用正常 certificate verification。

## Deployment architecture

```text
Browser → Railway Web HTTPS → built React + public config
          → bounded first-party Alpha API → Server HTTPS Alpha validation
          → short ticket (memory only) → direct Railway Server WSS /ws
            → one authoritative Node process
              → existing RoomManager / MatchManager / GameEngine
              → PostgreSQL transaction → COMMIT → ACK / private projection
```

- Development／test／production config 分開。Production 強制 PostgreSQL、HTTPS／WSS、exact Web CORS、有效且不同的兩個 secrets；分站必須明確 ALPHA_TRANSPORT=TICKET。同 origin COOKIE transport 繼續保留；無 localhost public URL 或 memory fallback。
- Production Web 預設 Alpha／Online，build 不含 Local bootstrap、Engine implementation、完整卡牌 catalog 或 developer snapshot tools；Local 保留 development 使用。
- Alpha code 經 JSON POST 驗證，換取 Web first-party Secure／HttpOnly／SameSite=Strict 簽章 cookie。固定 HTTPS bridge 取得 30 秒 admission ticket，memory-only subprotocol 直連 WSS；原 Alpha expiry 到期斷線且禁止繼續送出資料。原 PlayerSession／resumeToken／Room／Match authorization 繼續獨立生效；DB 不新增明文 token。
- Origin／Alpha 驗證在 WebSocket upgrade 與 Session 建立前完成。所有 gameplay 仍走原 protocol、session、match、version、Engine 與 durable transaction。
- 沿用 Phase 5B 的五個 models 與版本策略，沒有新增 migration 或改寫 snapshot 語義。Readiness 驗 DB connectivity、migration marker 與必要 tables。
- 單一 authoritative process，不允許 rolling overlap、多 worker 或 replica。Secrets 不進 image build args、前端 runtime config 或 logs。

Railway 操作程序：[railway-deployment.md](railway-deployment.md)，設計：[phase6-railway-plan.md](phase6-railway-plan.md)。保留的同 origin portable 方案：[deployment.md](deployment.md)。

## Security / error handling

| 項目 | 已驗證內容 |
|---|---|
| Config | 缺漏／弱值／placeholder／重用 secret、錯 URL／port／schema／log level、production memory、wildcard origin 拒絕 |
| Access | 無 cookie／錯 Origin 不建立 Session；tamper、expiry、rotation、duplicate cookie、body 上限與 code rate limit |
| Authorization | Gate 之後仍拒絕冒用對手、錯 match、錯 seat、非 decision owner；room code 不是身份 |
| Projection | 既有 strict protocol／private projection tests 全通過；production Browser 不取得對手 hidden hand 身份或本機完整 state |
| Bundle | 真實 production build 的 module graph 排除 Engine／Local／catalog；synthetic secret markers 不在 bundle |
| HTTP | Exact CORS／preflight、HSTS、CSP、nosniff、DENY frame、no-referrer；health 不暴露 config／state／stack |
| Errors | 固定 machine code 與 correlation context；HTTP 不回 raw diagnostics；production DB 連線錯誤為 DATABASE_UNAVAILABLE，未知錯誤為 SERVER_ERROR |
| Rate limits | Alpha／upgrade／Create／Join／Resume／gameplay／malformed traffic；bounded buckets、live sockets、per-connection pending 與 shared lifecycle budget |
| Logs | Allowlisted request／connection／room／match／version metadata，無 payload／token／private state／raw DB error；Caddy runtime errors 移除 request 物件 |

審查發現並修正兩項問題：短連線可繞過 queue bound，以及 upstream failure 會將 URI/query 寫入 Caddy error log。兩者均先重現失敗、加入測試、修正，再由原審查者獨立確認。見 [修正報告](phase6-fix-report.md) 與 [審查報告](phase6-review.md)。

## Tests / quality gates

下表保留 2026-09-13–14 完整驗證紀錄，0 failed／0 skipped；首次提交前另外重驗的項目列於下段。Regression 是再跑同一套 Node tests，不重複加總為新測試。

首次提交前另行重驗：`npm run test` **333/333**、`npm run typecheck` **PASS**、`npm run build` **PASS（116 modules）**；85 個受保護 baseline 檔案 **0 changed**。243 個暫存路徑沒有實際 `.env`、tmp／build 產物或私鑰檔；private-key／GitHub-token pattern scan 沒有命中。DB、Browser、restart 與 regression 指令未在這次提交前重跑，其結果沿用下表歷史紀錄。

| Command / check | 結果 |
|---|---|
| `npm test` | **333/333** |
| `npm run test:regression` | **333/333** |
| `npm run test:db` | **24/24**，真正 PostgreSQL |
| `npm run test:e2e` | **8/8**，原 Local／Online Browser tests |
| `npm run test:e2e:restart` | **4/4**，原 Phase 5B 實際 Server process restart |
| `npm run test:e2e:production` | **3/3**，同 origin 2 + split origin 1；含 built Web、真 TLS／PostgreSQL、公開 smoke CLI 及實際 process restart |
| `npm run typecheck` | PASS |
| `npm run demo` | PASS，core finished/restore、3A replay、3B 四組互動 restore/replay 相同 |
| `npm run build` | PASS，116 modules；production assets 不含 Local／Engine |
| `node scripts/test-caddy-redaction.ts`，指定 `CADDY_BIN` | PASS，實際 Caddy 2.10.2，502 與 error diagnostics 保留，query／header canaries 不在 log |
| 受保護 baseline SHA-256 比對 | **85 files、0 changed** |
| Docker build / Compose run | 未執行；此環境沒有 Docker CLI |
| `npm run smoke:deployment`（公開目標） | 未執行；Railway URLs 尚未建立。相同 CLI 已在本機雙 TLS process E2E 中通過 |
| Cross-network Closed Alpha | 未執行 |

新增 Node tests：原部署層 35 + Railway Web 13、ticket 4、client 3、proxy IP 4、expiry 2，共 **61**；原 **272** 項保留。DB 新增 readiness 1 項，原 23 項保留。Browser 原 12 項保留，production 共 3 項，合計 15 項。Proxy redaction 是另行執行的本機 integration check。

Local 初次冷啟動曾在原五秒 handoff assertion 失敗；trace 顯示 dynamic module 還在載入。加入 development entry warmup 後，原完整 8 項套件通過；未放寬原測試 timeout 或修改 Engine。

本輪沙箱內重跑再次出現初次 handoff 冷載入逾時，且 Playwright 無法退出它建立的測試服務。停止已確認的兩個測試 process、在沙箱外執行原套件後 8/8、exit 0；未再修改 warmup／UI／Engine 或放寬 assertion。此環境的 cold dev loading 仍可能受檔案存取延遲影響；正式 built Web tests 另行驗證。Railway review 的 expiry／proxy IP 問題、RED→GREEN 證據見 [phase6-railway-review.md](phase6-railway-review.md)。

## Restart / reconnect evidence

Production E2E 使用兩個獨立 Browser Context、真正 TLS 與 PostgreSQL schema，啟動 `apps/server/index.ts` 的 production process（Node 原生 TypeScript），沒有 Vite proxy 或合成 server response。

1. Alpha → A Create／B Join → Ready／Mulligan → 多回合出牌與推理 → B refresh → 原 seat → kill／restart Server → 同 Match／seat／投影／stateVersion／完整 durable snapshot → 繼續至 finished → 再次 restart → final result 可讀 → 新 gameplay 回 MATCH_FINISHED。
2. Mulligan redraw 接受後停在下一個 PendingDecision → 清除一方 Alpha cookie → kill／restart → 重新輸入通行碼並使用原 PlayerSession → 同 decision／owner／合法選項／stateVersion → 重送原 command → duplicate → durable snapshot（包含 RNG）完全相同 → 正常繼續。

原 Phase 5B 四項 browser restart 流程另行全通過。DB suite 同時覆蓋 PendingEffects、續行、effect cursor、RULE_BLOCKED、version mismatch、missing／corrupt／invalid snapshots、真實 transaction rollback 與 unavailable DB；失敗不發成功 ACK／view、不替換 Match、不多耗 RNG。

公開平台的 TLS termination、production DB、idle timeout／proxy restart、跨網路重連仍須在實際部署後執行上述流程，不能由本機結果代替。

## Acceptance status

| 使用者 acceptance criteria | 狀態 |
|---|---|
| 1–3：公開 HTTPS、公開 WSS、不同 network 同 Room | **待部署／跨網路證據** |
| 4：完整 Online FIXTURE Match | 本機 production-like PASS；公開驗收待執行 |
| 5–10：authority、privacy、persistence、restart、reconnect、idempotency | 本機完整 regression／DB／Browser PASS；公開驗收待執行 |
| 11–16：Alpha、secrets、CORS、health、rate、logging | 程式／本機 integration PASS；目標環境設定仍待驗證 |
| 17：所有既有 tests | PASS |
| 18：production build | Web build PASS；Docker artifact 未執行 |
| 19：deployment smoke | **未執行公開 smoke** |
| 20：cross-network Closed Alpha | **未執行** |

本機 Git 作者設定與首次 authenticated push 已完成，不再列為部署障礙。繼續公開部署所需：使用者本人補齊 server 兩個 secrets，完成待套用的 DB reference；確認 generated domains 的建立後填妥公開 URL／Origin 設定，再由既有 migration flow 發布服務。Railway 已登入且能連接 repository，無需自訂 DNS。部署完成後仍需兩種實際網路的測試裝置／操作證據。

## Known limitations / protected rules

- Phase 6 尚未達成 Internet acceptance；無可供外部玩家使用的公開網址。
- Docker／Compose 模板尚未在容器主機 build/run；Caddy 2.10.2 的本機 log check 不等於公開憑證或容器 image 驗收。
- Split origins／同 origin 兩種 transport、單 process authority；無 distributed rate limits、Redis、multi-server failover 或 rolling deployment。IP rate windows 共用於同 NAT，server restart 清除 buckets。Railway 模式 Server Alpha quotas 共用 Web egress（10 code／30 ticket per minute），Web 另依 edge visitor IP 限流；不信任任意 forwarding claim。
- Railway 設定清單是 Dashboard 人工核對資料，基本設定已手動保存，尚未完成 Variables／networking／release。官方新 services 不能使用舊 Config as Code，未建立誤導性的 railway.json。Server auto-deploy 已確認 disabled；舊 deployment 停止後才啟動新版本，不能把 1 replica／overlap=0 當作 DB 排他鎖。
- Alpha 使用共享 code，不含正式 account 或逐人撤銷；secret 輪替要求重新驗 gate，原 resume credentials 可續用。匿名 sessionStorage 遺失仍無 account recovery。
- 沿用 Phase 5B 的無 retention／GC／snapshot migration／online replay 服務限制；snapshot storage 尚未優化。只用既有 FIXTURE cards。
- **RQ-002、RQ-009、RQ-012、RQ-013、RQ-014、RQ-023、RQ-025、RQ-027 全部維持 BLOCKING。** 規則、RNG、Effect timing、serialization 語義未修改；RULE_BLOCKED 仍在相同 boundary 保存／恢復。
- 沒有進入 Account、Ranking、Matchmaking、Deck Builder、正式卡池、Social 或 Payment。

## 完整新增／修改檔案

工作區已初始化 main／origin，首次來源提交 `69e5caf` 已推送。以下清單以 Phase 5B 結束為比較基準；Ignored `tmp/` 工具、測試憑證、baseline、logs 與 `dist/`／`test-results/` 不列為產品 source。既有 `.env`／`.env.test` 未替換，dependencies 與 pnpm lockfile 未變動。

新增（45）：

| File | 用途 |
|---|---|
| `src/server/config.ts` | 分環境嚴格設定驗證 |
| `src/server/access.ts` | Alpha code／簽章 cookie |
| `src/server/rate-limit.ts` | Bounded fixed-window limiter |
| `src/server/logging.ts` | Allowlisted structured logger |
| `src/server/production.ts` | HTTP/S、Origin、gate、static、WSS admission |
| `src/ui/ProductionBootstrap.tsx` | Runtime public config／access／reauthorization |
| `tests/production-security.test.ts` | 15 security/config tests |
| `tests/production-transport.test.ts` | 9 HTTP／WS／log tests |
| `tests/production-web.test.ts` | 7 Web／bundle／error tests |
| `tests/production-lifecycle.test.ts` | 4 bounded queue／cleanup tests |
| `tests/db/readiness.test.ts` | DB readiness integration |
| `e2e/production/helpers.ts` | TLS／DB／process／browser test harness |
| `e2e/production/closed-alpha.spec.ts` | 2 production-like recovery E2Es |
| `playwright.production.config.ts` | Production Browser suite |
| `Dockerfile` | Multi-stage non-root Node runtime |
| `.dockerignore` | Build context 排除 secrets／產物 |
| `deploy/compose.yaml` | 單一 game process／TLS proxy |
| `deploy/Caddyfile` | HTTPS proxy／forwarded IP／log redaction |
| `.env.development.example` | Development placeholder template |
| `scripts/deployment-smoke.ts` | 正常 TLS 的公開 smoke |
| `scripts/test-caddy-redaction.ts` | 實際 proxy canary regression |
| `docs/phase6-plan.md` | 架構／執行計畫 |
| `docs/phase6-security-report.md` | Security primitives TDD evidence |
| `docs/phase6-web-report.md` | Web boundary／focused checks |
| `docs/phase6-review.md` | 獨立審查／修正後再驗證 |
| `docs/phase6-fix-report.md` | Queue／proxy／cold-load 修正證據 |
| `docs/deployment.md` | 部署／migration／rollback／驗收程序 |
| `docs/phase6-results.md` | 本報告 |
| `apps/web/index.ts` | 獨立 native Node Web runtime |
| `src/web/config.ts` | 僅 public settings 的 Web 設定 |
| `src/web/server.ts` | Static host／固定 Alpha API bridge |
| `src/server/proxy.ts` | 明確 Railway／Caddy edge IP 模式 |
| `tests/railway-web.test.ts` | 13 個 Web boundary tests |
| `tests/railway-ticket.test.ts` | 4 個 ticket／origin／lifetime tests |
| `tests/railway-client.test.ts` | 3 個 split-origin config／reconnect tests |
| `tests/railway-proxy.test.ts` | 4 個 proxy identity／quota tests |
| `tests/railway-expiry.test.ts` | 2 個 idle／DB-delayed expiry tests |
| `e2e/production/railway-split.spec.ts` | 分站 TLS／WSS／smoke／restart／finished E2E |
| `deploy/web.Dockerfile` | 不含 Engine／DB runtime 的 Web image |
| `deploy/railway-settings.json` | Dashboard 目標設定清單；基本設定已保存，完整發布尚未驗收 |
| `.env.web.example` | Web-only public placeholders |
| `docs/railway-deployment.md` | Railway 操作／Variables／發布／驗收程序 |
| `docs/phase6-railway-plan.md` | Railway integration 計畫 |
| `docs/phase6-railway-review.md` | 新審查發現與 root 修正驗證 |
| `docs/phase6-railway-web-report.md` | Web boundary／本機 TLS 測試證據 |

修改（16）：

| File | 變更 |
|---|---|
| `src/server/index.ts` | 共用 socket binding、heartbeat、bounded lifecycle admission |
| `src/server/managers.ts` | 安全觀測 log／production failure mapper hook |
| `src/server/persistence/postgres.ts` | readiness query，原 transactions 保留 |
| `apps/server/index.ts` | Production config／HTTP/S entry／safe startup／shutdown |
| `src/ui/main.tsx` | Production entry／排除 Local |
| `src/ui/OnlineScreen.tsx` | Explicit endpoint／gate-aware reconnect |
| `src/client/errors.ts` | Machine codes 對應可理解訊息 |
| `src/client/OnlineGameClient.ts` | 可傳入 memory-only WebSocket subprotocols，原 session／pending command 保留 |
| `package.json` | start／production E2E／deployment smoke scripts |
| `playwright.config.ts` | 分開 suites、原 memory test log config |
| `vite.config.ts` | Development lazy entry warmup |
| `scripts/migrate.ts` | Safe migration error output |
| `.env.example` | Production placeholders |
| `.env.test.example` | Test DB placeholder |
| `.gitignore` | 忽略 production env／secrets／keys |
| `README.md` | Current Phase／production 與 development 指引 |
