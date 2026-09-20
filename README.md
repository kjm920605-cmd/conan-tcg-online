# Detective Conan TCG Core Engine

## Goal

建立可測試、可序列化、可重播的獨立 Game Engine，支援本機 hot-seat 與 Server authoritative 的雙人 FIXTURE 對戰。

## Source of Truth

1. [官方 Ver.2.5 PDF](docs/reference/rule_manual.pdf)：最高優先來源，27 頁。
2. [digital-rules.md](docs/digital-rules.md)：來源稽核與完整 RULE-QUESTION。
3. [game-flow.md](docs/game-flow.md)：流程與原 89 項測試 backlog。
4. [card-schema.md](docs/card-schema.md)：目前資料契約與完整設計提案。
5. [原整理規格](docs/conan_tcg_original-rules.md)：工程參考；矛盾依 PDF 與稽核處理。

未取得官方完整裁定的 RQ-002、009、012、013、014、023、025、027 **維持 BLOCKING**。28 題分類仍為 BLOCKING 8、DEFERRED 16、IMPLEMENTATION 3、RESOLVED 1；RQ-011 的普通效果排程已確認。見 [裁定準備文件](docs/rule-adjudication-phase2.md)。工程身份、資料契約與測試 fixture 都不是官方裁定。

## Current Phase

