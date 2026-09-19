# 數位規則與來源稽核

狀態：Phase 3A Explicit Rules Feature Layer 有限核心已實作；本文件仍記錄完整規則設計，不表示每條已實作。PDF 本輪複核日期：2026-09-06，重點為 p.12、17–18、20–27。範圍與結果見 [phase3a-plan.md](phase3a-plan.md)、[phase3a-results.md](phase3a-results.md)，Phase 1／2 紀錄另保留。

## 1. 來源、範圍與閱讀方式

優先順序是本機官方 PDF，其次是已整理的工程規格。本文件中的工程選擇不構成新增遊戲規則。無法由這兩份資料確認的行為，一律列為 RULE-QUESTION，不能用其他 TCG 的慣例補足。

| 使用者指定來源 | 本次實際檔案／狀態 |
| --- | --- |
| `docs/reference/rule_manual_v2.5.pdf` | [reference/rule_manual.pdf](reference/rule_manual.pdf)，封面明示 Ver.2.5，共 27 頁 |
| `docs/original-rules.md` | [conan_tcg_original-rules.md](conan_tcg_original-rules.md)，共 1,507 行 |
| `README.md` | 分析階段時不存在；Phase 1 已重新閱讀使用者新增的 README 並補齊架構及執行方法 |
| 目前專案目錄 | 分析開始時僅兩個來源；Phase 1 新增 src/game、測試、examples 與套件設定，未建立 UI／server／Git repository |

來源指紋：

- PDF SHA-256：`2a3caf3372e66656cd9ac0c5ba9dc8fc4177c176317f4f97086975c1c9e65d41`。
- 原規格 SHA-256：`6680c33973b48c215dec2c40459ab31842afba368ada670a266be0864a08540b`。
- PDF 文字層擷取有編碼錯誤，本次以渲染圖像完整閱讀 p.1–27；下文頁碼是 PDF 內頁頁碼，與檔案頁序一致。
- 本次不修改、重新命名或複製原始來源。未引入新版網頁、卡表或外部裁定，避免混用規則版本。

標記慣例：

- **已確認**：可由指定 PDF 支持，有頁碼。
- **工程決策**：序列化、資料結構、指令驗證等設計，不宣稱官方要求這種程式寫法。
- **待確認**：附 RULE-QUESTION 編號；未解答前沒有遊戲結果的預設值。

配套文件：[game-flow.md](game-flow.md) 定義 state machine、unit test 清單與目錄；[card-schema.md](card-schema.md) 定義卡片與可序列化狀態。

## 2. original-rules.md 一致性稽核

整體基本規則大致相符；不能直接照原規格中的所有步驟與示意 invariant 實作。以下區分矛盾、過度概括與必要補充，避免把所有缺漏誤稱為官方規則衝突。

| 編號 | 原規格定位 | 判定 | PDF 依據與數位規格處置 |
| --- | --- | --- | --- |
| AUDIT-01 | §8，行 359；Assist Partner 返回列成第 5 步 | **順序矛盾／表述歧義** | p.10：返回 Partner 區並 Active 是 Auto **第 1 步**的一部分，早於角色 Active、抽牌及 FILE 補牌。刪除第 5 步式流程，見 DR-04。 |
| AUDIT-02 | §26.1，行 1191；標題稱 Field/Partner 的 MR uniqueness | **過度概括** | p.26 規定「新 MR 登場時移除既存 MR」，沒有提供任意時刻合計最多一張的全域 invariant；同頁另有對手回合離場後立即移到 Partner 區規則。不能直接用唯一性校驗刪除新狀態；交互作用見 RULE-QUESTION-018、019。 |
| AUDIT-03 | §26.1；既存 Field MR 被移除稱 ability/rule | **因果分類不夠精確** | p.26 明示屬於「能力によるリムーブ」。一般情形應記為能力造成，不能籠統標成 RULE 而漏掉能力移除觸發。 |
| AUDIT-04 | §15–19、§22.4、§29 | **結算時點缺漏** | p.15–17、19 明示圖中每個項目間的箭頭先結算發動效果；p.22 規定目前行動／效果完成後處理未解決效果。以官方流程項目為單位，不能只在整個 Action 結束才 drain，也不能在效果的每一個子指令後任意 drain。 |
| AUDIT-05 | §22.3–22.4 | **必要語義缺漏** | p.22：「～の場合」「～してもよい。そうした場合、～」在效果**結算時**確認條件、決定是否執行。觸發當下的條件與結算時的條件必須分開存，不可全部預先鎖定。 |
| AUDIT-06 | §17.3，行 721 附近 | **提前結束細節未落實** | p.17：Contact 任一角色離開現場，直接推進到 Contact 結束（失效 Contact 期間效果），再依有無父 Action 繼續；不能再給回應或做 AP 判定。效果直接造成的 Contact 到此結束。 |
| AUDIT-07 | §19 | **重要例外缺漏** | p.19：在未被 Guard 的 Action[事件] 分支，攻擊者離開現場仍繼續到 Action 結束。不能套用 p.16 Guard 前的終止條件。 |
| AUDIT-08 | §18.2 | **繼承清單不足** | p.18 明示繼承狀態、其他卡賦予的**能力與效果**、Set 與下疊卡；不是只繼承效果。新卡取代卡名／顏色等原卡資訊。使用次數等細節仍見 RULE-QUESTION-017、027。 |
| AUDIT-09 | §22.2、§28.2 | **有效性與持有需更精確** | p.21：無效的能力文字不能供其他能力／效果參照；但能力 icon 本身仍可被參照，且仍持有原能力。不能把「has ability」與「text/effect is valid」合成一個 boolean。 |
| AUDIT-10 | §21.3 | **規則例子需保留** | p.20 不足指定張數的「移除牌庫頂 N 張也可以」屬條件，不能部分執行；與強制效果移除盡可能多張後 Refresh 且不續移不同。見 DR-14。 |
| AUDIT-11 | §11「no eligible card」限制 | **文件未完全支持的延伸** | p.12 說 FILE 沒卡不能 Next Hint，同時排除 Assist Partner 作為拿取卡；「FILE 僅剩 Partner」沒有明確答案，見 RULE-QUESTION-009。一般空 FILE 不可用是已確認規則。 |
| AUDIT-12 | §29 範例先 trigger collection 再 replacement | **工程示意有誤用風險** | p.22 的「代わりに／無効にする」立即處理，不能先把被替代事件當成已發生後入列普通觸發。設計要區分候選事件、即時處理與已提交事實；競合見 RULE-QUESTION-003、020。 |
| AUDIT-13 | §30 GameState | **工程模型不完整，非官方矛盾** | 缺 setup、選擇權、可恢復程序、處理中卡片、隨機狀態、版本與資訊投影；`partner` 參照與 FILE 不能當成兩張實卡。見 card-schema.md。 |

