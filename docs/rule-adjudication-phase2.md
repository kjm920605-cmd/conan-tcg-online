# Phase 2 規則裁定準備文件

整理日期：2026-09-06。範圍僅為 RQ-002、009、012、013、014、023、025、027；八題維持 BLOCKING，本文件不作裁定，也不修改程式、測試或既有規則登錄。

最高來源：[官方 Ver.2.5 規則書](reference/rule_manual.pdf)，27 頁，SHA-256：2a3caf3372e66656cd9ac0c5ba9dc8fc4177c176317f4f97086975c1c9e65d41。下列頁碼指 PDF 檔案頁序，與印刷頁碼一致。日文摘錄逐頁以影像核對；僅合併排版換行，圖示中的可讀名稱以文字轉錄，省略振假名與色彩，不將中文解釋放入日文引文。

「問題」逐字保留 [digital-rules.md §4 RULE-QUESTION 完整登錄](digital-rules.md) 的問題欄。觸發情境使用 A／B 玩家及 X／Y／G 等合成角色；涉及尚未支援的效果、批次操作或修正層時，僅為待裁定 fixture，不宣稱已有某張正式卡能產生該情境。

所有 **ENGINE-PROPOSAL** 都是待採用的工程方案，不是官方規則，也不表示已實作。本文所稱「可工程化暫解」僅指隔離、拒絕、保存診斷與版本管理，**不表示能在缺裁定時繼續推定遊戲結果**。Phase 3 尚無已核定範圍，末表依是否納入受影響互動作條件式判斷。

共同 fail-closed 原則：命令在接受前就能確認涉及未決規則時，以 UnsupportedRule／相應 RULE_QUESTION_XXX 拒絕，狀態、RNG 與使用記錄不變；若已在合法流程中遇到未決互動，保存 RULE_BLOCKED、問題與既有事實，停在第一個需要猜測的步驟，不回滾已合法完成的成本或移動，也不自動 pass、跳過效果或判勝敗。此為工程隔離，不是官方平手／非法行動裁定。

## RQ-002

### 問題

> 同時終局、雙方同時需 Refresh 且無法完成，如何決定結果／平手？

### 觸發情境

1. 一個待裁定的批次效果結束時，A、B 的 Deck 同時為 0 張，Remove 也都為 0 張，兩方都出現「需要 Refresh 且沒有可重建牌庫的卡」的條件。這是尚未支援的批次 fixture；不能把引擎迴圈先遍歷 A 當成 A 先敗北的規則。
2. 未來效果使同一規則邊界出現互斥的勝敗候選，尚不能從卡文判斷它們有先後。需要辨別真正同時成立，或其實應逐項立即處理，不能先假設是平手。
3. **對照情境，不屬於自動阻擋理由**：A Deck=0、Remove=3，B Deck=1、Remove=0。A 先成功重建牌庫，接著 B 因 Refresh 的證據獲得移走最後一張而需要 Refresh；這有先後續行，與雙方同時空庫不同。

### 官方規則書相關內容

- **PDF p.9，「ゲームの勝利条件」註記**：

  > プレイヤーがリフレッシュ（→20ページ）を行う際、リムーブエリアのカードが0枚だった場合、そのプレイヤーはゲームに敗北します。

- **PDF p.13，「事件解決」手順**：

  > 「事件解決」を宣言し、パートナーをスリープさせます。自分の「事件」の事件レベルの数以上の「証拠」が集まっている場合、ゲームに勝利します。

- **PDF p.20，「リフレッシュ」**：

  > デッキのカードがなくなった場合、即座に「リフレッシュ」を行います。

  > 「リフレッシュ」は、行動の途中や効果の解決中でもデッキがなくなった時点で行います。（その後で行動や効果の解決を再開します。）

  > 手順①：「リムーブエリア」のカードをシャッフルしてデッキに置きます。
  >
  > 手順②：相手は「証拠」を1つ得ます。

- **digital-rules.md 對應**：[DR-03 Setup 與勝敗、DR-14 Refresh、§4 RQ-002](digital-rules.md)。
- **game-flow.md 對應**：[§3 狀態分層的 Outcome／Rule block、§9 Refresh interrupt 與恢復、§11.3 待裁定測試](game-flow.md)；REFRESH.REBUILD／PENALTY、FINISHED／RULE_BLOCKED。

### 官方規則目前能確認的部分

- 牌庫用盡立即 Refresh，不等下一次抽牌失敗；可以中斷當前行動／效果，之後返回。
- 個別玩家進行 Refresh 時 Remove=0，該玩家敗北。
- Refresh 的順序是重建己方牌庫，再由對手取得一張 Evidence。
- 事件解決有自身的宣告、Sleep 與證據數量判定；不是 Evidence 一達門檻就自動勝利。
- p.22 的回合玩家優先是普通未解決效果的解決順序，不能直接當成所有即時勝敗候選的仲裁規則。

### 官方規則目前無法確認的部分

- 真正同時成立的雙方敗北、勝敗衝突，應判誰勝、誰敗或平手。
- 如何辨認未來批次效果的勝敗條件是同時成立還是必須依明定順序逐項檢查。
- 同時有多個立即規則與終局候選時，是否有通用優先序；不能由玩家 ID、座位或 handler 排序補出。

### 對 Engine 的影響

| 面向 | 受影響內容 |
| --- | --- |
| state | status、outcome、blocked、雙方 Deck／Remove 狀態；同時候選不能被先寫入的 outcome 蓋掉。 |
| action | SOLVE_CASE 或未來可能產生勝敗條件的行動，終局邊界需與普通 checkpoint 區分。 |
| effect | 批次操作及立即規則可能產生多個終局候選；EffectQueue 優先權不能代替終局裁定。 |
| target | 需辨別每個候選影響的玩家及條件來源；不能固定把先遍歷玩家視為 loser。 |
| zone movement | Deck 最後一張移出、Remove→Deck、對方 Deck→Evidence 與巢狀 Refresh 的順序。 |
| serialization | 保存全部已知候選、正在執行的 REFRESH／MOVE 與 remaining；未裁定時不編造 outcome。 |
| replay | 固定規則版本、RNG 及候選成立順序；舊 replay 不可套用新裁定後默默換贏家。 |
| tests | 保留個別敗北／巢狀 Refresh 正常案例，另區分真正同步 fixture；既有關聯為 P0-14、19、UT-050、057、088。 |

### Proposed Implementation

**ENGINE-PROPOSAL**

用可序列化的 terminal candidate 記錄候選玩家、原因、因果事件與規則邊界。這是證據容器，不負責決定勝敗。僅在某一候選的先後與結果已受官方條文支持時提交 outcome；若候選衝突而無已確認裁定，保留 RQ-002。

裁定取得後再為該情境加入具名、版本化的 adjudicator，附來源及測試。不要設「回合玩家先敗」「平手」「先觸發先判」等預設策略。現有依序巢狀 Refresh 可繼續維持已確認的續行程序。

### 如果暫不裁定

維持雙方同時空庫等未定狀態的 RULE_BLOCKED，outcome=null；損壞或不相容快照明確拒絕。停止有歧義的洗牌、證據獲得或判勝，不消耗額外 RNG。不因「涉及兩人 Refresh」就擴大阻擋已知有先後的正常巢狀流程。