**Phase 6 — Internet Deployment / Closed Alpha（已公開部署，跨網路驗收待完成）**。Railway production 的 web、server 與 Postgres 已上線：[Closed Alpha 入口](https://web-production-48998.up.railway.app/)。兩個 application service 從同一 [repository](https://github.com/kjm920605-cmd/conan-tcg-online) 的 main revision `ab7a087` 建置，既有 migration 成功。公開 HTTPS／WSS、Alpha、exact Origin、health/readiness 與同瀏覽器兩個匿名 session 的完整 FIXTURE 對局已驗證；待決策、進行中回合與已完成對局的實際 Server 重啟後，座位、版本與可見投影一致。尚需電腦 Wi-Fi／手機 5G 的真實跨網路驗收，**Phase 6 不標記 COMPLETE**。部署程序見 [Railway deployment](docs/railway-deployment.md)，詳細證據與限制見 [phase6-results.md](docs/phase6-results.md)。

已完成的 [Phase 5B](docs/phase5b-results.md) 使用 PostgreSQL 保存匿名 session、Room／seat、Match、完整 snapshot 及 command receipt；Server process 重啟後可恢復原對局、PendingDecision、效果續行、RNG 與 RULE_BLOCKED。保留 [Phase 5A Online](docs/phase5a-results.md) 與 [Phase 4 本機模式](docs/phase4-results.md)，引擎遊戲規則與 DSL 保持不變。

共用牌桌使用 `GameClient`：LocalGameClient 沿用 LocalController；OnlineGameClient 只接收自己的投影與合法操作，再送出指令。Online 模式不載入 Local bootstrap，不建立 Browser Engine，也不提供完整快照工具。Node + WebSocket server 使用同一份 `src/game` 與 FIXTURE 卡牌資料；不複製引擎。

React + TypeScript + Vite 桌面使用兩套固定 40 張 FIXTURE Deck。UI → LocalController → Engine Command；可用操作經 Engine preview 驗證。Board 只收到 viewer-specific projection；回合或反應選擇權換人時先卸載私密畫面，Ready 後才顯示下一位玩家手牌。Mulligan、Next Hint、Mislead、Guard、Contact 回應、效果選序與調查使用通用 decision panel。

資料 pipeline：`data/cards` ＋ `data/card-programs` → `readCardCatalog`／schema 與引用驗證 → `compileContent` → GameEngine。28 張全部明標 **FIXTURE（正式卡 0 張）**，24 SUPPORTED、1 PARTIAL、3 BLOCKED。PARTIAL／BLOCKED 可保存為編輯資料，但整張不能編入牌局；不會把未支援部分靜默略去。Search 仍為 unsupported mechanic。

保留 Phase 1 的初始化／先後攻／Mulligan／Auto→Main→End／Assist／FILE／Case／Refresh，以及 Phase 2 的 Next Hint／Switch／Deduction／Mislead／Action／Guard／Contact。

Phase 3A 已提供 FieldEntry、Cut-in、專用 Disguise 替換、八種 keyword、MR 明示移動與有效區域、有限 Effect DSL、Set／underneath、簡單 Contact／Action／Turn modifier 到期、Investigate 選序及中途保存／重播。Phase 3B 用磁碟 JSON、逐卡測試與四組跨卡互動驗證這些能力。

- Contact 每方最多一次 Cut-in 或 Disguise；低 AP 方先，同 AP 非回合方先；先方 PASS、後方使用時給先方一次重試。
- Disguise 繼承官方列出的資料，舊卡裏置牌庫底；不當作登場。跨色／超 Level、MR 交互及一般重入仍受未決規則限制。
- MR Partner 能力必須明列區域。宣言目前只支援明列 OWN_MAIN、NONE 成本的合成能力；未實作任意時機、複合成本、Turn1 或正式 MR 卡文。
- 效果 program 必填來源要求、目標選取時點、目標區域、duration、無效目標行為。只支援文件明列的有限運算，沒有通用猜測 fallback。
- Assist Partner 計入 FILE，但 Next Hint 跳過；於**自己的下一個 Auto 第一步**返回 Partner Area 並 ACTIVE。

目前有 Local UI、Online MVP、PostgreSQL 持久化與 Closed Alpha 部署層；沒有帳號、配對、排名、Deck Builder、Redis、多 Server scaling 或新增正式卡牌。本輪範圍僅 Phase 6；公開部署與跨網路測試未完成前不宣稱驗收完成。完整替代／無效系統、其他 keyword、usage limit、通用 target／optional effect 與複雜卡文尚未由 Engine 支援。

## Architecture Principles

- **UI 與引擎分離**：所有變更經 GameEngine；私有 state，getState() 回傳深層 readonly／freeze 副本。玩家只提交 Intent。
- **三層身份**：不可變 CardDefinition、實體 CardInstance、一次在場存在 FieldEntry 分離。新 occurrence 不代表 Turn1／modifier／target／能力次數重設。
- **可序列化**：state、choice、程序 cursor、pending、modifier、附件與 RNG 均為 JSON。
- **Data-driven**：program ID 對應有限 opcode；不依 card ID／name 實作效果，不自動解析日文卡文。Deck composition 的 ID 清單只是資料。
- **普通效果不是 LIFO 或 FIFO**：EffectQueue 每次重算回合玩家優先，同方任選；目前 effect 完成後才選下一個。程序續行 frames 與 Pending Effects 分開。
- **統一管線**：Command → Validate → Rule Step → Emit Event → Detect Trigger → Pending Effects → Checkpoint → State Transition。MR 立即移動與 Disguise 專用替換不塞進普通 pending。
- **可注入 RNG**：所有亂數經 Rng.next；不使用 Math.random、時間或隱藏 global state。
- **Server authoritative**：Online 完整狀態、RNG、事件與 receipts 只存在 server；身分取自 socket session。所有封包經 shared strict runtime schema 驗證。Local developer import 僅是可信本機宿主能力，網路沒有快照回寫 API。
- **Version／Idempotency**：網路 command 帶 matchId／commandId／expectedVersion；成功 command + 自動續行視為一筆 transaction，stateVersion 加一。重送已接受的相同 envelope 不再次執行；過期版本回 STALE_STATE 與最新私人投影。Engine revision 保持原逐步語義。
- **Durability**：Engine 在隔離 draft 執行；DB transaction 提交 command receipt、snapshot、version 與 metadata 後才發布成功。持久化失敗丟棄 draft 與 runtime cache；後續重新讀 durable state，不切換到 memory fallback。
- **Reconnect／Replay**：匿名 session + resumeToken 恢復原座位及 pending decision；room code 不是憑證。快照保存續行與 RNG；固定內容、RNG 與命令產生相同結果。Replay 為既有 Engine 測試能力，尚無網路 replay 服務。
- **Fail-closed**：載入／宣告時拒絕未知語義；合法流程中遇到未知互動保存 RULE_BLOCKED 與診斷，不代選或判負。
- **版本**：schema 3／engine 0.3.0／ruleset pdf-2.5+explicit-3a。舊 schema 明確拒絕，沒有隱式遷移。

## 執行

需要 Node.js 24+、TypeScript 5.9.3；持久 Online／DB 測試需要 PostgreSQL。使用 React、Vite、ws、Zod、Drizzle + pg 與 Playwright，沿用 pnpm lockfile：

~~~sh
pnpm install --frozen-lockfile
npm test
npm run test:regression
npm run typecheck
npm run demo
npm run build
npm run test:e2e
npm run test:db
npm run test:e2e:restart
npm run test:e2e:production
npm run dev
~~~

第一次啟動開發版持久 Online，先準備 PostgreSQL 與 `.env`／`.env.test`。`.env.development.example` 是開發模板，`.env.example` 現為 production placeholder 模板，複製後必須填入實際環境設定；保留既有 `.env`。本工作區已建立本機 PostgreSQL 18.6（僅 `127.0.0.1:55432`），開發 DB 與專用測試 DB 分開；控制與 binary 來源見 [PostgreSQL setup](docs/phase5b-postgres-setup.md)。其他環境使用自己的 PostgreSQL URL。

~~~powershell
.\scripts\postgres-dev.ps1 start
# 首次設定才從開發／測試模板複製並填妥 placeholder；保留已有設定。
if (!(Test-Path .env)) { Copy-Item .env.development.example .env }
if (!(Test-Path .env.test)) { Copy-Item .env.test.example .env.test }
npm run db:migrate
~~~

Online 再開啟兩個終端，分別執行：

~~~sh
npm run server
npm run dev
~~~

Development Server 預設 `127.0.0.1:8787`。兩個獨立瀏覽器／無痕視窗開啟 [Online 牌桌](http://127.0.0.1:5173/?mode=online)：A 按 Create Room，分享 Room Code；B 輸入後 Join Room；雙方 Room Ready，開始 Mulligan。只使用既有固定 Fixture Deck A／B。

Railway Production 使用 `npm run build` 的 Web，Web host 執行 `npm run start:web`，Game Server 執行 `npm start`；共用根目錄 source，不複製 Engine。Web 經 runtime `WEB_PUBLIC_URL`／`GAME_SERVER_PUBLIC_URL` 取得公開設定，first-party Alpha cookie 經固定 HTTPS API bridge 取得短時效 ticket，再直接連另一 Railway domain 的 WSS `/ws`。Secrets 與 DB 只在 Server Variables；前端 bundle 不含 secrets。正式 build 預設 Alpha／Online，不提供 Local 或 developer snapshot 工具。發布需先 migration、readiness、正常憑證 smoke 與跨網路驗收；單一 authority 必須 stop-before-start，詳見 [Railway 部署文件](docs/railway-deployment.md)。原同 origin Cookie／Caddy 方案仍可使用，見 [portable deployment](docs/deployment.md)。

匿名 token 明文只保存在該分頁的 sessionStorage，DB 僅保存 hash。重新整理或 Server process 重啟後，使用原憑證恢復原 Room／seat／match；斷線後按 Reconnect，Resync 取得最新投影。重連尚未完成時不能操作，斷線不判負。Finished 對局仍可查看結果，新 gameplay 回 MATCH_FINISHED。

Restore 驗 engineVersion／rulesetVersion／compiled card data fingerprint／RNG algorithm；不相容回 VERSION_INCOMPATIBLE。Missing／corrupt／invalid snapshot 明確拒絕，不退回較舊版本或建立替代牌局。Development 沿用 PERSISTENCE_ERROR；production 將已識別的 DB 連線故障轉為 DATABASE_UNAVAILABLE，未知內部錯誤轉為 SERVER_ERROR，皆不回 raw stack。DB 恢復後可重連或 Resync。

關閉分頁／清除 sessionStorage 後不保證找回 token；此版沒有帳號復原或 rematch。只有憑證確實無效才使用 New anonymous session。舊 Phase 5A memory process 的既存局不會自動匯入 DB；本版從 PostgreSQL 模式建立的新局具有跨重啟恢復能力。

`npm run server` 預設使用 PostgreSQL，缺少 DATABASE_URL 會拒絕啟動。可明確設定 `MATCH_STORAGE=memory` 執行暫存開發模式，不能跨 restart 恢復；DB 故障不會觸發此模式。原 Browser E2E 使用明確 memory adapter；`test:db` 與 `test:e2e:restart` 必須連真實專用測試 DB，並以各自隨機 schema 隔離與清理。不得將 TEST_DATABASE_URL 指向有其他用途的 DB。

局域網開發可在 server 終端設定 `HOST=0.0.0.0`，Vite 執行 `npm run dev -- --host 0.0.0.0`，兩端以宿主的 LAN IP 存取。PowerShell 使用 `$env:HOST='0.0.0.0'`。`PORT` 改 server port；`VITE_GAME_SERVER_URL` 僅供 development 指定完整 WebSocket URL，開發預設使用網頁 hostname 的 8787 port。Production 由 `WEB_PUBLIC_URL`／`GAME_SERVER_PUBLIC_URL` 設定，沒有 localhost fallback 公開部署。

PowerShell 可使用 npm.cmd。demo 包含原核心牌局終局、Phase 3A 明示能力，以及載入 Phase 3B JSON 的四組跨卡互動。每個互動步驟都比對 restore，完整紀錄另由初始狀態 replay。Regression 現在執行全部測試，包含原 Phase 1–3A 的 124 項。

啟動後開啟 [本機牌桌](http://127.0.0.1:5173)。先把裝置交給畫面指定玩家並按 Ready，再選 Mulligan；另一位玩家同樣操作。後續依操作／決策面板遊玩。反應窗口也可能要求交接，請先把裝置交給指定玩家。

本機 localStorage 自動保存快照；重新整理後一律先遮蔽牌桌。Developer tools 僅在 Vite development mode 出現，提供 Export／Import Snapshot、Copy Game State 與檢視工具，並明示完整快照包含雙方私密資訊。正式 build 不含 dev panel。這是同機可信宿主，無法防止共用電腦使用者透過開發者工具讀取本機儲存；不是網路安全邊界。

Windows E2E 預設使用已安裝的 Microsoft Edge（Chromium）；其他平台先執行 `npx playwright install chromium`。可用環境變數 PLAYWRIGHT_CHANNEL 指定其他已安裝 channel。Chromium 下載在本環境逾時，因此本輪使用 Edge 通過驗證。Snapshot import 若不相容會保留目前對局並顯示錯誤。

原 Phase 1／2 的 71 項測試全部保留；原 UT-001–089 是完整 backlog，不等於全部完成。實際測試數與限制見驗收文件。

## 目前目錄

~~~text
src/game/
  model.ts                 # definition、instance、entry、modifier、state、command
  index.ts                 # GameEngine、型別、RNG、RuleError
  content/                 # 嚴格內容／program／trigger 白名單
  engine/                  # GameEngine、初始化、事件移動、各層 invariant
  procedures/              # 行動、Contact 回應、宣言、調查、回合及 Refresh
  effects/                 # EffectQueue、EffectResolver、有限 opcode
  rules/                   # orientation、identity、keywords、modifiers、MR
  random/                  # 可注入 RNG、洗牌
  persistence/             # JSON、安全整數、freeze、fingerprint
src/cards/                 # catalog、支援狀態、schema／binding 驗證與 Content 編譯
src/game/client/           # PlayerView、可見事件、LegalActions、PendingDecision
src/local/                 # 私有 local host controller、兩套固定 fixture deck
src/client/                # GameClient、LocalGameClient alias、OnlineGameClient
src/server/                # RoomManager、MatchManager、session、ws transport
src/server/persistence/    # Store interface、Drizzle tables、PostgreSQL／Memory adapters
apps/server/               # Node server 入口
src/web/                   # 獨立 Web static host 與限定 Alpha API bridge
apps/web/                  # 不含 Engine／DB／secrets 的 Web runtime 入口
deploy/                    # Docker、portable proxy、Railway Dashboard 設定清單
db/migrations/             # PostgreSQL 初始 schema，無遊戲快照 migration
scripts/                   # db:migrate 與本機 PostgreSQL 控制
packages/protocol/         # shared typed protocol + Zod runtime validation
src/ui/                    # 共用 React 桌面、Local/Online bootstrap、lobby
data/cards/                # 28 張明標 FIXTURE 的代表卡
data/card-programs/        # 18 個獨立有限 Effect Program
tests/                     # 保留全部基準，新增 schema、逐卡與跨卡測試
e2e/                       # Playwright 瀏覽器完整對戰／隱私／恢復
examples/                  # 三個 CLI demo 與共用純命令互動 adapter
docs/                      # 官方來源、規則登錄、設計、分階段驗收
~~~
