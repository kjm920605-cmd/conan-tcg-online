# Standalone Railway Web verification

新增 `apps/web/index.ts`、`src/web/config.ts`、`src/web/server.ts`，native Node 24 runtime 只接收 public URL／listener／log／proxy 設定。Production React 靜態檔由此 host 提供；Server 的 Engine、PostgreSQL、secrets 不進 Web runtime 或 bundle。

Web API bridge 僅允許固定 server HTTPS origin 的 `/api/alpha` 和 `/api/alpha/socket-ticket`；拒絕任意 path/query、redirect、外來 Origin、未知 JSON fields、過大 body、超過 32 個 outstanding upstream。JSON request／response 限 8KiB，上游 timeout 5 秒，回應只轉送 allowlist fields，cookie 只保留嚴格 __Host-alpha 屬性；raw upstream error 不回 client、不記錄。

`tests/railway-web.test.ts` 先因 implementation 尚不存在失敗，再 **13/13 通過**。內容包含 config／secret stripping、static routes、CSP、固定 API bridge、Origin、body、cookie attributes、upstream failure、readiness、proxy trust、rate limits、outstanding bound、timeout、native entry。另有 Railway proxy 4、ticket 4、client 3、expiry 2，共新增 Node 26 項。

實際 process E2E 使用不同 registrable domains `alpha.example.com`／`game.example.net` 映射到 loopback；真實 HTTPS、WS、PostgreSQL、production Web/Server process，無 Vite proxy／合成 Server response。Web child environment 不含 DB／SESSION_SECRET／ALPHA_ACCESS_SECRET。瀏覽器忽略本機 self-signed 憑證僅限該測試 context；Web→Server 與 smoke CLI 使用明確 CA 信任檔並保持 TLS 驗證。

測試包括 Alpha、Room、Mulligan、出牌／推理、private projection、reconnect、restart pending decision、duplicate command、不多耗 RNG、繼續到 finished、再 restart 可讀不可操作。票證只進 memory／WS subprotocol，不存 URL 或 sessionStorage。

`deploy/web.Dockerfile` 最後 stage 只複製 Web source、四個基礎工具與 dist；沒有 node_modules、Engine 或資料庫 client。此環境無 Docker CLI，image build 留待 Railway 實際驗證；不能以 source-level 檢查代替 container build。
