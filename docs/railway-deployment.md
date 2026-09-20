# Railway Closed Alpha deployment

指定 repository：[kjm920605-cmd/conan-tcg-online](https://github.com/kjm920605-cmd/conan-tcg-online)，兩個 application service 均指定 `main`。既有 Conan TCG Closed Alpha project／production 已建立 `web`／`server`／`Postgres`。**2026-09-20 兩個 Docker deployment 與既有 migration 已成功，Railway generated HTTPS／WSS endpoints 已上線；真實跨網路驗收仍待完成。** 實際 URLs、service IDs 與測試證據見 [phase6-results.md](phase6-results.md)，勿重複建立 project 或 services。

## 部署設定

Railway 目前官方文件指出新 service 不能啟用舊 `railway.json`／`railway.toml` Config as Code。因此本輪使用 Dockerfile + Dashboard 最小設定，不加入無法套用的舊 config。`deploy/railway-settings.json` 是可審查的操作設定清單，**不是 Railway 自動讀取的設定**；實際 deployment settings 必須在 Dashboard 核對。[官方 Config as Code](https://docs.railway.com/config-as-code)

| 設定 | web | server |
|---|---|---|
| Source | 同一 GitHub repository／main | 同一 GitHub repository／main |
| Root directory | `/`，保留完整共用 workspace | `/`，保留完整共用 workspace |
| Dockerfile | `deploy/web.Dockerfile` | 根目錄 `Dockerfile` |
| Custom build command | 留空；Docker build stage frozen install → typecheck → Vite build | 留空；Docker build stage frozen install → typecheck → Vite build → prune |
| Start command | `node apps/web/index.ts` | `node apps/server/index.ts` |
| Pre-deploy | 無 | `node scripts/migrate.ts` |
| Healthcheck | `/ready`，120 秒 | `/ready`，120 秒 |
| Replicas／Serverless | 1／Off | 1／Off |
| Auto-deploy | 第一輪 Off，手動部署同一 main revision | **Off**，受下方單一 authority 發布程序約束 |
| Public networking | Generate Domain，HTTPS | Generate Domain，HTTPS + WSS `/ws` |

Watch paths 逐項使用 `deploy/railway-settings.json` 對應清單。兩個 image 都在根目錄 typecheck，因此監看共用程式／測試／設定；不能只選 `apps/web` 或 `apps/server` 作為 build context。本次在 Dashboard 的 Dockerfile Path 欄位設定 web 的 `deploy/web.Dockerfile`、server 的 `Dockerfile`，並已實際 build 成功。`RAILWAY_DOCKERFILE_PATH` 是替代設定方式，現有服務不需要重複新增。平台從 Dockerfile build，勿另跑 Vite dev server。[官方 Dockerfiles](https://docs.railway.com/builds/dockerfiles)

Web runtime image 只有 built assets、Web host 與四個共用基礎工具檔；沒有 Engine、卡池、PostgreSQL client 或 node_modules。Server runtime 使用唯一一份原 `src/game`，沒有複製引擎。

## Variables

**所有真實 secrets 由使用者本人在 Railway Variables 輸入。不要貼到 Chat、prompt、GitHub 或文件。** 範例檔只有 placeholder，不複製現有本機 `.env`。以下只列名稱及非秘密設定規則。

| Variable | web | server |
|---|---|---|
| `NODE_ENV` | `production` | `production` |
| `HOST` | `0.0.0.0` | `0.0.0.0` |
| `PORT` | Railway Variables 設為 `8080`，domain target 同為 8080 | Railway Variables 設為 `8787`，domain target 同為 8787 |
| `RAILWAY_DOCKERFILE_PATH` | 使用 Dashboard Dockerfile Path 時不需要；替代值 `deploy/web.Dockerfile` | 使用 Dashboard Dockerfile Path 時不需要；替代值 `Dockerfile` |
| `WEB_PUBLIC_URL` | 生成的 Web HTTPS origin | 同一 Web HTTPS origin |
| `GAME_SERVER_PUBLIC_URL` | 生成的 Server **wss** origin 加 `/ws` | 同一值 |
| `CORS_ORIGINS` | 不需要 | 只允許 `WEB_PUBLIC_URL` 的完整 origin，無 `*` |
| `ALPHA_TRANSPORT` | 不需要，Web 固定 ticket transport | `TICKET` |
| `DATABASE_URL` | **不得設定** | Railway 對 PostgreSQL `DATABASE_URL` 的 reference；使用者本人設定 |
| `DATABASE_SCHEMA` | 不需要 | `public` |
| `MATCH_STORAGE` | 不需要 | `postgres` |
| `SESSION_SECRET` | **不得設定** | 使用者本人設定獨立隨機值 |
| `ALPHA_ACCESS_SECRET` | **不得設定** | 使用者本人設定另一獨立隨機值，提供 Alpha 玩家使用 |
| `ALPHA_TTL_SECONDS` | 不需要 | `28800`（預設 8 小時） |
| `TRUST_PROXY` | `true`，只在 Railway edge 後 | `true`，只在 Railway edge 後 |
| `PROXY_IP_HEADER` | `X_REAL_IP` | `X_REAL_IP` |
| `LOG_LEVEL` | `info` | `info` |

不要設定 production `VITE_*` secrets、`TEST_DATABASE_URL`、本機 TLS key/cert、`NODE_TLS_REJECT_UNAUTHORIZED=0`。平台處理公開 TLS，app listener 使用內部 HTTP。PostgreSQL 使用 Railway 提供的連線資訊，不手寫 DB host／帳密、不公開 TCP proxy；連線若需要 CA／TLS，沿用 provider 正確配置，不關閉憑證驗證。

## Alpha 與跨站連線

Browser → Web HTTPS → first-party `/api/alpha` JSON POST → fixed Game Server HTTPS Alpha API。只有 Server 驗證 code 與簽章；Web 不需要 secret，只轉送限定 JSON 和 `__Host-alpha` Secure／HttpOnly／SameSite=Strict cookie。該 cookie 屬於 Web domain。

Browser → Web `/api/alpha/socket-ticket` → Server 驗證 cookie → 30 秒 admission ticket → Browser memory → 直接連 Game Server WSS `/ws`。Ticket 只放 `Sec-WebSocket-Protocol`，Server 只回傳固定 `conan-alpha.v1`，不回顯 credential；禁止 ticket URL/query、永久儲存或 log。既有連線到原 Alpha expiry 為止；timer 到期關閉且每次送資料前重驗，避免 DB 延後或對手操作在到期後送出投影。重連取得新 ticket，保留原 resume credentials／pending command。

Room code 仍不是身分憑證。Alpha gate 後原 PlayerSession、resumeToken、match／seat／decision ownership、version、persistent idempotency 完整保留。

## Origin、IP 與限流

Server HTTP／WebSocket 都只允許設定的 Web origin。Web CSP `connect-src` 只允許自己和設定的完整 WSS endpoint。未提供或格式不合法的公開設定拒絕啟動，無 localhost fallback。

Railway 文件明列 `X-Real-IP` 識別 client remote IP；本版明確選擇此 header，不假設 Railway 的 X-Forwarded-For chain。未啟用 TRUST_PROXY 時忽略所有 IP headers；原單機 Caddy 方案保留預設 `X_FORWARDED_FOR` 模式。[官方 Specs & Limits](https://docs.railway.com/networking/public-networking/specs-and-limits)

Web 以 edge client IP 限流，且在 Railway 模式不向公開 Server 轉寄 visitor IP。Server Alpha API 因此對 Web egress 共用 aggregate bucket（10 code attempts/min、30 ticket requests/min），適合小批 Closed Alpha；大量玩家同時登入會回 RATE_LIMITED，約 60 秒後再試。Direct WSS 的限流仍依其 edge client IP。不得為繞過 aggregate quota 信任任意 client-supplied forwarding header。

公開上線後必須實測：不同網路的 quota 隔離、偽造 XFF／X-Real-IP 不可逃過 edge 覆寫與 app quota。未確認前不宣称此項 public acceptance 通過；不要建立繞過 edge 的 application TCP port。

## 首次發布與後續 restart／rollback

1. 先將已通過 gates 的來源推至指定 repository `main`，記錄 commit。確認 source 不含 `.env`、tokens、私鑰、DB dump、tmp 或 build 產物。
2. 使用既有 project／production／三個 services，核對 web/server 同 repository main 且 auto-deploy 停用；為兩者生成 Railway domain，填完公開設定。使用者在 Server Variables 設定 DB reference 與 secrets。官方記載 Alt + Deploy 可只保存設定，但本次瀏覽器自動操作仍觸發兩服務首次 build，原因未確認；**不可依賴快捷鍵保證不部署**。對已上線 server 套用 Variables／settings 之前，同樣必須先執行下方停止舊 deployment 的程序。[官方 staged changes](https://docs.railway.com/deployments/staged-changes)
3. 等 PostgreSQL ready。Server pre-deploy 跑既有 version-controlled migration；成功才 start，`/ready` 必須通過。沒有新 SQL migration，不能手動重建 match tables。
4. 發布 web 同一 commit，驗證 `/ready` 能連上 server，核對 Variables **名稱**與 deployment config，不列出秘密值。
5. 核對 HTTPS root、server `/health`／`/ready`、exact Origin、Alpha、direct WSS。記錄 image/build 成功證據；本次兩個 Railway Docker build 已通過，本機仍沒有 Docker CLI，未執行 portable Compose 驗收。
6. 後續 server 發版、Variables／settings 更新或 rollback：**先 Remove 舊 server deployment 並確認 Removed、原玩家 DISCONNECTED，再 deploy 選定的 main commit 或已驗證相容舊版本**。相同版本恢復可對已停止的 deployment 選 Redeploy。只停止運行 deployment，保留 service、database、volume、Variables。期間短暫離線，玩家按 Reconnect 使用原憑證恢復。[官方 Deployment actions](https://docs.railway.com/deployments/deployment-actions)

Railway 正常 healthcheck 切換會讓新 process 先啟動再退掉舊 process；一 replica 或 overlap=0 本身不能保證沒有兩個 authority。因此此版不使用自動 rolling deploy。不可使用會先啟動替代 process 的 Restart／Redeploy 流程代替明確 stop-before-start，除非已確認平台該 action 的實際停止順序。[官方 Healthchecks](https://docs.railway.com/deployments/healthchecks)

新舊 Engine／ruleset／card data 必須相容；不相容回 VERSION_INCOMPATIBLE。保留 DB 與 snapshots，不藉 rollback 重置牌局。DB unavailable／migration failed 時不要開 memory fallback。

## Public smoke 與 cross-network acceptance

`npm run smoke:deployment` 使用 Web public URL 和選填明確 Game Server URL，正常 TLS 驗證，检查雙端 health/ready、Web HTML／public config、拒絕 foreign origin、Alpha cookie、ticket、WSS SESSION。Operator 的 `ALPHA_TEST_CODE` 只能在本人私有執行環境設定，不交給 Codex、不輸出值；如不使用私有 CLI，使用者可在公開 Web Alpha 表單本人登入後進行驗收。腳本成功 **不等於完整 match／restart／不同網路已驗證**。

最後使用 Device A 電腦 Wi-Fi、Device B 手機 5G 或另一網路，皆開實際 Railway HTTPS URL：Alpha → Create／Join → Ready → Match → interactions → reload／disconnect → Reconnect → continue → finish。另開 active match，記錄 seat、match、decision、stateVersion，依 stop-before-start 程序重啟 server，再恢復同局並完成。驗证不同 Origin 被拒、對手手牌隱藏、原 command 跨 restart 不重複執行。

在 `docs/phase6-results.md` 記錄兩個實際 URLs、部署 revision、migration、public smoke、match／restart／跨網路證據與未完成項；上述 public + cross-network 均通過後才能標 COMPLETE。8 個 BLOCKING RQ 與所有 Game Engine 規則維持原狀。