其他章節核對覆蓋：

| 原規格章節 | PDF | 結果 |
| --- | --- | --- |
| §1–4 | p.3–8 | 四種卡、數值可負、三種朝向、40 張／同 ID 3 張、八區基本相符。完整色表與區域資訊權限仍待資料。 |
| §5–7、20 | p.9–10 | 起手 5 張、先攻先換牌、三階段、兩種明示勝敗及 End 大順序相符。 |
| §9–14 | p.11–14 | 主階段六類行動、手札使用與 Next Hint 的非對稱限制、雙色、Switch、Partner 與成本規則相符；未定邊界另列問題。 |
| §15–19 | p.15–19 | 推理、Guard、Contact 的 AP 比較與回應次數、ヒラメキ基本相符；上表補全箭頭與退出流程。 |
| §21–25 | p.20–25 | Refresh、未解決效果優先權、附屬卡、icon、關鍵字大致相符；上表補全條件／無效／成本語義。 |
| §26–28 | p.26–27 | MR 基本兩能力、多名與原 AP/LP=0 大致相符；MR 全域唯一性不可採用。 |
| §29–33 | 工程建議 | 不作官方規則來源；26 項 invariant 在 game-flow.md 逐項映射測試，過強敘述加註適用邊界。 |

## 3. 已確認的數位規則契約

所有 Main 指令共用前提：目前為自己的 `MAIN_IDLE`，沒有其他程序、未結算效果、待答選擇或已確認的終局阻擋。回應窗口的選擇不是新的 Main 行動。（p.11）

### DR-01 卡片、牌組及區域

依 p.3–8：每位玩家一張 Partner、一張 Case，主牌組正好 40 張 Character/Event。同印刷 ID 合計最多 3 張，異圖同 ID 合併計數；`definitionId`、`cardNo`、`instanceId` 均不能代替印刷 ID 做限量判定。組牌無顏色限制，Partner 可自由選色。

八區為 FIELD、PARTNER、CASE、DECK、EVIDENCE、FILE、REMOVE、HAND。己方卡不進入對手區域。Field 最多 5 個角色；Set／下疊卡不是額外 Field 角色，其餘區沒有通用張數上限。

證據及 FILE 後放的卡在上方，逐張放置（p.10、15）。牌庫有頂／底（p.9、20）。**工程決策**：陣列 index 0 統一代表頂部；除規則／卡文允許，不提供重排指令。其他區的內部排序只作儲存，不自動產生規則意義。

### DR-02 朝向與名乗り状態

依 p.6、15、16、25：Character 可為 ACTIVE、SLEEP、STUN。使 STUN 角色 Active 的結果是 SLEEP；使其 Sleep 或再次 Stun 仍為 STUN。數值變負不會自行移除角色（p.4）。

| 原狀態 | 使 Active | 使 Sleep | 使 Stun |
| --- | --- | --- | --- |
| ACTIVE | ACTIVE | SLEEP | STUN |
| SLEEP | ACTIVE | SLEEP | STUN |
| STUN | SLEEP | STUN | STUN |

Sleep **成本**必須由 ACTIVE 支付，不能把 STUN→STUN 當成成功支付（p.14）。Partner 的一般 ACTIVE/SLEEP 已確認；不要因共用 enum 就自行賦予 Partner 可被 Stun 的規則。

名乗り状態持續到登場當回合結束，僅限制推理及 Action。可 Guard、使用合法宣言、被 Switch。`迅速` 開放推理及 Action；`突撃` 只開放 Action；兩種指定型只開放對應 Action 目標；重新 Active 不消除名乗り状態。

