# Phase 5B Persistent Online Match Recovery — Implementation Plan

日期：2026-09-09。依使用者完整 Phase 5B 規格持續執行；例行工程選擇在既有授權內，不追加確認流程。使用 brainstorming、writing-plans、TDD、subagent-driven-development 與最終 code review。工作區沒有 Git repository，不建立假的 commit／diff 歷史。

## 設計與取捨

選 Drizzle + node-postgres：顯式 PostgreSQL tables／transaction 與現有 TypeScript、JSON Engine snapshot 接口相容；SQL migration 可直接稽核。Prisma 可用但額外 client generation 不利目前單 workspace；只用 pg 手寫所有 schema 會失去共享 table 型別。此次不改 Engine／DSL／卡牌資料。

Storage port 分隔 DB 與 RoomManager：production 使用 PostgresStore，舊單元測試使用 MemoryStore。同一個 RoomManager／MatchManager 執行全部權威流程，不複製 Engine。Server entry 的正常模式要求 DATABASE_URL；明確 `MATCH_STORAGE=memory` 僅供舊 Phase 5A 測試，不因 DB 故障自動切回 memory。

Room/session 改為可等待的交易；single-process command queue 序列化 connect／join／ready／resume／gameplay，避免 await 之間重複建局或建立兩個 match runtime。Room record 與 Match runtime 分離，runtime 按 room/match identity 唯一 cache。恢復不呼叫 create、advance 或 runUntilDecision；只驗證及 GameEngine.restore。

## 儲存契約

PlayerSession：id、resumeTokenHash、createdAt、lastSeenAt。只儲存 SHA-256 hash（token 本身為 server 256-bit 隨機值）；browser 留 plaintext token，resume 時 timing-safe 比對 hash。Room：id、code、A/B session、ready、固定 deck assignment、matchId、timestamps。Match：id、roomId、status、stateVersion、rulesetVersion、engineVersion、cardDataVersion、outcome、createdAt／updatedAt／finishedAt。

MatchSnapshot：matchId + stateVersion 唯一、完整 serialized GameState text、SHA-256 integrity hash、createdAt。原 snapshot 已包含 RNG algorithm/state/cursor、choice、pendingEffects、frames／effect cursor、RULE_BLOCKED、outcome；不另外產生可能分歧的 continuation 副本。MatchCommand：matchId + commandId 唯一、actor、expectedVersion、resultVersion、type／payload、canonical envelope fingerprint、resultStatus、createdAt。

成功 command 流程：protocol → session → match → persisted receipt → version → owner/id → isolated Engine draft → DB transaction（CAS match version、insert command、insert snapshot、update metadata）→ COMMIT → swap runtime → ACK／投影。錯誤 command 不取得成功 receipt，避免未授權者占用他人 commandId。已接受重送先查 DB receipt，同 actor + envelope 回原結果與最新投影，絕不重跑 Engine。

commit 失敗 discard draft，evict runtime，回 PERSISTENCE_ERROR；下一次使用必須重新讀 durable state，涵蓋 commit 結果不確定的斷線。拒絕期間不 broadcast 成功、不保留 memory-only 新狀態。DB unavailable 不做 memory fallback。snapshot 缺失／hash 不符／結構無效各有明確錯誤，不退回較舊版本或新建 replacement match。

## Version strategy

使用原 Engine `engineVersion=0.3.0`、`rulesetVersion=pdf-2.5+explicit-3a`；cardDataVersion 為 compiled Content 的 canonical SHA-256（原 contentFingerprint），任何規則資料／program 變化都不默默重解。另驗 snapshot schema、matchId／record version／status／outcome／content fingerprint 與 RNG algorithm。相容性失敗 VERSION_INCOMPATIBLE，資料破損 SNAPSHOT_CORRUPT／SNAPSHOT_INVALID／SNAPSHOT_MISSING；不做 migration。

## Tasks / deliverables

- [x] PostgreSQL：workspace development instance 或 DATABASE_URL；新增可重現 migration／db test commands，真實 PostgreSQL 驗證。
- [x] `src/server/persistence/model.ts`、MemoryStore：明確 Store port／持久化 records，先 memory-backed server restart 測試 red 再實作。
- [x] `src/server/persistence/schema.ts`、PostgresStore、SQL migration：五個指定 models、transaction／CAS／unique constraints、hash-only sessions；DB rollback／failure tests。
- [x] `src/server/match.ts`：extract 原 draft execution，增加 restore compatibility 與完整 snapshot validation；不動 src/game。
- [x] `src/server/managers.ts`／transport：async serialized processing、durable room/session、lazy single runtime restore、commit-before-ACK、persistent receipts、MATCH_FINISHED、structured errors。
- [x] CLI／UI：DATABASE_URL 啟動與 migration、明確 memory dev 模式；恢復無 room 的持久 session、persistence error 保持可恢復，原牌桌不重寫。
- [x] DB integration：room A only／joined／ready、hash／wrong token、active／decision／pending／blocked／finished restore、版本不相容、missing／invalid／corrupt snapshot、DB unavailable／rollback、cross-restart duplicate／RNG。
- [x] Browser restart A/B/C/D：兩個真實 browser + 子程序 server，實際 stop/start；原 seat／view／version／decision/options、duplicate 不再執行、final result 可讀與 MATCH_FINISHED。
- [x] Review 與 gates：保留 Phase 1–5A coverage，npm test、regression、DB tests、E2E、typecheck、demo、build；修正發現後更新 README／docs/phase5b-results.md 完整清單。

## 範圍

RQ-002、009、012、013、014、023、025、027 全部維持 BLOCKING。沒有 Account、Ranking、Matchmaking、Deck Builder、正式卡池、Redis、multi-server scaling 或 Phase 5C。資料庫保存完整私密 snapshot；Player projection 仍由原 server adapter 產生，DB資料／token hash 不進 wire payload。完成 Phase 5B 後停止。
