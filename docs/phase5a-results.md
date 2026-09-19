# Phase 5A — Online Multiplayer MVP Results

日期：2026-09-09。完成兩個獨立 Browser Client 經真實 WebSocket Server 的 FIXTURE 對局、重連與正常終局。停止於 Phase 5A，未建立 Account、Database／Redis、Ranking、Matchmaking、Deck Builder、Production deployment 或正式卡池。

## 可操作成果與啟動

兩個終端分別執行 `npm run server`、`npm run dev`。兩個獨立瀏覽器／無痕視窗開啟 [Online 牌桌](http://127.0.0.1:5173/?mode=online)，Create Room → 分享 Room Code → Join Room → 雙方 Room Ready → Mulligan → 遊玩。Server 預設綁定 `127.0.0.1:8787`；網頁預設連到目前 hostname 的 8787 port。設定 HOST／PORT／VITE_GAME_SERVER_URL 的方式見 [README](../README.md)。

[Local 模式](http://127.0.0.1:5173/) 保留 Phase 4 hot-seat、交接遮蔽、localStorage 保存及 development snapshot 工具。Online 模式共用原牌桌與 decision panel，只增加模式連結、房間與連線操作。

固定 Fixture Deck A／B 各 40 張，沿用既有卡牌與 program。Catalog 仍為 28 FIXTURE、24 SUPPORTED／1 PARTIAL／3 BLOCKED，正式卡 0 張；沒有新增遊戲規則、卡牌資料或 DSL opcode。

## Architecture

```text
React App / DecisionPanel
  → GameClient
    ├─ LocalGameClient (原 LocalController)
    │    → src/game/GameEngine + src/cards + data
    └─ OnlineGameClient (投影、憑證、待確認 envelope)
         → packages/protocol (Zod strict runtime schema)
         → WebSocket transport
         → RoomManager (session / seat / connection)
         → MatchManager (Engine / version / receipts)
         → 同一份 src/game 與 src/cards / data
         → 每位玩家自己的 PlayerPacket
```

採漸進式單 workspace：新增 `apps/server` 入口與 `packages/protocol`，保留 `src/game` 作為唯一引擎來源，Local 與 Server 直接引用。這次不搬動既有 Engine／卡牌模組成多個 workspace package，避免在新增 transport 的同時改寫 210 項基準的引用及建置；未複製引擎。`src/client/localGameClient.ts` 是原 controller 的 alias。

`GameClient` 只提供 snapshot、subscribe、ready／lock、submit；完整快照工具是可選 development capability。OnlineGameClient 沒有該 capability，也沒有 Content、GameEngine、RNG、snapshot import/export 或任意 state setter。主入口 lazy 選擇 LocalBootstrap／OnlineScreen；共享 App 對遊戲型別的引用都在編譯時移除。

Server gameplay 流程：

1. Strict protocol validation，拒絕 unknown 欄位、unknown message、malformed 與 binary payload。
2. Socket 綁定 session → room／match／seat 驗證。玩家身分由 server 綁定，payload 不能附帶 actorId／playerId／GameState／seed。
3. 檢查已接受 command receipt，再檢查 expectedVersion、decision owner／id。
4. 將原 Engine 序列化恢復為隔離 draft → 原 Engine.dispatch → bounded automatic continuation。
5. 成功後提交 draft、更新 stateVersion／receipt，再產生各自投影、可見事件與決策並廣播。

失敗指令不提交 draft；自動續行例外或 2000-step 上限明確拒絕，不留下半筆交易。原 Engine 的 RULE_BLOCKED 結果保持不變，不自行 pass 或判負。Transport 沒有 Guard、Deduction、Contact 等遊戲規則分支。

Server 記憶體持有完整 Engine 狀態（含 RNG、事件、命令紀錄）、獨立 match version／accepted receipts；RoomManager 持有 session、座位、Ready 與連線資料。Socket 是暫時 transport 物件，沒有塞進可序列化的 GameState。未實作 server 持久化，但未改動原 Engine serialization／restore／replay 契約。

## Protocol、版本與冪等

所有收送資料都經 `packages/protocol/index.ts` runtime schema 驗證；不只 TypeScript 型別。Server → Client 也逐層驗 PlayerView、card view、legal action、decision、room 與 outcome。Transport 限制單封包 64 KiB。

| 方向 | Messages |
| --- | --- |
| Client → Server | CREATE_ROOM、JOIN_ROOM、LEAVE_ROOM、READY、RESUME_MATCH、RESYNC、MULLIGAN、GAME_COMMAND、RESOLVE_DECISION |
| Server → Client | SESSION、ROOM_STATE、MATCH_STARTED、GAME_VIEW、COMMAND_ACCEPTED、COMMAND_REJECTED、PENDING_DECISION、RESYNC_STATE、PLAYER_CONNECTED、PLAYER_DISCONNECTED、RULE_BLOCKED、GAME_FINISHED |

雙方 Ready 時自動建立 match，不需要另設 START_MATCH。

Gameplay envelope：

```ts
{
  type: 'GAME_COMMAND' | 'RESOLVE_DECISION' | 'MULLIGAN',
  commandId: string,
  matchId: string,
  expectedVersion: number,
  payload: Intent
}
```

`PlayerPacket = { matchId, stateVersion, view, legalActions, decision }`。Decision 保留原 `id / playerId / kind / candidates / actions / submitIntent` 命名，對應 decisionId／owner／type／options；版本由外層 packet 或 PENDING_DECISION message 提供。非 owner 只能收到 WAITING，candidates／actions 必須為空，不能附帶 submitIntent。GAME_VIEW 是 UI 發布決策與 outcome 的完整單位，不拼接不同版本的獨立決策封包。

| 檢查 | 行為 |
| --- | --- |
| stateVersion | 初始 0；每次接受 command 及其自動續行整體加 1；不同於逐 rule step 更新的 Engine revision |
| expectedVersion 不符 | STALE_STATE，不執行；回最新版該玩家 RESYNC_STATE |
| 已接受 commandId，同 actor／完整 envelope | 回原 receipt 的 COMMAND_ACCEPTED，duplicate=true；再回目前投影；不重複成本、抽牌、RNG、Guard 或 decision |
| 相同 commandId、不同 payload／actor | COMMAND_ID_REUSED；不執行 |
| 非 decision owner | NOT_DECISION_OWNER；不執行，即使改用 GAME_COMMAND 包装也相同 |
| 過期 choiceId | STALE_DECISION；不執行 |
| 非此 room／match 的 session | NOT_IN_ROOM／MATCH_MISMATCH 等 structured rejection |
| 未解決規則 | 原 RULE_QUESTION code + RULE_BLOCKED；不吞掉、不猜測 |

Receipt 保存已成功交易，包含 actor、整個 envelope 的 canonical fingerprint 與接受時版本。Session／match 驗證先於 receipt；duplicate 檢查先於 stale，故成功後失去 ACK 的原封包仍可安全重送。未接受指令不建立成功 receipt。Room code 不能用來取代 session 身分。

## Privacy validation

每位玩家的 view、legalActions 與 decision 都由原 `projectGameState / getLegalActions / getPendingDecision` 重新產生，沒有把完整 GameState 傳給瀏覽器再以 CSS 隱藏。

- 自己手牌與規則允許公開的卡可見；對手手牌、牌庫及其他裏置區域只含匿名 `{ hidden: true }`。Deck／Hand count 由匿名項目數量表示。
- 對方不能收到 private instance／definition ID 或 decision candidates。調查已公開卡沿用既有可見性，重新裏置後投影不再提供身份。
- EventLog 只傳既有可見事件，沒有任意 detail／cause、RNG、pending effect program、frame payload、全卡表或 receipts。
- 整合測試逐步比對雙方完整序列化 PlayerPacket（包含 action／decision）與 host 上所有 concealed card IDs，並驗證所有 wire message schema。
- 實際瀏覽器測試確認對方手牌 ID 不在 DOM，沒有 dev panel、完整快照 localStorage；Online 模式的網路 request 未載入 LocalBootstrap、src/local、Engine、卡牌 catalog／data 模組。Production build 分出 LocalBootstrap 與 OnlineScreen chunks。
- Session token 僅透過 SESSION 送到其連線，沒有廣播至 room，也不輸出 console。只有 trusted host 的 inspectMatch 可讀完整狀態，協定沒有對應入口。

## Session／Reconnect validation

Server 產生 UUID playerSessionId 與 32-byte random resumeToken；roomCode 是另一個 8 字元識別碼。Online client 只將兩項憑證保存在依 server URL 區分的 sessionStorage。

Disconnect 保留正在進行的 match、座位、choice 與 stateVersion，不判負；對手收到連線狀態。Reconnect／reload 送 RESUME_MATCH，由 server 驗 token、綁回原座位並產生最新投影。替代連線先撤銷舊連線 authority；舊 socket 關閉不會把新連線斷掉。錯誤 token 無法恢復座位。

重連收到 ROOM_STATE 時仍維持不可操作，等 RESYNC_STATE 才恢復。In-flight 指令保存在 client 記憶體；同 client 重連後原封包可重送，server receipt 防止重複執行。整頁 reload 不保留待送佇列，而是以 server 最新結果恢復。

等待房間的 Leave 釋放座位並換新 session，client 清除舊 room；對局中的 transport Leave／Disconnect 保留 seat 與重連資格。瀏覽器保留原對局投影而 server session 已不存在時，也可按 New anonymous session 清除舊憑證並回到建房畫面。

測試涵蓋真實斷線／重連、恢復原 decision、斷線期間 server 已前進、同一座位替換舊 socket，以及瀏覽器中途 reload 後繼續到 GAME_FINISHED。Server restart 的 UI 回復測試以 routed WebSocket 模擬 session 遺失；這項只驗失效憑證的畫面恢復，沒有宣稱 server restart 可以保留對局。

## Tests 與 quality gates

| Gate | 實際結果（2026-09-09） |
| --- | --- |
| npm test | **264 / 264**；0 failed／skipped／cancelled |
| npm run test:regression | **264 / 264**；包含 Phase 1–4 全部 210 項 |
| npm run typecheck | 通過，包含 server、protocol、UI、tests 與 E2E |
| npm run demo | 通過；CASE_SOLVED、Phase 3A、Phase 3B 四組 restore／replay 全部 identical |
| npm run build | 通過；204 modules，OnlineScreen 98.50 kB／gzip 28.38 kB，LocalBootstrap 獨立 chunk |
| npm run test:e2e | **8 / 8**；Microsoft Edge（Chromium），保留原 5 項並新增 3 項 |
| pnpm frozen lockfile offline | 使用現有 store 驗證通過，Already up to date |

新增 54 項 Node tests，regression 不重複計入總數：

| Test file | 數量 | 重點 |
| --- | ---: | --- |
| tests/protocol.test.ts | 42 | 所有 Intent／message roundtrip、strict nested schema、hidden view、unknown／spoof／state payload、WAITING 隱私 |
| tests/server.test.ts | 3 | Room Full／Ready／Start、version／dedupe／owner、token replacement、leave／disconnect、malformed／oversize、server 續存 |
| tests/game-client.test.ts | 1 | 共用 GameClient 契約與 Local development／restore 相容 |
| tests/online-client.test.ts | 3 | 雙 client 私人座位、沒有 snapshot API、Leave 清除、fresh projection 到達前禁用操作 |
| tests/online-gameplay.test.ts | 5 | 真實 two-client TCP/WebSocket 複合互動、重連、兩種終局、RULE_BLOCKED 與每步隱私 |

真實 two-client integration 流程包括 Create／Join／Ready → 非空 Mulligan redraw → 多回合出牌與 Deduction → Action targeting Case → 實際 Character Guard → Contact → Cut-in 抽牌 → 回應 Pass → disconnect／resume → 合法繼續。重送 Mulligan、Deduction、Guard、Cut-in 與終局 envelope 均不再改變 GameState／RNG／成本。另驗 EMPTY_DECK 與 CASE_SOLVED 的 GAME_FINISHED，及 RQ-012／014 合法觸發後的 RULE_BLOCKED。

新增三條 Browser E2E：

1. 兩個獨立 context 建房／加入／Ready／Mulligan；reload 恢復原座位；對手 private IDs、dev panel 與完整快照不外露。
2. 只按 Server 提供的牌桌操作：開局、出牌、多回合 Partner Deduction、回應、End Main；中途 reload 後繼續；雙方收到相同 EMPTY_DECK 終局／GAME_FINISHED。
3. 活躍對局失去 server session，保留舊 packet 的頁面仍能顯示並操作 New anonymous session，不必靠重新整理逃出失效憑證。

Browser 完整局驗證普通出牌、推理與終局；深入 Action／Guard／Cut-in 互動在真實 WebSocket integration。沒有宣稱每一 keyword／Disguise 都另做了 Browser E2E；相關原 Engine／local interaction regression 全部保留。

唯讀審查見 [phase5a-review.md](phase5a-review.md)。三項具體 P2（Leave 舊房間、重連早於投影啟用、失效 session 恢復入口）皆先重現，再修正並通過 regression。Windows 沙箱不能正常清理 Playwright 啟動的子程序，最終以獲准的沙箱外測試正常退出。既有混用 npm／pnpm 的 `.bin/playwright` 曾指到另一安裝，test:e2e 改用確切 `@playwright/test/cli.js`，避免測試載入兩份 runner。

## BLOCKING RQ 與限制

全部仍為 **BLOCKING**；沒有改為 RESOLVED／IMPLEMENTATION：

| RQ | 保留的 fail-closed 邊界 |
| --- | --- |
| RQ-002 | simultaneous terminal |
| RQ-009 | FILE 只有 Assist Partner 時的 Next Hint |
| RQ-012 | 推理來源在 LP 計算前離場／動態 LP 數量歧義 |
| RQ-013 | 未裁定 Action／Guard 邊界 |
| RQ-014 | generic target rebinding／跨區身份／未知來源讀取 |
| RQ-023 | expiry-trigger recursion |
| RQ-025 | 未確認 FILE Partner 操作 |
| RQ-027 | 一般 leave-and-reenter 語義 |

宣告時的 UnsupportedRule 拒絕不改牌局；若原 Engine 在合法流程中進入 RULE_BLOCKED，server 傳播同一 blocked 狀態與 questionId，不 crash、不自動 pass。Online layer 不擴張 target／optional effect／replacement 或一般 LIFO stack 語義。

目前限制：

- Server 記憶體儲存；重新啟動遺失 match／session／receipts。沒有 DB、分散式房間或持久化 replay API。
- 沒有 session 到期、idle room 回收、rematch、計時判負或斷線代打；已占用 match 座位不讓 room code 接管。新局使用新的獨立分頁／session。
- sessionStorage 可恢復同分頁重新整理，關閉分頁或清除儲存後不能保證找回憑證；此版沒有跨裝置帳號／復原流程。
- 開發版 WebSocket，未實作 production TLS、rate limit、Origin allowlist、流量／連線配額；不描述為 production-ready。
- 每步傳完整玩家投影，沒有 delta compression／大型牌局效能驗收；合法操作沿用既有 Engine preview。
- 通用 target／optional effects 尚未由原 Engine 支援的部分保持未支援；本階段只傳送既有合法 decision，未新增卡文語義。

官方 PDF 與原整理規格 SHA-256 核對未變：`2a3caf3372e66656cd9ac0c5ba9dc8fc4177c176317f4f97086975c1c9e65d41`、`6680c33973b48c215dec2c40459ab31842afba368ada670a266be0864a08540b`。規則登錄及八個 BLOCKING 分類未修改。

## 完整新增／修改檔案

新增：

- `apps/server/index.ts`
- `packages/protocol/index.ts`
- `src/server/index.ts`
- `src/server/managers.ts`
- `src/client/GameClient.ts`
- `src/client/localGameClient.ts`
- `src/client/OnlineGameClient.ts`
- `src/client/errors.ts`
- `src/ui/LocalBootstrap.tsx`
- `src/ui/OnlineScreen.tsx`
- `tests/protocol.test.ts`
- `tests/server.test.ts`
- `tests/game-client.test.ts`
- `tests/online-client.test.ts`
- `tests/online-fixtures.ts`
- `tests/online-gameplay.test.ts`
- `e2e/online-play.spec.ts`
- `e2e/online-recovery.spec.ts`
- `pnpm-workspace.yaml`
- `docs/phase5a-plan.md`
- `docs/phase5a-protocol-report.md`
- `docs/phase5a-server-report.md`
- `docs/phase5a-integration-report.md`
- `docs/phase5a-review.md`
- `docs/phase5a-results.md`

修改：

- `README.md`
- `package.json`
- `pnpm-lock.yaml`
- `tsconfig.json`
- `playwright.config.ts`
- `src/local/controller.ts`
- `src/ui/App.tsx`
- `src/ui/main.tsx`
- `src/ui/styles.css`

沒有修改 `src/game`、正式規則來源、data/cards／data/card-programs，或原 Phase 1–4 測試。`dist`、node_modules、test-results 等生成產物不列為源碼交付。此工作區沒有 Git repository，未建立 commit／PR。

本階段完成後停止；不進入 Phase 5B。
