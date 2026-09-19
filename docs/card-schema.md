# Card Definition、Runtime State 與效果資料規格

Phase 4 新增 viewer projection：CardView 的隱藏卡僅為 `{hidden:true}`，沒有 instance／definition ID；own hand 與當前 face-up 卡可見。PlayerView 只包含投影 zones、count、有效 AP／LP、keyword、公開 modifier、程序摘要與過濾後事件；不包含 RNG、command receipts、raw frames 或完整 PendingEffects。LegalAction 與 PendingDecision 由 Engine-facing adapter 提供，不從 React 推定規則。此為資訊呈現工程邊界，不新增卡片／區域裁定。完整 state 僅由 local host／明示 dev snapshot 工具持有。

狀態：Phase 3A 有限 profile 已實作；驗收見 [phase3a-results.md](phase3a-results.md)。官方來源為 [Ver.2.5 PDF](reference/rule_manual.pdf)。以下工程欄位不構成官方裁定；RQ-002、009、012、013、014、023、025、027 保持 BLOCKING。

## Phase 3B Catalog（資料載入層）

`src/cards` 提供磁碟 JSON → Catalog → Core Content；不更動下列 Phase 3A runtime 型別。資料與覆蓋狀態見 [card-support-matrix.md](card-support-matrix.md)。

- `data/cards/<cardId>.json`：cardId、provenance、supportStatus、blockedBy、mechanics、unsupportedMechanics、definition。definition 是既有 CardDefinition，program 只以 ID 引用。
- `data/card-programs/<programId>.json`：programId、program。沿用既有 DSL，不增加 opcode 或 generic target semantics。
- 本批 provenance.kind 僅接受 FIXTURE，名稱必須以 `FIXTURE ` 開頭。未驗證正式來源前不接受 OFFICIAL；VERIFIED_CORE 表示有限引擎契約，不代表官方卡文認證。
- `validateCardDefinition(value, programs)`、`validateEffectProgram(value)` 在載入時驗證欄位、型別、ID、數值、keyword、trigger、opcode、duration、來源／目標契約及 references；檔名也須符合 ID。
- `readCardCatalog(root: URL)` 排序讀取並驗證；`parseCatalog(cards, programs)` 拒絕重複 ID，產生不可變 catalog；`compileContent(catalog, cardIds?)` 再次驗證並僅編譯 SUPPORTED，裁剪未引用 program。
- SUPPORTED 不得含 blocker 或 unsupported mechanic；PARTIAL 必須明列未支援需求；BLOCKED 必須明列 RULE-QUESTION。逐項 blockedBy 聯集須等於卡片 blockedBy，ID 必須是現有 001–028。明選 PARTIAL 或 BLOCKED 會失敗，不能把部分卡當成白板載入。
- 編輯資料中的 BLOCKED placeholder 仍須是有效 schema，未知語義保留在 unsupportedMechanics，不得混入可執行 program。
- Binding 驗證拒絕沒有適用 scope 的 modifier、沒有 Contact 的 OWN_CONTACT、無固定調查 keyword 的 invocation；AP_COMPARED 已進入 Contact 關閉步驟，不允許新建 UNTIL_CONTACT_END modifier（RQ-023）。
- SUPPORTED 僅表示這份有限 fixture profile 可編譯，不保證任意跨卡互動皆有官方裁定。既有八個 BLOCKING 邊界仍會 fail-closed。

## Phase 3A Profile（目前 runtime 實作）

實際型別為 src/game/model.ts。Content 只接受此有限契約；下方 §1 起保留長期設計提案，並非可直接載入的 JSON Schema。三層身份是 ENGINE ARCHITECTURE，不推定一般重入後的次數、modifier 或 target 語義。

| 資料 | 目前契約 |
| --- | --- |
| Content | version、definitions、programs；複製／freeze，canonical SHA-256 contentFingerprint |
| CardDefinition 共通 | definitionId、printedId、name、recognizedNames、colors、support=VERIFIED_CORE、triggers；Character／Event 可選 cutIns |
| PARTNER／CASE／EVENT | Partner lp；Case firstLevel／secondLevel；Event level／programId，解完才 Remove |
| CHARACTER | level、ap、lp；keywords、disguise=true、mr=true、declarations 均可選 |
| CardInstance | instanceId、definitionId、ownerId、face、orientation、enteredTurn、entryId、attachment；可選 abilitiesSuppressed |
| FieldEntry | entryId、instanceId、ownerId、createdTurn、creation=PLAY／DISGUISE、status=PRESENT／LEFT／REPLACED、previousEntryId、grantedAbilities |
| Modifier | id、targetEntryId、sourceEffectId、stat=AP／LP、value、duration、scopeId |
| PlayerState | id、partnerId、caseId、chapter、traceDiscovered、assistReturnOnOwnAuto、zones |
| GameState | schema 3／engine 0.3.0／ruleset pdf-2.5+explicit-3a、contentFingerprint、玩家／cards／entries／modifiers、turn、choice、frames、pending、RNG、事件、收據、blocked／outcome |
| 新增選擇 | CONTACT_RESPONSE 帶 PASS／CUT_IN／DISGUISE 意圖；INVESTIGATION_ORDER 保存被調查玩家與公開候選 |
| Contact frame | id、雙方實卡、初始 priorityAP／priority、responses／responseIndex、step；Disguise 專用更新 carrier |
| Deduction frame | sampledLP 與 calculatedLP，保存計算時點結果，不在證據途中重新計算張數 |
| Investigation frame | playerId、deckOwnerId、sourceId、count、revealed、step；驗證來源、父指令及固定 keyword 張數 |
| Effect frame | immutable program／source 引用、cursor；foundCards 保存該次調查最初公開批次 |

