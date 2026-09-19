# Phase 3B Card Support Matrix

日期：2026-09-08。28 張全部是 **FIXTURE，正式卡 0 張**；repo 未提供足夠可核驗正式卡表，依本階段授權使用合成代表卡。24 SUPPORTED、1 PARTIAL、3 BLOCKED；SUPPORTED 含 Partner／Case 兩張設定卡。

SUPPORTED 代表有限 DSL profile 可編譯，不代表所有可能互動都已有官方裁定。PARTIAL／BLOCKED 整張不進入 Content，不會略去未知能力後入局。每列 `CARD <ID>` 對應逐卡具名測試，涵蓋適用的合法性、時序、目標、狀態與事件；設定卡驗初始化，未支援卡驗拒絕及無狀態變動。

| Card | Mechanic | Status | Blocked RQ | Tests |
| --- | --- | --- | --- | --- |
| [F-ACTIVATED-DRAW](../data/cards/F-ACTIVATED-DRAW.json) | ACTIVATED, DRAW, MOVE, ASSAULT | SUPPORTED | — | [CARD F-ACTIVATED-DRAW](../tests/card-integration.test.ts) |
| [F-ACTIVE](../data/cards/F-ACTIVE.json) | ACTIVATED, ACTIVE, RAPID | SUPPORTED | — | [CARD F-ACTIVE](../tests/card-integration.test.ts) |
| [F-AP-BOOST](../data/cards/F-AP-BOOST.json) | ACTIVATED, AP_MOD, RAPID | SUPPORTED | — | [CARD F-AP-BOOST](../tests/card-integration.test.ts) |
| [F-CASE](../data/cards/F-CASE.json) | CASE | SUPPORTED | — | [CARD F-CASE](../tests/card-integration.test.ts) |
| [F-COMBO-CUT](../data/cards/F-COMBO-CUT.json) | CUT_IN, DRAW, AP_MOD, COMPOUND | SUPPORTED | — | [CARD F-COMBO-CUT](../tests/card-integration.test.ts) |
| [F-COMBO-ENTER](../data/cards/F-COMBO-ENTER.json) | ON_ENTER, DRAW, SET_CARD, STACK_UNDER, AP_MOD, COMPOUND, RAPID | SUPPORTED | — | [CARD F-COMBO-ENTER](../tests/card-integration.test.ts) |
| [F-COMBO-REACT](../data/cards/F-COMBO-REACT.json) | ON_ENTER, DRAW, REACT | SUPPORTED | — | [CARD F-COMBO-REACT](../tests/card-integration.test.ts) |
| [F-CUTIN](../data/cards/F-CUTIN.json) | CUT_IN, AP_MOD | SUPPORTED | — | [CARD F-CUTIN](../tests/card-integration.test.ts) |
| [F-DISGUISE](../data/cards/F-DISGUISE.json) | DISGUISE, DRAW | SUPPORTED | — | [CARD F-DISGUISE](../tests/card-integration.test.ts) |
| [F-ENTER-DRAW](../data/cards/F-ENTER-DRAW.json) | ON_ENTER, DRAW | SUPPORTED | — | [CARD F-ENTER-DRAW](../tests/card-integration.test.ts) |
| [F-EVENT-DRAW](../data/cards/F-EVENT-DRAW.json) | DRAW | SUPPORTED | — | [CARD F-EVENT-DRAW](../tests/card-integration.test.ts) |
| [F-EVIDENCE](../data/cards/F-EVIDENCE.json) | ACTIVATED, EVIDENCE, BULLET | SUPPORTED | — | [CARD F-EVIDENCE](../tests/card-integration.test.ts) |
| [F-EXPIRY](../data/cards/F-EXPIRY.json) | EXPIRY_TRIGGER | BLOCKED | RULE-QUESTION-023 | [CARD F-EXPIRY](../tests/card-integration.test.ts) |
| [F-FILE-PARTNER](../data/cards/F-FILE-PARTNER.json) | FILE_PARTNER_ABILITY | BLOCKED | RULE-QUESTION-025 | [CARD F-FILE-PARTNER](../tests/card-integration.test.ts) |
| [F-INVESTIGATE](../data/cards/F-INVESTIGATE.json) | INVESTIGATE, ACTIVATED | SUPPORTED | — | [CARD F-INVESTIGATE](../tests/card-integration.test.ts) |
| [F-LP-BOOST](../data/cards/F-LP-BOOST.json) | ACTIVATED, LP_MOD, RAPID | SUPPORTED | — | [CARD F-LP-BOOST](../tests/card-integration.test.ts) |
| [F-MISLEAD](../data/cards/F-MISLEAD.json) | MISLEAD | SUPPORTED | — | [CARD F-MISLEAD](../tests/card-integration.test.ts) |
| [F-MR](../data/cards/F-MR.json) | MR, ON_REMOVE, DRAW, ACTIVATED, RAPID | SUPPORTED | — | [CARD F-MR](../tests/card-integration.test.ts) |
| [F-PARTNER](../data/cards/F-PARTNER.json) | PARTNER | SUPPORTED | — | [CARD F-PARTNER](../tests/card-integration.test.ts) |
| [F-REMOVE-DRAW](../data/cards/F-REMOVE-DRAW.json) | ON_REMOVE, DRAW, REMOVE, RAPID | SUPPORTED | — | [CARD F-REMOVE-DRAW](../tests/card-integration.test.ts) |
| [F-RETURN](../data/cards/F-RETURN.json) | REENTER_FIELD | BLOCKED | RULE-QUESTION-014, RULE-QUESTION-027 | [CARD F-RETURN](../tests/card-integration.test.ts) |
| [F-SEARCH](../data/cards/F-SEARCH.json) | SEARCH, DRAW | PARTIAL | — | [CARD F-SEARCH](../tests/card-integration.test.ts) |
| [F-SET](../data/cards/F-SET.json) | ON_ENTER, SET_CARD | SUPPORTED | — | [CARD F-SET](../tests/card-integration.test.ts) |
| [F-SLEEP](../data/cards/F-SLEEP.json) | ACTIVATED, SLEEP, ASSAULT_CHARACTER | SUPPORTED | — | [CARD F-SLEEP](../tests/card-integration.test.ts) |
| [F-STUN](../data/cards/F-STUN.json) | ACTIVATED, STUN, ASSAULT_CASE | SUPPORTED | — | [CARD F-STUN](../tests/card-integration.test.ts) |
| [F-TRACE](../data/cards/F-TRACE.json) | TRACE, ACTIVATED, DRAW | SUPPORTED | — | [CARD F-TRACE](../tests/card-integration.test.ts) |
| [F-UNDER](../data/cards/F-UNDER.json) | ON_ENTER, STACK_UNDER | SUPPORTED | — | [CARD F-UNDER](../tests/card-integration.test.ts) |
| [F-VANILLA](../data/cards/F-VANILLA.json) | VANILLA | SUPPORTED | — | [CARD F-VANILLA](../tests/card-integration.test.ts) |