### 需要新增的測試

- UT-Q-002-01：雙方 Deck／Remove 同時為 0 的合法性及最終結果，expected 只能依取得的裁定填入。
- UT-Q-002-02：交換玩家 ID、座位、候選記錄順序，結果只受官方裁定指定的因素影響。
- UT-Q-002-03：同一邊界勝利與敗北候選衝突，測官方指定優先序；終局只提交一次。
- UT-Q-002-04：有明確先後的巢狀 Refresh 對照，同步仲裁不能改壞既有結果。
- UT-Q-002-05：阻擋快照還原、RNG cursor、未執行移動及重播版本一致；新裁定不靜默遷移舊 replay。

## RQ-009

### 問題

> FILE 只有 Assist Partner 時，可否宣告只獲得使用機會的 Next Hint？

### 觸發情境

A 的 Main 空閒，Partner 已 Assist 並以 SLEEP 位於 FILE；FILE=[Partner]、FILE count=1，沒有其他 FILE 卡。A 手上有一張符合 Case 顏色、Level=1 的合成 Character，提出 NEXT_HINT。

Partner 明確不能被取回，但 FILE 又不是空的；未定點是能否略過沒有合法取卡對象的第一步，直接得到第二步的使用機會，而非 Level 或顏色是否通過。

### 官方規則書相關內容

- **PDF p.12，「02.ネクストヒント」手順**：

  > 手順①：自分の「FILEエリア」の1番上にあるカード（アシストしているパートナーを除く）を手札に加えます。
  >
  > 手順②：手札から自分の「FILEエリア」にあるカードの枚数以下のレベル（カード左上の数字）のカードを1枚使用できます。

- **PDF p.12，同節 Point**：

  > ②で使用できる手札は「ネクストヒント」1回につき1枚です。使用しないことも選択できます。

  > 「FILEエリア」にカードがない場合は「ネクストヒント」を行えません。

- **PDF p.11，「01.手札の使用」的使用限制**：

  > このターン中に「ネクストヒント」を行っていた場合は行えない

- **PDF p.13，Assist 手順①的括註**：

  > （ここにいる間は「FILEエリア」にあるカードの枚数として数えます。）

- **digital-rules.md 對應**：[AUDIT-11、DR-05 通常手札使用、DR-06 Next Hint、DR-08 Partner、§4 RQ-009](digital-rules.md)。
- **game-flow.md 對應**：[Phase 2 流程與 checkpoint、§5 Main 子程序的 Next Hint、UT-014–019](game-flow.md)；NEXT_HINT.TAKE→CHECKPOINT→NEXT_HINT_CARD。

### 官方規則目前能確認的部分

- 真正空 FILE 不可 Next Hint。
- Assist Partner 計入 FILE 張數，但不屬於 Next Hint 可以拿回的卡。
- 一般 Next Hint 先取卡，再選擇是否使用一張手牌；可選擇不用，不能保存本次使用機會到以後。
- Level 按拿取後 FILE 張數判定，使用仍受 Case 色限制。
- 做過 Next Hint 的回合不能再做通常手札使用。

### 官方規則目前無法確認的部分

- FILE 只剩 Partner 時，第一步無可取卡是否直接禁止宣告。
- 若允許宣告，是否可以跳過第一步、給第二步機會，及這是否算「已進行 Next Hint」。
- p.22「盡可能執行」的效果文字通則是否適用於這個 Main 行動的宣告資格；不能自行把行動程序當成一般效果。

### 對 Engine 的影響

| 面向 | 受影響內容 |
| --- | --- |
| state | turn.usedNextHint、FILE count、choice 與 NEXT_HINT frame 是否建立。 |
| action | NEXT_HINT 的接受／拒絕與之後 PLAY_CARD 的可用性。 |
| effect | 若沒有取卡，是否有可成立的取卡事件／觸發；不得虛構 NEXT_HINT_TAKEN。 |
| target | 非 Partner 的合法 FILE top 候選為空，不能用 Partner 補位。 |
| zone movement | FILE→HAND 是否有實際移動；Partner 必須留在 FILE。 |
| serialization | 保存「尚未接受」與「已接受但沒有移卡」的區別，不能只看 FILE 非空還原 choice。 |
| replay | 宣告是否消耗本回合通常用牌資格必須隨 ruleset 固定，命令重送不能重開機會。 |
| tests | 既有 P2-04 是 UnsupportedRule 邊界，不能當成官方禁止此行動的 expected；關聯 UT-018。 |

### Proposed Implementation

**ENGINE-PROPOSAL**

將宣告資格表示為「已確認可用／已確認不可用／需裁定」三態，FILE 僅 Partner 保留第三態。未來若官方允許沒有取卡的 Next Hint，才新增明確的 no-card 分支，且只記錄實際發生的事件；若官方禁止，改成該裁定所支持的規則性拒絕。

這兩條分支都是待官方選定的可能實作，不設預設答案；不能以 collection.find() 回傳空值直接替遊戲作裁定。

### 如果暫不裁定

沿用 UnsupportedRule／RULE_QUESTION_009，整個命令原子拒絕。FILE、Hand、Partner、usedNextHint、normalPlayUsed、choice、RNG 均不變；不給用牌機會，也不因技術拒絕把正常手札使用封鎖。

### 需要新增的測試

- UT-Q-009-01：FILE=[Partner]，依裁定驗證 NEXT_HINT 可否接受。
- UT-Q-009-02：若允許，驗證零移卡情況的 0/1 張使用機會、事件內容與 usedNextHint；若禁止，驗證正確拒絕類別及原子性。
- UT-Q-009-03：FILE=[]、[Partner]、[Partner, Character] 三種狀態不能混為一種 eligibility。
- UT-Q-009-04：若可用，取卡不存在時仍按官方指定 FILE count 與 Case 色驗證，不虛構免費使用。
- UT-Q-009-05：在新分支 choice 中序列化／重播；重複指令不給第二次機會，Partner 不進 Hand。

## RQ-012

### 問題

> 推理來源在結算證據前離場，LP 用哪個值？逐張獲得中 LP 改變時是否重算剩餘量？

### 觸發情境

1. A 的成熟角色 X 為 ACTIVE、LP=2。A 宣告推理並 Sleep；宣告後 checkpoint 解決一個已觸發效果，使 X 由 FIELD→REMOVE。DEDUCTION 保存 sourceId=X，但尚未 CALCULATE_LP／取得 Evidence。
2. 待擴充的修正 fixture：推理開始獲得證據時 X 的 LP=3，Deck 剩一張；已取得一張後立即 Refresh，其間若某個已獲官方支持的即時處理或持續能力變化改變 X 的 LP，剩餘量如何處理仍待確認。**不是允許普通 pending 在每張 Evidence 之間插入解決**。
3. 若 X 離場後同一實卡再進場，是否仍是這次推理的來源，同時牽涉 RQ-014／027；不能只靠 instanceId 相同認定續行。

### 官方規則書相關內容