所有 zones 陣列保存實卡 ID；index 0 是頂，FILE／Evidence 新卡置頂，DECK 的 MOVE 目前只支援置頂。SET／UNDER 為獨立持有容器，CardInstance.attachment={kind,hostEntryId} 連結宿主；FIELD 仍保存實卡 ID，再以 entryId 查 occurrence。PROCESSING 是內部暫存位置。registry／entry／foundCards 只是參照，84 張實卡恰有一個持有位置。

卡離場後 entry 封存，不刪除實卡身份／received modifier 記錄，也不裁定一般離場會使其失效。已確認 duration 仍能按 scope 移除 modifier。普通重入拒絕 RQ-027；沒有 Turn1／usage reset 系統。

Disguise 專用替換建立新 occurrence、previousEntryId 指向舊 occurrence；保留實卡定義 ID，官方明列的 orientation／received effects／granted abilities／set／under 明確轉給新 occurrence。只更新 Contact／Action 的指定 carrier，不提供通用 target rebinding。Disguise 與一般重入不能共用推定規則。

### EffectProgram 明示契約

~~~ts
type EffectProgram = {
  sourceRequirements: "INDEPENDENT" | "FIELD_ENTRY";
  targetSelectionPoint: "NONE" | "RESOLUTION";
  targetZone: "NONE" | "FIELD";
  duration: "INSTANT" | "UNTIL_CONTACT_END" | "UNTIL_ACTION_END" | "UNTIL_TURN_END";
  invalidTargetBehavior: "BLOCK";
  instructions: Instruction[];
  condition?: "TRACE_DISCOVERED";
};
~~~

不接受舊 instruction 陣列、未知欄位、任意 source read／跨區 target／重綁／未知 duration。來源要求 FIELD_ENTRY 必須有原 occurrence 且在解決時仍符合來源讀取要求；來源無須再讀的 program 明列 INDEPENDENT，因此來源離場或後來失效仍可解決。非 Character 或 Partner 區 MR 不能綁定 FIELD_ENTRY 讀取。MR Partner 能力只接受本輪明列區域且來源獨立的 program；不存在通用 PARTNER target fallback。

| Opcode | 本輪可審核參數／限制 |
| --- | --- |
| DRAW／GAIN_EVIDENCE | SELF／OPPONENT、固定 count；逐張，立即 Refresh 後續行 |
| REMOVE | SOURCE 或 OWN_CONTACT 的目前 Field 實卡 |
| MOVE | SOURCE、FIELD → HAND／REMOVE／DECK 頂；不支援從外區重新入場 |
| ACTIVE／SLEEP／STUN | SOURCE 或 OWN_CONTACT；走九格朝向及正式事件管線 |
| AP_MOD／LP_MOD | SOURCE 或 OWN_CONTACT、固定加減值、三種明示 duration；LP 在證據張數處理中改變會阻擋 RQ-012 |
| SET_CARD | 來源牌庫頂固定 count → SOURCE 附件；不足時依 p.20 Refresh 續行 |
| STACK_UNDER | 來源牌庫頂 0／1 張 → SOURCE underneath；批量下疊與移動現場宿主到 underneath 未支援 |
| INVOKE_KEYWORD | 固定 INVESTIGATE_X 文字；對手選公開批次的牌庫底排列 |
| Phase 1 相容 opcode | ADD_FILE、REMOVE_TOP、SET_SOURCE_STATE、REMOVE_SOURCE、SUPPRESS_SOURCE_ABILITIES；仍須包在明示 EffectProgram 中 |

INDEPENDENT Cut-in 可將 OWN_CONTACT 明列為解決時的目前 Contact 角色；這是本輪專用角色選取，不把 Disguise 視為所有舊目標自動重綁。SOURCE 需要相同 FieldEntry，否則 RQ-014。沒有任選卡片、跨區身份替代或未知目標自動跳過。

duration 保存具體 Contact／Action id 或 turn-N。簡單到期只刪除 modifier，留下診斷事件；MODIFIER_EXPIRED／STAT_CHANGED／DURATION_EXPIRED 不能成為可載入 trigger。於自己正在結束的 scope 新建同 scope modifier、到期衍生触發或未知 scope 一律 RQ-023，不重開窗口。

### Keyword、觸發與有限宣言

RAPID、ASSAULT、ASSAULT_CHARACTER、ASSAULT_CASE、BULLET、MISLEAD_X、INVESTIGATE_X、TRACE 均由資料判斷；MISLEAD 是旧合成 fixture 的 MISLEAD_X 別名。數字 X 必須為非負安全整數。同種重複或別名重複拒絕 RQ-028，不猜堆疊方式。

Trigger 保存 event、player=SELF／OPPONENT／ANY、programId，可選 subject=SOURCE／ANY、zones、TRACE_DISCOVERED 條件。event 白名單集中於 content/triggers.ts。Character 預設 FIELD；只有 MR 可明列 PARTNER。外來 grant 與印刷 trigger 分開，原能力失效不刪外來 grant 或已 pending 項目。FILE Partner 適用性仍 RQ-025。

