# Phase 6 — Internet Deployment / Closed Alpha

完整程式品質驗證紀錄：2026-09-13–14；首次提交前的 Node tests／typecheck／build 重驗：2026-09-19–20；實際 Railway 公開部署與恢復驗證：2026-09-20（Asia/Taipei）。本次續作僅修改部署設定與文件，沒有修改遊戲程式。

**狀態：Railway 公開部署及雙 session 對局／重啟驗證已通過；真實跨網路驗收待完成，Phase 6 不標記 COMPLETE。** Conan TCG Closed Alpha 的 production 已運行 web／server／Postgres，兩服務從同一 main revision `ab7a087` 建置。以下公開驗證使用 Railway generated URLs 與正常 TLS 憑證驗證，不使用 localhost 代替。未升級付費方案或建立新帳號。

## Deployment target / endpoints

| 項目 | 實際狀態 |
|---|---|
| 平台／主機／部署方式 | Railway；Conan TCG Closed Alpha／production，獨立 Web／Server Docker services，已上線 |
| Source | [conan-tcg-online](https://github.com/kjm920605-cmd/conan-tcg-online)，兩服務指定 main；實際部署 revision `ab7a087a65ec8aedb0db847cc90d23b805d2633b` |
| 公開 HTTPS Web URL | [Closed Alpha Web](https://web-production-48998.up.railway.app/) |
| 公開 HTTPS Server URL | [Server health](https://server-production-ab3e.up.railway.app/health) |
| 公開 WSS URL | `wss://server-production-ab3e.up.railway.app/ws` |
| Production PostgreSQL | Railway Postgres Online；Server pre-deploy 記錄 `migration.applied`／`0001_persistent_matches`，之後 `server.started`、`/ready` 200。公開對局實際跨 process 恢復 |
| 公開憑證／DNS | 兩站正常 TLS 驗證成功，HTTPS／WSS 可達；未關閉憑證驗證 |
| Public deployment smoke | 無秘密 HTTP／admission 檢查 16/16；使用者本人 Alpha 登入後，公開 UI 完整對局／refresh／restart 通過。帶 code 的 CLI 未執行，見下方範圍 |
| 不同 network 的 Device A／B | 尚未執行；沒有跨網路驗收證據 |

### Railway 實際設定紀錄

[Project Dashboard](https://railway.com/project/15e27d1c-b0c7-47c6-aa43-61143d50a2e7?environmentId=7d26e95b-d842-4326-bfd3-3fc13df37660)。Project ID：`15e27d1c-b0c7-47c6-aa43-61143d50a2e7`；production ID：`7d26e95b-d842-4326-bfd3-3fc13df37660`。

| Service | Service ID | 已保存設定 |
|---|---|---|
| web | `5988bde1-9a27-40c4-af19-fd6200bcc4b8` | 根目錄 build；`deploy/web.Dockerfile`；`node apps/web/index.ts`；`/ready`／120 秒；15 個 watch paths；8 個非秘密 Variables；PORT／domain target 8080 |
| server | `bbc10174-5293-4d0f-9430-42c60301093a` | 根目錄 build；`Dockerfile`；`node apps/server/index.ts`；pre-deploy `node scripts/migrate.ts`；`/ready`／120 秒；15 個 watch paths；16 個 Variables（含使用者設定的 DB／兩個 secrets）；PORT／domain target 8787 |
| Postgres | `e5a67b83-a506-49f5-a698-9461c3447285` | Railway PostgreSQL service／volume；未開放 public DB TCP proxy |

2026-09-19 初次保存設定時，repository 尚無來源，未產生 application deployment。2026-09-20 公開 domain 已取得使用者操作前確認，實際套用公開設定時，透過自動操作送出的 Alt + Deploy 仍觸發兩個首次 Docker build；原因未確認。當時沒有舊 authoritative process，因此沒有新舊重疊。**後續不能依賴此快捷鍵保證只儲存；server 的 code／Variables／settings 變更一律先停舊部署再發布。** 官方仍記載此快捷鍵為 save-only，這裡保留觀察與文件的差異。[Railway staged changes](https://docs.railway.com/deployments/staged-changes)

web／server 均已確認 **Auto deploy is disabled**，保留 main 來源供手動發布；各 1 replica、Serverless Off。Dockerfile Path 使用 Dashboard 欄位，沒有另外新增 `RAILWAY_DOCKERFILE_PATH`。首次 web deployment：`0eb6a6f5-ec78-438f-a304-de063fbfebe9`；首次 server deployment：`709729d0-1e44-4623-a22c-180cbb2e90e2`。實際部署的 Details 連到 GitHub revision `ab7a087`。[官方 GitHub autodeploys](https://docs.railway.com/deployments/github-autodeploys)

共同非秘密 Variables：`NODE_ENV=production`、`HOST=0.0.0.0`、`TRUST_PROXY=true`、`PROXY_IP_HEADER=X_REAL_IP`、`LOG_LEVEL=info`、`WEB_PUBLIC_URL`、`GAME_SERVER_PUBLIC_URL` 與對應的 `PORT`。Server 另有 `MATCH_STORAGE=postgres`、`DATABASE_SCHEMA=public`、`ALPHA_TRANSPORT=TICKET`、`ALPHA_TTL_SECONDS=28800`、exact Web origin 的 `CORS_ORIGINS`。Application 仍讀取環境 PORT／URL，沒有將實際 domain 寫入程式。

使用者本人已設定 `DATABASE_URL`、`SESSION_SECRET`、`ALPHA_ACCESS_SECRET` 並在公開 Web 完成 Alpha 登入。僅核對 masked Variables 名稱，未讀取或代填秘密值；web 沒有 DB／signing／access secrets。`deploy/railway-settings.json` 的 `applied:true` 表示 Dashboard 設定與實際部署已核對，**不表示跨網路驗收完成**。Manifest／範例仍不含實際 domain 或秘密。

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
| Docker build / Compose run | 2026-09-20 兩個 Railway Docker build／runtime PASS；本機沒有 Docker CLI，portable Compose 未執行 |
| `npm run smoke:deployment`（公開目標） | 未執行帶 code 的 CLI，避免取得使用者秘密；相同 CLI 曾在本機雙 TLS process E2E 通過。本次公開無秘密檢查與登入後 UI 驗證另列如下 |
| Cross-network Closed Alpha | 未執行 |

新增 Node tests：原部署層 35 + Railway Web 13、ticket 4、client 3、proxy IP 4、expiry 2，共 **61**；原 **272** 項保留。DB 新增 readiness 1 項，原 23 項保留。Browser 原 12 項保留，production 共 3 項，合計 15 項。Proxy redaction 是另行執行的本機 integration check。

Local 初次冷啟動曾在原五秒 handoff assertion 失敗；trace 顯示 dynamic module 還在載入。加入 development entry warmup 後，原完整 8 項套件通過；未放寬原測試 timeout 或修改 Engine。

本輪沙箱內重跑再次出現初次 handoff 冷載入逾時，且 Playwright 無法退出它建立的測試服務。停止已確認的兩個測試 process、在沙箱外執行原套件後 8/8、exit 0；未再修改 warmup／UI／Engine 或放寬 assertion。此環境的 cold dev loading 仍可能受檔案存取延遲影響；正式 built Web tests 另行驗證。Railway review 的 expiry／proxy IP 問題、RED→GREEN 證據見 [phase6-railway-review.md](phase6-railway-review.md)。

## Railway public validation — 2026-09-20

使用真正 Railway endpoints、正常 TLS 驗證，無本機 DNS 對映、測試 CA 或 server response stub。

無秘密公開檢查 **16/16、exit 0**：Web／Server `/health`、`/live`、`/ready` 共六項；Web HTML、built assets、HSTS／正確 WSS CSP；public config 僅四個公開欄位；匿名 Alpha GET；雙站錯 Origin 拒絕且無 wildcard CORS；Server exact Web origin preflight；錯 code 401；無 cookie ticket 401；無 ticket WSS 401／錯 Origin WSS 403。檢查工具放在 ignored `tmp/phase6/railway-public-check.mjs`，沒有讀取真實 secret 或改變對局。

使用者親自在公開 Web Alpha 表單登入後，以同一瀏覽器的兩個獨立匿名玩家分頁進行下列操作。**這是兩個 session，並非兩台裝置或不同網路。** Room `AAF561F6`；Dashboard allowlisted logs 顯示 match `954c6b53-db49-47a4-b4dc-eb02d94e0dc0`。

| 公開流程 | 證據／結果 |
|---|---|
| Alpha → direct WSS → Create／Join → Ready | A／B 均 CONNECTED，固定座位、各自手牌與對手 Hidden card |
| Mulligan 待決策 → Server stop → redeploy → Reconnect | Version 1；A 已選一張換牌，B 待 Mulligan。兩方 seat／room／version／完整可見牌桌／decision panel 字串逐欄一致，B 同 owner 與五個原選項 |
| 出牌／推理／多回合 → Browser B reload | Version 12；B 原 seat／room／version／可見投影完全相同 |
| 進行中回合 → Server stop → redeploy → Reconnect | Version 12；A／B 可見投影與版本逐欄一致，繼續操作至版本 36 |
| 完整 FIXTURE 對局 | Version 36，FINISHED，B 勝利／EMPTY_DECK，無可用 gameplay 操作 |
| Finished → Server stop → redeploy → Reconnect | PASS；Alpha 到期後使用者本人重新登入，A／B 以原 session 回到同房間、原座位、version 36。雙方可見牌桌／decision panel 與重啟前逐欄完全一致，仍為 B 勝利／EMPTY_DECK，兩方皆無可用 gameplay 操作 |

三次重啟都先對舊 deployment 選 Remove，確認 Removed／兩方 DISCONNECTED，再對已停止版本 Redeploy；保留 DB、volume、Variables。替代 deployments 依序為 `b002d4d7-26ef-4695-8af5-1888e54f70f4`（待決策恢復）、`3c19646c-abd7-4f97-9fc7-4509ccdb4664`（回合中恢復）、`2d2cc357-97fa-46c3-912f-7a2471201b38`（最終結果恢復，現行 Active）。未同時運行兩個 authority。

此次公開 Browser 比對以 DOM 可見內容為界，未讀取 hidden application state、cookie／resume token、DB credential 或完整 snapshot。公開 decisionId、RNG cursor、完整 durable snapshot、跨 restart 重送相同 commandId 與 `MATCH_FINISHED` 原始封包拒絕，沒有在本輪另行驗證；其證據沿用下方本機 DB／production E2E，不能宣稱已在 Railway 全部重跑。沒有因 browser 的 property insertion order 導致 JSON 字串不同而判定 state 差異：最終使用逐欄內容相等比較。

Alpha 重新驗證沒有建立新 Room 或替代 Match；原完成對局仍保留。公開 UI 沒有 finished gameplay 按鈕，因此本次只確認結果可讀與 UI 不再提供操作，不將其等同於原始協議 `MATCH_FINISHED` 拒絕測試。

## Historical local restart / reconnect evidence

Production E2E 使用兩個獨立 Browser Context、真正 TLS 與 PostgreSQL schema，啟動 `apps/server/index.ts` 的 production process（Node 原生 TypeScript），沒有 Vite proxy 或合成 server response。

1. Alpha → A Create／B Join → Ready／Mulligan → 多回合出牌與推理 → B refresh → 原 seat → kill／restart Server → 同 Match／seat／投影／stateVersion／完整 durable snapshot → 繼續至 finished → 再次 restart → final result 可讀 → 新 gameplay 回 MATCH_FINISHED。
2. Mulligan redraw 接受後停在下一個 PendingDecision → 清除一方 Alpha cookie → kill／restart → 重新輸入通行碼並使用原 PlayerSession → 同 decision／owner／合法選項／stateVersion → 重送原 command → duplicate → durable snapshot（包含 RNG）完全相同 → 正常繼續。

原 Phase 5B 四項 browser restart 流程另行全通過。DB suite 同時覆蓋 PendingEffects、續行、effect cursor、RULE_BLOCKED、version mismatch、missing／corrupt／invalid snapshots、真實 transaction rollback 與 unavailable DB；失敗不發成功 ACK／view、不替換 Match、不多耗 RNG。

Railway 的 TLS、production DB 與實際部署替換後恢復已有上方公開證據；不同網路重連、長時間 idle／proxy timeout、edge IP 防偽與全部 raw-protocol assertions 仍未完成，不以本機結果代替。

## Acceptance status

| 使用者 acceptance criteria | 狀態 |
|---|---|
| 1–3：公開 HTTPS、公開 WSS、不同 network 同 Room | HTTPS／WSS PASS；**不同 network 待人工驗收** |
| 4：完整 Online FIXTURE Match | 公開雙 session PASS（version 36／B 勝利） |
| 5–10：authority、privacy、persistence、restart、reconnect、idempotency | 本機完整 regression／DB／Browser PASS；公開座位／私密 UI／待決策、回合中及 finished restart／refresh PASS。公開 raw idempotency／完整 snapshot 未重跑 |
| 11–16：Alpha、secrets、CORS、health、rate、logging | 公開 Alpha／exact CORS／health／masked Variables／migration/start/resume logs PASS；edge IP 防偽與跨網路 quota 尚未驗收 |
| 17：所有既有 tests | PASS |
| 18：production build | Web build 與兩個 Railway Docker deployments PASS |
| 19：deployment smoke | 公開無秘密檢查 16/16 + 登入後 UI/WSS/match PASS；未執行需操作員秘密的 CLI |
| 20：cross-network Closed Alpha | **未執行** |

部署、Git 作者／push、使用者 secrets 設定與 generated domains 均已完成，不再列為障礙。剩餘人工驗收：Device A 電腦 Wi-Fi 與 Device B 手機 5G／不同網路，使用上述 Web URL，完成 Alpha → Create／Join → Ready → gameplay → reload／Reconnect → continue → finish；另於 active match 依 stop-before-start 重啟 Server，恢復同局後繼續。記錄日期、網路、room、座位、版本與結果；未取得這些實際證據前不標記 COMPLETE。通行碼只能在公開 Web 表單由本人輸入，不要貼在報告或 Chat。

## Known limitations / protected rules

- Phase 6 已有公開網址與雙 session 驗證，但尚未達成真實跨網路 acceptance。
- Railway Docker build/run 已通過；portable Compose 仍未執行，Caddy 本機 log check 不等於 Railway edge 設定驗收。
- Split origins／同 origin 兩種 transport、單 process authority；無 distributed rate limits、Redis、multi-server failover 或 rolling deployment。IP rate windows 共用於同 NAT，server restart 清除 buckets。Railway 模式 Server Alpha quotas 共用 Web egress（10 code／30 ticket per minute），Web 另依 edge visitor IP 限流；不信任任意 forwarding claim。
- Railway 設定清單是 Dashboard 人工核對資料，Variables／networking／release 已完成；不是自動載入的 Config as Code。Server auto-deploy disabled；所有 code／settings／Variables 發布必須先停舊 process，不依賴 Alt+Deploy 或把 1 replica／overlap=0 當成 DB 排他鎖。
- Alpha 使用共享 code，不含正式 account 或逐人撤銷；secret 輪替要求重新驗 gate，原 resume credentials 可續用。匿名 sessionStorage 遺失仍無 account recovery。
- 沿用 Phase 5B 的無 retention／GC／snapshot migration／online replay 服務限制；snapshot storage 尚未優化。只用既有 FIXTURE cards。
- **RQ-002、RQ-009、RQ-012、RQ-013、RQ-014、RQ-023、RQ-025、RQ-027 全部維持 BLOCKING。** 規則、RNG、Effect timing、serialization 語義未修改；RULE_BLOCKED 仍在相同 boundary 保存／恢復。
- 沒有進入 Account、Ranking、Matchmaking、Deck Builder、正式卡池、Social 或 Payment。

## 完整新增／修改檔案

2026-09-20 公開部署續作修改七個既有檔案，沒有新增產品程式：`README.md`、`docs/phase6-results.md`、`docs/railway-deployment.md`、`docs/phase6-railway-review.md`、`deploy/railway-settings.json`、`.env.example`、`.env.web.example`。變更為實際部署／恢復證據、PORT 設定說明與發布程序；85 個受保護 Engine／rules／cards 檔案 SHA-256 再核對為 0 changed。JSON parse 與 `git diff --check` 通過。未因文件更新重跑整套 tests，沿用相同程式 revision 的前述結果。

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
| `deploy/railway-settings.json` | Dashboard 已核對設定、PORT／target ports、停止後發布政策；跨網路仍待驗收 |
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
