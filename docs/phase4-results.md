# Phase 4 Local Playable UI Results

日期：2026-09-08。已完成本機／hot-seat playable client，停止於 Phase 4；未建立 Online Multiplayer、Account、Matchmaking、Database、Ranking 或 production deployment。

## 可操作成果

React + TypeScript + Vite 延續單一 workspace，沒有重寫 Game Engine。兩套固定 Fixture Deck A／B 各 40 張，全部從既有 SUPPORTED Definition 編入；總 catalog 仍為 28 FIXTURE、24 SUPPORTED／1 PARTIAL／3 BLOCKED，正式卡 0 張。

執行 `npm run dev` 後開啟 [本機牌桌](http://127.0.0.1:5173/)。依畫面指定玩家 Ready → Mulligan → 輪流遊玩。主操作、來源／目標 highlight、不可用原因、Guard／Mislead／Contact 回應、Cut-in／Disguise、效果解決順序、Next Hint 選卡及調查排序皆由 Engine-facing adapter 提供資料。

雙方桌面顯示 Field、Partner、Case、Evidence、FILE、Remove、Deck count；自己的 Hand 卡面與對方 Hand count 分開。可見角色呈現名稱、Level、有效 AP／LP、orientation、keyword、Set／underneath count 與暫時 modifier。ACTIVE／SLEEP／STUN 同時用文字與邊框提示。

## 架構與隱私

`UI → LocalController → Command → GameEngine.dispatch → Validation → State + Events → PlayerView → UI`。Component 不讀取完整 GameState，不實作名乗り、Level、Case color、Guard、Deduction、Next Hint 或 keyword 合法性。

- `GameEngine.preview(actorId, intent)`：對隔離的 state 副本走真實 dispatch；查詢不提交 state、receipt、events 或 RNG。只驗目前指令能否接受，不冒稱預先保證所有未來效果的結果。
- `getLegalActions`：列舉候選來源／目標，逐項交 Engine preview；保留真實錯誤 code/category。
- `getPendingDecision`：ACTIONS、MULTI_SELECT、ORDERED、WAITING。多選與排序提交的最終陣列仍由 Engine 驗證，沒有按卡名分支。
- `projectGameState`：own hand 與當前 face-up 卡可見；其他卡只有匿名 placeholder。對方手牌／牌庫及裏置 FILE、Evidence、Set、underneath 不露出 instance/definition ID。調查明示公開的牌可見，重新裏置後從整個投影移除身份。
- Event log 只呈現 Engine 既有事件；不複製可能含 private ID 的任意 detail/cause。歷史事件卡名按當前可見性保守過濾。程序只呈現 kind／step／player，沒有 raw frame payload。
- required actor 優先使用 choice.playerId，涵蓋回合中的 Mislead、Guard、Contact、效果選序。換人時同步清空 view/actions/decision，React 直接卸載 board 與 DevPanel，Ready 之前不渲染另一手牌。
- UI 新增 snapshot 操作只呼叫可信宿主 Engine.restore；不提供 state setter。無效匯入保留目前對局。成功匯入與 reload 先鎖定 viewer；Ready 透過 Engine 繼續中途 automatic frames。
- canonical SHA-256 改用跨平台實作，與 Node crypto 的 Unicode／長字串指紋比對一致。schema 3／engine 0.3.0／ruleset 不變，沒有隱式 snapshot migration。

本機 localStorage 自動保存完整快照；DevPanel 僅 development mode 提供，Reveal／Export／Copy 明示包含雙方私密資訊，使用者主動操作後才顯示。交接會卸載已 Reveal 的資料。這是同機可信 host，無法防止實體共用電腦使用者讀取 localStorage／開發者工具；未將它描述成 server security boundary。production build 沒有 DevPanel 文案或介面。

## 測試與品質 Gate

| 驗證 | 實際結果 |
| --- | --- |
| npm test | 210 / 210，0 failed／skipped |
| npm run test:regression | 210 / 210，包含原全部 185 項 |
| npm run typecheck | 通過 |
| npm run demo | 原三個 demo 通過；含 CASE_SOLVED 與所有既有 restore/replay 比對 |
| npm run build | 通過；104 modules，JS 約 310.37 kB，gzip 約 91.79 kB |
| npm run test:e2e | 5 / 5，Playwright + Microsoft Edge（Chromium） |
| pnpm frozen lockfile offline 檢查 | 通過 |
| 桌面與窄螢幕視覺檢查 | 1440×1000／390×844；無頁面橫向溢出 |

保留原 185 tests，新增 25 個 Node／SSR／controller tests；E2E 另計 5 項，不能將 regression 再次執行重複加總。

| 新增測試檔 | 數量 | 覆蓋 |
| --- | ---: | --- |
| browser-hash.test.ts | 1 | browser SHA-256 與既有 canonical fingerprint 相容 |
| player-view.test.ts | 3 | 隱私投影、所有裏置區域、調查公開後重新遮蔽 |
| legal-actions.test.ts | 5 | preview 無副作用、Partner／FILE RQ、Mislead 多選、調查排序、Mulligan ownership |
| local-controller.test.ts | 5 | Ready／handoff、無效 command/import 原局不變、subscription、兩套 deck、中途 auto restore |
| local-gameplay.test.ts | 9 | Next Hint、Deduction、Mislead、Action、Guard、Contact、Cut-in、Disguise、效果順序、調查、RQ、restore、完整對局 |
| ui-render.test.ts | 2 | 初始／Ready board、卸載舊手牌、普通 render 不匯出 state |

Local gameplay 測試以 Engine commands 建立情境後交 LocalController 操作，沒有直接竄改 state。每次 required actor 改變都檢查 view/actions/decision 在 Ready 前清空，並檢查投影對方手牌沒有 ID／name。

五條 browser test：

1. 初始交接 → Ready → 桌面與 Mulligan → 下一玩家交接 → reload 再次遮蔽。
2. Assist → RQ-025 提示 → Next Hint／Decline → FILE 僅 Partner 的 RQ-009 → Reveal dev snapshot → End Main 後 private DOM／DevPanel 卸載。
3. Export Snapshot 下載 → invalid import 保留原局 → valid import → Ready → 恢復相同 revision／可操作 UI。
4. Setup → 雙方 Mulligan → play card → 多回合 Partner Deduction／End Main → 正常 EMPTY_DECK 終局；完整操作使用瀏覽器按鈕，沒有測試終局捷徑。
5. 390px 窄螢幕無橫向溢出，仍可 Next Hint／Decline。

完整 browser match 驗證的是正常 Loss 路徑；Case Solve 的既有 Engine tests／CLI demo 仍通過，UI 由同一 SOLVE_CASE legal action 提供按鈕。特殊 Contact 回應／Disguise 的深入覆蓋位於 controller integration，沒有宣稱每一種互動都有獨立 browser E2E。

開發過程先重現缺少 projection／hash／controller／App 的失敗；中途 restore 卡在 AUTO 的測試先紅後綠，修正 Ready 時呼叫 Engine bounded advance。唯讀邊界審查見 [phase4-review.md](phase4-review.md)，未留下已知隱私／合法性阻擋缺陷。

## UI 限制

- 第一版沒有卡圖、動畫、AI 對手、deck editor 或 replay timeline；操作採清楚列出的 command 按鈕，密集牌局需要滾動。
- 引擎尚未提供泛用 optional effect／generic target decision 語義；通用 ACTIONS presentation 可呈現 Engine 提供的可選操作，沒有為未知卡文新增選擇或猜測 fallback。現有可選項（Next Hint、Guard、Mislead、Contact Pass）均可完成。
- 名稱與 opcode／事件種類保留英文，主要操作提示為繁體中文；部分 unavailable reason 保留原 Engine code。
- 可見事件保守省略自由文字細節，避免洩漏曾移入隱藏區域的卡身分。DevPanel 的 private capture 為手動擷取，更新需重新 Reveal。
- localStorage 與 dev snapshot 是可信本機功能；尚無加密、PlayerView 網路 transport 或正式 hidden-information security protocol。
- 自動流程按 Engine 推進至下一決策，不播放 Auto／End 每一步動畫。超過 automatic step budget 或 Engine error 明確顯示診斷，不自動代答。
- 本環境 Chromium 下載端點多次逾時，改用已安裝 Microsoft Edge；未驗 Safari／Firefox。
- 完成對局後保留終局畫面與 snapshot；新對局可重新建立本機快照，沒有大廳或多對局管理。

## BLOCKING Rule Questions

RQ-002、009、012、013、014、023、025、027 **全部仍為 BLOCKING**。UI 顯示 Unsupported Rule 與 RQ 編號，拒絕未支援指令或保留 Engine RULE_BLOCKED 診斷；不猜測、不靜默 pass、不繼續被阻擋程序。

官方 PDF、原整理規格、正式資料與 RULE-QUESTION 分類未變。來源 SHA-256：

- PDF：2a3caf3372e66656cd9ac0c5ba9dc8fc4177c176317f4f97086975c1c9e65d41
- 原整理規格：6680c33973b48c215dec2c40459ab31842afba368ada670a266be0864a08540b

## 新增／修改檔案

工作區沒有 Git repository；以下為本輪實際檔案清單。node_modules、cache、dist、Playwright artifacts 與 tmp 視覺檢查 PNG 不列為原始碼交付。

新增 24 個：

- [index.html](../index.html)
- [vite.config.ts](../vite.config.ts)
- [playwright.config.ts](../playwright.config.ts)
- [src/game/persistence/hash.ts](../src/game/persistence/hash.ts)
- [src/game/client/index.ts](../src/game/client/index.ts)
- [src/local/controller.ts](../src/local/controller.ts)
- [src/local/decks.ts](../src/local/decks.ts)
- [src/ui/App.tsx](../src/ui/App.tsx)
- [src/ui/styles.css](../src/ui/styles.css)
- [src/ui/main.tsx](../src/ui/main.tsx)
- [src/ui/browser-content.ts](../src/ui/browser-content.ts)
- [src/ui/env.d.ts](../src/ui/env.d.ts)
- [tests/browser-hash.test.ts](../tests/browser-hash.test.ts)
- [tests/player-view.test.ts](../tests/player-view.test.ts)
- [tests/legal-actions.test.ts](../tests/legal-actions.test.ts)
- [tests/local-controller.test.ts](../tests/local-controller.test.ts)
- [tests/local-gameplay.test.ts](../tests/local-gameplay.test.ts)
- [tests/ui-render.test.ts](../tests/ui-render.test.ts)
- [e2e/local-play.spec.ts](../e2e/local-play.spec.ts)
- [docs/phase4-plan.md](../docs/phase4-plan.md)
- [docs/phase4-engine-report.md](../docs/phase4-engine-report.md)
- [docs/phase4-ui-report.md](../docs/phase4-ui-report.md)
- [docs/phase4-review.md](../docs/phase4-review.md)
- [docs/phase4-results.md](../docs/phase4-results.md)

修改 9 個：

- [README.md](../README.md)
- [package.json](../package.json)
- [pnpm-lock.yaml](../pnpm-lock.yaml)
- [tsconfig.json](../tsconfig.json)
- [.gitignore](../.gitignore)
- [src/game/engine/GameEngine.ts](../src/game/engine/GameEngine.ts)
- [src/game/persistence/json.ts](../src/game/persistence/json.ts)
- [docs/card-schema.md](../docs/card-schema.md)
- [docs/game-flow.md](../docs/game-flow.md)

npm 安裝暫時生成的 package-lock 已移除，維持既有 pnpm-lock 為唯一 lockfile。套件與基礎工具參考官方 [Vite 指南](https://vite.dev/guide/)、[Playwright webServer](https://playwright.dev/docs/test-webserver)、[noble-hashes](https://github.com/paulmillr/noble-hashes)，未引入外部遊戲規則來源。

Phase 4 到此停止，不進入 Online Multiplayer。