- **PDF p.15，「05.推理」宣告及證據獲得**：

  > 「推理」を宣言し、推理するパートナー／キャラをスリープさせます。

  > 推理したパートナー／キャラのLP（カード右下の鍵穴の数値）だけ「証拠」を得ます。デッキのカードを上から「証拠エリア」に裏向きのまま置きます。

  > LPが0以下の場合は「証拠」を1つも得ません。

  > 1回に2つ以上得る場合も、「FILEエリア」と同様に1枚ずつ置きます。

- **PDF p.15，手順前說明**：

  > 途中でキャラの能力が発動した場合、項目と項目の間（矢印のタイミング）で効果を解決してから次に進みます。

- **PDF p.20，逐張取得途中 Refresh**：

  > これらの効果の解決の途中でデッキのカードがなくなった場合、「リフレッシュ」を行ってから残りの枚数分を解決します。

  上述段落列出的項目含「カードを引く」「証拠を得る」「FILEエリアに置く」「デッキの上からセットする」。

- **PDF p.25，Mislead 補註**：

  > LP－Xするのは、その「推理」の終了時までです。

- **digital-rules.md 對應**：[DR-10 推理、DR-14 Refresh、DR-15 效果語義與排程、§4 RQ-012／014](digital-rules.md)。
- **game-flow.md 對應**：[§6 推理狀態機、§3.1 Frame 與續行資料、§9 Refresh interrupt 與恢復](game-flow.md)；DEDUCTION.CALCULATE_LP、GAIN_EVIDENCE、MOVE.remaining、REFRESH。

### 官方規則目前能確認的部分

- 推理宣告會 Sleep；Mislead 在 Evidence 獲得之前處理，減值有效到本次推理結束。
- Evidence 數量依推理 Partner／Character 的 LP；LP≤0 獲得零張。
- 多張 Evidence 逐張放置，後放的在上。
- 一般觸發在官方流程項目間解決；即時 Refresh 可中斷取得步驟，再續做剩餘數量。
- p.22 保留已發動「效果」的規則，不能直接擴張成推理來源離場時必定使用最後已知 LP 或必定繼續推理。

### 官方規則目前無法確認的部分

- 來源在 Evidence 計算前離場，推理是否繼續，以及若繼續該讀哪個 LP。
- LP 是哪個時點取一次、是否綁定原在場角色，而非同張實卡在新區域的數值。
- 已開始逐張獲得後 LP 變動，剩餘量是否重新計算；若新值低於已取得數量，如何處理已取得部分。
- 來源離場後重入是否恢復本次推理的來源資格。

### 對 Engine 的影響

| 面向 | 受影響內容 |
| --- | --- |
| state | DEDUCTION.sourceId、calculatedLP、lpReduction、misleadIds、MOVE.remaining。 |
| action | DEDUCE 是否提前結束、何時送出 DEDUCTION_ENDED。 |
| effect | LP 修正、Mislead、來源離場觸發、Refresh 中的即時處理與持續能力。 |
| target | 本次推理來源身份與數值讀取對象；與 RQ-014 的綁定規則相接。 |
| zone movement | FIELD→REMOVE／其他區，以及 Deck→Evidence 的已完成張數與後續量。 |
| serialization | 保存計算是否完成、採用的規則版本與已取得數量，不能用 null 自動轉成 0。 |
| replay | 同一指令序列的證據量及 RNG 消耗取決於採樣策略，必須固定在 ruleset／program 版本。 |
| tests | 既有 P2-24 阻擋來源離場；P2-14／26 驗證正常逐張 Refresh。關聯 UT-029–031、049–052、078、088。 |

### Proposed Implementation

**ENGINE-PROPOSAL**

保存來源引用與規則邊界，將 lpReadPolicy、sourceDeparturePolicy 與 quantityPolicy 視為需要官方證據才能啟用的規則參數。尚未取得裁定時不填「宣告時值」「最後已知值」或「當前值」作預設。

裁定後，若需要保存一次取樣值，另存取樣事件及值；若需要動態計算，則保存已完成量與官方指定的重算邊界。兩者皆不能在 restore 時重跑已完成移卡。現有固定印刷 LP＋本次 Mislead 的有限路徑只覆蓋沒有此歧義的情境。

### 如果暫不裁定

來源在 CALCULATE_LP 前不在已知合法位置時，維持 RULE_BLOCKED／RULE-QUESTION-012；不取得猜測數量的 Evidence，也不自動宣布推理結束。未確認的中途 LP 修正內容不載入；若之後執行中遇到，停在需重算的邊界，保留已合法取得的卡、順序與 RNG，不回收或補發。

### 需要新增的測試

- UT-Q-012-01：宣告後來源離場、Mislead 後來源離場，分別驗證官方指定的推理續行與 LP。
- UT-Q-012-02：若 LP 有指定取樣時點，取樣前／後改變 LP 的結果不能混淆。
- UT-Q-012-03：取得一張後遇 Refresh 且合法修正改變 LP，驗證剩餘量及已完成部分；與普通 pending 延後解決作對照。
- UT-Q-012-04：LP 降到 0、負值、低於已取得張數，以及增加時的官方結果。
- UT-Q-012-05：同張實卡離場重入與替代來源，按 RQ-014／027 裁定驗證來源身份。
- UT-Q-012-06：在未取樣、已取樣、移動中、Refresh、RULE_BLOCKED 各點保存／還原；不重複獲得 Evidence。

## RQ-013

### 問題

> Guard 後、Contact 前 Guard 者離場，或 Case Evidence 在移除步前已歸零，如何續行？Guard 前提前終止是否仍發動 Action-end 能力？

### 觸發情境

1. A 以 X 攻擊 B 的 SLEEP 角色 Y；B 以 ACTIVE 角色 G Guard 並 Sleep。Guard 後 checkpoint 的已觸發效果使 G 離場；Contact 尚未發生。
2. A 以 X 對 B 的 Case 宣告 Action，當時 B Evidence=1。進入 Case 分支的取證據步驟前，待擴充的效果 fixture 已把該證據移走，使 Evidence=0。
3. A 宣告後、Guard 之前，X 或原目標 Y 離場。官方已說 Action 此刻結束；未定的是此種提前結束是否還走一般 Action-end 能力與清理時序。
4. **已確認的對照**：Contact 已開始後 G 離場；或未被 Guard 的 Case 分支已開始後 X 離場。兩者各有明文，不應一起歸為未知。

### 官方規則書相關內容

- **PDF p.16，Action 頁底註記**：

  > 「ガード」までの間にアクションしたキャラやアクションで指定した相手のキャラが現場を離れた場合、アクションはその時点で終了します。

- **PDF p.16，Case 目標限制**：

  > 「証拠」が1つもない事件は指定できません。

- **PDF p.17，Guard 成功後的分支**：

  > アクションしたキャラと、ガードしたキャラの間で「コンタクト」が発生します。

- **PDF p.17，「コンタクト」の終了旁註及 Action 結束**：

  > コンタクト中のいずれかのキャラが現場を離れた場合、その時点でここまで進めます。

  「ここまで」指圖中的「コンタクト」の終了，不是指重新 Guard 或直接做 AP 判定。

  > アクション終了時の能力が発動し、効果を解決します。アクション中の効果が切れます。

