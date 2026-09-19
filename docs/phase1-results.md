# Phase 1 Core Game Engine 驗收

日期：2026-09-05。範圍依 [phase1-plan.md](phase1-plan.md)，原規則／PDF 保持原樣。已重新閱讀官方 PDF 全 27 頁、三份設計文件與全部 28 個 RULE-QUESTION。

## 驗證結果

使用 Node.js v24.19.0、pnpm 11.19.0、TypeScript 5.9.3：

| 指令 | 結果 |
| --- | --- |
| pnpm test | **33 通過、0 失敗、0 skipped、0 todo** |
| pnpm typecheck | **通過**，tsc --noEmit，exit 0 |
| pnpm demo | **通過**，第 8 回合由 b 完成 CASE_SOLVED；序列化／restore 一致 |

33 組分為原定 **28 組 P0** 及 **5 組回歸測試**。原 89 項設計不是全部完成；有些 P0 只涵蓋其中部分已確認行為，例如沒有 Contact、Set、Cut-in、keyword 或到期修正。

測試先以未實作的 API 執行，28 組失敗，再完成實作。獨立審查另找出三項驗證缺陷，均先新增失敗案例、確認原因後修正：

1. 未宣告的 program ID 不能透過物件原型鏈被誤認為有效；命令收據、快照玩家／卡片／事件引用也使用 own property 或已驗證玩家清單。
2. restore 檢查 phase/root frame、父子程序、PROCESSING／FINISH_EVENT 雙向對應與 pending checkpoint，包含 SETUP 不能帶入待解決效果或處理中 Event，拒絕會永久停住的損壞快照。
3. JSON 驗證拒絕稀疏／額外屬性陣列、不可列舉屬性，並在執行 getter 前拒絕 accessor。

另外兩組回歸覆蓋 Character 自身效果造成 STUN、下一次 Auto 轉 SLEEP，以及非回合方效果產生回合方 pending 後重新給回合方選擇權。

## 已完成核心

- GameState／PlayerState、CardDefinition／CardInstance 分離；輸入 catalog 複製並 freeze，快照深層 readonly／freeze。
- 合法組牌、洗牌、RNG 決定先後攻、五張起手與依序 Mulligan、兩人換牌後公開。
- Auto／Main／End 狀態機；固定印刷 LP 的基本推理、有限通常用牌與事件解決。
- ACTIVE／SLEEP／STUN 九格轉移；角色名乗り檢查。
- Basic zone movement、FILE、Evidence、Assist、永久 Case chapter marker。
- Assist Partner 僅在**自己的下一個 Auto 第一步**返回 Partner Area 並 ACTIVE；對手 Auto 不提早返回。
- 逐張移動後立即 Refresh、Remove 洗回、對手證據／痕跡、剩餘量續行與巢狀 Refresh。
- EffectQueue 回合方優先、同方任選；EffectResolver 有限 opcode、目前效果完成後才處理新觸發；未使用一般 LIFO／FIFO。
- 私有引擎状态與原子命令驗證、revision、冪等收據；完整程序／choice／RNG 快照還原與同版本確定性重演。

## 仍未解決的 BLOCKING RULE-QUESTION

BLOCKING 指特定互動不可自行裁定，不是整個已確認核心不能執行。全部 28 題規則答案仍 OPEN；分類合計 BLOCKING 6、DEFERRED 19、IMPLEMENTATION 3。

| 問題 | 尚缺裁定 | 目前處置 |
| --- | --- | --- |
| RULE-QUESTION-002 | 同時勝敗／雙方同時空庫 | 拒絕未裁定快照或保留 RULE_BLOCKED，不自行判平手或指定輸家 |
| RULE-QUESTION-011 | Auto、Assist、成本等普通觸發微時點 | Auto 抽牌產生觸發時保存 RULE_BLOCKED、pending 與續行點；其他未支援觸發不載入 |
| RULE-QUESTION-014 | 目標時點、來源／目標移區後身份與讀值 | 不提供任意 target／重選／last-known-value opcode；來源不在已知區域時阻擋 |
| RULE-QUESTION-023 | 到期效果再觸發與循環 | 僅支援 End 觸發→空 expiry 步驟→換人；到期修正 opcode 不載入；步数限制不判終局 |
| RULE-QUESTION-025 | FILE Partner 的能力／推理／特殊狀態互動 | FILE 中特殊操作拒絕或 RULE_BLOCKED；已確認的下一個己方 Auto 返回照常實作 |
| RULE-QUESTION-027 | 一般離場重入的修正、朝向、限次重設 | 僅支援首次正常登場；未定離場重入／runtime 重設快照拒絕 |

所有 DEFERRED／IMPLEMENTATION 問題逐題處置見 [phase1-plan.md](phase1-plan.md)，完整題目及 PDF 依據保留於 [digital-rules.md](digital-rules.md)。

## 新增／修改檔案

新增：

~~~text
.gitignore
package.json
pnpm-lock.yaml
tsconfig.json
docs/phase1-plan.md
docs/phase1-results.md
src/game/index.ts
src/game/model.ts
src/game/content/validate.ts
src/game/engine/GameEngine.ts
src/game/engine/create.ts
src/game/engine/invariants.ts
src/game/engine/procedure-invariants.ts
src/game/engine/state-helpers.ts
src/game/effects/EffectQueue.ts
src/game/effects/EffectResolver.ts
src/game/persistence/json.ts
src/game/procedures/advance.ts
src/game/procedures/commands.ts
src/game/random/rng.ts
src/game/rules/orientation.ts
tests/core.test.ts
tests/fixtures.ts
tests/regressions.test.ts
examples/core-game.ts
examples/synthetic-content.ts
~~~

修改：

~~~text
README.md
docs/digital-rules.md
docs/game-flow.md
docs/card-schema.md
~~~

本輪開始已有 README，因此實際為擴充既有檔案。官方 PDF／原整理規格 SHA-256 與分析階段一致。node_modules 是依 lockfile 安裝的開發依賴，不屬原始碼交付；PDF 閱讀暫存圖不列入專案來源。

## 限制與下一階段建議

目前是可執行的有限核心，適合合成規則測試。沒有正式卡片資料匯入器、完整卡文 DSL、UI、帳號、Server、Online Multiplayer、觀戰或 PlayerView。完整快照含隱藏牌及 RNG，只能交給可信宿主，不能直接當未來玩家同步 payload。

Setup 前半段在 create 內完成；尚不能保存洗牌中途。End expiry 尚无持續效果可失效。FieldEntity、modifier／usage、attachment、MR／Disguise、Next Hint／Switch、Action／Contact 仍未實作。restore 驗證結構與續行，不驗伺服器簽章或整局歷史。

建議下一階段仍做引擎：

1. 優先取得 011 的 timing 與 025 的 FILE Partner 裁定，逐題補上來源及 expected。
2. 加入已確認的 Next Hint、單卡 Switch、推理／Mislead；未定交互維持 gate。
3. 按官方流程建立 Action／Contact，維持有限回應窗口與普通效果集合。
4. 擴充離場重入／Disguise 前先確定 014／027，加入 FieldEntity 與版本化 migration。
5. 隱藏資訊政策確認後再設計 PlayerView／Reconnect contract；由使用者另行授權 UI／Multiplayer 階段。

本輪到此停止於 Phase 1。
