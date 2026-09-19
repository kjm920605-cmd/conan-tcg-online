# Phase 3B Representative Card Integration Results

日期：2026-09-08。Phase 3B 完成，停止於代表卡資料整合。沒有 UI、Multiplayer、帳號或全卡池匯入。

## 交付範圍

完成磁碟 JSON → schema／reference／binding 驗證 → 可編譯 Content → GameEngine → command／event／checkpoint → restore／replay。CardDefinition 與 EffectProgram 分置，CardInstance／FieldEntry 仍由既有 Engine 管理。src/game、原 124 項測試及 engine 0.3.0／schema 3／ruleset 版本不變；本輪只加資料層與驗證、代表內容、測試和 CLI demo。

Repo 缺少足夠正式卡表，因此依使用者允許的 fallback 建立 **28 張 FIXTURE，正式卡 0 張**。不是正式卡文支援認證。逐卡機制與測試見 [card-support-matrix.md](card-support-matrix.md)。

| 項目 | 數量 |
| --- | ---: |
| 代表卡總數 | 28 |
| SUPPORTED | 24 |
| PARTIAL | 1 |
| BLOCKED | 3 |
| SUPPORTED 設定卡 Partner／Case | 2 |
| 可入 Deck 的 SUPPORTED 卡 | 22 |
| 獨立 Effect Programs | 18 |
| Program 靜態 instruction 總數 | 22 |

compileContent 預設僅選 SUPPORTED；明選 PARTIAL 回 UNSUPPORTED_CARD_STATUS，明選 BLOCKED 回對應 RULE_QUESTION。未支援卡只作編輯紀錄，不會裁掉未知能力後入局。SUPPORTED 仍受既有全域規則邊界限制。

## DSL 使用分布

統計每個獨立 program JSON 內 instruction 的出現次數，非 runtime 執行頻率，也不按卡片引用次數倍增。沿用 Phase 3A 全部既有 opcode，未新增 Search 或其他 generic semantics。

| Opcode | 次數 |
| --- | ---: |
| DRAW | 5 |
| AP_MOD | 5 |
| SET_CARD | 2 |
| STACK_UNDER | 2 |
| REMOVE | 1 |
| MOVE | 1 |
| ACTIVE | 1 |
| SLEEP | 1 |
| STUN | 1 |
| LP_MOD | 1 |
| GAIN_EVIDENCE | 1 |
| INVOKE_KEYWORD | 1 |

INVOKE_KEYWORD 是 Phase 3A 已有的固定 INVESTIGATE_X invocation。AP／LP modifier 使用有限來源與簡單 duration；沒有擴張跨區 target rebinding 或猜測來源讀值。

## Keyword coverage

| Keyword | 定義出現數 | 代表卡 |
| --- | ---: | --- |
| RAPID | 6 | F-ACTIVE、F-AP-BOOST、F-LP-BOOST、F-REMOVE-DRAW、F-MR、F-COMBO-ENTER |
| ASSAULT | 1 | F-ACTIVATED-DRAW |
| ASSAULT_CHARACTER | 1 | F-SLEEP |
| ASSAULT_CASE | 1 | F-STUN |
| BULLET | 1 | F-EVIDENCE |
| MISLEAD_X | 1 | F-MISLEAD |
| INVESTIGATE_X | 1 | F-INVESTIGATE |
| TRACE | 1 | F-TRACE |

八種 keyword 都載入資料並保留 Phase 3A 語義測試。Mislead、Investigate、Trace 另有逐卡執行；TRACE 與 Refresh 有跨卡正向條件測試。Set／underneath、MR、Disguise、Cut-in 由專用資料欄位／program／核心路徑表示，不偽裝成新 keyword。

## Unsupported mechanic

| 卡 | 分類 | 處理 |
| --- | --- | --- |
| F-SEARCH | PARTIAL：Draw 可表達，Search predicate／選取／公開／洗牌契約不足 | 不加 opcode；整張拒絕入局。未來需個別可信卡文及選取契約，不能把 Investigate 當 Search |
| F-RETURN | BLOCKED：一般離場重入與 target retention | RQ-014、027；不實作猜測重綁／重設 |
| F-EXPIRY | BLOCKED：expiry 觸發新效果／同 scope 重建 | RQ-023；不重開 resolution window |
| F-FILE-PARTNER | BLOCKED：FILE 中 Partner Ability | RQ-025；不延伸已確認的 Assist 返回行為 |

