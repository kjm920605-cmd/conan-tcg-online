# Railway integration review

日期：2026-09-13。範圍：獨立 Web host、ticket admission、UI reconnect、proxy IP、deployment singleton；Game Engine／rules／data 不修改。

## P2：已到期的閒置 socket 仍收到資料

獨立審查以真實 WebSocket 重現：A 的有效 Alpha cookie 剩約 3 秒，A/B 開始對局；A 過期後不送任何 frame，B 提交 Mulligan，A 仍收到 version 2 GAME_VIEW。原本只在 inbound frame 驗證 Alpha；DB 延後完成 connect 也能在過期後送 SESSION。

審查者新增 `tests/railway-expiry.test.ts`，先確認 0/2，分別在 GAME_VIEW／SESSION assertion 失敗。Root 修正：從已驗證 cookie／ticket 取得原 expiry，升級連線後設定到期關閉 timer；每次 outbound send 再使用無副作用的 authorization check。即使 timer 尚未排到或 DB 延遲，過期後也不送資料。既有 cleanup slot、resume credential、durable state 不改。

Root 重新跑 expiry + ticket + lifecycle 共 10/10；完整 Node／regression 333/333。expiry 測試也驗證 fresh admission + 原 resume token 回到同 match、A seat、version 2。修正後驗證由 Root 執行；不宣稱審查者另行重驗。

## P2：Railway proxy IP 契約

獨立審查指出 Railway 的文件明列 X-Real-IP，不能套用原 Caddy 覆寫 XFF 的假設。Root 新增明確 `PROXY_IP_HEADER=X_REAL_IP`，且必須 TRUST_PROXY=true；預設 X_FORWARDED_FOR 保留既有 Caddy 模式。Web／Server 使用同一工具驗證 IP，無效／重複值回到 peer IP，未選用的 header 不影響 rate buckets。

Railway Web 不向公開 server 轉寄 visitor IP，避免把未驗證 forwarding claim 當身分。Server Alpha quota 明確維持 Web egress aggregate，操作限制記錄在部署文件。四項新測試先 0/4，再 4/4：設定驗證、IP 選取、Web quota／header stripping、Server quota。真實 Railway edge 的 header 防偽／跨網路隔離尚需 public validation。

## 其他修正與限度

- Production E2E 選 action 原本只用 card label；同名實體卡造成 Playwright strict locator 錯誤。現在依 packet 內相同 label 的 action ID／順序定位，保留 disabled entries 的索引與原 gameplay assertions，未改 Engine 或卡牌。
- 公開 smoke 支援 split origins、雙端 health/ready、first-party cookie 換 ticket、direct WSS；實際兩個 TLS process 的 E2E 會執行該 CLI，以測試 CA 信任檔驗證 TLS，不使用 NODE_TLS_REJECT_UNAUTHORIZED=0。
- Stop-before-start 為這版單一 authority 的發布必要條件。Auto-deploy Off、1 replica、Serverless Off；不宣稱 overlap=0 單獨提供排他鎖。
- 審查時（2026-09-13）尚無真實 Railway project；2026-09-20 兩個 Railway Docker build、公開 endpoints 與 migration 已成功。公開 UI 的 match／restart 證據見 [phase6-results.md](phase6-results.md)。真實跨網路與 edge header 防偽驗收仍待完成；不認定 Phase 6 COMPLETE。
