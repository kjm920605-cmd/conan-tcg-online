# Phase 2 Core Gameplay Actions 驗收

完成日期：2026-09-06。範圍依 [phase2-plan.md](phase2-plan.md)。已重新閱讀 README、digital-rules、game-flow、card-schema、Phase 1 結果、全部 28 題、現有程式／測試，並於 2026-09-05 重新視讀官方 Ver.2.5 PDF 全 27 頁。

## 驗證結果

環境：Windows PowerShell、Node.js v24.16.0、npm 11.13.0、TypeScript 5.9.3。PowerShell 以 npm.cmd 執行下列 npm scripts。

| 指令 | 結果 |
| --- | --- |
| npm test | **71 通過，0 失敗，0 skipped，0 todo** |
| npm run typecheck | **通過**，tsc --noEmit，exit 0 |
| npm run test:regression | **41 通過，0 失敗**；包含 Phase 1 全部 33 項及 Phase 2 的 8 項回歸 |
| npm run demo | **通過**；第 8 回合 b 完成 CASE_SOLVED，serialize／restore 一致 |

71 項為 **原 Phase 1 33 項 + Phase 2 30 項 + 本輪回歸 8 項**，不是原 89 項 backlog 全部完成。主要測試先執行得到 28 項預期失敗／2 項既有拒絕邊界通過，再建立功能；審查發現的缺陷亦先重現失敗，再修正。

獨立唯讀審查已複核修正，Phase 2 的 38 項測試通過，未發現剩餘的重要問題。這是有限核心與合成內容的審查，不代表完整正式卡文已驗證。

## 已完成範圍

- Next Hint：取最上方非 Partner FILE 卡、即時計數、任選 0/1 張合法手牌、Level／Case 全色驗證；可重複、禁止插入 Main、封鎖之後的通常用牌。
- Switch：單一角色登場會超過五人時才開選擇；既有角色無朝向限制。正式移除／登場事件進管線，來源離場觸發仍入 pending，完整登場步驟後才解決。
- Deduction：ACTIVE／名乗り與 RAPID 驗證、Sleep 宣告、宣告 checkpoint、Mislead、效果 checkpoint、LP 計算、逐張 Evidence／Refresh、checkpoint、Deduction-end。
- Mislead：對手一次選互異 ACTIVE Field 角色，同批 Sleep；合計 X 只保存於本次推理。最終 LP≤0 不獲得 Evidence。
- Action／Guard：合法 Character／Case target；新角色需要 RAPID 才能 Action，Guard 則允許名乗り ACTIVE 角色，宣告後 Sleep。
- Contact：開始／優先權／回應／AP／結束，低 AP 方先、同 AP 非回合方先；攻擊 AP≥防禦 AP 移除防禦者，不因比較移除攻擊者。Contact 中參與者離場跳過 AP 比較。
- Case 分支：頂 Evidence 暫存 PROCESSING，再入 Remove，己方 +1 Evidence；進入該分支後不因攻擊者離場中止。本 profile 不接受ヒラメキ能力。
- RQ-011 checkpoint：目前完整 action／effect／atomic step 完成後處理 pending；同方任選，每個效果後重新給回合方優先；來源離場或被 suppress 不取消已觸發效果。
- 序列化：所有選擇窗口、流程游標、剩餘量、AP 順序、LP／Mislead、RNG、revision 均為 JSON；restore 驗證來源、候選與父子程序。
- 封裝：狀態僅由 GameEngine 私有 state／驗證後 draft 提交改變；getState 為深層 readonly／freeze 副本，沒有任意玩家移卡或效果執行指令。

有限效果使用 program ID／opcode registry，不依卡名分支；普通 pending 是獨立集合，不是 LIFO 或 FIFO。Refresh 是立即規則續行，與普通效果排序分開。所有隨機操作仍經可注入純 RNG 介面。

## 測試與原 backlog 對照

| 本輪測試 | 對應原設計 | 覆蓋及界線 |
| --- | --- | --- |
| P2-01–05、P2-R01 | UT-014–019、060 | Next Hint、Partner 排除、可選用牌、計數／色／Level、重複使用與 Event 子程序 |
| P2-06–08 | UT-005、021、061 | 單卡 Switch、任何朝向、離場觸發、巢狀選擇快照；不含同時多卡溢出 |
| P2-09–13 | UT-029–031、060 | RAPID／Mislead、Sleep、LP、checkpoint；不含通用 LP 修正層 |
| P2-14、15、26 | UT-049–052、060、078、084 | 推理／Auto 的 Refresh、逐張順序、中途恢復 |
| P2-16、P2-R02 | UT-059、061 | source suppress 不取消 pending、新回合方 pending 重新獲優先權；原 P0-20／21 與 R-05 仍保留 |
| P2-17–22 | UT-032–040、045、060 | target、Guard、Contact AP、Case 基本分支、Cut-in／Disguise 明確未支援 |
| P2-23、24、30 | UT-041、061、088 | Contact 離場已確認分支；推理／Guard 邊界及重入保留 RQ gate |
| P2-25–29、P2-R04 | UT-027、078、080、084、087 | 每步快照、選擇原子拒絕、AP／LP 一致性、未知或重複 keyword／immediate timing 拒絕 |
| P2-R03、05–08 | UT-060、061、084、088 | FILE Partner gate、Auto 狀態事件、AP 移除前捕捉、規則阻擋優先及終局診斷 |

P0-23 的未知版本測試改為 schema 999；P0-28 按 RQ-011 新確認改為 Auto checkpoint，保留技術上限不是勝敗的斷言。原 33 項未刪除。其餘未確認的 UT-Q 待辦保留在文件，不把缺少 expected 的規則算作通過。