### DR-03 Setup 與勝敗

依 p.9：Partner／Case 裏置 → 洗主牌組 → 隨機決定先後攻 → 雙方各抽 5 → 先攻決定並完成一次換牌 → 後攻決定並完成一次換牌 → 公開 Partner／Case → 先攻第一回合。換牌可選手中任意張，先返回牌庫並洗牌，再抽相同張數，可選擇不換。

依 p.5、9、13：初始 Case 狀態為 `事件編`。Assist 達標轉為 `解決編` 後不返回。這是事件進度 marker，與卡片 face up/down 是不同維度。Evidence 達標不會自動勝利；事件解決程序成功才勝利。Refresh 時 Remove 空則該玩家敗北。同步終局見 RULE-QUESTION-002。

### DR-04 Turn、Auto 與 End

依 p.10，AUTO → MAIN → END → 對手 AUTO。

Auto 固定四步：

1. 己方 Partner Active；若由 Assist 在 FILE，**於該玩家自己的下一個 Auto Phase 第一個步驟，先返回 Partner 區並成為 ACTIVE**。對手的 Auto 不會返回它。PDF p.10 與使用者 Phase 1 確認一致。
2. 己方現場所有角色 Active；STUN 改為 SLEEP。
3. 抽一張；先攻第一回合也抽。
4. 逐張從牌庫頂裏放到 FILE，通常兩張；只有先攻第一回合為一張。

End：發動並結算回合結束能力 → 到回合結束的效果失效 → 交給對手。未解決效果不能跨到對手 Main 繼續任意處理。一般時序依已確認 RQ-011：每個完整規則步驟之後 checkpoint；到期再觸發／循環仍見 RULE-QUESTION-023。

### DR-05 通常手札使用

依 p.11–12：每回合至多一次，該回合已做 Next Hint 則不可用。Level ≤ 當前 FILE 張數（含 Assist Partner），卡片顏色須由己方 Case 支持；雙色卡兩色都要支持。只讀取 FILE 張數，不因此支付／翻轉／移除 FILE。

結果：Character 以 ACTIVE 登場並處理容量；Event 結算其效果後進 Remove，卡文 Set 等例外見 DR-16。角色由效果登場、Cut-in、ヒラメキ不受此通常 Case 色限制；不能把這些途徑扣成一次通常手札使用。

### DR-06 Next Hint

依 p.11–12：空 FILE 不可做。先把 FILE 頂卡（排除 Assist Partner）移到手中，再決定使用 0 或 1 張手牌；新拿的卡也可用。Level 用**取走後** FILE 張數，仍含 Partner；套用同樣 Case 色限制。

Next Hint 可在通常手札使用後進行，且沒有通用每回合一次限制；反向順序則封鎖通常使用。這個使用機會只屬於當次程序，不能儲存；兩步間不可插入 Assist 等 Main 行動。「atomic」只代表不接受另一個 Main 行動，不排除規則要求的 Refresh／選擇／結算時點。FILE 僅 Partner 仍為 RULE-QUESTION-009；依已確認 RQ-011，取卡步驟完成後先 checkpoint，再開本次使用手牌選擇。

### DR-07 Switch

依 p.12：現場滿員而角色將登場時，可移除既存角色來騰位，不要求該角色 Active。或同時登場多張會超過上限時可用；有空位且無溢出時不可自行 Switch。正常單卡進場以玩家選擇合法騰位完成後落地，穩定狀態最多 5 張。多卡同時進場的候選／數量與 MR 交互見 RULE-QUESTION-018。

### DR-08 Partner

依 p.13：兩能力均付 Partner Sleep 成本。

| 指令 | 前提 | 結果 |
| --- | --- | --- |
| Assist | Partner 能合法付 Sleep | Sleep 並移到 FILE；此刻含 Partner 達 7 張就強制轉解決編。僅普通 FILE 增到 7 不會自行翻 marker。 |
| 事件解決 | Case 為解決編，Partner 能付 Sleep | 宣告並 Sleep，依先／後攻對應事件等級比較 Evidence；達標則勝利。p.13 將比較寫在支付後，本文不新增「證據不足就不能宣告」前提；未達標不產生勝利。 |

Partner 在 FILE 可否被效果 Active 後使用能力／推理，不能從一般 Partner 區用法延伸，見 RULE-QUESTION-025。

### DR-09 宣言與成本

依 p.14：可用己方 Field Character、Case、Partner 區 MR，或能力明定的其他區域。登場當回合可用；沒有 Sleep 成本時不強制 ACTIVE。

冒號左側為成本，右側為效果。所有成本都可支付才可宣告；成本中省略「自己的」仍只能使用己方卡，未寫區域的 Character 指己方 Field。無目標的 Sleep／移牌庫底成本作用於能力來源。

成本造成的事件必須記錄 `cause.kind=COST`，不滿足「以自己的能力／效果做了 X」條件；但不是全面禁止所有由成本引起的其他觸發。成本先支付，之後處理效果；不能因效果無可執行部分而自動退還合法支付的成本。多成本內部順序與即時 Refresh 見 RULE-QUESTION-015。

### DR-10 推理

