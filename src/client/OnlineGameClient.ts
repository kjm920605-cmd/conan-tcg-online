import { ClientMessageSchema, ServerMessageSchema } from "../../packages/protocol/index.ts";
import type { ClientMessage, PlayerPacket, RoomState, ServerMessage } from "../../packages/protocol/index.ts";
import type { Intent } from "../game/model.ts";
import type { ClientSnapshot, GameClient } from "./GameClient.ts";
import { displayError } from "./errors.ts";

export type Credentials = { playerSessionId: string; resumeToken: string };
export type LobbySnapshot = { connection: "CONNECTING" | "CONNECTED" | "DISCONNECTED"; hasSession: boolean; room: RoomState | null; stateVersion: number | null; error: string | null };
type Options = { credentials?: Credentials | null; persist?: (credentials: Credentials | null) => void };
type GameplayMessage = Extract<ClientMessage, { commandId: string }>;

/** Network view + commands only. Deliberately has no Engine, Content, RNG or snapshot API. */
export class OnlineGameClient implements GameClient {
  readonly privateCoverLabel = "我的牌桌已隱藏";
  #url: string;
  #socket: WebSocket | null = null;
  #credentials: Credentials | null;
  #persist: (credentials: Credentials | null) => void;
  #resuming = false;
  #connection: LobbySnapshot["connection"] = "DISCONNECTED";
  #room: RoomState | null = null;
  #packet: PlayerPacket | null = null;
  #error: string | null = null;
  #locked = false;
  #pending = new Map<string, GameplayMessage>();
  #listeners = new Set<() => void>();
  #snapshot!: ClientSnapshot;
  #lobby!: LobbySnapshot;
  constructor(url: string, options: Options = {}) {
    this.#url = url; this.#credentials = options.credentials ?? null; this.#persist = options.persist ?? (() => {}); this.#publish();
  }
  getSnapshot = () => this.#snapshot;
  getLobbySnapshot = () => this.#lobby;
  subscribe = (listener: () => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };
  #publish(): void {
    const packet = this.#packet;
    const usable = this.#connection === "CONNECTED" && !this.#resuming && this.#pending.size === 0;
    this.#snapshot = {
      requiredPlayerId: packet?.decision?.playerId ?? packet?.view.turn.playerId ?? "",
      status: packet?.view.status ?? "CONNECTING", view: this.#locked ? null : packet?.view ?? null,
      actions: usable ? packet?.legalActions ?? [] : [],
      decision: packet?.decision ? (usable ? packet.decision : { ...packet.decision, mode: "WAITING", candidates: [], actions: [] }) : null,
      error: this.#error,
    };
    this.#lobby = { connection: this.#connection, hasSession: !!this.#credentials && !this.#resuming,
      room: this.#room, stateVersion: packet?.stateVersion ?? null, error: this.#error };
    for (const listener of this.#listeners) listener();
  }
  connect(protocols?: string[]): void {
    this.#socket?.close();
    this.#connection = "CONNECTING"; this.#error = null; this.#resuming = !!this.#credentials;
    const socket = protocols ? new WebSocket(this.#url, protocols) : new WebSocket(this.#url); this.#socket = socket; this.#publish();
    socket.onopen = () => {
      if (this.#socket !== socket) return;
      if (this.#credentials) this.#send({ type: "RESUME_MATCH", ...this.#credentials });
      else { this.#connection = "CONNECTED"; this.#publish(); }
    };
    socket.onmessage = event => {
      if (this.#socket !== socket) return;
      try {
        const message = ServerMessageSchema.parse(JSON.parse(String(event.data)));
        this.#receive(message);
      } catch { this.#error = "INVALID_SERVER_MESSAGE: 已停止接受無效伺服器資料"; this.disconnect(); }
    };
    socket.onclose = () => { if (this.#socket === socket) { this.#connection = "DISCONNECTED"; this.#publish(); } };
    socket.onerror = () => { if (this.#socket === socket) { this.#error = "連線失敗；請確認 Game Server 正在執行。"; this.#publish(); } };
  }
  #send(message: ClientMessage): void {
    const parsed = ClientMessageSchema.safeParse(message);
    if (!parsed.success) { this.#error = "INVALID_CLIENT_MESSAGE"; this.#publish(); return; }
    if (this.#socket?.readyState !== WebSocket.OPEN) { this.#error = "DISCONNECTED：請先重新連線。"; this.#publish(); return; }
    this.#socket.send(JSON.stringify(parsed.data));
  }
  #receive(message: ServerMessage): void {
    switch (message.type) {
      case "SESSION_RESTORED":
        this.#resuming = false; this.#connection = "CONNECTED"; this.#room = null; this.#packet = null; break;
      case "SESSION":
        // A fresh socket's temporary session must not overwrite a saved resume credential.
        if (this.#resuming && message.playerSessionId !== this.#credentials?.playerSessionId) return;
        if (!this.#resuming && this.#credentials && message.playerSessionId !== this.#credentials.playerSessionId) {
          this.#room = null; this.#packet = null; this.#pending.clear(); this.#error = null;
        }
        this.#credentials = { playerSessionId: message.playerSessionId, resumeToken: message.resumeToken };
        this.#persist(this.#credentials); this.#connection = "CONNECTED"; break;
      case "ROOM_STATE":
        this.#room = message.room;
        if (!message.room.matchId) this.#resuming = false;
        this.#connection = "CONNECTED"; break;
      case "MATCH_STARTED": case "GAME_VIEW": case "RESYNC_STATE": {
        if (this.#packet?.matchId === message.packet.matchId && this.#packet.stateVersion > message.packet.stateVersion) return;
        this.#packet = message.packet; this.#resuming = false; this.#connection = "CONNECTED";
        if (message.type === "RESYNC_STATE") for (const pending of this.#pending.values()) this.#send(pending);
        break;
      }
      case "COMMAND_ACCEPTED": this.#pending.delete(message.commandId); break;
      case "COMMAND_REJECTED":
        if (message.commandId) this.#pending.delete(message.commandId);
        this.#error = displayError(message.code, `${message.code}: ${message.message}`);
        if (!message.commandId && this.#resuming) this.disconnect();
        break;
      case "RULE_BLOCKED": this.#error = displayError(message.questionId); break;
      // Versioned GAME_VIEW is the single atomic UI publication for decisions and outcome.
      case "PENDING_DECISION": case "GAME_FINISHED": case "PLAYER_CONNECTED": case "PLAYER_DISCONNECTED": break;
    }
    this.#publish();
  }
  createRoom(): void { this.#send({ type: "CREATE_ROOM" }); }
  joinRoom(roomCode: string): void { this.#send({ type: "JOIN_ROOM", roomCode: roomCode.trim().toUpperCase() }); }
  roomReady(): void { this.#send({ type: "READY" }); }
  leaveRoom(): void { this.#send({ type: "LEAVE_ROOM" }); }
  resync(): void { if (this.#packet) this.#send({ type: "RESYNC", matchId: this.#packet.matchId }); }
  ready(): void { this.#locked = false; this.#publish(); }
  lock(): void { this.#locked = true; this.#publish(); }
  submit(intent: Intent): void {
    if (!this.#packet || this.#connection !== "CONNECTED" || this.#resuming || this.#pending.size || this.#locked) return;
    const parsed = ClientMessageSchema.safeParse({ type: intent.kind === "MULLIGAN" ? "MULLIGAN" : "choiceId" in intent ? "RESOLVE_DECISION" : "GAME_COMMAND",
      commandId: crypto.randomUUID(), matchId: this.#packet.matchId, expectedVersion: this.#packet.stateVersion, payload: intent });
    if (!parsed.success || !("commandId" in parsed.data)) { this.#error = "INVALID_CLIENT_MESSAGE"; this.#publish(); return; }
    this.#pending.set(parsed.data.commandId, parsed.data); this.#error = null; this.#send(parsed.data); this.#publish();
  }
  disconnect(): void { const socket = this.#socket; this.#socket = null; socket?.close(); this.#connection = "DISCONNECTED"; this.#publish(); }
  resetSession(protocols?: string[]): void {
    this.disconnect(); this.#credentials = null; this.#persist(null); this.#packet = null; this.#room = null; this.#pending.clear(); this.connect(protocols);
  }
  dispose(): void { this.disconnect(); this.#listeners.clear(); }
}
