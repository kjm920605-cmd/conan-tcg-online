import { createRoot } from "react-dom/client";
import { lazy, Suspense } from "react";
import "./styles.css";
const Local = import.meta.env.DEV ? lazy(() => import("./LocalBootstrap.tsx")) : null;
const Online = lazy(() => import("./OnlineScreen.tsx"));
const Production = lazy(() => import("./ProductionBootstrap.tsx"));
const online = !import.meta.env.DEV || new URLSearchParams(location.search).get("mode") === "online";
createRoot(document.getElementById("root")!).render(<>
  {import.meta.env.DEV && <nav className="mode-nav" aria-label="Game mode"><a href="/" aria-current={!online ? "page" : undefined}>Local hot-seat</a><a href="/?mode=online" aria-current={online ? "page" : undefined}>Online fixture</a><span>DEVELOPMENT · FIXTURE CARDS</span></nav>}
  <Suspense fallback={<p className="loading">載入牌桌…</p>}>{!import.meta.env.DEV ? <Production/> : online ? <Online/> : Local && <Local/>}</Suspense>
</>);
