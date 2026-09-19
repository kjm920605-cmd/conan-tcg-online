# Phase 5A Online Multiplayer MVP Implementation Plan

日期：2026-09-08。使用 brainstorming／writing-plans／TDD 與 subagent-driven-development 技能延續已授權實作，保留 Phase 4 桌面與所有 210 tests／5 E2E。不需重新確認已明列需求。工作區無 Git repository。

## 設計

採漸進式單 workspace：`apps/server` 為入口，`src/server` 為 room/session/match/transport，`packages/protocol` 為 shared runtime validated protocol，`src/client` 為 GameClient／OnlineGameClient。既有 `src/game` 與 `src/cards`／data 是唯一共用引擎／內容來源，Local 與 Server 直接引用；不為資料夾外觀複製引擎或搬動 210 項基準。之後可分拆 workspace package 而不改接口。

Node.js + TypeScript + ws + Zod。只加 Local/Online、Create/Join、Ready、Room code 與連線資訊，牌桌本體仍由 App 消費 GameClient snapshot。Online client 不載入／執行 Engine，不接收完整 snapshot，沒有 dev export/import 能力。Local client 維持 Phase 4 功能。

Server 單執行緒同步處理每次 gameplay transaction：protocol → session → match → idempotency → stateVersion → decision owner/id → Engine.dispatch → bounded auto advance → stateVersion + 1 → projection。stateVersion 是一次已接受 command 及其自動續行的整體版本；Engine revision 保持原逐步語義。

匿名 session 由 server 產生 playerSessionId／高熵 resumeToken，僅發給該 socket。roomCode 是分享識別碼，不是授權。Resume 驗 token 後綁回原 seat；新連線取代旧連線，旧連線不可再提交。Disconnect 不判負、不改遊戲版本。Leave 明確離開房間但不更改已進行遊戲結果；可保留 reconnect 資格直到 server 記憶體清除。

## 協作接口（固定契約）

`packages/protocol/index.ts` export `ClientMessageSchema`, `ServerMessageSchema`, `ClientMessage`, `ServerMessage`, `PlayerPacket`, `RoomState`, `IntentSchema`。

Client union（全部 strict object）:

```ts
{type:'CREATE_ROOM'} | {type:'JOIN_ROOM',roomCode:string} | {type:'LEAVE_ROOM'} | {type:'READY'}
| {type:'RESUME_MATCH',playerSessionId:string,resumeToken:string}
| {type:'RESYNC',matchId:string}
| {type:'GAME_COMMAND'|'RESOLVE_DECISION'|'MULLIGAN',commandId:string,matchId:string,expectedVersion:number,payload:Intent}
```

Server union:

```ts
{type:'SESSION',playerSessionId:string,resumeToken:string}
| {type:'ROOM_STATE',room:RoomState}
| {type:'MATCH_STARTED'|'GAME_VIEW'|'RESYNC_STATE',packet:PlayerPacket}
| {type:'COMMAND_ACCEPTED',commandId:string,matchId:string,stateVersion:number,duplicate:boolean}
| {type:'COMMAND_REJECTED',commandId:string|null,code:string,message:string,stateVersion:number|null}
| {type:'PENDING_DECISION',matchId:string,stateVersion:number,decision:PendingDecision|null}
| {type:'PLAYER_CONNECTED'|'PLAYER_DISCONNECTED',playerId:string,matchId:string|null}
| {type:'RULE_BLOCKED',matchId:string,stateVersion:number,questionId:string}
| {type:'GAME_FINISHED',matchId:string,stateVersion:number,outcome:{winnerId:string,loserId:string,reason:'EMPTY_DECK'|'CASE_SOLVED'}}
```

`RoomState={roomCode:string,status:'WAITING'|'PLAYING'|'FINISHED'|'RULE_BLOCKED',seats:{playerId:'A'|'B',occupied:boolean,ready:boolean,connected:boolean,deck:'Fixture Deck A'|'Fixture Deck B'}[],matchId:string|null}`.

`PlayerPacket={matchId:string,stateVersion:number,view:PlayerView,legalActions:LegalAction[],decision:PendingDecision|null}`. Decision 的 id/playerId/kind/candidates/actions 沿 Phase 4 命名，外層 stateVersion 與 decision.id 一起驗證。非 owner 的 WAITING 不含 private candidates/actions。

Server factory `createGameServer({content,port?:number,host?:string,matchOptions?:()=>CreateOptions,rng?:Rng})`：預設 host127.0.0.1／port8787；測試 port0 可取得實際 port，host 輸入明示供 LAN；回 `{port,close():Promise<void>, ...}`。matchOptions/rng 是可信 server fixture 注入，不是網路 payload；不允許 Browser 指定 seed／deck。

## Tasks / gates

- [x] 1. Protocol：以 Zod strict schema 驗所有 client/server payload，包括每個 Engine Intent、完整 PlayerView 僅允許合法欄位；先 malformed/spoof/unknown-state tests 再實作。
- [x] 2. Server：RoomManager、MatchManager、匿名 session、ws transport；測試 roomfull／ready／owner／version／duplicate／disconnect／resume，所有修改只經原 Engine。
- [x] 3. GameClient：抽取共用 snapshot/接口，LocalController 相容；OnlineGameClient 只儲存 projection 與 session credential，不引入 Engine／卡牌資料。Wire 收送均 runtime validate；disconnect disables actions，resume/resync 重新接收最新 view。
- [x] 4. UI：沿用 App，local dev tools 變為可選能力；online lobby / mode link / room status / waiting / reconnect。Local bootstrap 動態隔離，不在 online mode 建立 local Engine。
- [x] 5. 真實 ws two-client integration：完整房間至對局、Deduction／Action／Guard／Contact／response，断線重連、stale／duplicate／invalid／private payload。用 server-side deterministic fixture options，不改任何規則。
- [x] 6. Browser：兩個獨立 context 加入／ready／mulligan／多回合／遊戲終局與 reload resume；保留全部 Phase 4 E2E。
- [x] 7. 唯讀安全／規格審查，修復具體缺陷，npm test／regression／typecheck／demo／build／E2E。
- [x] 8. 更新 README／docs/phase5a-results.md，列出測試、隐私與重連驗證、限制、全部新增修改，完成後停止。

## 固定界線

RQ-002、009、012、013、014、023、025、027 仍 BLOCKING；structured rejection／RULE_BLOCKED 保留，不自行 pass 或判負。沒有 Account、DB／Redis、Ranking、Matchmaking、Deck Builder、正式卡池或 production deployment。

只提供開發用 in-memory server；server restart 不保留對局。Transport 包含 max payload 與 malformed 處理，不將 room code 當 session；token 不輸出 log／不廣播。所有接受／拒絕的網路 schema 均須測試。Scope 內 unknown optional/generic effect 與 Phase 4 一樣只呈現 Engine 目前已支援的 decision，不新增遊戲語義。