PendingEffect 保存 id／controllerId／sourceId／programId 與有需要的 sourceEntryId。沒有 callback 或傳統 stack。原印刷與已存 grant 的固定 keyword X 不會被本 profile 的任何指令動態改值，已支付 Mislead／已觸發 Investigate 因此能在後來能力失效後續行；這不授權一般動態讀值。来源離場讀取仍 RQ-014。

cutIns=[{abilityId,programId}]；同張牌多個能力只選一個。declarations=[{abilityId,programId,zones,timing:"OWN_MAIN",cost:"NONE"}] 是有限合成卡文契約，不能省略區域，也不能把 program ID 當玩家任意執行入口。Partner MR 禁止推理／Action，只允許明列區域的 triggered／declaration。其他時機、成本、Turn1、usageLimit 及正式 MR 卡文仍未支援；不因無 Sleep 成本強制 ACTIVE。

SET／UNDER 中的卡不能按印刷 Character keyword 參與規則選取；裏向附件／底牌順序仍只存在可信宿主快照。PlayerView／隱藏資訊投影未實作；不向未來客戶端直接傳送 GameState。

### 序列化與版本

create／restore 載入錯誤使用 RuleError，提供 code 與 category；dispatch 回 structured rejection，規則未知為 UnsupportedRule／RULE_QUESTION_XXX。執行中未知保存 RULE_BLOCKED，停止但保留既有合法事實與續行。schema 1／2 拒絕，不靜默升級；內容 fingerprint／RNG algorithm 必須相符。

## 1. 四種身份必須分開

| 身份 | 欄位 | 意義 |
| --- | --- | --- |
| 印刷 ID | `printedId` | 官方卡面 ID；同 ID 異圖計入同一個最多 3 張限制（p.7） |
| 內容定義 | `definitionId` | 特定卡面／版本的不可變規則資料；可有相同 printedId 的不同美術版本 |
| 實卡 | `instanceId` | 一場遊戲的一張實體卡；即使同 definition 的 3 張也各自有唯一 ID |
| 場上角色存在 | `entityId` | 現場中的角色狀態承載者；變裝換實卡時保留需要繼承的狀態及參與位置 |

`cardNo` 是卡面編號，不與 `printedId` 或 `definitionId` 混用。場上卡名不是身份鍵。印刷 ID／編號保留字串，包括前導零、符號及版本差異，不轉數字。

Card Definition 不可變；局內修改不寫回 catalog。CardInstance 的 `definitionId` 在該局不變。變裝使用兩張不同 CardInstance，不把舊實卡 definitionId 改成新卡再複製舊卡回牌庫。

## 2. Card Definition JSON Schema

下列 JSON Schema 2020-12 是**卡片定義的結構契約**，可供未來匯出成 schema 檔。它不等於完整卡文 parser。`programId`／`conditionId` 等引用還須由內容驗證器檢查確實存在且版本相符。