- **PDF p.19，未被 Guard 的 Case Action 分支**：

  > 相手の1番上の「証拠」をリムーブします。

  > 自分は「証拠」を1つ得ます。

  > アクション中のキャラが現場を離れても、ここまで進めます。

  最後一句位於該分支「アクションの終了」旁。該頁另明列ヒラメキ的選擇／解決及之後才把該卡放入 Remove 的步驟。

- **digital-rules.md 對應**：[AUDIT-06／07、DR-11 Action、Guard、Contact、DR-13 未被 Guard 的 Action[事件]、§4 RQ-013](digital-rules.md)。
- **game-flow.md 對應**：[§7 Action／Guard／Contact 狀態機的 Early、§7.1 Case Action 分支](game-flow.md)；ACTION.GUARD_WINDOW／AFTER_GUARD、CONTACT、CASE_ACTION.TAKE_EVIDENCE。

### 官方規則目前能確認的部分

- Guard 前的指定範圍內，攻擊者或原角色目標離場，Action 當場結束，不繼續 Guard／Contact／AP。
- 已成功 Guard 的一般情形，Contact 是攻擊者與 Guard 者之間，不是原目標 Y。
- Contact 中任何一方離場，前進到 Contact 結束；不能繼續尚未做的 AP 判定。
- 宣告 Case 目標時，該 Case 必須有 Evidence；一般未被 Guard 分支移除頂部一張，自己取得一張。
- 已進入 p.19 分支後，攻擊角色離場不取消該分支剩餘流程。
- 一般 Action 結束有能力解決，再使 Action 期間效果失效的步驟。

### 官方規則目前無法確認的部分

- Guard 已付成本但 Contact 尚未開始，Guard 者離場後是終止、仍視為 Guard、回到原目標或有其他程序。
- Case 合法指定後、取證據之前變成 Evidence=0，是否仍取得己方 Evidence，是否跳過某步及如何結束。
- p.16 的提前終止是否仍發動／解決全部 Action-end 能力，以及何時使各期間效果失效。
- 其他跨 Guard／Contact 邊界的參與者失效，是否可直接套用上述某一特定條文。

### 對 Engine 的影響

| 面向 | 受影響內容 |
| --- | --- |
| state | ACTION 的 target、guardId、step，以及是否已建立 CONTACT／CASE_ACTION。 |
| action | Action 提前結束、Action-end 事件、Guard 是否能重選及後續分支。 |
| effect | Guard／Contact／Action-end 觸發及期間效果的清理；不能以共用 cleanup 產生未確認觸發。 |
| target | 原目標、Guard 者、實際 Contact 對手，必須保存為不同角色；不能自動 retarget。 |
| zone movement | Guard 者離場、Evidence→PROCESSING→REMOVE、己方 Deck→Evidence；不能憑空移除不存在的卡。 |
| serialization | 保存離場發生的精確邊界、原目標與 Guard 成本事實；restore 不把 AFTER_GUARD 當 MAIN。 |
| replay | 是否發出 CONTACT_STARTED／ACTION_ENDED、證據及 RNG 消耗，都依裁定分支決定。 |
| tests | P2-24 現有 Guard 邊界阻擋；P2-23 為已進 Contact 的已知離場。關聯 UT-035、041、045、078、088。 |

### Proposed Implementation

**ENGINE-PROPOSAL**

以具名邊界及 terminationReason 區分 PRE_GUARD_SOURCE_LEFT、POST_GUARD_GUARD_LEFT、CASE_EVIDENCE_MISSING 與 CONTACT_PARTICIPANT_LEFT。記錄名稱只是描述事實，不決定是否觸發 Action-end。

裁定後建立各邊界的續行表，分別指定：是否建立 Contact、實際對手、是否取得 Evidence、哪些結束能力／期間清理需要執行。未知表格儲存 UNRESOLVED，不用「一律 Action-end」或「一律回原目標」作通用處理。

### 如果暫不裁定

對未確認的 Guard 後、Contact 前及取證據前歸零情境維持 RQ-013 阻擋。Guard 前已知應終止者，不再開 Guard／Contact／AP；在是否發動 Action-end 的未定步驟前保留 RULE_BLOCKED，不假裝已完成所有清理。

保留已付的 Sleep、已移動的卡與既有 pending；不退款、不重選 Guard、不自動攻擊原目標、不補證據。已進 Contact／Case 分支的明確離場規則照常執行，不能因本題存在就一概阻擋。

### 需要新增的測試

- UT-Q-013-01：Guard 前攻擊者／原目標離場，按裁定驗證 Action-end 能力與期間清理；不得出現 Contact／AP。
- UT-Q-013-02：Guard 後 G 離場、攻擊者離場及原目標離場，分別驗證實際對手與續行，不自動合併。
- UT-Q-013-03：Case 指定時 Evidence=1、取卡前變成 0，依裁定驗證移除／己方取得／Action-end。
- UT-Q-013-04：已進 Contact 的離場與已進 Case 分支的攻擊者離場維持官方已知行為。
- UT-Q-013-05：每一終止原因只發出裁定允許的結束事件一次；不重付 Guard 成本。
- UT-Q-013-06：在邊界 checkpoint 與阻擋點序列化／重播，原目標、Guard、PROCESSING 與剩餘步驟一致。

## RQ-014

### 問題

> 一般效果選目標在何時，目標移區／離場重入後還算原目標嗎？能否重選，來源數值如何讀？

### 觸發情境

1. X 的兩個一般效果已觸發並成為 pending。先解決的效果使 X 離場，第二個效果只要求「抽一張」：來源離場本身不取消這個已觸發效果，這是已知對照。
2. 同樣先使 X 離場，但第二個效果需要改變 X 的狀態或讀 X 的 LP；此時不能只因 pending 還存在，就推定 Remove 中的 X 是可操作目標或可讀原在場數值。
3. 待擴充的選目標 fixture：一個效果要選 Field 角色 Y，從觸發到解決之間 Y 先回 Hand、再以同張實卡登場。若程序曾保存 Y，是否仍綁定它、是否另選，以及到底應何時選，都缺通用規則。
4. 效果中的「若……」或「可以……若如此……」與選目標可能有依存順序；前者有解決時確認的明文，不等於所有目標也已被指定在同一時點選。

### 官方規則書相關內容

- **PDF p.22，「能力／効果のテキスト」**：

  > 「～する」と書かれている効果は必ず行います。（一部を解決できない場合、可能な限り行います。）

  > エリアの指定なく「キャラ」とだけ書かれている場合は「現場」にいるキャラを指します。

  > 「キャラを～枚まで選び」と書かれている効果では、指定のないかぎりどちらの「現場」にいるキャラでも選べ、その効果を発動したキャラ自身も選べます。

- **PDF p.22，「発動した効果を解決するまで」Point**：

  > 未解決の効果に「～の場合」や「～してもよい。そうした場合、～」がある場合、それは解決する際に参照したり、するかどうか選択して実行します。

  > 効果が発動してから解決されるまでの間に、それを発動したキャラ自身が現場を離れたり、その能力が有効でなくなった（→21ページ）場合でも、その効果はそのまま解決します。

