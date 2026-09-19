import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { OnlineGameClient } from "../client/OnlineGameClient.ts";
import type { Credentials } from "../client/OnlineGameClient.ts";
import { App } from "./App.tsx";
import { displayError } from "../client/errors.ts";

export async function connectAfterAccess(connect: (protocols?: string[]) => void, beforeReconnect?: () => Promise<void>, socketProtocols?: () => Promise<string[]>): Promise<void> {
  await beforeReconnect?.();
  connect(await socketProtocols?.());
}

export default function OnlineScreen({ serverUrl, beforeReconnect, socketProtocols }: { serverUrl?: string; beforeReconnect?: () => Promise<void>; socketProtocols?: () => Promise<string[]> } = {}) {
  const [client] = useState(() => {
    const url = serverUrl || (import.meta.env.DEV ? import.meta.env.VITE_GAME_SERVER_URL : undefined) || `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:8787`;
    const key = `conan-online-session:${url}`;
    let credentials: Credentials | null = null;
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(key) || "null");
      if (stored && typeof stored === "object" && "playerSessionId" in stored && typeof stored.playerSessionId === "string" && "resumeToken" in stored && typeof stored.resumeToken === "string") credentials = { playerSessionId: stored.playerSessionId, resumeToken: stored.resumeToken };
    } catch { /* Malformed local credentials never confer authenticated identity. */ }
    return new OnlineGameClient(url, { credentials, persist: value => {
      try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); } catch { /* Reload resume requires browser storage. */ }
    } });
  });
  useEffect(() => {
    let current = true;
    void connectAfterAccess(protocols => { if (current) client.connect(protocols); }, undefined, socketProtocols)
      .catch(() => { if (current) setAccessError(displayError('ALPHA_ACCESS_REQUIRED')); });
    return () => { current = false; client.dispose(); };
  }, [client, socketProtocols]);
  const lobby = useSyncExternalStore(client.subscribe, client.getLobbySnapshot, client.getLobbySnapshot);
  const game = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [code, setCode] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const reconnectPending = useRef(false);
  const reconnect = async (resetSession = false) => {
    if (reconnectPending.current) return;
    reconnectPending.current = true; setReconnecting(true); setAccessError(null);
    try { await connectAfterAccess(protocols => resetSession ? client.resetSession(protocols) : client.connect(protocols), beforeReconnect, socketProtocols); }
    catch { setAccessError(displayError("ALPHA_ACCESS_REQUIRED")); }
    finally { reconnectPending.current = false; setReconnecting(false); }
  };
  const connected = lobby.connection === "CONNECTED" && lobby.hasSession;
  return <>
    <section className="online-bar" aria-label="Online room">
      <div><p className="eyebrow">ONLINE · SERVER AUTHORITATIVE</p><h2>線上測試房間</h2></div>
      <span className="connection" data-testid="online-connection">{lobby.connection}</span>
      {game.view && <span>你的座位 <strong data-testid="online-seat">{game.view.viewerId}</strong> · stateVersion <strong data-testid="state-version">{lobby.stateVersion}</strong></span>}
      {lobby.room && <span>Room <strong className="room-code" data-testid="room-code">{lobby.room.roomCode}</strong></span>}
      {lobby.room?.seats.map(seat => <span key={seat.playerId} data-testid={`peer-${seat.playerId}`}>{seat.playerId} · {seat.occupied ? seat.connected ? "connected" : "disconnected" : "empty"} · {seat.ready ? "ready" : "not ready"}</span>)}
      {lobby.connection !== "CONNECTED" && <button disabled={reconnecting} onClick={() => void reconnect()}>Reconnect</button>}
      {lobby.room && lobby.stateVersion !== null && <button disabled={!connected} onClick={() => client.resync()}>Resync</button>}
    </section>
    {accessError && <p className="error" role="alert">{accessError}</p>}
    {lobby.error?.includes("INVALID_SESSION") && <section className="online-lobby panel"><p>重連憑證無效或已不再存在。建立新身分會忘記此分頁的舊重連憑證。</p><button disabled={reconnecting} onClick={() => void reconnect(true)}>New anonymous session</button></section>}
    {lobby.stateVersion === null ? <section className="online-lobby panel">
      <p className="eyebrow">FIXTURE DECK A / B · TWO PLAYERS</p>
      {!lobby.room ? <><h1>邀請另一位玩家</h1><p className="muted">建立房間後分享 Room Code。兩位玩家都 Ready 後，由 Server 開始對局。</p>
        <button className="primary" disabled={!connected} onClick={() => client.createRoom()}>Create Room</button>
        <div className="join-room"><label htmlFor="room-code">Room Code</label><input id="room-code" value={code} maxLength={256} onChange={e => setCode(e.target.value)} placeholder="8-character code" autoComplete="off"/><button disabled={!connected || !code.trim()} onClick={() => client.joinRoom(code)}>Join Room</button></div>
      </> : <><h1>等待對手與 Ready</h1><p className="muted">Room Code 只用於加入空位；重新連線會使用此分頁保存的匿名憑證。</p><div className="dev-buttons"><button className="primary" disabled={!connected} onClick={() => client.roomReady()}>Room Ready</button><button disabled={!connected} onClick={() => client.leaveRoom()}>Leave Room</button></div></>}
      {lobby.error && <p className="error" role="alert">{lobby.error}</p>}
    </section> : <App controller={client}/>}
  </>;
}
