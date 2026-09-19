# Phase 3A Explicit Rules Feature Layer 驗收

完成及最終驗證日期：2026-09-08。實作期間已重新閱讀 README、digital-rules、game-flow、card-schema、Phase 1／2 結果、裁定準備文件、全部 RULE-QUESTION、現有程式與測試。2026-09-06 複核官方 Ver.2.5 相關頁面，重點為 p.12、17–18、20–27。

本階段止於有限 Core Engine，沒有 UI、Multiplayer、帳號或大量正式卡牌資料。所有新增能力均為合成測試／demo 內容，不代表任何正式卡文已完成審核。

## 最終驗證

在專案根目錄，以 PowerShell 的 npm.cmd 執行：

| 指令 | 結果 |
| --- | --- |
| npm test | **124 通過、0 失敗、0 skipped、0 todo**，exit 0 |
| npm run test:regression | **83 通過、0 失敗、0 skipped、0 todo**，exit 0 |
| npm run typecheck | **通過**，tsc --noEmit，exit 0 |
| npm run demo | **通過**，原核心牌局與 Phase 3A 純命令 demo，exit 0 |

完整測試為 **Phase 1 33 + Phase 2 38 + Phase 3A 53 = 124**。回歸 script 包含原全部 71 項，加本輪 12 項審查回歸；其餘 41 項 Phase 3A 功能測試由 npm test 執行。原 UT-001–089 仍是完整 backlog，沒有宣稱全數完成。

原核心 demo 於第 8 回合由 b 達成 CASE_SOLVED，restore 一致。新 demo 經 12 個玩家命令建立 3 個 FieldEntry，完成 Cut-in、Disguise／附件繼承、Contact modifier 到期及 3 張 Investigate；中途 restore 後續行，另從相同初始狀態完整重播，最終序列化字串完全一致。此 demo 停在 PLAYING，是明確功能演示終點。

## 已完成範圍

| 項目 | 實作／驗證範圍 |
| --- | --- |
| Identity | Definition、實體 Instance、FieldEntry 分離；一般離場封存，Disguise 建新 occurrence 並保存 lineage；不推定 Turn1／target／modifier／usage 重設 |
| Cut-in | 低 AP 優先、同 AP 非回合優先；每 Contact 每方一次 Cut-in 或 Disguise；先方 PASS／後方使用後的先方重試；選一能力、先 Remove、免 Case 色／Level、效果中 Refresh 後繼續 |
| Disguise | 專用替換；旧卡裏置 Deck bottom，新實卡接續；繼承 orientation、received effects、grants、Set／under；不觸發普通登場，觸發 Disguise-specific ability |
| Keyword | RAPID、ASSAULT、ASSAULT_CHARACTER、ASSAULT_CASE、BULLET、MISLEAD_X、INVESTIGATE_X、TRACE；資料驅動，無卡名分支 |
| Investigate／TRACE | 不足 X 使用可用牌；被調查者選底序；保存最初公開批次；調查本身不假造空牌庫；TRACE 隨對手 Refresh 保存為玩家事實 |
| MR | 普通登場移除既存 Field／Partner MR；對手回合離場先原目的區再立即 Partner；自己回合不轉移；不設全域 MR 張數 invariant |
| MR 區域能力 | 明列有效區域的 triggered ability；有限 OWN_MAIN／NONE 成本 declaration；Partner MR 不可 Deduction／Action |
| DSL | DRAW、REMOVE、MOVE、ACTIVE、SLEEP、STUN、AP_MOD、LP_MOD、GAIN_EVIDENCE、SET_CARD、STACK_UNDER；保留原有限 opcode，另有固定 Investigate 呼叫 |
| Duration | Contact／Action／Turn 三種簡單到期；具體 scope ID，Contact 與 Action 不混用；禁止 expiry-trigger recursion |
| Persistence | schema 3／engine 0.3.0／ruleset pdf-2.5+explicit-3a；FieldEntry、附件、modifier、Contact／Investigate 中途選擇、RNG 及程序可保存與重播 |
| Engine 邊界 | 玩家只有 Intent；私有 state、immutable 副本；沒有任意 opcode／state setter。create／restore／advance 限可信宿主，未建立網路服務 |