完整 Color enum 未由 PDF 提供，因此 `colors` 使用非空字串陣列；正式資料必須通過外部已審核色表驗證（RULE-QUESTION-006），不能將範例顏色宣稱為完整枚舉。Case 的 `caseLevels.first/second` 不硬編碼為固定 7／6；以各卡印刷值為準（p.5）。Partner LP 也存卡面值，不假設所有未來卡一定為 1。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Conan TCG Card Definition - phase 1 proposal",
  "oneOf": [
    { "$ref": "#/$defs/partner" },
    { "$ref": "#/$defs/character" },
    { "$ref": "#/$defs/event" },
    { "$ref": "#/$defs/case" }
  ],
  "$defs": {
    "id": { "type": "string", "minLength": 1 },
    "ids": {
      "type": "array",
      "items": { "$ref": "#/$defs/id" },
      "uniqueItems": true
    },
    "source": {
      "type": "object",
      "additionalProperties": false,
      "required": ["sourceId", "version", "locator"],
      "properties": {
        "sourceId": { "$ref": "#/$defs/id" },
        "version": { "$ref": "#/$defs/id" },
        "locator": { "type": "string", "minLength": 1 }
      }
    },
    "ability": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "abilityId", "kind", "textJa", "iconIds", "activeZones",
        "validityConditionId", "triggerConditionId", "costProgramId",
        "effectProgramId", "keywordId", "keywordValue", "limit", "sources"
      ],
      "properties": {
        "abilityId": { "$ref": "#/$defs/id" },
        "kind": {
          "enum": ["CONTINUOUS", "TRIGGERED", "DECLARE", "CUT_IN", "DISGUISE", "INSPIRATION", "KEYWORD", "MR_RULE"]
        },
        "textJa": { "type": "string" },
        "iconIds": { "$ref": "#/$defs/ids" },
        "activeZones": {
          "type": "array",
          "items": { "enum": ["FIELD", "PARTNER", "CASE", "DECK", "EVIDENCE", "FILE", "REMOVE", "HAND", "SET", "UNDER", "PROCESSING"] },
          "uniqueItems": true
        },
        "validityConditionId": { "type": ["string", "null"], "minLength": 1 },
        "triggerConditionId": { "type": ["string", "null"], "minLength": 1 },
        "costProgramId": { "type": ["string", "null"], "minLength": 1 },
        "effectProgramId": { "type": ["string", "null"], "minLength": 1 },
        "keywordId": { "type": ["string", "null"], "minLength": 1 },
        "keywordValue": { "type": ["integer", "null"] },
        "limit": {
          "oneOf": [
            { "type": "null" },
            {
              "type": "object",
              "additionalProperties": false,
              "required": ["scope", "count", "countsAt"],
              "properties": {
                "scope": { "const": "EACH_TURN" },
                "count": { "type": "integer", "minimum": 1 },
                "countsAt": { "enum": ["TRIGGER", "USE"] }
              }
            }
          ]
        },
        "sources": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/source" } }
      }
    },
    "common": {
      "type": "object",
      "required": [
        "schemaVersion", "definitionId", "definitionVersion", "printedId", "cardNo",
        "type", "nameJa", "recognizedNames", "colors", "traits", "rarity", "textJa",
        "abilities", "supportStatus", "ruleQuestionIds", "sources"
      ],
      "properties": {
        "schemaVersion": { "const": "card-definition/1" },
        "definitionId": { "$ref": "#/$defs/id" },
        "definitionVersion": { "$ref": "#/$defs/id" },
        "printedId": { "$ref": "#/$defs/id" },
        "cardNo": { "$ref": "#/$defs/id" },
        "type": { "enum": ["PARTNER", "CHARACTER", "EVENT", "CASE"] },
        "nameJa": { "type": "string", "minLength": 1 },
        "recognizedNames": { "type": "array", "minItems": 1, "uniqueItems": true, "items": { "$ref": "#/$defs/id" } },
        "colors": { "type": "array", "minItems": 1, "uniqueItems": true, "items": { "$ref": "#/$defs/id" } },
        "traits": { "$ref": "#/$defs/ids" },
        "rarity": { "type": ["string", "null"] },
        "textJa": { "type": "string" },
        "abilities": { "type": "array", "items": { "$ref": "#/$defs/ability" } },
        "supportStatus": { "enum": ["VERIFIED", "RULE_BLOCKED", "UNREVIEWED"] },
        "ruleQuestionIds": {
          "type": "array",
          "uniqueItems": true,
          "items": { "type": "string", "pattern": "^RULE-QUESTION-[0-9]{3}$" }
        },
        "sources": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/source" } }
      }
    },
    "partner": {
      "allOf": [
        { "$ref": "#/$defs/common" },
        {
          "required": ["printedLP", "sharedRuleIds"],
          "properties": {
            "type": { "const": "PARTNER" },
            "printedLP": { "type": "integer" },
            "sharedRuleIds": {
              "const": ["partner.assist.v2_5", "partner.solve-case.v2_5"]
            }
          }
        }
      ],
      "unevaluatedProperties": false
    },
    "character": {
      "allOf": [
        { "$ref": "#/$defs/common" },
        {
          "required": ["printedLevel", "printedAP", "printedLP", "isMR"],
          "properties": {
            "type": { "const": "CHARACTER" },
            "printedLevel": { "type": "integer" },
            "printedAP": { "type": "integer" },
            "printedLP": { "type": "integer" },
            "isMR": { "type": "boolean" }
          }
        }
      ],
      "unevaluatedProperties": false
    },
    "event": {
      "allOf": [
        { "$ref": "#/$defs/common" },
        {
          "required": ["printedLevel", "useProgramId"],
          "properties": {
            "type": { "const": "EVENT" },
            "printedLevel": { "type": "integer" },
            "useProgramId": { "$ref": "#/$defs/id" }
          }
        }
      ],
      "unevaluatedProperties": false
    },
    "case": {
      "allOf": [
        { "$ref": "#/$defs/common" },
        {
          "required": ["caseLevels"],
          "properties": {
            "type": { "const": "CASE" },
            "caseLevels": {
              "type": "object",
              "additionalProperties": false,
              "required": ["first", "second"],
              "properties": {
                "first": { "type": "integer" },
                "second": { "type": "integer" }
              }
            }
          }
        }
      ],
      "unevaluatedProperties": false
    }
  }
}
```

### 2.1 結構之外必須驗證的語義

- `recognizedNames` 必須包含 nameJa，其他名稱須有官方依據；不從卡名大量 if/else 或正規式猜角色關係。名稱 normalization 規則獨立版本化。
- `abilityId` 在 definition 內唯一，program／condition 引用存在。`TRIGGERED` 必須有 trigger；`DECLARE` 有效果、成本可空；`KEYWORD` 指定已審核 keyword；`MR_RULE` 由 isMR 導出，不能依卡名猜測。
- `activeZones` 表達審核後適用區域。SET／UNDER／PROCESSING 是工程位置關係，不是官方第九到十一區；列在枚舉不表示能力一般可以在那裡生效。
- `supportStatus=VERIFIED` 表示該定義及程序均已核實，不代表其與所有其他卡的交互都已解答。未定互動仍可在 runtime 進 RULE_BLOCKED。
- `RULE_BLOCKED` 要附至少一個登錄中的問題；`UNREVIEWED` 不可作可執行正式卡；合成測試資料置於測試 manifest，不能混入正式卡表。
- `abilities` 的空陣列不等於批准未讀卡文的無效果卡。`textJa`、program 與資料來源須人工／工具核對。
- `count` 結構容許正整數作擴充；Ver.2.5 已確認的 icon 是 ①／②。未有來源的其他數值不可靠 schema 接受就宣稱合法。
- Case 的事件編／解決編是 runtime marker，同張卡的能力以 `requiredCaseStage` 條件控制；不建立另一張「解決編 Card Definition」來替換實卡。

### 2.2 DeckDefinition

| 欄位 | 型別／要求 |
| --- | --- |
| `partnerDefinitionId` | 指向 PARTNER |
| `caseDefinitionId` | 指向 CASE |
| `mainDeckDefinitionIds` | 有序／可重複的 40 個 definitionId，僅 CHARACTER／EVENT；初始輸入順序不免除洗牌 |
| `formatId` | generic-manual-v2.5 或日後已另核實賽事規則 |
| `contentManifestId` | 固定卡表版本 |

依 definition 的 printedId 加總最多 3；不能對 `mainDeckDefinitionIds` 設 uniqueItems，因為合法牌組可有同卡多張。createMatch 從每個 slot 分配一個 instanceId，再由引擎執行官方洗牌。

## 3. Card Runtime 與位置

**工程決策**：唯一持有位置由 zone 容器、Field entity 或 attachment／processing 容器決定；CardInstance 不另存一份易失同步的 `zone`／`index`。`locateCard(instanceId)` 從容器派生位置，效能索引是可重建 cache，不寫入 authoritative state。

### 3.1 CardInstance

| 欄位 | 型別 | 限制 |
| --- | --- | --- |
| `instanceId` | string | 局內唯一，洗牌、Refresh、移區不換實卡 ID |
| `definitionId` | string | 不可變，指向固定版本 catalog |
| `ownerId` | PlayerId | 不可變；依 p.8 不自動引入 control change 或對手區域所有權 |
| `face` | `UP / DOWN` | 和 orientation 分離；表向 Evidence 仍是 Evidence |
| `partnerRuntime` | `{ orientation: ACTIVE/SLEEP/STUN }` 或 null | 僅 Partner；enum 能保存狀態不等於批准未確認 Partner Stun 行為 |
| `characterRuntime` | `{ orientation: ACTIVE/SLEEP/STUN/null }` 或 null | 僅 Character；朝向存在實卡 runtime，才能保存 Partner 區 MR 等非現場角色的狀態。Field 角色不得為 null；其他區域如何轉換依已確認規則，未定時不預設 ACTIVE |
| `caseRuntime` | `{ stage: CASE/RESOLUTION }` 或 null | 僅 Case；初始 CASE，與 face 不同 |

Character 的場上存在資訊在 FieldEntity，朝向只有 CardInstance.characterRuntime 一份正規值；FieldEntity 不再保存副本。Character/Event 置於牌庫／手牌時仍有 CardInstance，但不因為印刷類型是 Character 就算作現場角色或能推理。Partner 區 MR 的宣言仍能讀取 characterRuntime；抵達該區時朝向如何轉換若無卡文確認，依 RULE-QUESTION-027 阻擋，不靠缺欄位預設可付 Sleep。

### 3.2 歷史 FieldEntity 提案（本輪採上方 FieldEntry）

| 欄位 | 型別 | 意義 |
| --- | --- | --- |
| `entityId` | string | 現場存在身份，用於 action／contact／已確認 duration 的參照 |
| `cardInstanceId` | string | 目前承載角色的實卡；變裝改此參照，新舊實卡 definitionId 均不變 |
| `ownerId` | PlayerId | 與 card owner 一致 |
| `orientation`（查詢值，非儲存欄位） | ACTIVE/SLEEP/STUN | 從目前 cardInstanceId 的 characterRuntime 派生，p.6 狀態 |
| `enteredTurnId` | string | 名乗り状態以目前 turnId 是否相同派生，不永久保存過期 boolean |
| `entryBatchId` | string | 記錄同時登場一批，供疾風判斷，不以陣列逐張插入打散同時性 |
| `setCardIds` | CardInstanceId[] | 正規持有容器，Set 卡各自 face；非獨立 Field 卡 |
| `underCardIds` | CardInstanceId[] | 正規持有容器，規則查詢僅提供數量 |
| `modifierIds` | string[] | 指向 state.modifiers 中的活動效果記錄 |
| `grantedAbilityIds` | string[] | 外來賦予能力記錄，與 definition.abilities 分開 |
| `abilitySuppressionIds` | string[] | 表示原能力／指定能力失效條件，不刪除 definition |

一般離場重入會有新的進場 occurrence 可供辨識；哪些外來效果／次數延續由規則決定，見 RULE-QUESTION-014、017、027。新 entity ID 是工程的事件識別，不預先裁定所有舊 target 都失效或所有計數歸零。

### 3.3 容器與實卡守恆

每玩家 zones：

| 容器 | 元素 | 順序／內容 |
| --- | --- | --- |
| `deck, hand, evidence, file, remove, partnerArea, caseArea` | CardInstanceId[] | index 0 是頂；hand 等沒有官方規定頂序的容器只作儲存。Partner 區可容納 Partner、MR 及核實特殊卡 |
| `field` | FieldEntityId[] | 最多 5 個穩定現場角色，順序不自動代表先後優先權 |
| `FieldEntity.setCardIds / underCardIds` | CardInstanceId[] | 兩類分開，不能同時也在 Remove／Field 等容器 |
| `processing[processingId].cardIds` | CardInstanceId[] | 處理中 Event／ヒラメキ等暫存實卡，附 owningFrameId 與使用途徑 |

`players[p].partnerInstanceId / caseInstanceId` 是永久 lookup 參照，**不是另一個持有位置**。Partner Assist 從 partnerArea 搬到 file，沒有複製；FILE quantity 可直接含該實卡計數。Field 的實卡由 entity.cardInstanceId 持有一次，`instances` registry 本身不是另一個 zone。

每張初始實卡在任意可保存的 state 中恰有一個持有位置。索引、pending 的來源 snapshot、revealed 集合與玩家已知資訊只是參照，不加到張數。兩人合法開局有 84 張實卡；目前手冊沒有建立新實卡／token 的一般規則，不自行添加。

移動須原子更新容器，不能向外保存「舊位置與新位置各有一張」的半成品；效果多步可以暫停，但每個已提交 state 必須保有守恆及 referential integrity。

### 3.4 Phase 3A 變裝的身份轉換

~~~text
原始：Field → C1 → Entry E1（PRESENT）
      Hand → C2（definition D2，有有效變裝）

替換：C1 裏置自己 Deck 底；E1.status=REPLACED
      Field → C2 → 新 Entry E2（previousEntryId=E1）
      朝向／received effects／grants／set／under 依 p.18 繼承
      Contact／必要 Action carrier 明確換成 C2
      發出 DISGUISED，沒有普通 CHARACTER_ENTERED
~~~

C1／C2 的 definitionId 均不改。建立 E2 是 ENGINE ARCHITECTURE，並非一般重入或其他 target 的裁定。來源離場讀值、限次與 MR 交互依對應 RULE-QUESTION 阻擋。

## 4. AuthoritativeGameState 完整保存範圍

所有欄位只含 JSON object、array、string、finite number、boolean 或 null。整數須在選定語言的安全整數範圍；需要很大計數時用具格式驗證的字串，不放 BigInt。無值明示 null，不用 undefined。ID 用單調 counter 分配或接受已保存 ID，不依當前時間。

| 頂層欄位 | 必須保存的內容 |
| --- | --- |
| `versions` | stateSchema、engine、ruleset、contentManifestId／contentHash、programManifestHash、rngAlgorithm |
| `matchId / revision / nextIds` | 局識別、接受指令版本、下一個 instance/entity/frame/effect/choice/event 的可重現計數 |
| `players / playerOrder` | 恰兩個座位 ID、Partner/Case lookup、所有 zones、痕跡狀態 |
| `setup` | firstPlayerId 可空、每人開局步驟／換牌完成狀態、是否已公開 Partner/Case |
| `turn` | turnId、遞增 turnNumber、turnPlayerId、phase；Setup 時可空 |
| `turnLedger` | 每玩家 usedNormalHandPlay、usedNextHint；每玩家本回合第一批登場 batchId；每能力使用／觸發次數 |
| `instances / entities` | 上節所有實卡與 Field entity 資料 |
| `processing` | 尚未放回正式區域的處理中實卡及 owningFrameId，不是漏算實卡的暫存變數 |
| `machine` | status、activeFrameId、frames、awaitingChoice、ruleBlock；所有可恢復步驟 |
| `pendingEffects` | 以 effectInstanceId 的 record；controller/owner、來源、program、trigger 事實與已知 bindings |
| `modifiers / grantedAbilities / suppressions` | 活動效果、來源、參照、duration 及有效性；registry program 引用，不存函式 |
| `rng` | 私密的 PRNG state／cursor 與同版本算法識別 |
| `knowledge` | 目前 reveal／look 的授權接收者、範圍、程序期限與 revealedRefs；不自動准許看其他裏牌 |
| `historyCursor / commandReceipts` | event sequence／log 位置、commandId→payloadHash／resultRevision 等重送資訊；完整 log 由未來 persistence 保存 |
| `outcome` | null 或明確的 winnerId／loserId／reason／atEventSequence；未知平手放 ruleBlock，不填猜測結果 |

`pendingEffects` 用 record 而非堆疊；UI 排列順序不是效果規則優先順序。`outcome` 一旦確認就不再接受遊戲操作；技術故障／斷線不填入官方敗北 reason。

### 4.1 ChoiceRequest

每個 choice 保存 `choiceId, actorId, kind, createdAtRevision, owningFrameId, resumeAt, selector, min, max, distinct, allowDecline, visibility`。selector 是可序列化查詢描述或已合法鎖定候選 ID，不能存函式。哪些候選在回應時須重算由該程序明訂，沒有通用 target 重選規則（RULE-QUESTION-014）。

例如 Contact choice 必須保存是 FIRST／SECOND／FIRST_RETRY，並只給該玩家可用一次的 Cut-in／Disguise／pass。pending effect choice 只能選目前具有優先權玩家自己的 pending；不是用 turnPlayerId 硬套所有選擇。

對方看不到 choice 內隱藏牌的 definitionId。當 UI 回傳過期 choiceId 或不合法選擇，拒絕這次 command，保留當前合法 state 和同一 choice。

### 4.2 PendingEffect 與來源 snapshot

```json
{
  "effectInstanceId": "fx-12",
  "controllerId": "player-a",
  "source": {
    "instanceId": "card-18",
    "entityIdAtTrigger": "entity-4",
    "definitionId": "fixture-character-trigger",
    "abilityId": "ability-on-entry"
  },
  "programId": "fixture.draw-one.v1",
  "programVersion": "1",
  "triggerEventSequence": 63,
  "triggerBindings": {},
  "capturedFacts": {
    "sourceZoneAtTrigger": "FIELD"
  }
}
```

這是合成資料形狀，不是假裝某張官方卡。保存來源 snapshot 是為了找回已觸發能力及已發生事實，**不代表自行採用 last-known AP/LP／target 規則**。若某一 program 的取值時點未確認，標 RULE-QUESTION-012／014。已觸發效果不因 source 後來在牌庫而丟失；不要依賴 source 必須仍在 Field 才能找到 program。

### 4.3 Modifier 與 duration

Modifier 保存 `modifierId, sourceEffectId, targetRef, operation, value, duration, origin`。第一階段明示可建模的數值操作是加減 AP／LP／Level 與 p.27 的原 AP／LP=0；其他運算新增 opcode 前先審查卡文。

| Duration kind | 必存 scope | 已確認用途 |
| --- | --- | --- |
| `UNTIL_DEDUCTION_END` | deductionId | Mislead LP 減值 |
| `UNTIL_CONTACT_END` | contactId | Cut-in AP 加值 |
| `UNTIL_ACTION_END` | actionId | Action 期間效果 |
| `UNTIL_TURN_END` | turnId | 到回合結束效果 |
| `WHILE_CONDITION` | conditionId／sourceRef | 持續能力的有效條件，由審核後 program 決定 |

相同 kind 不同 scopeId 不一起清除。原印刷數值／活動 modifier／派生當前數值分開；`currentAP/currentLP/currentLevel` 預設由 evaluator 算，不持久化另一份可能失同步的值。供程序確定數量的快照只在取值時點已確認後存 frame.locals。

## 5. 效果系統的資料化契約

採用審核後的 IR（intermediate representation，結構化效果指令），不直接在對局時分析日文，也不以卡名 if/else 決定效果。

```text
官方卡文 + 頁碼／卡號來源
  → 人工／工具輔助語義整理
  → 已審核 Ability / Cost / Condition / EffectProgram
  → schema 與引用驗證
  → immutable program registry
  → runtime 用 opcode + frame cursor 執行