- **PDF p.20，Refresh 中來源卡的所在區域**：

  > カットインと現場リムーブ時は、そのカードがリムーブエリアに置かれた状態で効果を解決します。（シャッフルしてデッキに置かれるカードには含まれます。）

  此處「カットイン」「現場リムーブ時」在 PDF 為圖示文字；這段直接顯示效果未完成時來源實卡可能再被洗入 Deck。

- **digital-rules.md 對應**：[AUDIT-05、DR-09 宣言與成本、DR-14 Refresh、DR-15 效果語義與排程、§4 RQ-014](digital-rules.md)。
- **game-flow.md 對應**：[§3.1 EFFECT bindings／cursor、§8.1 一般未解決效果、§8.2 候選事件與已發生事件](game-flow.md)；EffectQueue、EffectResolver、來源引用與未來 target choice。

### 官方規則目前能確認的部分

- 沒有區域指定的「Character」指 Field；無己方限制的選擇可包含雙方合格角色及來源本身。
- 文字「若……」「可以……若如此……」的參照與是否執行，於解決時確認。
- 已觸發效果不因來源離場或原能力後來無效而自動取消。
- 已知效果應盡可能執行；但需要先知道某一對象是否合法、某一部分是否能做，才能套用「盡可能」。
- 普通 pending 的任選／回合方優先，以及即時 replacement／negation 的例外，依 p.22 與已解決 RQ-011 處理。

### 官方規則目前無法確認的部分

- 是否存在適用所有效果的統一選目標時點，或必須依每段卡文分別指定。
- 目標換區或重入後是否仍是原對象；同實卡 ID 與原場上角色身份的關係。
- 目標失效後能否重選、何時重選，以及多目標效果的有效部分如何與原選擇綁定。
- 來源數值、狀態或其他資訊在來源離場後應讀哪個版本；沒有通用 last-known-information 制度可直接套用。
- 原能力失效與明確使「效果」無效的差別，不能被「來源離場仍解決」擴張成效果永不會被無效。

### 對 Engine 的影響

| 面向 | 受影響內容 |
| --- | --- |
| state | PendingEffect.sourceId、EFFECT.effect／cursor，以及尚未建立的 bindings、選擇結果與來源讀值。 |
| action | 宣言或其他行動觸發效果後，是否需要 target choice、何時回到父程序。 |
| effect | 效果存續與來源操作合法性是兩個判斷；不能從 queue 刪除來源已離場的效果。 |
| target | 候選生成、選擇時點、失效檢查、多目標及重選規則均受影響。 |
| zone movement | 移區、重入、Refresh 洗回來源卡，不應默默把綁定指向另一個區域中的角色。 |
| serialization | 保存已選／未選、綁定身份與精確 instruction cursor；目前 cursor 是下一指令位置，不能誤讀成已完成效果數。 |
| replay | 選擇必須由命令記錄重演，不在還原時重新挑第一個候選或重新讀當前來源取代既存事實。 |
| tests | 來源離場／失效後仍解決已有 P2-07／16；新增 target 生命週期與讀值測試，關聯 UT-059–061、078、084、088。 |

### Proposed Implementation

**ENGINE-PROPOSAL**

在個別已審核 program 中明列 targetSelectionPoint、bindingPolicy、sourceReadPolicy 與 invalidTargetPolicy；這些欄位的值必須有卡文／裁定支持，沒有全域 fallback。

將實卡引用與「某次在場存在」引用分開，是保存事實的工程方法；是否視為同一規則對象仍由裁定決定。若官方要求取樣，保存明確取樣事件與資訊；若要求解決時選，才在該 instruction 建立 choice。保留 pending program 的獨立身份，不以來源區域變化取消它；不以一般 LIFO stack 模擬選擇時點。

### 如果暫不裁定

只載入目標／來源語義已確認的有限 opcode。DRAW 等不依賴來源仍在場的已觸發效果繼續正常解決；需要未知身份、目標重選或來源讀值時，保留 RQ-014 阻擋，不把整個效果當作失敗／no-op。

不讓任意 target ID 的指令繞過內容審核；不自動找同名卡、同 definition 或同實卡的新進場位置。保留已完成操作、pending、游標及診斷，未取得裁定前不解除 RULE_BLOCKED。

### 需要新增的測試

- UT-Q-014-01：各受裁定 program 的選目標時點，明確區分觸發時、解決時或文字指定的其他時點。
- UT-Q-014-02：目標移區、同實卡重入、同名但不同實卡，驗證官方指定的綁定身份。
- UT-Q-014-03：單一／多目標中部分失效，按裁定驗證重選、有效部分及後續指令，不自行套用整體失效。
- UT-Q-014-04：來源離場或被洗回 Deck 後，來源獨立效果繼續；需要來源數值的效果依明定讀值時點驗證。
- UT-Q-014-05：來源能力失效與明確效果無效分開測試；後者需有已確認卡文／裁定支持的即時 handler 規格。
- UT-Q-014-06：target choice、綁定後及來源移動後的快照／重播，候選、已選對象、部分完成進度不重算。

## RQ-023

### 問題

> 回合／Action 結束效果失效又造成新觸發時，是否重開結算或結束窗口？循環如何處理？

### 觸發情境

1. A 已做完 End 的回合結束能力；X 目前 AP=3000，其中 +1000 來自「到回合結束」效果。進入失效步驟後該修正移除；待擴充的效果 fixture 若因此產生新的普通觸發，需要知道何時解決，能否直接交回合。
2. Contact 的暫時 AP 修正在 Contact 結束失效；若失效產生新觸發，而父 Action 尚未完成，需確認新觸發相對於 Action-end 的位置。Action 期間效果失效也有同類邊界。
3. 待裁定循環 fixture：到期失效產生效果，新效果又建立在同一結束邊界到期的修正，可能再次觸發。這描述待確認的效果互動，不宣稱某張正式卡具備它；也不能僅因自動步數多就認定官方無限循環。

### 官方規則書相關內容

- **PDF p.10，「エンドフェイズ」**：

  > ① ターン終了時の能力が発動し、効果を解決します。
  >
  > ② ターン終了時までの効果が切れます。
  >
  > ③ ターンエンドを伝えて相手のターンに移ります。

- **PDF p.17，「コンタクト」の終了與「アクションの終了」**：

  > カットインによるAP＋など、コンタクト中の効果が切れます。

  > アクション終了時の能力が発動し、効果を解決します。アクション中の効果が切れます。

- **PDF p.19，Case Action 的結束亦明列相同步驟**：

  > アクション終了時の能力が発動し、効果を解決します。アクション中の効果が切れます。

- **PDF p.22，普通效果待解決時序**：

  > 行動の途中や効果の解決中に効果が発動した場合、それは現在の行動や効果の解決が完了したら解決できるようになります。（それまでは「未解決」の状態となります。）

  該頁另明列同方任選、回合方優先；沒有附一般到期再清理／循環結果的流程表。

- **digital-rules.md 對應**：[DR-04 Turn、Auto 與 End、DR-11 Action、Guard、Contact、DR-13 Case Action、DR-15 效果語義與排程、§4 RQ-023](digital-rules.md)。
- **game-flow.md 對應**：[§4 EndTriggers→EndExpiry→TurnHandoff、§7 Contact／Action 結束、§7.1 ACTION_DURATION_EXPIRE、§8 scheduler、UT-076／089](game-flow.md)。