所有 program 必填 sourceRequirements、targetSelectionPoint、targetZone、duration、invalidTargetBehavior。只接受已明列語義，不接受舊陣列或未知欄位 fallback。source 不再需要讀值時使用 INDEPENDENT；FIELD_ENTRY 讀值需原 occurrence，跨區或未知身份仍停止。

Disguise 的新 occurrence 是 ENGINE ARCHITECTURE；專用繼承不授權一般 target rebinding。朝向只有實卡 runtime 的一份正規資料，沒有以修改 definitionId 模擬變裝。

## 新增測試與原 backlog 對照

| 測試檔 | 數量 | 核心覆蓋／原 UT 關聯 |
| --- | --- | --- |
| phase3a.test.ts | 7 | FieldEntry、四種新登場權限、BULLET、MISLEAD_X；UT-029、033–034、078 |
| phase3a-effects.test.ts | 10 | DSL 契約、拒絕未知語義、AP／LP、朝向／移動、expiry；UT-011、030、036、076、087–088 |
| phase3a-contact.test.ts | 10 | Cut-in 順序／一次限制／選一、Disguise、能力失效、Refresh、Action 到期、中途 replay；UT-036–044、054、064、076、078、081 |
| phase3a-attachments.test.ts | 3 | Set／under 容器、清理、Refresh 續行、Disguise 繼承；UT-043、052、068–069 |
| phase3a-investigation.test.ts | 3 | Investigate 不足數量、對手選序、批次及 TRACE；UT-058、062 的固定條件子集、070 |
| phase3a-mr.test.ts | 8 | MR 移動／登場處理／區域限制／有限宣言、未知限次；UT-071–073、087–088 |
| phase3a-regressions.test.ts | 12 | 審查重現、快照一致性、已 pending 效果與關閉 scope；UT-061、066、076、078、084、088 |

上表是已明示子集；例如 UT-068 的完整 PlayerView、UT-069 的現場宿主變 underneath、任意 conditional DSL／usageLimit 均未完成。

功能測試採分批先確認失敗、再實作。舊測試只遷移顯式 program 契約與必要 fixture 身份資料，原 71 項案例全部保留；P2-22 標題改為缺少 card／ability 的舊 extension request，避免誤稱本輪完全不支援 Cut-in／Disguise。

獨立唯讀審查發現並經回歸測試修正：結束窗口建立同 scope modifier、Disguise 舊來源移動觸發漏失、granted Mislead 驗證不一致、調查張數／父指令快照核對不足、非 Field 來源綁定 Field program，以及已 pending Investigate 在來源後來失效時卡住。另加入未知 granted trigger 拒絕。後續複查確認前次四項主要缺陷已修正，相關 30 項測試通過，有限 declaration 未發現可重現卡死。

## 仍未解決的 BLOCKING

以下 **全部維持 BLOCKING**，沒有取得官方完整裁定：

| RQ | 保留的 fail-closed 邊界 | 規則／測試位置 |
| --- | --- | --- |
| RQ-002 | 同時終局／雙方無法 Refresh 不猜勝負；不採任意玩家順序判定 | state-helpers、invariants；原核心終局／快照驗證 |
| RQ-009 | FILE 只有 Assist Partner 時不宣告 Next Hint | gameplay-commands；P2-04 |
| RQ-012 | 推理來源在 LP 計算前離場，或證據張數處理中的 LP 變動不推定結果 | deduction、modifiers；P2-24、Phase 3A LP 測試 |
| RQ-013 | 未明示的 Action／Guard／Case 證據邊界仍阻擋 | action；P2-24 |
| RQ-014 | 通用 target rebinding、跨區身份、未知 source read 不載入或保存 RULE_BLOCKED | content/programs、explicit、EffectResolver；P3A DSL／回歸 |
| RQ-023 | expiry 觸發、關閉 scope 重建、循環或無明示 scope，不重開 resolution window | modifiers、content、feature-invariants；三種 closing-scope 回歸 |
| RQ-025 | FILE Partner 只允許 Assist／count／Next Hint 排除／下一己方 Auto 首步返回 ACTIVE；其他能力／推理拒絕 | 原 Partner gate、events；P2-04、P2-R03、MR declaration 測試 |
| RQ-027 | 一般離場重入、能力次數／狀態保留仍未裁定；不把 FieldEntry 新 ID 當 reset 規則 | identity、canPlay、contact-response、content；P2-30、MR 未知限次測試 |