```

可以對 `opcode` 使用有限的 switch／handler map；禁止把 `nameJa === ...` 當效果派發機制。規則需要比較名稱時（例如絆）使用通用名稱 predicate 和已核實 recognizedNames，這與用名稱寫卡牌專屬效果分支不同。

### 5.1 不合併的四層

| 層 | 責任 |
| --- | --- |
| Ability Definition | 如何持有、在哪些區有效、是否發動／可用、限次與卡文 |
| Cost Program | 驗證全部可付及 COST 因果，不能當一般「盡可能」效果執行 |
| Effect Program | 按句序執行、選擇、結算時條件、已確認即時規則及剩餘量 |
| Pending Scheduler | 何時可以開始解決哪個 effectInstance，回合玩家優先與玩家選序 |

### 5.2 第一階段候選 opcode

這是支援 p.10–27 已確認語義的最小 vocabulary，並非宣稱所有卡都能表達。每個 opcode 未來需有封閉參數 schema、執行契約、source refs 與 meaningful test。

| 類別 | 表達式／opcode | 必要參數與限制 |
| --- | --- | --- |
| Sequence | `SEQUENCE` | 有序 nodeIds；每個子指令不自動 drain 普通 pending |
| 分支 | `IF_AT_RESOLUTION` | conditionId、then／else nodeId；不在觸發時預判 |
| 可選 | `MAY` | actorRef、childNodeId、onChosen／onDeclined；「如此則」讀實際執行結果 |
| 選擇 | `CHOOSE_CARDS` | actorRef、selector、min/max、distinct、bindAs、visibility |
| 抽／移牌 | `DRAW / GAIN_EVIDENCE / ADD_FILE / SET_FROM_DECK` | playerRef、quantity、逐張／Refresh 後續做 |
| 看／公開 | `LOOK_TOP / REVEAL_TOP` | playerRef、quantity、閱覽權限、bindAs；仍在牌庫 |
| 效果移除頂牌 | `REMOVE_TOP_AS_EFFECT` | quantity、不足盡可能／Refresh 後不補差額 |
| 一般搬移 | `MOVE_SELECTED` | refs、目的地、top/bottom、face、已核實 cause；不泛化成任意跨玩家區 |
| 朝向 | `SET_ORIENTATION` | targetRef、ACTIVE/SLEEP/STUN；成本可付性另層判定 |
| 數值 | `ADD_STAT / SET_PRINTED_BASE_ZERO` | targetRef、stat、value、duration；競合規則另 gate |
| 能力 | `GRANT_ABILITY / SUPPRESS_ORIGINAL_ABILITIES` | 審核過的 abilityRef／duration；MR 例外保留 |
| 附件 | `SET_CARD / PUT_UNDER` | hostRef、cardRefs、face／來源要求；兩機制分離 |
| 捜査 | `INVESTIGATE` | X、opponentRef、revealedBinding、由對手選底序 |
| 程序調用 | `START_CONTACT` | 明確雙方角色與判定主體、返回點；卡文欠缺則 RULE-QUESTION-024 |
| 即時規則 | `REPLACE_PROPOSED_EVENT / NEGATE_EFFECT` | 明確適用 predicate 與被替代／無效對象，不產生自由回應 stack |

`CostProgram` 的 `REQUIRE_EXACT_DECK_REMOVE`、`SLEEP_SELF`、`REMOVE_OWN_SELECTED` 等使用全額可付語義；不能轉成表中普通效果移除 opcode。多成本的額外順序須依 RULE-QUESTION-015 補充。

### 5.3 可恢復 program 範例

下例只表達 p.18 說明的 Cut-in AP+2000，示意 program 結構。Cut-in 的「卡先到 Remove」、每人一次與回應順序由 procedure 管，不寫進每張卡 program 重複實作。

```json
{
  "programId": "manual.cut-in.ap-plus-2000.v2_5",
  "programVersion": "1",
  "supportStatus": "VERIFIED",
  "sources": [
    { "sourceId": "official-manual", "version": "2.5", "locator": "p.18 カットイン AP+2000" }
  ],
  "entryNodeId": "apply-ap",
  "nodes": {
    "apply-ap": {
      "opcode": "ADD_STAT",
      "target": { "kind": "OWN_CONTACT_ENTITY" },
      "stat": "AP",
      "value": 2000,
      "duration": { "kind": "UNTIL_CONTACT_END", "scopeFrom": "currentContactId" },
      "nextNodeId": null
    }
  }
}
```

上述 VERIFIED 僅指此手冊例示語義；不代表匯入任意帶相似卡名的卡。執行 frame 保存目前 nodeId、bindings、剩餘操作和 returnTo，registry 不保存 callback 到 state。未知 node／opcode／condition 一律顯式錯誤或 RULE_BLOCKED，不可當 no-op 繼續。

能力失效時仍保留 program reference 與 printed ability；evaluator 分別回答 `hasIcon`、`abilityIsValid`、`effectIsValid`。已 pending 的 effect 使用既存發動事實，明確 negate 記錄另行處理（p.21–22、27）。

## 6. 版本、序列化與資訊投影

### 6.1 序列化 invariant

1. 所有 Game State 可 JSON round-trip，包含 pending、processing、frames、選擇、modifier、RNG、RULE_BLOCKED。
2. 無 function、closure、Promise、generator、class instance、DOM、Date、Map／Set、BigInt、undefined、NaN、Infinity 或循環引用。需要集合以陣列／record 保存並驗證去重。
3. 所有引用可解析；registry 版本缺失不啟動恢復。來源已離場不等於 definition／program 不可解析。
4. 容器為唯一位置來源，任何實卡只被持有一次；attachment host 存在、關係無循環；穩定 Field 最多 5。
5. Hash 以固定 canonical JSON 規則產生（物件鍵排序、陣列維持順序）；不能直接假設不同語言的普通 stringify 有相同順序。
6. Schema migration 必須有版本與測試；source／content 修改後不得默默對同 Replay 產生不同結果。

### 6.2 Authoritative state 不等於 PlayerView

| 資料 | 完整 state | 玩家投影 |
| --- | --- | --- |
| 己方手牌 | 實卡 ID／定義 | 己方可見；對手不得收到定義 |
| 牌庫 | 真實順序、實卡 ID | 不傳真實順序／穩定可追蹤 card IDs；公開／查看只按有效 effect 授權 |
| 裏向 Set | 保留原始 definition 供未來翻出 | 連擁有者都不能確認正面（p.23） |
| 下疊卡 | 保留實卡資料以供搬移 | 規則只提供數量（p.23），不因此刪掉 server 身份 |
| FILE／Evidence 裏向卡 | 實際資料與 face | 完整自身查閱權仍待 RULE-QUESTION-021；不能一律以 owner 身份公開 |
| 捜査 | revealedRefs 與真實底序 | 公開卡可以顯示，被捜査者選的底序不必公開（p.25） |
| PRNG／完整 event log | 受保護保存 | 不直接傳出，避免推算洗牌或洩漏牌序 |

隱藏區域使用 opaque view token／數量；當移到不可追蹤位置或洗牌後不能靠穩定 instanceId 泄漏原卡去向。公開過的卡並不授權 UI 看到之後秘密重排的對應身份。連線的玩家座位與 viewer token 由 Server 驗證，不能讓客戶端任意切換查看對手手牌。

哪些數量、過去公開資訊、可看裏牌的完整規則仍待 RULE-QUESTION-021。先建立投影介面及已確認的保密 invariant，不把未確認的預設遮蔽當正式遊戲裁定。

## 7. 文件驗證與未實作邊界

本文件提供四卡種的 JSON Schema、Runtime／GameState 欄位契約、效果 IR 與版本／投影要求；不是已可執行的 schema package，也沒有完整卡表。

Phase 1 已從 game-flow.md 的 UT-001–089 選定 P0；Phase 2 補上主要行動與審查案例，對照見 phase2-results.md。RQ-011 已按本輪確認解決，其餘未定結果不寫成 gameplay expected，也不以程式預設值冒充裁定。