依 p.15、25：ACTIVE Partner 或己方現場 ACTIVE Character，Character 須非名乗り状態或有迅速。宣告並 Sleep → 對方 Mislead 窗口 → 依本次 LP 獲得 Evidence → 結束推理。每個官方箭頭先處理待解決效果。

對方可同時選任意數量合法 ACTIVE Mislead 角色，Sleep 它們，以各自 X 降低本次推理 LP；減值只到本次推理結束。沒有其他一般反應窗口。所得 Evidence 為 `max(LP, 0)`，逐張從自己牌庫頂裏放；期間立即 Refresh 並續做剩餘張數。來源離場與抽取中 LP 再變動的取值問題見 RULE-QUESTION-012。

### DR-11 Action、Guard、Contact

依 p.16–18：己方 Field ACTIVE Character，且通過名乗り状態／關鍵字限制。指定對手 SLEEP/STUN Character，或至少有一張 Evidence 的對手 Case。宣告並 Sleep → 箭頭效果 → Guard。

Guard 可由對手一張 Field ACTIVE Character 執行並 Sleep，無 AP 門檻且名乗り状態可用；Bullet 禁止 Guard（p.25）。在 Guard 前，攻擊者或原本指定的目標 Character 離場，Action 當場結束（p.16 註）。其他邊界見 RULE-QUESTION-013。

被 Guard 時與 Guard 者 Contact；未被 Guard 的角色攻擊與原角色 Contact。Contact：

1. 發生 Contact，完成箭頭效果後比較當前 AP 決定回應順序。
2. AP 低者先，高者後；相同時被攻擊的非回合玩家先。
3. 每玩家每次 Contact 最多做一次、用一張：Cut-in **或** Disguise；可 pass。
4. 僅當第一位 pass、第二位行動時，再給第一位一次機會。不是雙方輪流無限回應。
5. 每一位行動及其效果結算完成後才換下一位。順序在第 1 步確定，沒有每次 AP 變動就重排的步驟。
6. 攻擊者 AP ≥ 對方 AP，移除對方；小於則不移除任何一方。攻擊者不因 AP 比較自行被移除。
7. Contact 結束使 Contact 期間效果失效；有父 Action 才處理 Action 結束能力，結算後使 Action 期間效果失效。

任一 Contact 參與角色在期間離場，跳至 Contact 結束，略過未做的回應與 AP 判定。Disguise 是參與者替換，不可誤走一般離場終止分支。直接由效果造成的 Contact 沒有額外隱含 Action；卡文不足以定義角色時見 RULE-QUESTION-024。

### DR-12 Cut-in 與 Disguise

依 p.18、20：Cut-in 使用具有此能力的手牌，多個 Cut-in 效果只能選一個。它使用後先在 Remove，再結算效果；Refresh 可洗回此卡。常見 AP+2000 到 Contact 結束失效，不是增加到回合結束。

Disguise 使用手中具有有效變裝能力的 Character 替換己方 Contact 角色，舊卡裏置牌庫底。繼承原角色狀態、其他卡賦予的能力／效果、Set 與下疊卡；卡名／顏色等固有資訊換成新卡。不是登場，不觸發登場時／疾風等登場條件；觸發新卡變裝時。Level／顏色可用性見 RULE-QUESTION-010，使用次數等繼承細節見 RULE-QUESTION-017、027。

### DR-13 未被 Guard 的 Action[事件]

依 p.19：取對方最上方一張 Evidence → 對方選擇是否發動該卡ヒラメキ → 效果完成或放棄後將該卡放 Remove → 自己取得一張 Evidence → Action 結束能力 → Action 期間效果失效。

移除與取得都是一張，與攻擊者 LP 無關。進入此分支後攻擊者離場仍繼續；不得沿用 Guard 前終止條件。表向證據也可ヒラメキ；由能力／效果等其他原因移除證據不觸發ヒラメキ。

ヒラメキ解決中卡尚未進 Remove，不能洗入期間發生的 Refresh。引擎需有「處理中卡」持有位置，不能提早放 Remove 或複製一張虛擬卡。若輪到移除時已無 Evidence，見 RULE-QUESTION-013。

### DR-14 Refresh

依 p.9、20：牌庫成為 0 張**立即**處理，包含抽走最後一張剛好完成需求的情況，不等下一次抽牌失敗或 phase 結束。

1. 如 Remove 為 0，立即敗北，不繼續原程序。
2. 洗入目前 Remove 的所有卡形成新牌庫。
3. 對手獲得一張 Evidence。
4. 返回原程序的精確續行點。

對手取得 Evidence 也可能使其牌庫空，故續行機制必須能保存巢狀 Refresh；未定競合不能自動選贏家。每次對手 Refresh，自己的痕跡成為發見済み，之後不回復；自己的 Refresh 不發現自己的痕跡（p.25）。

| 文字／操作種類 | 原牌庫不足時 | Refresh 後 |
| --- | --- | --- |
| 抽牌、得證據、放 FILE、從牌庫頂 Set | 逐張執行至牌庫空，立即 Refresh | 繼續剩餘數量 |
| 看／公開頂 N 張 | 只看／公開現有張數，卡仍視為在牌庫，不因不足 Refresh | 依後續指令移動；實際移空才 Refresh |
| 效果：頂 N 張移除 | 移除能移除的原牌庫卡，空時 Refresh | 不再移除差額 |
| 成本或條件：頂 N 張移除／「移除也可以」 | 事先不足 N 張就不可執行該成本／條件 | 不可先部分支付，再靠 Refresh 湊數 |