28 題仍為 BLOCKING 8、DEFERRED 16、IMPLEMENTATION 3、RESOLVED 1（RQ-011）。digital-rules 的 28 題登錄列於更新時逐字核對不變。也保留 RQ-010 跨色／超 Level Disguise、RQ-018–020 MR 競合、RQ-028 重複 keyword 等既有未知組合。

預先能確認涉及未知語義的內容／命令回 UnsupportedRule／RULE_QUESTION_XXX；合法流程中才遇到則保存 RULE_BLOCKED、已有事實與續行，不跳過或判負。工程隔離不等於官方認定行動非法。

## 有限範圍與後續建議

MR declaration 目前僅接受明列 OWN_MAIN／NONE 成本與有效區域的合成卡文；其他窗口、複合成本、Turn1、正式 MR 能力資料仍不支援。Keyword X 是此 profile 不可動態改值的固定文字／保留 grant；不裁定一般動態讀值或來源最後資訊。

MOVE 限 Field SOURCE 到 Hand／Remove／Deck 頂；STACK_UNDER 限 Deck 頂 0／1 張，未實作現場宿主下疊及批次 MR 組合。grant 可序列化、查詢及 Disguise 繼承，沒有提供任意增刪 grant opcode。簡單 additive modifier 不代表完整持續效果層。

完整快照含隱藏資訊，仅供可信宿主；PlayerView、公開 replay、儲存服務、Reconnect transport、帳號與 Multiplayer 都未建立。舊 schema 1／2 拒絕，未提供自動遷移。

後續應先針對需要擴充的 BLOCKING 取得裁定，再另行選定目標／成本／usage 子集；正式卡文需逐張核實。沒有自動開始下一 Phase。

## 新增／修改檔案

依 Phase 3A 開始前保存的 44 檔指紋比對：新增 **23**、修改 **28**、刪除 **0**。本目錄沒有 Git repository，未進行 commit／merge。

### 新增 23 檔

- docs/phase3a-plan.md
- docs/phase3a-results.md
- examples/explicit-rules.ts
- examples/programs.ts
- src/game/content/programs.ts
- src/game/content/triggers.ts
- src/game/effects/explicit.ts
- src/game/engine/feature-invariants.ts
- src/game/procedures/contact-response.ts
- src/game/procedures/declaration.ts
- src/game/procedures/investigation.ts
- src/game/rules/identity.ts
- src/game/rules/keywords.ts
- src/game/rules/modifiers.ts
- src/game/rules/mr.ts
- tests/phase3a-attachments.test.ts
- tests/phase3a-contact.test.ts
- tests/phase3a-effects.test.ts
- tests/phase3a-fixtures.ts
- tests/phase3a-investigation.test.ts
- tests/phase3a-mr.test.ts
- tests/phase3a-regressions.test.ts
- tests/phase3a.test.ts

### 修改 28 檔

- README.md
- docs/card-schema.md
- docs/digital-rules.md
- docs/game-flow.md
- examples/synthetic-content.ts
- package.json
- src/game/content/validate.ts
- src/game/effects/EffectResolver.ts
- src/game/engine/create.ts
- src/game/engine/events.ts
- src/game/engine/gameplay-invariants.ts
- src/game/engine/invariants.ts
- src/game/engine/procedure-invariants.ts
- src/game/engine/state-helpers.ts
- src/game/index.ts
- src/game/model.ts
- src/game/persistence/json.ts
- src/game/procedures/action.ts
- src/game/procedures/advance.ts
- src/game/procedures/commands.ts
- src/game/procedures/deduction.ts
- src/game/procedures/gameplay-commands.ts
- src/game/procedures/gameplay-rules.ts
- tests/core.test.ts
- tests/fixtures.ts
- tests/phase2-regressions.test.ts
- tests/phase2.test.ts
- tests/regressions.test.ts

README 與三份規則／架構文件同步目前 profile，舊完整 schema 明列為長期提案。Phase 1／2 結果、裁定準備文件、原規格與 PDF 保持原樣；沒有新增 runtime dependency。

來源指紋於最終驗證再次核對：

- 官方 PDF SHA-256：2a3caf3372e66656cd9ac0c5ba9dc8fc4177c176317f4f97086975c1c9e65d41
- 原整理規格 SHA-256：6680c33973b48c215dec2c40459ab31842afba368ada670a266be0864a08540b

