# Phase 3B Representative Card Integration Implementation Plan

日期：2026-09-08。依使用者指定範圍執行；沒有 Git repository，不建立分支或 commit。採既有 Phase 文件位置。實作依測試驅動開發與 executing-plans 流程逐項驗證。

## 目標與設計

完成 JSON 卡片資料 → 嚴格驗證 → 顯式 program 引用 → Engine Content → 命令驅動牌局／restore／replay。Repo 沒有正式卡表，因此使用 28 張明確 FIXTURE：24 SUPPORTED（含 Partner／Case）、1 PARTIAL Search、3 BLOCKED（一般重入／expiry recursion／FILE Partner）。不冒充正式卡牌；八個 BLOCKING 不變。

採外部 catalog adapter，保持 src/game 的 Phase 3A DSL 與 schema 3。直接將支援狀態塞入核心模型會混合編輯資料與 runtime；只保留 TypeScript 合成物件則無法驗證磁碟載入。獨立 JSON＋adapter 能保留 provenance／未支援需求，又避免把 PARTIAL／BLOCKED 靜默編成白板牌。

資料分為 data/cards/*.json、data/card-programs/*.json。CatalogCard 包含 cardId、provenance、supportStatus、blockedBy、mechanics、unsupportedMechanics、definition；ProgramRecord 為 programId＋program。每張 definition 的 ID 必須和 cardId 相同。只有 SUPPORTED 可編譯入 Engine；編譯時再次驗證，以免編輯後繞過 gate。Core 的 VERIFIED_CORE 只指有限執行契約，不代表官方卡文認證。

所有 unknown input 先檢查 JSON、schema、型別與 references；外區來源、沒有 Contact 的 OWN_CONTACT／duration、INVESTIGATE_X 缺 keyword 等不可能的綁定在載入時失敗。一般動態目標、Search、限次／重入／expiry trigger 不加 opcode。fixture 的固定行為只用既有定義／keyword／program。

## 實作步驟

- [x] 載入與驗證：新增 src/cards/model.ts、validation.ts、bindings.ts、catalog.ts、files.ts、index.ts，以及 tests/card-validation.test.ts。
  - 公開 validateEffectProgram(value: unknown)、validateCardDefinition(value: unknown, programs: Record<string, EffectProgram>)。
  - parseCatalog(cards: unknown[], programs: unknown[]): CardCatalog 驗重複 ID、完整引用與狀態。
  - compileContent(catalog, cardIds?): Content 只容許 SUPPORTED；預設選 supported，明確選到部分／阻擋卡則失敗。
  - readCardCatalog(root: URL) 排序讀取兩個資料目錄；不改 GameState。
  - 先加入 assert.throws(() => validateEffectProgram({programId:'bad',program:{}}))、缺欄位／錯 references／未決 RQ 狀態及 duration binding 測試；node --test tests/card-validation.test.ts 先失敗再通過。
- [x] 建立 28 張 FIXTURE JSON 與獨立 program JSON。用測試核對所有狀態／機制、名稱與來源標記；不讓測試內建立的卡文代替資料檔。
- [x] 新增 examples/representative-session.ts 作純命令測試／demo adapter：注入固定 RNG、合法 40 張牌組、記錄 command／advance，對每步 restore 後結果作比對；不使用可寫 state fixture。
- [x] tests/card-integration.test.ts：每張卡以 cardId 對應具名案例，驗證 legality、時序、target、state、events；來源資料全部經 readCardCatalog／compileContent。阻擋卡驗證載入拒絕與狀態／事件不變。
- [x] tests/card-combos.test.ts：enter→react→modifier→Contact→Cut-in→expiry、Disguise 附件／效果繼承、MR／區域能力、TRACE／Refresh；完整命令 replay 與每步 restore 一致。
- [x] 新增 examples/representative-cards.ts，npm demo 包含此資料 pipeline；擴充 regression script 保留原 124 項並加本輪驗證／互動。
- [x] 產生 docs/card-support-matrix.md、docs/phase3b-results.md；統計實際卡數／狀態、靜態 opcode 次數與 keyword coverage、未支援需求、對應 tests。同步 README／schema 文件目前層次。
- [x] 獨立唯讀審查，重現及修正必要問題；執行 npm test、npm run test:regression、npm run typecheck、npm run demo。核對官方來源與所有 RULE-QUESTION 未變，完成後停止。

## 未支援需求分類

Search（任選滿足 predicate 的牌／公開／洗牌／選取時點）不等同 Investigate；可能需個別官方卡文與明確 selection 契約，本轮不擴充。PARTIAL 只表示已知 Draw 部分可用 DSL 表達，整張卡不可入局。

一般重入／target retention：RQ-014／027；expiry 產生新效果：RQ-023；FILE Partner declaration：RQ-025。其餘 RQ-002／009／012／013 的既有流程界線仍保留，任何實際依賴它們的卡必須在 blockedBy 明列並隔離。

品質門檻：原 124 項不刪除；新增錯誤案例先失敗後修正。沒有 UI、Multiplayer、帳號、正式全卡池、card ID/name 行為分支或新 generic target semantics。