Event／ヒラメキ在自身效果解決完成前不在 Remove；Cut-in／現場リムーブ時來源已在 Remove（若沒有其他移動），可被洗回。原效果執行不能依賴卡仍在 Remove 才能續行。

### DR-15 效果語義與排程

依 p.21–22、24、27：

- 滿足發動條件且有效的 triggered ability 必須發動，次數 icon 內不能任意略過；效果本文可選則於結算時選擇。
- `ターン①/②` 限制每個回合的發動／使用，不只己方回合。重入或變裝的計數身份另見 RULE-QUESTION-017、027。
- `～する` 盡可能執行；`～してもよい` 可拒絕；`～枚まで` 可選 0。成本／條件須全額的例外見 DR-09、14。
- 無區域的 Character 指 Field；效果未限己方時，雙方符合者和來源本身都可選。一次選多張不能重複使用同一實例。
- 觸發時保存 trigger 事實；結算時才評估「若……」和可選分支。來源離場或能力變無效，不會取消已觸發效果；明確效果無效化另論。
- 未解決效果是可選的集合：兩方都有時，回合玩家優先；有權玩家選自己的任何一個，無關觸發先後。完成一個效果後重新檢查優先方。不是 FIFO，也不是 LIFO。
- 「代わりに」「無効にする」例外立即處理；不得建立自由接招或任意打斷的 stack。多個即時處理競合見 RULE-QUESTION-003、020。

| 無效項目 | 行為 |
| --- | --- |
| 持續能力 | 不提供效果 |
| 條件觸發／登場／現場移除／變裝時／疾風 | 不發動 |
| 宣言／變裝能力 | 不可使用 |
| Cut-in | 合法時點可用，但無效部分不產生效果 |
| ヒラメキ | 可選發動，但無效部分不產生效果 |
| Event 效果 | Event 可使用，但無效部分不產生效果 |

條件 icon 支援己方／對方回合、Partner 色、Case 色／特徴、FILE 下限、事件編／解決編、絆的 Field 卡名。單色條件只需 Case 具有該色；`&` 多色條件須全有；Partner 不滿足絆。

「原 AP/LP 變 0」只替代印刷基值，其他加減仍在；不造成自動移除。「原能力無效」保留外來賦予能力、已觸發效果及 MR 能力；不刪除原能力 definition。超出這些明示情形的計算層次見 RULE-QUESTION-016。

### DR-16 附屬卡、名稱、捜査與 MR

依 p.23：Set 與下疊是兩種關係，不能混合。一個角色 Set 數不限。裏向 Set 連擁有者都不能確認正面，且不視為 Character/Event；移除時表置 Remove。下疊卡在規則中只有張數資訊，底層實卡資料仍須保存供之後移動。宿主離場或變成另一角色的下疊卡，原 Set／下疊卡全部移除；Disguise 依 p.18 繼承的例外處理，不先觸發通用清理。

依 p.25：捜査 X 由對手公開其牌庫頂 X 張，不足則盡可能公開；由**對手**選擇放回牌庫底順序，順序不必公開。隨後效果所稱發現的卡，是剛公開的那批卡。

依 p.27：官方所述 `&`／括號多名卡在各區具有全名和列出的角色名；不能把一張實卡當成兩張來選。使用人工核實 `recognizedNames`，不做一般字串切割或子字串匹配。下疊／裏向 Set 的資訊限制仍需按其區域語義處理。

依 p.26：MR 是 Character 的特殊機制，不是第五卡種。一般登場後依 MR 規則移除既有 Field／Partner 區 MR，其中 Field 移除屬能力造成。對手回合 MR 離場時，先到原目的區，再**立即**到 Partner 區；這不是「代替」效果，也不能放入一般 pending 集合等稍後才搬。己方回合不轉移。Partner 區 MR 不推理／Action，只使用適用該區的能力。複合情況見 RULE-QUESTION-018–020。

## 4. RULE-QUESTION 完整登錄

以下涵蓋原規格 8 項及設計發現的全部 28 個未定點；不是宣稱窮盡未提供卡片的問題。RQ-011 已按本輪確認標為 **RESOLVED**；其餘 27 題仍 OPEN，編號保留。Assist 返回時間已確認，不是 RULE-QUESTION-025 的 FILE 特殊能力裁定。

| Phase 2 分類 | RULE-QUESTION 編號 | 數量 |
| --- | --- | --- |
| BLOCKING | 002、009、012、013、014、023、025、027 | 8 |
| DEFERRED | 001、003、004、008、010、015、016、017、018、019、020、021、022、024、026、028 | 16 |
| IMPLEMENTATION | 005、006、007 | 3 |
| RESOLVED | 011 | 1 |

BLOCKING 限於受影響互動，不阻止已確認核心執行；DEFERRED 的未決語義不載入，但 Phase 3A 可建立同類功能已明示的子集。IMPLEMENTATION 採明列名稱／色值／有限 program，不猜完整官方資料。分類與問題原文保持；每題歷史處置見 [phase2-plan.md](phase2-plan.md)，本輪界線見下方 Phase 3A 節。

