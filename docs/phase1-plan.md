# Phase 1 執行與驗收範圍

2026-09-05。使用者已授權實作 Core Game Engine；不建立 UI、帳號、連線或正式卡片資料庫。

## 規則問題分類

完整問題原文仍在 [digital-rules.md](digital-rules.md)。分類只決定本輪處理方式，**不是官方裁定或問題已解決**。

- **BLOCKING**：影響核心的特定互動。遇到未定行為必須拒絕內容／操作，或保存 `RULE_BLOCKED`，不能猜測。其餘已確認核心仍可執行。
- **DEFERRED**：整個相關功能不在本輪支援範圍；未知能力不能當成無效果卡載入。
- **IMPLEMENTATION**：可以先決定工程表示方法；缺少的官方資料仍不得自行補齊。

| RULE-QUESTION | 分類 | 本輪處置 |
| --- | --- | --- |
| 001 | DEFERRED | 大會額外組牌限制，尚無賽制模組 |
| 002 | BLOCKING | 同時勝敗／雙方同時空庫沒有裁定；拒絕該快照，不選擇輸家 |
| 003 | DEFERRED | 不支援 replacement／negation 競合 |
| 004 | DEFERRED | 不載入 MR 卡片或能力 |
| 005 | IMPLEMENTATION | recognizedNames 明列已核實名稱，不以字串拆名猜測 |
| 006 | IMPLEMENTATION | colors 是非空識別字陣列，不宣稱完整官方色枚舉；用牌做集合包含檢查 |
| 007 | IMPLEMENTATION | 使用有限 opcode registry 與明確支援狀態，不解析日文效果文字 |
| 008 | DEFERRED | 本輪固定 PDF Ver.2.5 與使用者確認；新增官方來源再版本化 |
| 009 | DEFERRED | Next Hint 尚未實作，包含 FILE 僅 Partner 邊界 |
| 010 | DEFERRED | Disguise 不支援 |
| 011 | BLOCKING | Auto／Assist 等未確認微時點若產生一般觸發，保存事實後暫停，不自行 drain |
| 012 | DEFERRED | 推理只支援固定印刷 LP、無 Mislead／中途來源移動的 fixture |
| 013 | DEFERRED | Action／Guard／Contact 不支援 |
| 014 | BLOCKING | 不支援任意選目標、離場後重取目標／last-known-value 的 program |
| 015 | DEFERRED | 不支援複合能力成本；已確認的 ACTIVE→SLEEP 成本可用 |
| 016 | DEFERRED | 不支援數值分層／多重基值覆寫 |
| 017 | DEFERRED | Disguise 的能力與限次繼承不支援 |
| 018 | DEFERRED | 不支援同時多角色進場、Switch 或 MR；滿場通常登場回報未支援 |
| 019 | DEFERRED | 不支援對手回合 MR 返回 Partner |
| 020 | DEFERRED | 不載入 MR／replacement，故不裁定其與 Refresh 的競合 |
| 021 | DEFERRED | 尚無 PlayerView；完整 snapshot 僅供受信任的引擎宿主，禁止作為未來玩家 payload |
| 022 | DEFERRED | Event 只支援解決後進 Remove，附件／其他目的地拒絕 |
| 023 | BLOCKING | 支援 End 觸發解決→expiry→換人；不支援 expiry 再觸發／持續效果循環 |
| 024 | DEFERRED | 不支援效果建立 Contact |
| 025 | BLOCKING | FILE Partner 只計數並按已確認 Auto 返回；在 FILE 推理或能力作用不猜測 |
| 026 | DEFERRED | 不支援 Big Jewel 特殊卡 |
| 027 | BLOCKING | 不支援角色離場重入、修正／限次重設；僅首次正常登場 |
| 028 | DEFERRED | 不支援多重 keyword／Mislead 疊加 |

合計：BLOCKING 6、DEFERRED 19、IMPLEMENTATION 3。28 個 ID 保留，沒有刪除未決問題。

## 已確認修正

Partner Assist 後在 FILE，**僅在該玩家自己的下一個 Auto Phase 第一個步驟**回到 Partner Area 並成為 ACTIVE。對手的 Auto 不會返回它。先返回 Partner，再使自己的 Field 角色 Active，再抽牌，再補 FILE。依 PDF p.10 及使用者本輪明確確認。此項不是 RULE-QUESTION-025 的 FILE 能力裁定。

