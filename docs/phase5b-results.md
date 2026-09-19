# Phase 5B — Persistent Online Match Recovery

驗收日期：2026-09-09。Phase 5B 完成；本輪停止於持久化與恢復，不進入 Account、Ranking、Matchmaking、Deck Builder、正式卡池、Redis 或多 Server scaling。

## 結果

PostgreSQL 保存匿名身分、Room／seat／Ready、Match、每個成功 command 的完整 snapshot 及 receipt。Server process 重啟後，原 resume session 可取得相同座位、stateVersion 與自己的 PlayerGameView，並接續原 RNG、PendingDecision、PendingEffects 和程序游標。Finished 對局保留結果，新 gameplay 回 `MATCH_FINISHED`；RULE_BLOCKED 原樣恢復，不改規則或代選勝負。

保留 Phase 1–5A 全部測試覆蓋。八項 BLOCKING RULE-QUESTION 未改為 RESOLVED；此次沒有修改 `src/game/`、Effect DSL、Card Definition 或正式卡牌資料。

## Persistence architecture

使用 **Drizzle ORM + node-postgres（pg）+ PostgreSQL**。正常 Server CLI 預設 PostgreSQL；缺少 `DATABASE_URL` 拒絕啟動。`MATCH_STORAGE=memory` 是明確選擇的暫存開發／舊測試 adapter，DB 失敗不會自動切回 memory。

- `MatchStore`：session、room、match、snapshot、receipt 的非同步儲存契約。
- `PostgresStore`：Drizzle table definitions、SQL migration、transaction、version CAS 與持久化查詢。
- `MemoryStore`：同一契約的測試實作，用於舊測試與可控制的故障注入。
- `RoomManager`：將 connection、room、resume、gameplay 操作序列化；身分來自已驗證 session 與持久 room membership。
- `MatchManager`：隔離 Engine draft、snapshot validation、lazy restore 及原有玩家投影。Game Engine 本身沒有因導入 DB 而重寫。

同一 Server process 使用一條 promise queue；同一 match ID 只 cache 一個 authoritative runtime。Restore 在 queue 中完成，不會因兩位玩家同時 resume 建立兩份權威狀態。連線狀態屬 process runtime；Room 的 seat、Ready、固定 deck assignment 與 match ID 屬 durable data。斷線不刪除這些資料，也不判負。

## DB schema

SQL：[`0001_persistent_matches.sql`](../db/migrations/0001_persistent_matches.sql)。Drizzle 定義：[`schema.ts`](../src/server/persistence/schema.ts)。欄位使用 snake_case，TypeScript 使用 camelCase。

| Model／table | 持久欄位 | 約束與用途 |
|---|---|---|
| PlayerSession／player_sessions | id、resume_token_hash、created_at、last_seen_at | session ID 主鍵；hash 必須為 64 位 hex；不保存 token 明文 |
| Room／rooms | id、code、player_a_id、player_b_id、ready_a、ready_b、deck_a、deck_b、match_id、status、created_at、updated_at | code／match_id 唯一；座位 session FK；兩席不得同人；Ready 必須有玩家；保留既有固定 Deck A／B |
| Match／matches | id、room_id、status、state_version、ruleset_version、engine_version、card_data_version、outcome、created_at、updated_at、finished_at | 每 room 一個 match；版本為安全整數範圍；FINISHED 必須有 outcome／finished_at |
| MatchSnapshot／match_snapshots | match_id、state_version、serialized_state、integrity_hash、created_at | `(match_id, state_version)` 主鍵；原完整 JSON 字串 + SHA-256；不覆寫舊版本 |
| MatchCommand／match_commands | match_id、command_id、player_id、expected_version、result_version、command_type、payload、fingerprint、result_status、created_at | `(match_id, command_id)` 主鍵；每 match 的 result_version 唯一；成功版本為 expected + 1 |

Room → Match FK 延後到 commit 驗證，允許 room、match 和 version 0 snapshot 同交易建立。另有 `_migrations` 記錄已套用的 SQL；重跑 `db:migrate` 不會重建資料。

`MatchCommand.player_id` 是 Engine authoritative seat ID（A／B），由 session 對應 Room 推導，不採信 client 提供的 actor。`result_status` 目前保存 `ACCEPTED`；未授權或驗證失敗的 command 不占用成功 receipt。這不是所有拒絕請求的 audit log。