解答規格：記錄精確來源版本、頁碼／官方 Q&A 或卡號、裁定內容、受影響規則／測試及審核日期。一般使用者偏好若改變遊戲規則，須成為另命名的 house-rules ruleset，不得記成官方解答。

| ID | 待確認問題 | 已知邊界／缺少證據 | 阻擋範圍與取得資料 |
| --- | --- | --- | --- |
| RULE-QUESTION-001 | 賽事是否有禁限卡、Partner／Case 限制等額外構築規則？ | p.7 明示活動可能追加規則 | 不阻擋 generic 40／3 驗證；賽事模式需特定賽事規章。 |
| RULE-QUESTION-002 | 同時終局、雙方同時需 Refresh 且無法完成，如何決定結果／平手？ | p.9 只列個別勝敗；沒有通用平手優先順序 | 阻擋同時終局案例；需官方完整規則／Q&A。不可用座位、玩家 ID 排序判勝。 |
| RULE-QUESTION-003 | 同一事件有多個 replacement／negation，誰選、何順序、可否重複適用？ | p.22 只確認即時處理 | 阻擋競合案例；需含實際卡號的官方裁定。 |
| RULE-QUESTION-004 | 個別 MR 的卡文、有效區域、成本與效果為何？ | p.26 只有共通規則與例子 | 阻擋未提供 MR 卡的定義；需官方卡面／卡表及修正。 |
| RULE-QUESTION-005 | 官方現有 `&`／括號以外名稱是否有新認定？ | p.27 明示其他表記不能僅因包含角色名而套用 | 阻擋新語法自動辨識；採已核實名稱清單，需逐卡資料。 |
| RULE-QUESTION-006 | 完整合法顏色集合、各卡色值為何？ | 手冊示例不構成完整色表 | 阻擋正式色 enum／卡表匯入；需官方卡片資料。 |
| RULE-QUESTION-007 | 已發行卡的完整效果語法與每種例外有哪些？ | p.21–27 不是所有卡文 grammar | 阻擋宣稱完整 DSL／所有卡支援；需卡文 corpus，逐種審核 opcode。 |
| RULE-QUESTION-008 | 官方完整規則、Q&A、勘誤與卡文的適用版本／優先關係為何？ | 本次來源沒有完整裁定制度 | 阻擋罕見例外與跨版內容合併；需官方版本來源。現階段仍以此 PDF 最高。 |
| RULE-QUESTION-009 | FILE 只有 Assist Partner 時，可否宣告只獲得使用機會的 Next Hint？ | p.12 禁止空 FILE，又排除 Partner 作為拿取卡；未單獨說明此組合 | 阻擋此局面；不可把「沒有可拿卡」或「FILE 非空」自行當成答案。 |
| RULE-QUESTION-010 | Disguise 是否檢查 FILE Level／Case 顏色及其他使用限制？ | p.18 說手牌有變裝能力即可替換；p.12 豁免清單未明列變裝 | 阻擋跨色／超 Level 等變裝合法性判定；需官方變裝 Q&A／卡文。 |
| RULE-QUESTION-011 | **RESOLVED：普通觸發及 checkpoint 時序** | PDF p.15–17、19、21–22；2026-09-05 使用者 Phase 2 六項明確確認，見下節 | 行動／效果／atomic rule step 中先 pending，完成後 checkpoint；同方任選、回合方優先；來源離場／後來無效不取消；replacement／negation 為獨立即時路徑。 |
| RULE-QUESTION-012 | 推理來源在結算證據前離場，LP 用哪個值？逐張獲得中 LP 改變時是否重算剩餘量？ | p.15 未提供離場終止或 last-known-value 規則 | 阻擋這些推理案例；不套用 Action 的離場條文。 |
| RULE-QUESTION-013 | Guard 後、Contact 前 Guard 者離場，或 Case Evidence 在移除步前已歸零，如何續行？Guard 前提前終止是否仍發動 Action-end 能力？ | p.16 只列 Guard 前攻擊者／原指定角色離場時終止；p.17、19 規定各分支內情形，沒有完整早期終止觸發表 | 阻擋跨邊界／目標失效與早期終止觸發案例；需具體 timing 裁定。 |
| RULE-QUESTION-014 | 一般效果選目標在何時，目標移區／離場重入後還算原目標嗎？能否重選，來源數值如何讀？ | p.22 給結算條件與來源離場效果仍解決，未給通用 target／last-known-information 制度 | 阻擋需身份或取值補充的效果；每個已確認效果 program 明訂讀值時點，不自動 retarget。 |
| RULE-QUESTION-015 | 多段成本的支付先後、成本移空牌庫的 Refresh 與其他成本如何交錯？ | p.14 全額可付，p.20 立即 Refresh；未給所有混合成本算法 | 阻擋複合成本／即時介入；需相關卡號 Q&A。合法性檢查不能提前改狀態。 |
| RULE-QUESTION-016 | 多個設基值、倍率、加減、能力取得／無效化相互依賴時如何排序？ | p.27 只確認原 AP/LP=0 保留加減與原能力無效的範圍 | 阻擋進階計算競合；不可自行套其他 TCG 的 layer／timestamp 規則。 |
| RULE-QUESTION-017 | 變裝繼承哪些使用次數、來源能力身份與限次記錄？ | p.18 說繼承狀態及外來能力／效果，p.24 限每回合使用／發動 | 阻擋限次能力與變裝組合；不因換 definitionId 就重設全部，也不全盤沿用。 |
| RULE-QUESTION-018 | 多角色同時登場超容量，能選哪些卡 Switch、何時移除、與 MR 登場移除誰先？ | p.12、24 確認同時登場存在，p.26 確認 MR 規則，無完整批次演算 | 阻擋批次溢出／多 MR 同時登場；需具體官方例子。單卡普通 Switch 可獨立設計。 |
| RULE-QUESTION-019 | 對手回合新 MR 登場造成舊 MR 移除後立即回 Partner，是否再觸發移除？MR 變裝／下疊又如何交互？ | p.26 的兩條 MR 規則及 p.18、23 未詳列交互 | 阻擋這些 MR 組合；不能用「全域最多一張 MR」直接解決。 |
| RULE-QUESTION-020 | MR 立即轉區、Refresh、replacement／negation 同時遇到時，優先順序是什麼？ | p.20、22、26 各自要求立即，未完整排序 | 阻擋競合事件；不能依程式 handler 註冊順序決定。 |
| RULE-QUESTION-021 | 自己能否查看裏向 FILE／Evidence、牌庫等資訊？各區數量／過去公開資訊的完整可見性？ | p.8 手札對手不可見、p.23 裏向 Set 不可看、p.25 底部順序不必公開；沒有通用資訊公開表 | 阻擋完整 PlayerView 規則；工程需先保留逐位置權限，不將保守遮蔽宣稱官方裁定。 |
| RULE-QUESTION-022 | Event 會 Set／移到其他位置時，處理中位置、效果完成与其他觸發、Refresh 如何交錯？ | p.20 一般 Event 解決前不在 Remove；p.23 有 Set 例外 | 阻擋複合 Event 目的地與結算時點；需實際卡文，不能無條件最後再放 Remove。 |
| RULE-QUESTION-023 | 回合／Action 結束效果失效又造成新觸發時，是否重開結算或結束窗口？循環如何處理？ | p.10、17、19 有結束先後，未提供一般清理循環／循環裁定 | 阻擋該邊界；engine step 上限只能形成技術暫停，不能判平手或強迫 pass。 |
| RULE-QUESTION-024 | 非標準 Action、由效果直接造成的 Contact 中，AP 平手回應方及 AP 判定主體如何指定？ | p.17 規定直接 Contact 到 Contact 結束，普通流程以 Action 方定義比較 | 阻擋缺少參與角色／判定方向的 effect Contact；需發起該 Contact 的官方卡文。 |
| RULE-QUESTION-025 | FILE 中 Partner 能否被 Active、推理或再使用 Partner 能力？Partner 的可選區域／狀態邊界？ | p.10、13、15 說明一般流程，未回答所有效果交互 | 阻擋這些 Partner 特殊操作；保留實體位置與朝向，不能只看永久 partnerId。 |
| RULE-QUESTION-026 | p.8 提到的特徴「ビッグジュエル」等 Partner 區特殊卡如何進出、計數及使用？ | 手冊只有區域列舉，沒有完整卡文 | 阻擋相關特殊卡；Partner 區必須容許額外實例，不可固定單卡槽。 |
| RULE-QUESTION-027 | 一般離場重入、轉區後哪些 modifier／朝向／限次記錄／公開狀態重設或保留？ | p.18 明訂變裝繼承，p.23 明訂附件清理；沒有完整跨區重設表 | 阻擋跨區身份與效果延續；可保存實卡 ID 與進場 occurrence，但不要自動全清／全留。 |
| RULE-QUESTION-028 | 效果賦予重複關鍵字，特別多個 Mislead X／同名關鍵字，是否累加或各別使用？ | p.25 說多張 Mislead 角色可同時用，未說同一角色多個版本 | 阻擋重複 keyword 組合；不能用 set 去重或數值加總自行決定。 |