## 跨卡互動

[card-combos.test.ts](../tests/card-combos.test.ts) 實際載入相同 JSON；共用 [representative-combos.ts](../examples/representative-combos.ts)。

| 情境 | 主要卡牌 | 驗證 |
| --- | --- | --- |
| Enter → observer → Contact → Cut-in → expiry | F-COMBO-ENTER、F-COMBO-REACT、F-REMOVE-DRAW、F-COMBO-CUT | 同方任選順序、instruction order、不插入 pending、Contact／Turn 分別到期 |
| Disguise | F-COMBO-ENTER、F-DISGUISE、F-ACTIVATED-DRAW | 新 occurrence、orientation／modifier／set／underneath 繼承、無普通登場 |
| MR | F-MR、F-AP-BOOST | 正式離場事件、對手回合轉 Partner、區域宣言限制、MR 唯一性 |
| Refresh → TRACE | F-TRACE、F-ACTIVATED-DRAW、F-EVENT-DRAW | 對手 Refresh 才發現、已發現後條件 Draw |

全部互動逐步 restore 並比較事件與完整序列化狀態，再從相同內容／注入 RNG／初始設定重播完整紀錄。Search 只覆蓋未支援資料及拒絕測試，未實作 Search 遊戲效果。詳見 [phase3b-results.md](phase3b-results.md)。