### 官方規則目前能確認的部分

- End 先解決回合結束能力，再讓「到回合結束」效果失效，再交回合。
- 一般 Contact 流程先讓 Contact 期間效果失效，之後才到父 Action 的結束步驟。
- Action 結束能力先解決，Action 期間效果之後失效；Case 分支同樣有這個次序。
- 普通 pending 不能打斷目前尚未完成的行動／效果；RQ-011 的已確認排程繼續適用。
- 技術上限、timeout、state hash 或程式偵測並不是規則書給出的平手／敗北條件。

### 官方規則目前無法確認的部分

- 到期失效本身產生新觸發時，是否重開哪個窗口、是否重新掃描到期效果、及何時可以交回合／結束 Action。
- 在結束窗口中新加入「到本次結束」的效果，其到期時點與需要的再次清理步驟。
- 同時到期的效果是否以批次處理、可否由玩家選序，以及與新 pending 的完整交錯方式。
- 強制／可選循環的正式終止規則、是否可要求選不同選項、是否有平手或其他結果。

### 對 Engine 的影響

| 面向 | 受影響內容 |
| --- | --- |
| state | END.step、CONTACT／ACTION 的結束進度，以及未來 modifiers、duration scope 與到期記錄。 |
| action | END_MAIN、Action-end、Contact-end 與下一回合開放時點，不能重複結束或提早交回合。 |
| effect | 到期造成的新觸發、再次到期與循環；普通 queue 與即時處理仍分開。 |
| target | 到期修正影響的角色／玩家及能力來源是否仍有效，可能與 RQ-014／027 交互。 |
| zone movement | 新效果可能抽牌、移除或引發 Refresh；不能在規則窗口未定時擅自執行。 |
| serialization | 保存到期邊界、已處理項目與待處理事實，還原不能再次撤銷同一修正。 |
| replay | 循環診斷與步數預算不應改變遊戲結果；不同技術 budget 不可產生不同官方勝負。 |
| tests | 現有 P0-22 只涵蓋 End 觸發→空 expiry→換人，P0-28 覆蓋 STEP_LIMIT 非終局；UT-076 完整 duration 仍待擴充。 |

### Proposed Implementation

**ENGINE-PROPOSAL**

用可序列化的 duration scope（turn／action／contact）與到期工作清單保存已知事實；清單的存在不代表批次順序已被官方裁定。取得裁定後，才定義 expiry→checkpoint→是否再次 expiry 的精確轉移。

步數預算、重複狀態摘要及因果鏈只用於技術暫停與診斷，不自動產生 draw／loss 或強制玩家改選。不要建立「反覆清理直到無觸發」作預設，亦不把 scope 轉換成真實時間 timer。

### 如果暫不裁定

沿用未支援到期 opcode／修正系統的內容拒絕；可照常執行既有不產生到期交互的有限流程。若未來執行中碰到未確認的到期再觸發，保存 RQ-023，在開新窗口或交回合前停止。

單純 STEP_LIMIT 維持技術暫停，不能直接宣告 RQ-023 已證明發生，更不能判平手。保留精確游標與 pending，不清空佇列來強行結束回合。

### 需要新增的測試

- UT-Q-023-01：End 到期產生一個普通 pending，依裁定驗證其 checkpoint 及交回合時點。
- UT-Q-023-02：Contact 到期產生觸發、Action 到期產生觸發，分別測試相對於父程序結束的位置。
- UT-Q-023-03：多個效果同時到期，按官方確認的批次／選序規則驗證，避免依 ID 排序。
- UT-Q-023-04：到期觸發建立同一 scope 的新效果，驗證是否再次到期及重開窗口。
- UT-Q-023-05：官方確認的強制／可選循環案例，採裁定指定終止方式；不同 step budget 不影響結果。
- UT-Q-023-06：到期前、到期後 pending、再次清理與技術暫停的快照／重播；每項修正只清除規定次數。

## RQ-025

### 問題

> FILE 中 Partner 能否被 Active、推理或再使用 Partner 能力？Partner 的可選區域／狀態邊界？

### 觸發情境

1. A 已 Assist，Partner 以 SLEEP 在 FILE，並計入 FILE count；A 想在本回合對該 Partner 再呼叫 DEDUCE、ASSIST 或 SOLVE_CASE。
2. 待擴充的效果 fixture 嘗試讓 FILE Partner 變 ACTIVE，再據此進行推理或 Partner Ability。朝向改成 ACTIVE 並不能自行證明來源區域合法。
3. Partner 在 FILE 時，遊戲事件符合其某個能力的觸發文字；需要確認該能力在 FILE 是否適用。這與「效果在 Partner 離開合法區域前已經觸發，現在等待解決」是不同問題。
4. **已確認的對照**：對手的 Auto 不搬回 A 的 Partner；A 自己下一個 Auto 的第一步才返回 Partner Area 並 ACTIVE。

### 官方規則書相關內容

- **PDF p.13，「アシスト」手順①與括註**：

  > パートナーをスリープさせ、「FILEエリア」に移動させます。
  >
  > （ここにいる間は「FILEエリア」にあるカードの枚数として数えます。）

- **PDF p.13，Partner Ability 的成本說明**：

  > （アクティブ状態の場合に使用でき、スリープ状態の場合は使用できません。）

- **PDF p.12，Next Hint 手順①**：

  > 自分の「FILEエリア」の1番上にあるカード（アシストしているパートナーを除く）を手札に加えます。

- **PDF p.10，Auto 第一步**：

  > 自分のパートナーをアクティブにします。

  > アシストによって「FILEエリア」に置かれていた場合はパートナーエリアに戻してアクティブにします。

- **PDF p.15，推理的一般來源條件**：

  > 「推理」はアクティブ状態のパートナーか、自分の「現場」にいるアクティブ状態のキャラが行えます。

- **PDF p.21，Character 觸發能力的區域註記**：

  > キャラが現場にいることが前提ですが、エリアが指定されている能力は現場以外でも発動します。

  這是 Character 能力的區域說明，不能直接推導出所有 FILE Partner 能力都可用或都不可用。

- **digital-rules.md 對應**：[DR-04 Auto、DR-05／06 FILE 計數與 Next Hint、DR-08 Partner、DR-10 推理、§4 RQ-025 與 RQ-011 實作契約後的限定清單](digital-rules.md)。
- **game-flow.md 對應**：[§4 AutoPartner、§5 Assist／事件解決／Next Hint、§6 推理、§8 觸發捕捉、Phase 2 的 RQ-025 限定](game-flow.md)。

### 官方規則目前能確認的部分

- Assist 會 Sleep Partner 並移至 FILE；其在 FILE 時計入張數。
- Next Hint 取卡排除正在 Assist 的 Partner。
- 自己的 Auto 按列出的順序，第一步使 Partner Active；在 FILE 的 Assist Partner 先返回 Partner Area，再 Active。此點亦已有使用者明確確認，並非本題待裁定部分。
- 一般 Partner 推理需要 ACTIVE；Partner Ability 的 Sleep 成本不能由 SLEEP 支付。
- p.15 的一般 ACTIVE 條件沒有提供所有 FILE 中特殊效果交互的完整條文；缺少禁止字樣不能自行當成允許。

