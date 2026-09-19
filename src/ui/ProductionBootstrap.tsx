import { useCallback, useEffect, useRef, useState } from "react";
import { displayError, isKnownErrorCode } from "../client/errors.ts";
import OnlineScreen from "./OnlineScreen.tsx";

type PublicConfig = { webPublicUrl: string; gameServerPublicUrl: string; alphaRequired: true; alphaTransport?: 'TICKET' };
const configurationError = "公開連線設定無效，請聯絡測試管理者。";

export function parsePublicConfig(value: unknown, pageUrl: string): PublicConfig {
  try {
    if (!value || typeof value !== "object" || !("webPublicUrl" in value) || !("gameServerPublicUrl" in value)
      || !("alphaRequired" in value) || value.alphaRequired !== true
      || typeof value.webPublicUrl !== "string" || typeof value.gameServerPublicUrl !== "string") throw new Error();
    const page = new URL(pageUrl);
    const web = new URL(value.webPublicUrl);
    const socket = new URL(value.gameServerPublicUrl);
    const ticketMode = 'alphaTransport' in value && value.alphaTransport === 'TICKET';
    if ('alphaTransport' in value && value.alphaTransport !== undefined && !ticketMode) throw new Error();
    if (page.protocol !== "https:" || web.protocol !== "https:" || web.origin !== page.origin
      || ![page.origin, `${page.origin}/`].includes(value.webPublicUrl)
      || socket.protocol !== "wss:" || socket.username || socket.password || value.gameServerPublicUrl !== `wss://${socket.host}/ws`
      || !ticketMode && socket.host !== page.host) throw new Error();
    return { webPublicUrl: web.origin, gameServerPublicUrl: socket.href, alphaRequired: true, ...(ticketMode ? { alphaTransport: 'TICKET' as const } : {}) };
  } catch { throw new Error(configurationError); }
}

class PublicRequestError extends Error {
  constructor(code: string) { super(displayError(code)); }
}

async function requestPublicJson(path: string, fetcher: typeof fetch, init: RequestInit = {}): Promise<unknown> {
  try {
    const response = await fetcher(path, { ...init, credentials: "same-origin", cache: "no-store", redirect: "error" });
    const value: unknown = await response.json();
    if (!response.ok) {
      const detail = value && typeof value === "object" && "error" in value ? value.error : null;
      const code = detail && typeof detail === "object" && "code" in detail ? detail.code : null;
      throw new PublicRequestError(isKnownErrorCode(code) ? code : "SERVER_ERROR");
    }
    return value;
  } catch (error) {
    // Do not expose response bodies, network diagnostics or any submitted access code.
    throw error instanceof PublicRequestError ? error : new PublicRequestError("SERVER_ERROR");
  }
}

export async function loadPublicConfig(pageUrl: string, fetcher: typeof fetch = fetch): Promise<PublicConfig> {
  return parsePublicConfig(await requestPublicJson("/api/public-config", fetcher), pageUrl);
}

export async function fetchAlphaAccess(fetcher: typeof fetch = fetch): Promise<boolean> {
  const value = await requestPublicJson("/api/alpha", fetcher);
  if (!value || typeof value !== "object" || !("authenticated" in value) || typeof value.authenticated !== "boolean") throw new PublicRequestError("SERVER_ERROR");
  return value.authenticated;
}

export async function submitAlphaCode(code: string, fetcher: typeof fetch = fetch): Promise<void> {
  const value = await requestPublicJson("/api/alpha", fetcher, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }),
  });
  if (!value || typeof value !== "object" || !("authenticated" in value) || value.authenticated !== true) throw new PublicRequestError("ALPHA_ACCESS_REQUIRED");
}

export async function fetchSocketProtocols(fetcher: typeof fetch = fetch): Promise<string[]> {
  const value = await requestPublicJson('/api/alpha/socket-ticket', fetcher, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  if (!value || typeof value !== 'object' || !('ticket' in value) || typeof value.ticket !== 'string'
    || !/^ws1\.[1-9]\d{0,12}\.[1-9]\d{0,12}\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/.test(value.ticket)) throw new PublicRequestError('SERVER_ERROR');
  return ['conan-alpha.v1', value.ticket];
}

const socketProtocols = () => fetchSocketProtocols();

export function AlphaAccessForm({ onSubmit }: { onSubmit: (code: string) => Promise<void> }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <section className="online-lobby panel" aria-label="Alpha access">
    <p className="eyebrow">CLOSED ALPHA · FIXTURE CARDS</p><h1>Alpha 測試通行</h1>
    <p className="muted">輸入測試通行碼以開啟線上房間。重新驗證後會使用此分頁原有的玩家身分。</p>
    <form onSubmit={async event => {
      event.preventDefault();
      if (busy || !code) return;
      const submittedCode = code;
      setCode(""); setBusy(true); setError(null);
      try { await onSubmit(submittedCode); }
      catch (error) { setError(error instanceof PublicRequestError ? error.message : displayError("SERVER_ERROR")); }
      finally { setBusy(false); }
    }}>
      <label htmlFor="alpha-code">Alpha 通行碼</label>
      <input id="alpha-code" type="password" value={code} onChange={event => setCode(event.target.value)} maxLength={512} autoComplete="off" spellCheck={false} disabled={busy} required />
      <button className="primary" disabled={busy || !code}>{busy ? "驗證中…" : "進入 Alpha"}</button>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}

export default function ProductionBootstrap() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [phase, setPhase] = useState<"checking" | "required" | "ready" | "failed">("checking");
  const [entered, setEntered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pendingAccess = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);
  useEffect(() => {
    let current = true;
    setPhase("checking"); setError(null);
    void (async () => {
      try {
        const loaded = await loadPublicConfig(location.href);
        const authenticated = await fetchAlphaAccess();
        if (!current) return;
        setConfig(loaded); setEntered(authenticated); setPhase(authenticated ? "ready" : "required");
      } catch (error) {
        if (!current) return;
        setError(error instanceof PublicRequestError ? error.message : configurationError); setPhase("failed");
      }
    })();
    return () => {
      current = false;
      pendingAccess.current?.reject(new PublicRequestError("ALPHA_ACCESS_REQUIRED"));
      pendingAccess.current = null;
    };
  }, [attempt]);

  const beforeReconnect = useCallback(async () => {
    if (await fetchAlphaAccess()) return;
    setPhase("required");
    await new Promise<void>((resolve, reject) => { pendingAccess.current = { resolve, reject }; });
  }, []);
  const authenticate = async (code: string) => {
    await submitAlphaCode(code);
    setEntered(true); setPhase("ready");
    pendingAccess.current?.resolve(); pendingAccess.current = null;
  };

  return <>
    {phase === "checking" && <p className="loading" role="status">正在確認 Alpha 測試通行…</p>}
    {phase === "failed" && <section className="online-lobby panel"><p className="error" role="alert">{error}</p><button onClick={() => setAttempt(value => value + 1)}>重新確認連線</button></section>}
    {phase === "required" && <AlphaAccessForm onSubmit={authenticate} />}
    {/* Keep the existing client and its pending receipts/credentials through access renewal. */}
    {entered && config && <div hidden={phase !== "ready"}><OnlineScreen serverUrl={config.gameServerPublicUrl} beforeReconnect={beforeReconnect}
      {...(config.alphaTransport === 'TICKET' ? { socketProtocols } : {})} /></div>}
  </>;
}