## Durability boundary

```text
Strict protocol validation
→ Session／Room membership／Match validation
→ 查 persisted command receipt（處理重送）
→ 新 command：Version／decision owner／decision ID validation
→ Restore isolated Engine draft → dispatch → 自動續行至穩定 boundary
→ DB transaction
    1. CAS 更新 Match：WHERE state_version = expectedVersion
    2. INSERT MatchCommand
    3. INSERT 完整 MatchSnapshot
    4. 更新 Room status／Match outcome／timestamps 等 metadata
→ COMMIT
→ 安裝新的 runtime state
→ COMMAND_ACCEPTED
→ 分別產生兩位玩家的 PlayerGameView
```

每個成功 gameplay command 與它引起的自動續行共用一筆 transaction，網路 `stateVersion` 加一；Engine 原有逐步 revision 語義保持不變。version 0 的初始 snapshot 也先 commit，才發送 `MATCH_STARTED`。

交易尚未完成時不發 ACK／新投影，也不修改目前 runtime。交易失敗丟棄 draft，並 evict cached match，回 structured `PERSISTENCE_ERROR`（version conflict 為 `PERSISTENCE_CONFLICT`）。之後必須讀 DB 的最後 durable state；不保留 memory-only 的新權威狀態。

若 DB 已 commit，但回應途中失敗，Server 同樣不猜結果、不發布成功，而是 evict runtime；Resync／重連重新讀 snapshot，重送由 persisted receipt 判定。測試涵蓋這個「commit 成功後拋錯」情境。真實 PostgreSQL 的 snapshot insert 故障也驗證整筆 transaction rollback，Match version、snapshot、receipt 都不前進。

## Persistent idempotency

每次 gameplay 都查 DB 的 `(matchId, commandId)`，不只查 memory。已有 receipt 時，必須同 actor、同 canonical envelope fingerprint，才能回原 `resultVersion` 與 `duplicate: true`，再提供最新私人投影；不呼叫 Engine。相同 ID 換 actor 或 payload 回 `COMMAND_ID_REUSED`。

因此舊 expectedVersion 的合法重送在 stale check 前識別；已接受操作不再消耗 RNG、成本、抽牌或 zone movement。Finished match 的已接受 receipt 仍可確認；**新的** gameplay 一律回 `MATCH_FINISHED`。

## Session 與 recovery flow

匿名 token 由 Server 產生 256-bit 隨機值。Browser 在原分頁 `sessionStorage` 保存明文；DB 只存 SHA-256 hash。Resume 使用 timing-safe hash comparison。Room Code 只供找 room，不是身分憑證。

```text
原 resumeToken + playerSessionId
→ 驗證 PlayerSession
→ 查 Room／seat／Match
→ 若 runtime 不存在：讀 Match 與最新 snapshot
→ 相容性、完整性與 Engine invariant validation
→ GameEngine.restore（不 advance，不重新發牌）
→ 建立唯一 runtime，恢復 stateVersion
→ 替換 socket binding
→ RoomState + 該玩家的 PlayerGameView／PendingDecision
```

Restore 驗證在換身分 binding 與發投影前完成。舊 socket 被新 socket 取代時撤銷原 mapping。無 Room 的持久匿名 session 以 `SESSION_RESTORED` 確認完成；初始 session DB 操作失敗會回錯並關閉該 socket，避免留下無法驗證的半連線。Restore 遭暫時性 DB 錯誤時，client 保留原憑證以便重試。

Room recovery 已驗證：只有 A、A／B 都未 Ready、只有 A Ready、已開局、一位未重連、雙方重連，以及 Finished。重啟後 connected flags 隨實際 socket 恢復，seat、Ready、deck assignment、match ID 不變。

## Snapshot completeness 與 version strategy

Snapshot 保存原 `GameEngine.serialize()` 的完整結果，沒有重新拼湊一份簡化 state。RNG algorithm／state／cursor、turn／phase／subflow、choice／decision ID／owner／候選選項、pendingEffects、frames／effect cursor／continuation、modifier、附件、RULE_BLOCKED 與 outcome 均保留在原 GameState。網路 stateVersion 在 snapshot row 與 Match row 一致保存。