### 官方規則目前無法確認的部分

- 哪些能力／效果能合法選取 FILE Partner，能否在 Auto 返回以外把它 Active。
- FILE Partner 被 Active 後，是否能推理、再 Assist、事件解決或使用其他能力。
- FILE 中是否能新觸發某個 Partner 能力，以及能力原文對來源區域的需求。
- 能否將一般 Character 的目標／狀態條文直接套用 Partner；尤其不能因共用 enum 就推定 STUN 或其他狀態互動。

### 對 Engine 的影響

| 面向 | 受影響內容 |
| --- | --- |
| state | partnerId、真實 zone、orientation、assistReturnOnOwnAuto、FILE count；不能只看永久 partnerId。 |
| action | DEDUCE、ASSIST、SOLVE_CASE 及未來 Partner Ability 的來源合法性。 |
| effect | FILE 中的新觸發適用性與已觸發效果存續分開；前者未定，後者依 RQ-011／p.22 不因離場自動取消。 |
| target | Active／其他狀態效果能否選 FILE Partner，需要區域與卡種能力矩陣。 |
| zone movement | Assist 的 PARTNER→FILE、Next Hint 排除、自己的下一 Auto FILE→PARTNER 是已知路徑。 |
| serialization | Partner 只有一個實體位置，返回標記與 FILE 狀態一致；不能還原成既在 Partner 又在 FILE。 |
| replay | 自己下一 Auto 的時間點、朝向事件及拒絕命令必須重演一致；不能憑重連強制提前返回。 |
| tests | 保留 P0-04、P2-01／04、P2-R03／07；新增 FILE 中狀態、目標與能力矩陣的裁定測試。 |

### Proposed Implementation

**ENGINE-PROPOSAL**

建立按 card type、zone、operation 與 ability 有效區域查詢的能力矩陣，未知格保持 UNRESOLVED／RULE_QUESTION_025。操作成本可支付與來源區域合法性分開檢查，不把 ACTIVE 當成所有行為的通行證。

現階段矩陣只填已確認的 Assist 入 FILE、計數、Next Hint 排除、自己的下一 Auto 返回並 ACTIVE。未來每一個 FILE 特殊能力依卡文／裁定逐項加入，不能用 Character 的通用 handler 擴張 Partner 行為。

### 如果暫不裁定

FILE 中推理／再使用 Partner 能力等命令回 UnsupportedRule／RULE_QUESTION_025，且不改變 state。未確認的 FILE Active／目標操作不載入或拒絕，不把它當成合法狀態變更後再猜後續。

自動觸發適用性不明時保留 RULE_BLOCKED；不得把該能力默默略過，也不得把它放進普通 queue 冒充已確認觸發。只因來源已在 FILE 而取消先前已合法觸發的來源獨立效果，同樣不符合 p.22。未被阻擋的對局仍照常執行已確認的自己的下一 Auto 返回規則；已阻擋的對局不能藉推進到 Auto 或後續勝負判定繞過未決步驟。

### 需要新增的測試

- UT-Q-025-01：各已獲裁定的 card type／zone／operation 格，驗證可選目標及拒絕原因。
- UT-Q-025-02：若官方允許 FILE Active，分別測推理、Assist、事件解決與其他 Ability 的資格，不能由 Active 一次推定全部可用。
- UT-Q-025-03：FILE 期間新觸發與離開合法區域前已觸發效果分開測；驗證來源有效性及 pending 存續。
- UT-Q-025-04：不同 FILE 順序、FILE 僅 Partner、Partner＋普通卡，計數與 Next Hint 排除維持一致。
- UT-Q-025-05：己方／對手 Auto、跨回合快照及命令重送，Partner 僅在正確第一步返回 ACTIVE，沒有複製卡。
- UT-Q-025-06：未知互動與 Case 勝利條件同時被遇到時，RULE_BLOCKED 不被覆蓋；取得裁定後按明定流程驗證。

## RQ-027

### 問題

> 一般離場重入、轉區後哪些 modifier／朝向／限次記錄／公開狀態重設或保留？

### 觸發情境

1. 角色 X 已在上一回合登場，本回合變 SLEEP，並用過一個「每回合一次」能力；待擴充 fixture 另給它暫時 AP 修正、外來能力與附件。X 因已確認的移除由 FIELD→REMOVE，之後某效果使同張實卡回 Hand，再嘗試登場。
2. X 若曾 STUN、能力被 suppress，或在本回合才登場，重入後哪些 runtime 狀態還在，同樣不能由舊資料直接沿用。
3. 曾公開的 X 回到隱藏區、被洗入 Deck，之後再進場；實卡資料保存、玩家可見性及已知資訊是否可追蹤是不同層次，完整可見性另與 RQ-021 相接。
4. **特例對照**：Disguise 將原 Contact 角色放 Deck bottom，換上另一張手牌。這有明確繼承條文，不是一般離場重入的通用模板。

### 官方規則書相關內容

- **PDF p.11，一般手札使用的 Character 登場**：

  > 使用したら、キャラはアクティブ状態で「現場」に登場させ、イベントは効果を解決してリムーブエリアに置かれます。

- **PDF p.15，登場當回合的推理限制**：

  > キャラは「現場」に登場したターンはまだ「推理」できません。
  >
  > この状態を「名乗り状態」と言います。

- **PDF p.18，Disguise Point 的特例**：

  > 変装したら、元のキャラの状態や受けていた効果も引き継がれます。
  >
  > （スリープ状態、他のカードによって与えられていた能力や効果、セットされている／重なっているカードなど）

  > 変装での入れ替わりは登場ではありません。

- **PDF p.23，Set 卡及下疊卡清理**：

  > セットしたキャラが現場を離れる場合や、別のキャラの下に重なった場合は、セットされているカードをすべてリムーブします。

  > キャラが現場を離れる場合や、別のキャラの下に重なった場合は（セットされているカードと同様に）重なっているカードをすべてリムーブします。

- **PDF p.24，「能力の使用／発動の回数制限を表すもの」中ターン①**：

  > 各ターンに1回だけ発動する（宣言能力であれば1回だけ使用できる）

- **PDF p.24，「登場時」與「現場リムーブ時」的定義**：

  > このキャラが「現場」に登場したときに発動する
  >
  > 能力や効果によって登場しても発動します。

  > このキャラが「現場」からリムーブされたときに発動する
  >
  > リムーブされる方法は問いません。

- **digital-rules.md 對應**：[DR-02 朝向與名乗り状態、DR-05 通常手札使用、DR-12 Disguise、DR-15 限次／效果語義、DR-16 附屬卡、§4 RQ-027](digital-rules.md)。
- **game-flow.md 對應**：[§3.1 身份與續行資料、§5 登場／Switch、§7 Disguise 替換、§11 UT-043／068／069／077／085／086](game-flow.md)；實際有限 profile 的 enteredTurn 封存及重新登場 gate 另見 [card-schema.md](card-schema.md)。

### 官方規則目前能確認的部分

