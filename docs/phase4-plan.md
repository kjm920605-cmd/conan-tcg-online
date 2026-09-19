# Phase 4 Local Playable UI Implementation Plan

日期：2026-09-08。依使用者完整 Phase 4 規格執行；採 subagent-driven-development 分工實作獨立模組與唯讀審查。現有專案無 Git repository，不建立 commit 或 worktree。

## 設計與約束

React + TypeScript + Vite，單一 workspace 延續現有 Node test suite。桌面採深綠桌墊、米白卡面、琥珀操作提示；無需卡圖、動畫或外部素材。雙方 board 垂直排列，自己的手牌在下方，右側為操作／通用 decision／事件紀錄。手機使用單欄滾動，hot-seat 交接全畫面遮蔽並移除 board。

採獨立 local controller 私有持有 GameEngine。React 僅收 PlayerView、引擎驗證的操作與 structured decision。直接讓 component 判規則會產生第二套引擎；把全部 state 傳 React 再用 CSS 隱藏會洩漏資料，因此兩者都不採用。Local host 本身有完整資料，dev snapshot 是明示可信開發工具，不是未來網路協定。

保留所有 185 tests、原資料與八個 BLOCKING RQ。不得新增猜測規則、Online Multiplayer、Account、Matchmaking、Database、Ranking 或 production deployment。Snapshot 只透過 GameEngine.restore 驗證；不建立 state setter。持久化使用本機 browser storage，reload 一律回到交接鎖定畫面。

## 模組與接口

- `src/game/client/`：viewer projection、visible events、candidate intents 與 Engine dry-run legality；GameEngine 可增加只讀 preview API，不重寫規則。probe 對副本 dispatch，不改原 state／RNG／events。
- `src/local/controller.ts`：私有 Engine、viewer、handoff、revision command、bounded auto advance、snapshot import/export；切換 required actor（choice owner 優先）前清除 viewer；Ready 才產生對應 view。
- `src/local/decks.ts`：從 SUPPORTED definitions 建立兩套固定合法 40 卡 Fixture Deck A/B，仍用現有 F-CASE／F-PARTNER，不改正式規則與卡片。
- `src/ui/`：App、Board、DecisionPanel、DevPanel、styles；只呈現 adapter 資料並提交 Intent。通用 action list 同時表示 source/target；multi-select 與 ordered card choice 不寫卡牌專用 modal。
- Vite browser entry 直接 glob JSON 並 parseCatalog／compileContent；避開 Node filesystem reader。同步 fingerprint 以跨平台 SHA-256 保持原 canonical hash，不變更 snapshot schema。

## 執行清單

- [x] 1. 閱讀 docs／Engine／資料／tests，記錄 baseline；確認 React/Vite/Playwright 與 portable hash 契約。
- [x] 2. 先寫 projection/privacy、preview purity、legal actions 與 decisions 測試，觀察失敗；實作 `src/game/client` 及必要只讀 Engine API；驗證所有舊測試。
- [x] 3. 實作 local controller 與兩套 deck。先測 handoff（包含中途對方 choice）、非法操作無變化、匯入失敗原局不變、reload 鎖定，再實作並驗證。
- [x] 4. 建立 React/Vite 桌面。先建立 browser render/privacy/play 测試，再實作 UI。Dev panel 清楚標註會顯示全局私密資料，交接時必須卸載；本地保存不含 viewer Ready 狀態。
- [x] 5. 擴充 browser integration：Next Hint、Deduction、Mislead、Action、Guard、Contact、Cut-in、Disguise、effect ordering、UnsupportedRule、snapshot restore。用 Engine commands 建立中途測試局，禁止竄改 GameState。
- [x] 6. 完整 browser match：Setup → Mulligan → 多回合玩法 → 正常 Case Solve 或 Deck Loss。保留完整 fixture deck 與遊戲規則；不可用測試捷徑結束。
- [x] 7. 唯讀規格與品質審查，修復具體缺陷；實際瀏覽器檢視桌面與窄螢幕。
- [x] 8. 執行 npm test、regression、typecheck、demo、build、E2E；建立 phase4-results.md／更新 README，列出全部新增修改與限制，停止。

## 可驗證案例與完成依據

`assert.equal(JSON.stringify(projectGameState(state, other, content)).includes(hiddenCardId), false)`：對方手牌及未公開牌庫 ID 不得出現在 view／event detail／decision／action payload。

`const before = engine.serialize(); engine.preview(actor, intent); assert.equal(engine.serialize(), before)`：candidate legality 使用真實 Engine validator，無副作用。

`controller.ready(); controller.submit(intent); assert.equal(controller.getSnapshot().view, null)`：required actor 改變時在同步 controller transition 先移除 private view，Ready 前無 board。

`controller.importSnapshot(invalid)`：restore 失敗保留原 engine；合法 restore 成功後仍鎖定 viewer，UI 可繼續 pending decision。

每段測試先紅後綠；完整命令為 `npm test`、`npm run test:regression`、`npm run typecheck`、`npm run demo`、`npm run build`、`npm run test:e2e`。不得把既有引擎未支援的 optional/generic target 效果偽裝為可執行；presentation 預留 kind 並對未知 decision 明確停止。