| 驗證 | 目前值／行為 |
|---|---|
| Engine | `0.3.0` |
| Ruleset | `pdf-2.5+explicit-3a` |
| Snapshot schema | `3` |
| Card data | compiled Content 的 canonical SHA-256 fingerprint，含 definition／program |
| RNG | snapshot algorithm 必須符合 Server 所配置的 RNG interface |
| Integrity | serialized JSON 的 SHA-256；match ID、version、status、outcome、finishedAt 一致；再經 Engine invariant validation |

版本或 RNG algorithm 不相容回 `VERSION_INCOMPATIBLE`；latest snapshot 缺失或不符 Match version 回 `SNAPSHOT_MISSING`；hash／snapshot identity 不符回 `SNAPSHOT_CORRUPT`；無效 JSON／state 回 `SNAPSHOT_INVALID`。即使存在較舊 snapshot，也不退回舊版本，避免重跑已接受操作。此次未建立 snapshot migration framework；未來改 Engine 語義時必須明確維護版本，不能只替換程式碼。

Restore 不執行完成過的 effect、draw、cost、zone move 或 RNG。專用 DB 測試把 `DRAW 1 → Investigate 選序 → DRAW 2` 停在 effect cursor 2：恢復後只執行剩餘 DRAW 2，最終手牌增加 3，沒有重複首個 DRAW，也沒有額外消耗 RNG。

## Private projection

網路仍只使用既有 `projectGameState`、`getLegalActions`、`getPendingDecision`，對每個 seat 分別投影。原始 snapshot、DB records、token hash 不進協定；Browser 無新增 Engine／DB 存取或 authoritative snapshot 回寫 API。Local UI 保留。Online UI 僅修正憑證失效說明，沒有新增遊戲介面或功能層。

## Verification

Windows、Node 24.16.0、TypeScript 5.9.3、PostgreSQL 18.6、Playwright 的 Microsoft Edge channel。以下為本輪最後完整執行結果，全部 exit 0、無 skipped tests：

| Gate | 結果 |
|---|---|
| `npm test` | **272／272 passed** |
| `npm run test:regression` | **272／272 passed**；同一完整套件再跑，不另加到測試總數 |
| `npm run test:db` | **23／23 passed**，真實 PostgreSQL |
| `npm run test:e2e` | **8／8 passed**，原 Local／Online browser regression |
| `npm run test:e2e:restart` | **4／4 passed**，真實子程序 stop／restart + PostgreSQL |
| `npm run typecheck` | passed |
| `npm run build` | passed；Vite production bundle |
| `npm run demo` | 三組 CLI demo passed；中途 restore／完整 replay identical |
| pnpm frozen lockfile／offline install | passed |

測試 runner 合計 **307 項**：272 Node 主套件 + 23 DB + 12 Browser；regression 重跑不重複計數。Phase 5A 原 264 Node + 8 Browser 覆蓋全保留。Phase 5B 新增 8 Node、23 DB、4 Browser。舊 `online-gameplay.test.ts` 終局拒絕碼由 `MATCH_STOPPED` 更新為本階段明確要求的 `MATCH_FINISHED`，不是刪除舊驗證。

DB integration 各自建立隨機 schema，連專用 `TEST_DATABASE_URL`，結束只清理自己 schema；無 DB URL 會失敗，不 skip 或改用 MemoryStore。涵蓋 SQL atomicity／unique／CAS、hash-only session、錯 token、同時 lazy resume、完整 state／RNG 恢復、PendingEffects／continuation、mid-program cursor、RULE_BLOCKED、finished metadata、三種版本不相容、RNG mismatch、missing／corrupt／invalid snapshot、不可用 DB 與真實 rollback。

另外以可控制的 Store fault injection 驗證延遲 commit、commit 前失敗、commit 成功後拋錯、初始 session 失敗恢復、client 保留憑證重試。[獨立 runtime review](phase5b-runtime-review.md) 的可行動問題均已修正並加入回歸測試。

### Restart E2E A–D

兩個獨立 Browser Context（隔離 cookie／storage）操作真實 React UI 和 WebSocket。每個測試啟動自己的 `apps/server/index.ts` Node 子程序與 PostgreSQL schema，實際終止子程序，再以相同 port／DB 啟動新的 process；不是只清除 memory map。