這些是工程支援分類，不是官方裁定。卡片未知能力保留於 unsupportedMechanics；有效 schema placeholder 不會進入引擎 Content。若將來個別效果語義可由官方明確支持，可另行評估有限 opcode；本階段未擴充。

## 驗證結果

於本工作區實際執行，以下命令 exit code 全部為 0：

| Gate | 結果 |
| --- | --- |
| npm test | 185 / 185 通過，0 skipped／failed |
| npm run test:regression | 185 / 185 通過；擴充為完整 suite，含原全部 124 項 |
| npm run typecheck | tsc --noEmit 通過 |
| npm run demo | 三個 CLI demo 通過；原核心終局、Phase 3A、Phase 3B |
| 新增 schema／program／binding 測試 | 29 |
| 新增逐卡整合測試 | 28（一張一案例） |
| 新增跨卡 interaction 測試 | 4 |
| 本輪新增 tests | 61 |

Regression 與 npm test 現在刻意執行相同完整套件，不能將兩次執行相加成 370 個獨立 tests。逐卡測試驗適用的 legality、trigger timing、target legality、resulting state、events；沒有能力的設定卡／vanilla 驗沒有憑空效果，未支援卡驗載入拒絕及狀態不變。

| 跨卡 demo | 紀錄步數（Command＋Advance） | Restore 比對次數 | 完整 Replay |
| --- | ---: | ---: | --- |
| Entry → observer → compound → Contact → Cut-in → expiry | 151 | 170 | 相同 |
| Disguise inheritance | 98 | 111 | 相同 |
| MR movement／uniqueness | 105 | 118 | 相同 |
| Refresh → TRACE | 254 | 292 | 相同 |
| 合計 | 608 | 691 | 四組皆相同 |

Restore 比對包含中途 pending、instruction cursor、Contact、modifier、附件、RNG 及完整序列化狀態；包含嘗試推進的無變更步驟，故可多於紀錄步數。完整 replay 從相同 Content、初始設定及注入 RNG 重新執行，沒有直接修改 GameState。

唯讀審查找到 AP_COMPARED 綁定 UNTIL_CONTACT_END 的載入漏洞：核心已在關閉 Contact，資料層卻接受新 modifier，直到解決才碰到 RQ-023。先新增測試重現失敗，再分開 Contact target 可用時點與 Contact duration 可建立時點；現於載入拒絕。沒有修改核心規則或將 RQ-023 裁定為已解決。

## BLOCKING boundaries

RQ-002、009、012、013、014、023、025、027 **全部維持 BLOCKING**。本輪 schema 測試驗證八題都能作為合法阻擋 metadata，但 BLOCKED 卡不可編譯。原 game-flow／digital-rules／裁定文件未改寫，官方 PDF 與原整理規格 SHA-256 保持：

- PDF：2a3caf3372e66656cd9ac0c5ba9dc8fc4177c176317f4f97086975c1c9e65d41
- 原整理規格：6680c33973b48c215dec2c40459ab31842afba368ada670a266be0864a08540b

## 檔案清單

本工作區沒有 Git repository；以下為本輪新增／修改清單，不宣稱 Git diff。

新增 61 個檔案：

