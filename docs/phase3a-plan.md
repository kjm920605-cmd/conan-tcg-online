# Phase 3A Explicit Rules Feature Layer

設計日期：2026-09-06；完成驗證：2026-09-08。依使用者已指定的架構與範圍執行，沿用現有專案；本目錄不是 Git repository。所有新增牌面均為合成測試資料。

## 設計

CardDefinition 與 CardInstance 保持分離，增加 FieldEntry 記錄每張實卡的一次在場存在。一般離场後封存；Disguise 建立新的 occurrence 並明確繼承 p.18 列出的資料。這是 ENGINE ARCHITECTURE，不裁定一般重入、限次、目標重綁或修正重設。

採現有程序的增量擴充：有限 program 契約、keyword 查詢、duration、附件／MR 移動及 Contact 回應分別成模組。相較全面重寫引擎，可沿用現有 checkpoint、RNG、序列化驗證；相較直接往 action.ts 加所有效果，模組可各自測試與審核。

EffectProgram 必填 source requirements、target selection point、target zone、duration、invalid-target behavior。只允許 SOURCE／OWN_CONTACT 等本輪明定對象，不加入通用玩家任選目標與跨區重綁。原合成 fixture 遷移為顯式契約，不在正式載入入口接受舊陣列 fallback。捜査由有限 keyword instruction 呼叫，對手選公開批次的牌庫底順序；不是新增 Main action。

Contact 保存初始 AP 順序與 FIRST／SECOND／FIRST_RETRY 回應進度；每方至多一張 Cut-in 或 Disguise。後者走專用替換，原卡到底，新卡承接參與身份與明示繼承資料，不發出普通登場。簡單到期只移除指定 scope modifier；expiry 觸發或遞迴內容回 RQ-023。

八個 BLOCKING 保持原分類。另保留 RQ-010 的跨色／超 Level Disguise、RQ-017 限次繼承、RQ-018–020 MR 競合、RQ-028 重複 keyword 等未知組合。MR Partner 區的能力必須明列有效區域，不能共享 FILE Partner 能力規則。

## 實作與驗證

- [x] 閱讀現有來源及 PDF 相關頁；基準 npm test 為 71／71。
- [x] tests/phase3a.test.ts：先加入身份／keyword 失敗測試；新增 rules/identity.ts、rules/keywords.ts，接入原流程並遷移測試 fixture 的身份資料。
- [x] 新增 EffectProgram 明示契約及 content/programs.ts 驗證，遷移原合成 program；測試缺欄位及未知語義不載入。
- [x] rules/modifiers.ts、effects/explicit.ts：先測試 opcode、到期及序列化，再接入 resolver、推理與 AP 查詢。
- [x] procedures/contact-response.ts：先測試 Cut-in 一次／選一能力、優先序、first retry、到期與中途 restore；再實作回應與專用 Disguise。
- [x] engine/events.ts 的附件管線、rules/mr.ts：先測試附件守恆、繼承／清理、MR 先到目的區再到 Partner、唯一性與未決交互，再接入正式移動管線。
- [x] procedures/investigation.ts：先測試公開不足數量、對手選底部順序、不假 Refresh、found 批次與 TRACE，再接入 keyword instruction。
- [x] engine/feature-invariants.ts 與既有 invariant：逐步恢復檢查新欄位、引用、scope、選擇與續行；未知舊 schema 明確拒絕，不靜默遷移。
- [x] 審查並修正問題；保留原 71 項，新增 Phase 3A 功能及必要回歸。
- [x] 執行 npm test、npm run test:regression、npm run typecheck、npm run demo。
- [x] 更新 README、digital-rules、game-flow、card-schema，建立 phase3a-results.md；報告檔案、測試與限制，停止於本階段。

驗證使用 Node.js 原生 node:test 與 TypeScript。新增案例每批先確認因缺功能而失敗，再實作。沒有 UI、帳號、網路服務、正式卡牌大量匯入或新的 runtime dependencies。