### RQ-011 已確認的實作契約

1. action／effect／atomic rule step 途中發動的一般效果先保存為 Pending Effect。
2. 當前單位完整結束後進 resolution checkpoint；官方 p.15–17、19 箭頭均為 checkpoint。多指令 effect 中間不插普通效果。
3. 同方任選自己的未解決效果，無觸發先後限制。
4. 有回合方 pending 時優先給回合方；其沒有 pending 才給非回合方，每個效果完成後重新計算。
5. 已觸發效果不因來源離場或能力後來失效而消失。結算時需要未知目標／來源讀值仍受 012／014 阻擋，不能自行補 last-known-value。
6. 「代わりに～」「無効にする」屬 immediate replacement／negation，不進普通 queue。本輪沒有完整即時效果 handler；此類內容明確拒絕，競合 003／020 仍未解決。

RQ-025 **仍為 BLOCKING**：只允許 Assist 後位於 FILE、計入 count、Next Hint 跳過該 Partner，以及自己下一 Auto 第一步返回並 ACTIVE。FILE Partner Ability／推理／重新 Active 後的額外行為回 UnsupportedRule／RULE_QUESTION_025，不做預設裁定。

### 未解答問題的工程處理

完整卡表提案以 supportStatus 與 ruleQuestionIds 宣告未支援範圍；目前有限 Content profile 使用 support=VERIFIED_CORE 與嚴格欄位／opcode 白名單，並未實作整份提案。未審核 program 不可當成無效果卡進正式規則運算。若執行中才遇到未定互動，保存 RULE_BLOCKED、受影響問題、完整程序 cursor 及既有事實，不推進有歧義的步驟、不代選、不判負。