## 審查與回歸修正

1. Auto Partner 回復 ACTIVE 透過事件捕捉；ACTIVE→ACTIVE 等未改變朝向的要求不虛構 ORIENTATION_CHANGED。
2. AP 比較先捕捉當時仍在場角色的觸發，再完成防禦者移除；效果仍等整個比較步驟後 checkpoint。
3. 已遇到 RQ-025 時，後續 Case 判勝不得覆蓋 RULE_BLOCKED；保留已完成的明確步驟及問題。
4. 正常終局允許保存未執行的 pending／frames 作診斷，不再推進它們，也不因缺少後續 checkpoint 拒絕合法終局。
5. 還原時驗算本 profile 的固定 AP 順序、已計算 LP 與 Mislead 合計，拒絕自相矛盾的快照。

## 仍未解決的 BLOCKING RULE-QUESTION

目前分類：**BLOCKING 8、DEFERRED 16、IMPLEMENTATION 3、RESOLVED 1（RQ-011）**；其餘 27 題答案仍 OPEN。BLOCKING 限定受影響互動，不阻止已確認流程。

| 問題 | 尚缺確認 | 引擎處置 |
| --- | --- | --- |
| RQ-002 | 同時終局／雙方同時空庫的結果 | 保留 RULE_BLOCKED／拒絕未裁定快照，不猜平手或輸家 |
| RQ-009 | FILE 只有 Assist Partner 能否宣告 Next Hint | UnsupportedRule／RULE_QUESTION_009，不把無可拿卡等同官方禁止 |
| RQ-012 | 推理來源離場、LP 讀值與變動時点 | 來源離場保留 RULE_BLOCKED；不提供通用 LP 修正系統 |
| RQ-013 | Guard／Contact 前邊界離場、Case 證據失效、提前 Action-end 觸發 | 在有歧義的續行前保留 RULE_BLOCKED；已進 Contact 的離場照官方分支 |
| RQ-014 | 目標身份、離場來源讀值／重選 | 來源操作遇到非 Field 保留 RULE_BLOCKED；無任意 target／last-known-value 推定 |
| RQ-023 | 到期修正產生新觸發／循環 | 不載入到期修正 opcode；技術 step limit 不判終局 |
| RQ-025 | FILE Partner Ability／推理／重新 ACTIVE 後額外行為 | 玩家呼叫回 UnsupportedRule／RULE_QUESTION_025；自動觸發適用性不明保留 RULE_BLOCKED |
| RQ-027 | 離場重入的朝向、修正、限次重設 | 已確認移除可執行，保存封存 runtime；再次登場回 RULE_QUESTION_027 |

RQ-025 只允許已確認的 Assist 後位於 FILE、計數、Next Hint 排除、自己下一個 Auto 第一步返回 Partner 並 ACTIVE。FILE 中的未知行為沒有被當作 no-op。

## 相容性與限制

- 快照升為 schema 2／engine 0.2.0／ruleset pdf-2.5+rq011-confirmed；舊 schema 1 明確拒絕，未做隱式遷移。
- 完整快照含隱藏資訊，restore／advance 只供可信宿主；未來 server 負責身份與指令排序。Replay／Reconnect 的續行資料已保留，本輪沒有網路或持久化服務。
- Contact 只實作 PASS 回應，Cut-in／Disguise 是 extension point。RAPID／MISLEAD 之外 keyword、MR、附件、複合成本、完整持續效果、正式卡文都未實作。
- immediate replacement／negation 不進一般 queue；本輪內容載入明確拒絕，不宣稱已完成即時 handler 或其競合排序。
- 未建立 UI、帳號、Online Multiplayer，也未大量輸入正式卡牌。

## 新增／修改檔案

新增 11 個：

~~~text
docs/phase2-plan.md
docs/phase2-results.md
src/game/engine/events.ts
src/game/engine/gameplay-invariants.ts
src/game/procedures/gameplay-rules.ts
src/game/procedures/gameplay-commands.ts
src/game/procedures/deduction.ts
src/game/procedures/action.ts
tests/phase2-fixtures.ts
tests/phase2.test.ts
tests/phase2-regressions.test.ts
~~~

修改 17 個：

~~~text
.gitignore
README.md
package.json
docs/digital-rules.md
docs/game-flow.md
docs/card-schema.md
src/game/model.ts
src/game/content/validate.ts
src/game/engine/GameEngine.ts
src/game/engine/create.ts
src/game/engine/invariants.ts
src/game/engine/procedure-invariants.ts
src/game/engine/state-helpers.ts
src/game/effects/EffectResolver.ts
src/game/procedures/commands.ts
src/game/procedures/advance.ts
tests/core.test.ts
~~~

官方 PDF 與原整理規格保持原樣。重新核對 SHA-256：

~~~text
docs/reference/rule_manual.pdf
2a3caf3372e66656cd9ac0c5ba9dc8fc4177c176317f4f97086975c1c9e65d41
docs/conan_tcg_original-rules.md
6680c33973b48c215dec2c40459ab31842afba368ada670a266be0864a08540b
~~~

## 下一階段建議

先取得 RQ-009／012／013／014／025／027 的具體官方裁定與案例，補相應 expected，再另行決定 Cut-in／Disguise、成本與有限 keyword 的擴充範圍。PlayerView／隱藏資訊及 RQ-021 應在任何連線功能之前明確化。

Phase 2 到此停止；沒有自動進入下一 Phase。