| E2E | 已執行流程與斷言 |
|---|---|
| A | Create／Join／Ready → 至少第 4 回合 → 記錄完整 durable snapshot 與兩位投影 → kill／restart → Reconnect → seat、投影、stateVersion 完全相同 → 下一 command 正常加一 |
| B | 第二位玩家 Mulligan PendingDecision → kill／restart → 同 decision ID、owner、合法選項 → resolve → PLAYING |
| C | Mulligan 實際換一張牌並接受 command X → kill／restart → 重送相同 X → duplicate ACK；DB snapshot／RNG／version 不變，receipt 仍只有一筆 → 下一操作正常 |
| D | 以合法 UI 指令完成 FIXTURE 對局 → kill／restart → 雙方結果仍可見、finishedAt／final snapshot 不變 → 新 gameplay 回 MATCH_FINISHED |

B 使用 Mulligan 決策；效果選序、調查中途的 effect cursor 與 RULE_BLOCKED 重啟由前述真實 PostgreSQL integration tests 驗證。沒有宣稱 Browser E2E 窮舉所有 Guard／Contact／keyword 中途狀態。既有 Engine restore／replay 測試與 demo 仍驗證複合效果、Contact、Disguise、MR、Trace 等流程。

## Acceptance criteria 對照

| 要求 | 證據 |
|---|---|
| 1–3 active Match／Room／seat／匿名 identity 不遺失 | DB room/session recovery、E2E A–D |
| 4–8 authoritative state／RNG／decision／pending／continuation／version 相同 | 完整 state + PlayerPacket deep equality、mid-program DB test、E2E A–C |
| 9 cross-restart idempotency | DB receipt、E2E C、commit uncertainty test |
| 10 RULE_BLOCKED 保留 | DB RQ-012 boundary restore，outcome 仍 null |
| 11 finished 可讀不可操作 | DB finished test、E2E D |
| 12 private projection 保留 | 原 protocol／server／UI privacy tests，兩位投影分別比對 |
| 13–17 舊 tests／persistence／restart E2E／typecheck／build | 上表全部通過 |

## 本機啟動與 known limitations

本工作區 PostgreSQL 在 `127.0.0.1:55432`；dev DB `conan_tcg_dev` 與 test DB `conan_tcg_test` 分離。正常執行：`scripts/postgres-dev.ps1 start` → 設定 `.env` → `npm run db:migrate` → `npm run server`，另開 `npm run dev`。詳見 [README](../README.md) 與 [PostgreSQL setup](phase5b-postgres-setup.md)。

- 僅單一 authoritative Server process；全域 queue 優先保證正確性，尚無分散式 ownership、failover、Redis 或 scaling。
- 每個成功 command 保存完整 snapshot；尚無 snapshot／receipt／session retention、GC 或 storage 壓縮。Memory runtime cache 也尚無淘汰策略。
- PostgreSQL 的備份、監控、正式 TLS、secret management 與部署未納入此階段。workspace dev instance 使用 loopback trust authentication，不是 production 配置。
- Windows 開發用 EDB binaries 需要 ASCII `P:` alias，避免中文路徑 initdb 問題；實際資料仍在 workspace 的 `tmp/postgres-18.6/data`。Binary 來源與控制方式見 setup 文件，未建立系統服務。
- 關閉分頁／清除 sessionStorage 後不保證找回匿名 token；沒有帳號復原、rematch 或代替玩家找回身份的流程。
- 舊 Phase 5A memory process 的既有 Match 不會自動匯入 DB；跨重啟承諾適用本版 PostgreSQL 模式已 commit 的 Match。
- 缺失／損壞 latest snapshot 明確拒絕恢復，沒有自動從舊 snapshot／command log 修復或 migration；不會靜默重開局。
- MatchCommand 目前是成功 receipt，尚無完整拒絕請求審計；Replay 仍為 Engine 驗證能力，沒有提供線上 replay API。

## BLOCKING RULE-QUESTION

**RQ-002、RQ-009、RQ-012、RQ-013、RQ-014、RQ-023、RQ-025、RQ-027 全部維持 BLOCKING。** Persistence 不決定同時終局、FILE-only Partner Next Hint、Deduction source／LP ambiguity、Action／Guard 邊界、跨區 target／source read、expiry recursion、FILE Partner 額外能力或一般重入語義。