- [data/card-programs/p-active.json](../data/card-programs/p-active.json)
- [data/card-programs/p-ap-turn.json](../data/card-programs/p-ap-turn.json)
- [data/card-programs/p-combo-cut.json](../data/card-programs/p-combo-cut.json)
- [data/card-programs/p-combo-enter.json](../data/card-programs/p-combo-enter.json)
- [data/card-programs/p-contact-boost.json](../data/card-programs/p-contact-boost.json)
- [data/card-programs/p-cut-contact.json](../data/card-programs/p-cut-contact.json)
- [data/card-programs/p-draw-one.json](../data/card-programs/p-draw-one.json)
- [data/card-programs/p-draw-two.json](../data/card-programs/p-draw-two.json)
- [data/card-programs/p-evidence-two.json](../data/card-programs/p-evidence-two.json)
- [data/card-programs/p-investigate.json](../data/card-programs/p-investigate.json)
- [data/card-programs/p-lp-turn.json](../data/card-programs/p-lp-turn.json)
- [data/card-programs/p-move-hand.json](../data/card-programs/p-move-hand.json)
- [data/card-programs/p-remove-self.json](../data/card-programs/p-remove-self.json)
- [data/card-programs/p-set-two.json](../data/card-programs/p-set-two.json)
- [data/card-programs/p-sleep.json](../data/card-programs/p-sleep.json)
- [data/card-programs/p-stun.json](../data/card-programs/p-stun.json)
- [data/card-programs/p-trace-draw.json](../data/card-programs/p-trace-draw.json)
- [data/card-programs/p-under-one.json](../data/card-programs/p-under-one.json)
- [data/cards/F-ACTIVATED-DRAW.json](../data/cards/F-ACTIVATED-DRAW.json)
- [data/cards/F-ACTIVE.json](../data/cards/F-ACTIVE.json)
- [data/cards/F-AP-BOOST.json](../data/cards/F-AP-BOOST.json)
- [data/cards/F-CASE.json](../data/cards/F-CASE.json)
- [data/cards/F-COMBO-CUT.json](../data/cards/F-COMBO-CUT.json)
- [data/cards/F-COMBO-ENTER.json](../data/cards/F-COMBO-ENTER.json)
- [data/cards/F-COMBO-REACT.json](../data/cards/F-COMBO-REACT.json)
- [data/cards/F-CUTIN.json](../data/cards/F-CUTIN.json)
- [data/cards/F-DISGUISE.json](../data/cards/F-DISGUISE.json)
- [data/cards/F-ENTER-DRAW.json](../data/cards/F-ENTER-DRAW.json)
- [data/cards/F-EVENT-DRAW.json](../data/cards/F-EVENT-DRAW.json)
- [data/cards/F-EVIDENCE.json](../data/cards/F-EVIDENCE.json)
- [data/cards/F-EXPIRY.json](../data/cards/F-EXPIRY.json)
- [data/cards/F-FILE-PARTNER.json](../data/cards/F-FILE-PARTNER.json)
- [data/cards/F-INVESTIGATE.json](../data/cards/F-INVESTIGATE.json)
- [data/cards/F-LP-BOOST.json](../data/cards/F-LP-BOOST.json)
- [data/cards/F-MISLEAD.json](../data/cards/F-MISLEAD.json)
- [data/cards/F-MR.json](../data/cards/F-MR.json)
- [data/cards/F-PARTNER.json](../data/cards/F-PARTNER.json)
- [data/cards/F-REMOVE-DRAW.json](../data/cards/F-REMOVE-DRAW.json)
- [data/cards/F-RETURN.json](../data/cards/F-RETURN.json)
- [data/cards/F-SEARCH.json](../data/cards/F-SEARCH.json)
- [data/cards/F-SET.json](../data/cards/F-SET.json)
- [data/cards/F-SLEEP.json](../data/cards/F-SLEEP.json)
- [data/cards/F-STUN.json](../data/cards/F-STUN.json)
- [data/cards/F-TRACE.json](../data/cards/F-TRACE.json)
- [data/cards/F-UNDER.json](../data/cards/F-UNDER.json)
- [data/cards/F-VANILLA.json](../data/cards/F-VANILLA.json)
- [docs/card-support-matrix.md](../docs/card-support-matrix.md)
- [docs/phase3b-plan.md](../docs/phase3b-plan.md)
- [docs/phase3b-results.md](../docs/phase3b-results.md)
- [examples/representative-cards.ts](../examples/representative-cards.ts)
- [examples/representative-combos.ts](../examples/representative-combos.ts)
- [examples/representative-session.ts](../examples/representative-session.ts)
- [src/cards/bindings.ts](../src/cards/bindings.ts)
- [src/cards/catalog.ts](../src/cards/catalog.ts)
- [src/cards/files.ts](../src/cards/files.ts)
- [src/cards/index.ts](../src/cards/index.ts)
- [src/cards/model.ts](../src/cards/model.ts)
- [src/cards/validation.ts](../src/cards/validation.ts)
- [tests/card-combos.test.ts](../tests/card-combos.test.ts)
- [tests/card-integration.test.ts](../tests/card-integration.test.ts)
- [tests/card-validation.test.ts](../tests/card-validation.test.ts)

修改 3 個檔案：

- [README.md](../README.md)：目前階段、資料 pipeline、fixture／支援狀態與執行說明。
- [package.json](../package.json)：全套 regression 與新增代表卡 demo。
- [docs/card-schema.md](card-schema.md)：catalog 與 runtime 分離契約、載入／編譯邊界。

## 後續建議（未執行）

取得少量可核驗正式卡文與來源後，先評估能否完整映射既有 DSL，再更新 provenance 契約與逐卡測試；Search 需獨立明確的資料與選取契約。八題 BLOCKING 需官方裁定，不能用更多 fixture 推定。Phase 3B 到此停止。