## 執行順序

1. 更新文件、固定有限的支援範圍及下列 P0 清單。
2. 建立 TypeScript／Node test 設定、合成卡片 fixture，先執行失敗測試。
3. 實作 JSON model、資料驗證、注入 RNG、封裝 Engine 及 Setup／Turn。
4. 實作 Assist／Case、有限正常用牌／推理、逐張移動／Refresh 續行。
5. 實作 EffectQueue／EffectResolver、恢復驗證、未定規則 gate。
6. 跑 tests、typecheck、CLI 範例與獨立審查；補必要回歸測試；停止於 Phase 1。

## 第一輪 28 組 P0

每組可含多筆資料斷言；不是把原 89 項全部宣稱完成。括號列出僅覆蓋部分的原測試。

| P0 | 原 Test ID | 本輪 expected |
| --- | --- | --- |
| 01 | UT-001–004 | 40 張、印刷 ID 三張上限、卡种、混色可組牌 |
| 02 | UT-006 | shuffle→隨機先攻→各抽五→依序換牌→公開 |
| 03 | UT-007 | 換 0／2／5、回庫洗牌補抽，不能重選 |
| 04 | UT-008 | 自己下一 Auto 第一步 Partner 回來 ACTIVE，對手 Auto 不返回 |
| 05 | UT-009 | 抽牌與先攻首回合／其他 FILE 數 |
| 06 | UT-010 | FILE／Evidence 頂序與實卡唯一位置 |
| 07 | UT-011 | 九格朝向表及不可付 Sleep 成本 |
| 08 | UT-013、019 | 通常用牌一次、Level／全部顏色，FILE 不扣除 |
| 09 | UT-022 | Assist 加入時達 7 翻解決編；降低後不回復 |
| 10 | UT-023 | 其他 FILE 增加不翻章，證據達標不自動勝 |
| 11 | UT-024–025 | 事件解決需章節／Active；按先後攻等級判定；不足仍 Sleep |
| 12 | UT-029–030（部分） | 固定 LP 推理、逐張證據、新角色不可推理；keyword 未支援 |
| 13 | UT-049 | 正好抽完最後一張仍立即 Refresh |
| 14 | UT-050 | 空庫無 Remove 敗北，停止剩餘步驟 |
| 15 | UT-051、058 | Remove 洗回、對手 +1 Evidence、對手痕跡發現 |
| 16 | UT-052（部分） | DRAW／FILE／Evidence 跨 Refresh 繼續剩餘張數；Set 未支援 |
| 17 | UT-053（部分） | 解決中 Event 不在 Remove，Refresh 不洗回；Cut-in 未支援 |
| 18 | UT-055 | 移除頂 N 不足時 Refresh 後不補移剩餘量 |
| 19 | UT-057 | 巢狀 Refresh 能回到外層與原效果 |
| 20 | UT-059 | 回合玩家優先、同方自由選序，非 LIFO／FIFO |
| 21 | UT-060（部分） | 一個效果全部完成再解新觸發；Action 未支援 |
| 22 | UT-076（部分） | End 觸發完成→expiry 步驟→換人；暫無持續修正 |
| 23 | UT-078、084（部分） | 換牌／效果選序／逐張效果／巢狀 Refresh 快照恢復與版本拒絕 |
| 24 | UT-080、082 | 錯 actor／revision／choice／重複 ID 拒絕且不變；相同命令重送冪等 |
| 25 | UT-081 | 注入 RNG 的相同 seed／commands 重演相同 state／events |
| 26 | UT-079、085–086（部分） | JSON 嚴格驗證、定義／實卡分離、公開快照不可變、84 張守恆 |
| 27 | UT-087 | 未知 opcode／缺 program／未核實內容拒絕，不按卡名選效果 |
| 28 | UT-088–089 | 未定 Auto 觸發保存 RULE_BLOCKED；技術步數上限不是和局／敗北 |

原 89 項完整設計保留在 game-flow.md；超出此表的規則維持待實作。P0 的通過不等於完整 TCG 可以上線對戰。