- 一般手札使用的 Character 以 ACTIVE 登場；登場當回合有名乗り的推理／Action 限制，合法 keyword 例外另依 p.25。
- Disguise 明確繼承所列狀態、外來能力／效果及附件，且不算登場。其一般繼承條文不能等同所有限次身份細節均已解答。
- 一般宿主離場／變成另一角色下疊時，p.23 明列 Set／下疊卡全部移除；Disguise 的明示繼承需要獨立處理。
- ターン① 等限制按「各回合」，不是只算自己的回合。
- 能力／效果造成的登場也符合登場時能力；「現場リムーブ時」不限制移除的方法。
- 保存一張實卡的 ID 是工程身份需求，不等於官方認定它在各區域都延續同一個場上角色狀態。

### 官方規則目前無法確認的部分

- 一般離場及重入的完整 reset／retain 矩陣：原有 modifier、STUN／SLEEP、外來能力、suppress、限次與其他標記。
- 每回合限次究竟綁實卡、原在場存在、能力來源或其他身份；同回合重入能否再次使用。
- 各種轉區後，舊效果／目標引用是否延續，與 RQ-014 的對象身份如何連結。
- 除明文指定的朝向／裏向／附件處理外，公開狀態與已知資訊在隱藏區及重入後的完整保存／重設規則；不可取代 RQ-021 的可見性裁定。

### 對 Engine 的影響

| 面向 | 受影響內容 |
| --- | --- |
| state | CardInstance.orientation／enteredTurn／abilitiesSuppressed，以及未來 modifier、usage ledger、entry identity、公開資訊紀錄。 |
| action | PLAY_CARD／效果登場後的名乗り、推理、Action、Guard 與宣言／限次能力可用性。 |
| effect | 舊修正是否仍適用、來源能力是否延續、pending 是否仍綁原存在；不可自動取消已觸發效果。 |
| target | 同一 instanceId 重入是否仍為原目標，應與 RQ-014 一起裁定，不能用卡名尋找替身。 |
| zone movement | 離場、Remove／Hand／Deck 間移動、再次登場、附件清理與 Disguise 例外。 |
| serialization | 區分封存的歷史 runtime 與正在生效的狀態；restore 不能因資料還存在就重新套用。 |
| replay | entry／usage／modifier 身份隨版本固定；新裁定不能追溯性重設舊 replay 的限次或朝向。 |
| tests | P2-30 目前只驗證封存與重入拒絕；裁定後需完整欄位矩陣、同 definition 多實卡獨立性及附件守恆。 |

### Proposed Implementation

**ENGINE-PROPOSAL**

分開 CardDefinition、CardInstance（實卡）與 entry occurrence（一次在場存在），移區時保存歷史事實，將 reset／retain 作為依「from／to／cause／規則版本」查詢的已審核資料。建立 entry occurrence 只是辨識變化，**不預先決定限次重設或效果失效**。

每個 runtime 欄位都需要來源支持的處置；未知格保持 UNRESOLVED，不預設全清或全留。Disguise 走已確認的替換／繼承專用路徑，不能透過改寫 definitionId 造出同張卡變裝的假象。公開資訊及投影政策另依 RQ-021 核定。

### 如果暫不裁定

維持已確認的一般首次登場與移除。離場後可保存 orientation／enteredTurn 等封存資料供診斷，但不讓它們在非 Field 生效；再次登場維持 UnsupportedRule／RULE_QUESTION_027。

未有正式規格的效果登場、跨區重設、附件／Disguise 組合不載入；若執行中才遇到未知重設，停在該步前。不替使用者清除限次、不重新給 ACTIVE、不繼承全部 modifier，也不因保存完整伺服器資料就向玩家公開隱藏卡。

### 需要新增的測試

- UT-Q-027-01：按官方 reset／retain 矩陣，逐欄測 orientation、STUN、enteredTurn、modifier、外來能力、suppress、限次與公開狀態。
- UT-Q-027-02：同回合／跨回合離場重入，分別驗證名乗り、RAPID 例外及每回合能力限次身份。
- UT-Q-027-03：同名、同 definition 的不同實卡，以及同實卡不同 entry，不能互相覆蓋 runtime。
- UT-Q-027-04：一般離場與 Disguise 特例的附件移除／繼承、登場時／變裝時觸發及實卡守恆。
- UT-Q-027-05：舊 target／來源／modifier 引用跨重入的結果，與 RQ-014 裁定一致；已 pending 效果不單因離場被刪除。
- UT-Q-027-06：封存、隱藏區、再次登場前／後的快照與 replay；可見性另依 RQ-021，禁止靜默版本遷移。

## Summary Table

「官方是否足夠」以是否足以回答該題**全部未定互動**為準；否不表示相關一般規則都不清楚。「是否可工程化暫解」中的可以只表示 fail-closed 隔離，不表示已解決玩法。

| RQ | 問題 | 官方是否足夠 | 是否可工程化暫解 | Phase 3 是否受阻 |
| --- | --- | --- | --- | --- |
| RQ-002 | 同時終局／Refresh 失敗的勝敗優先序 | 否；只明列個別勝敗與立即 Refresh | 可以：保留終局候選並阻擋，不判平手 | 若含真正同步／批次終局則受阻；已確認依序 Refresh 不受阻 |
| RQ-009 | FILE 僅 Partner 能否 Next Hint | 否；空 FILE 禁止與 Partner 排除均已知，但組合無明文 | 可以：命令原子拒絕 UnsupportedRule | 該 FILE 局面受阻；一般 Next Hint 可繼續 |
| RQ-012 | 推理來源離場及中途 LP 取值 | 否；一般 LP、逐張及 Refresh 續行已知 | 可以：限制內容，未知採樣前保留 RULE_BLOCKED | 若含來源離場續行／動態 LP 交互則受阻 |
| RQ-013 | Guard／Contact 邊界、Case 無證據、提前結束 | 否；各已知分支不能補完整跨界規則 | 可以：保存邊界與原目標，阻擋未知續行 | 若要完整行動邊界／早期結束能力則受阻；基本 Contact 可繼續 |
| RQ-014 | 選目標時點、移區身份、重選與來源讀值 | 否；已觸發效果存續不等於完整 target 制度 | 可以：逐 program 審核並阻擋未知綁定 | 通用 target DSL／複雜效果受阻；來源獨立有限 opcode 可繼續 |
| RQ-023 | 到期再觸發、重開窗口與循環 | 否；一般結束次序已有明文 | 可以：拒絕未定 duration 內容，技術暫停不判勝敗 | 完整 duration／循環系統受阻；目前空 expiry 路徑可繼續 |
| RQ-025 | FILE Partner 的可用能力／操作區域 | 否；Assist、計數、Next Hint 排除、下一己方 Auto 返回已知 | 可以：已確認操作白名單，其餘 RQ-025 | FILE 中特殊能力受阻；已確認 Partner 基本行為可繼續 |
| RQ-027 | 一般離場重入的 runtime 重設／保留 | 否；通常登場、變裝繼承、附件清理僅涵蓋特定情境 | 可以：封存 runtime 並拒絕未知重入 | 重入／限次／modifier 的完整交互受阻；首次登場與已確認移除可繼續 |
