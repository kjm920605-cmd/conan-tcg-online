# Phase 2 Core Gameplay Actions — 執行計畫

日期：2026-09-05；完成驗證：2026-09-06。以使用者本輪明確指定的流程作為已授權設計，沿用 Phase 1 的封裝 Engine、JSON 程序 frame 與獨立 Pending Effect 集合。

## 規則處置先行

- RQ-011 改為 **RESOLVED**：依 PDF p.15–17、19、21–22 與本輪使用者六項確認。普通觸發先入 pending，當前 action／effect／atomic rule step 完成才進 checkpoint；同方任選、回合方優先；來源離場／後來無效不取消已發動效果。immediate replacement／negation 不進普通 queue，其 handler 尚未支援，內容載入明確拒絕。
- RQ-025 維持 **BLOCKING**。只允許 Assist 後位於 FILE、計數、Next Hint 跳過該 Partner、自己下一個 Auto 第一步返回並 ACTIVE。未知行為回 UnsupportedRule／RULE_QUESTION_025；運行中不確定觸發保留 RULE_BLOCKED。
- 本輪觸及的 RQ-009（FILE 僅 Partner）、012（推理來源離場）、013（Guard／Contact 邊界）由 DEFERRED 改為 BLOCKING，沒有改答案。其餘未決問題不自行裁定。
- 002、009、012、013、014、023、025、027 共 8 題 BLOCKING；DEFERRED 16；IMPLEMENTATION 005／006／007 共 3；RESOLVED 011 共 1。原 Phase 1 報告保留為歷史紀錄。

## 架構與程序

採既有顯式 frame 續行，不引入外部 FSM 或第二套引擎。新增 events pipeline 收集事實及普通觸發；不在每次 emit 後立刻解決效果。Refresh 仍立即中斷逐張 MOVE，完成後返回原剩餘量。

| 程序 | 保存與執行方式 |
| --- | --- |
| Auto | 四個官方步驟各有 checkpoint；抽牌／FILE 的整個數量步驟完成後 drain，Refresh 仍逐張立即處理 |
| Next Hint | 取最上方非 Partner FILE 卡→checkpoint→選 0/1 張合法手牌→通常登場／Event 子程序→完成；保留本回合 usedNextHint |
| Switch | 登場會超過五人時才開選擇；移除既有角色並完成新角色登場構成一次登場步驟，兩者事件皆入 pipeline，之後 checkpoint |
| Deduction | 宣告 Sleep→checkpoint→Mislead window→checkpoint→計算當前 LP 減本次 Mislead→逐張證據／Refresh→checkpoint→結束→checkpoint |
| Mislead | 對手選互異、有效、ACTIVE 的 Field Mislead 角色，可空選；同一次宣告同時 Sleep，X 合計只保存於本次推理 frame |
| Action | 驗證來源與角色／Case 目標→Sleep 宣告→checkpoint→Guard→checkpoint→Contact 或未被 Guard 的 Case 分支→Action-end checkpoint |
| Contact | START→checkpoint→固定 AP priority（低方先、同 AP 非回合方先）→checkpoint→兩位 PASS extension windows→AP 比較→checkpoint→END→checkpoint |
| Case 分支 | 頂 Evidence 至 PROCESSING→checkpoint→本 profile 無ヒラメキ→Remove→checkpoint→己方逐張 +1 Evidence→checkpoint；不因攻擊者離場中斷 |

Contact 只接受 PASS。Cut-in／Disguise 明確 UnsupportedFeature，沒有假裝能用。只實作推理／Action 所需的 RAPID（迅速）及 MISLEAD X，未知或重複 keyword 拒絕；不建立完整 keyword／modifier 系統。

離場移除是已確認行為；實卡保留原 enteredTurn／orientation 作為封存資料，不在非 Field 區域生效。再次登場仍受 RQ-027 阻擋，不自行判定哪些狀態重設。已觸發 DRAW 等不依賴來源在場的 program 可繼續；需讀離場來源的未知語義保留相應問題。

狀態 schema 升為 2、engine 0.2.0、ruleset 固定 rq011-confirmed。舊版快照明確拒絕，不偷偷以新時序重播舊規則。RNG 仍為原可注入純介面。所有 choice 與 frame 使用互斥型別並由 restore 驗證續行完整性。

## 任務與驗證順序

- [x] 重新閱讀 README、三份設計、Phase 1 結果、28 題、現有 src/game 與 tests；重新視讀 PDF 全 27 頁。
- [x] 執行 Phase 1 基準：npm test，33／33 通過。
- [x] 更新 digital-rules／game-flow 的 RQ-011 與 RQ-025。
- [x] 先新增 Phase 2 測試：30 項中 28 項因功能缺少而失敗、2 項既有拒絕邊界通過，再開始實作。對照原 UT-014–021、029–041、045、049–052、059–061、078–089。
- [x] 在 model.ts、engine/events.ts 建立事件與 checkpoint 契約；checkpoint helper 與事件管線合併，更新 content 驗證、Auto 與版本。
- [x] 新增 procedures/gameplay-rules.ts、gameplay-commands.ts，於 advance.ts 接入 Next Hint；測試 FILE 計數、色、Switch 與不可插入 Main。
- [x] 新增 procedures/deduction.ts，測試 RAPID／Mislead／LP／逐張 Evidence 與 Refresh。
- [x] 在 procedures/action.ts 集中 Action／Contact／Case 子流程，測試目標／Guard／AP／PASS／來源離場 gate。
- [x] 更新 engine/invariants.ts、procedure-invariants.ts，新增 gameplay-invariants.ts；逐步快照還原、錯 actor／choice／revision 原子拒絕。
- [x] 保留原 33 組測試；P0-28 更新 Auto expected 並保留技術上限斷言，RQ-025 block 另有 P2-R03／07。P0-23 改用固定未知 schema 999，仍測版本拒絕。
- [x] 執行 npm test、npm run typecheck、npm run test:regression、npm run demo；完成獨立審查及修正，補 8 項回歸。
- [x] 更新 README、card-schema、game-flow、docs/phase2-results.md，列出所有檔案及總測試數，停止於 Phase 2。

沒有 UI、帳號、Multiplayer、正式卡牌資料匯入、MR、Disguise 或完整 Cut-in；不建立這些目錄或依賴。