這個暫停是設計用的缺規則狀態，**不是官方遊戲中的平手／敗北**。恢復需要可追溯規則版本與相容性檢查；不得在同一 Replay 偷換程式定義。未涉問題的已確認規則仍可列入第一階段測試，不必等所有卡片資料齊全才驗證基本 invariant。

## 5. 本階段完成邊界

Phase 1 從原 89 項測試選出 28 組 P0，建立有限核心。不以「測試全過」宣稱完整遊戲規則已完成。

Phase 2 移除 RQ-011 的 Auto 阻擋，改用已確認 checkpoint。002、009、012、013、014、023、025、027 仍透過 UnsupportedRule／RULE_BLOCKED 或內容／快照驗證防止未定行為。這些 gate 是工程處置，不是遊戲裁定。沒有建立 React UI、帳號、Server 或 Online Multiplayer。

## 7. Phase 3A 實作界線（ENGINE ARCHITECTURE）

本節是工程範圍記錄，沒有增加官方裁定。RQ-002、009、012、013、014、023、025、027 仍是 BLOCKING；28 題原文與分類不變。[裁定準備文件](rule-adjudication-phase2.md) 保留為歷史分析，其中 ENGINE-PROPOSAL 不自動成為規則。

| 功能／來源 | 本輪明確支援 | 未自行延伸 |
| --- | --- | --- |
| Identity | CardDefinition／CardInstance／FieldEntry，Disguise 專用 occurrence 與 lineage | 新 ID 不意味 Turn1、modifier、target 或 usage 重設；RQ-014／027 |
| Cut-in，DR-11／12；p.12、17–18、20–21 | 每 Contact 每方最多一次 Cut-in 或 Disguise；選一能力、先 Remove、Case 色限制不適用、失效 Cut-in 可用但不執行無效效果；來源遭 Refresh 仍解決 | 不提供自由回應 stack 或一般 ability-validity 層 |
| Disguise，DR-12；p.18、21 | 舊卡裏置牌庫底、新卡接續；繼承朝向／received effects／grants／Set／under；不是登場；觸發變裝時；失效能力不可用 | 跨色／超 Level 的可用性 RQ-010；MR RQ-019；一般重入 RQ-027 |
| Keyword，DR-02／10／16；p.25 | 八種指定 keyword；固定 X、TRACE 玩家事實、對手選 Investigate 底序 | 重複 keyword RQ-028；其餘 keyword、任意条件與動態數值未載入 |
| MR，DR-09／16；p.14、26–27 | 正常登場移除既存 MR；對手回合先原目的區再立即 Partner；只開明列區域的能力 | 沒有全域 MR≤1；RQ-018–020 組合不猜；正式卡文 RQ-004 |
| 有限 MR declaration | 明列 OWN_MAIN／NONE 成本／FIELD 或 MR PARTNER 的合成 descriptor，依 programId 執行 | 不是賦予每張 MR 任意能力；其他窗口、成本／Turn1、能力次數未支援 |
| DSL，DR-13–16；p.20–23 | 有限 opcode，明列來源、目標時點／區域、duration、無效目標處置 | 通用選卡、跨區重綁、未知來源讀取、一般重入等內容拒絕載入 |
| Duration，DR-04／11／13／15；p.10、17、19 | UNTIL_CONTACT_END／UNTIL_ACTION_END／UNTIL_TURN_END 的簡單加減 modifier 到期 | expiry trigger／循環／正在關閉 scope 重建仍 RQ-023 |
| Set／under，DR-16；p.23 | 分開容器、宿主普通離場附件到 Remove、Disguise 特例继承；Set 牌庫續行見 p.20 | 現場宿主變 underneath 的通用操作未支援；不讀 facedown 附件的印刷類型來選取 |

一般觸發仍依 RQ-011：完整 action／effect／atomic rule step 後 checkpoint；同方任選、回合方有 pending 時優先，之後重新計算。來源離場／能力失效不抹掉已觸發效果。INDEPENDENT program 無須再讀來源；需要原 FieldEntry 的 program 遇未知跨區讀值則明確阻擋 RQ-014。

Mislead 的已付 X、Investigate 的固定能力文字在本 profile 不能被任意動態改值；保存的 grant 也不提供通用增刪 opcode。這個有限條件允許已觸發調查於印刷能力失效後續行，並不裁定可变 X、來源最後資訊或 re-entry 的一般語義。

命令預先驗出未決規則時回 UnsupportedRule／RULE_QUESTION_XXX，保持狀態、RNG 與使用機會；自動程序遇未決互動時保存 RULE_BLOCKED、既有事實及 cursor，不猜測繼續。所有八題 BLOCKING 的具体界線與測試位置見 phase3a-results.md。