RQ-012 的實際 RULE_BLOCKED state 已經過 persist → restart → restore → reconnect 驗證，保持同一 boundary、pending／continuation 與 null outcome。其餘 BLOCKING 的原 Engine 測試維持通過；未新增任何裁定。

官方 PDF 與原整理規格 SHA-256 與本輪開始一致：

- `docs/reference/rule_manual.pdf`：`2a3caf3372e66656cd9ac0c5ba9dc8fc4177c176317f4f97086975c1c9e65d41`
- `docs/conan_tcg_original-rules.md`：`6680c33973b48c215dec2c40459ab31842afba368ada670a266be0864a08540b`

## 完整新增／修改檔案

工作區沒有 Git repository；以下依本階段實際編輯清單列出，不虛構 Git diff。

### 新增（21）

| 檔案 | 用途 |
|---|---|
| `src/server/persistence/model.ts` | Store port、records、structured errors |
| `src/server/persistence/memory.ts` | 顯式暫存測試 adapter |
| `src/server/persistence/schema.ts` | Drizzle 五模型 definitions |
| `src/server/persistence/postgres.ts` | PostgreSQL transaction／migration／查詢 |
| `src/server/match.ts` | 抽出 MatchManager，加入 restore／版本／snapshot 邊界 |
| `db/migrations/0001_persistent_matches.sql` | 初始 schema 與 SQL constraints |
| `scripts/migrate.ts` | DB migration CLI |
| `scripts/postgres-dev.ps1` | workspace PostgreSQL start／status／stop |
| `.env.example` | PostgreSQL Server 設定範例 |
| `.env.test.example` | 專用測試 DB 設定範例 |
| `playwright.persistence.config.ts` | 實際 process restart E2E 設定 |
| `tests/persistent-memory.test.ts` | 三項 session／room／match recovery 測試 |
| `tests/durability-boundary.test.ts` | 五項 commit／故障／client retry 測試 |
| `tests/db/store.test.ts` | 真實 transaction／CAS／unique 測試 |
| `tests/db/recovery.test.ts` | PostgreSQL recovery／failure／pending／finished 測試 |
| `e2e/persistent/helpers.ts` | 隔離 browser、DB schema 與 Server 子程序 |
| `e2e/persistent/restart.spec.ts` | Restart E2E A–D |
| `docs/phase5b-plan.md` | 工程計畫與範圍 |
| `docs/phase5b-postgres-setup.md` | binary 來源、本機 DB 與啟動說明 |
| `docs/phase5b-runtime-review.md` | 獨立 review 與修正證據 |
| `docs/phase5b-results.md` | 本驗收文件 |

### 修改（13）

| 檔案 | 修改 |
|---|---|
| `src/server/managers.ts` | durable room/session、非同步 queue、lazy restore、commit-before-ACK、persisted dedupe |
| `src/server/index.ts` | transport 等待／drain 非同步 Server 操作 |
| `apps/server/index.ts` | PostgreSQL 預設、env、關閉與測試 supervisor readiness |
| `packages/protocol/index.ts` | 無 Room session 恢復完成訊息 `SESSION_RESTORED` |
| `src/client/OnlineGameClient.ts` | 持久 resume、失敗保留憑證與可重試連線 |
| `src/ui/OnlineScreen.tsx` | 更新失效憑證說明 |
| `package.json` | Drizzle／pg dependencies 與 DB／restart scripts |
| `pnpm-lock.yaml` | 固定新增 dependencies |
| `.gitignore` | 忽略本機 `.env`／`.env.test` |
| `tsconfig.json` | scripts 與新增 Playwright config 納入 typecheck |
| `playwright.config.ts` | 原 E2E 排除 persistent 子目錄，明確暫存模式 |
| `tests/online-gameplay.test.ts` | 終局預期錯誤碼更新為 MATCH_FINISHED |
| `README.md` | Current Phase、durability、recovery、設定與執行方式 |

另建立本機 ignored 設定 `.env`／`.env.test` 與 `tmp/postgres-18.6/` binary／data／log；`node_modules`、`dist`、`test-results` 為安裝或驗證產物，不列為 source changes。不覆寫既有使用者憑證設定。
