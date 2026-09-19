import { useState, useSyncExternalStore } from 'react';
import type { GameClient, DevelopmentTools } from '../client/GameClient.ts';
import { displayError } from '../client/errors.ts';
import type { CardView, LegalAction, PendingDecision, PlayerView } from '../game/client/index.ts';
import type { Intent, Zone } from '../game/model.ts';

type Highlight = { sourceId?: string; targetId?: string } | null;
type ActionsProps = { actions: LegalAction[]; submit: (intent: Intent) => void; highlight: (value: Highlight) => void };
function ActionList({ actions, submit, highlight }: ActionsProps) {
  return <div className="action-list">{actions.map(action => <div className="action-row" key={action.id}
    onMouseEnter={() => highlight(action)} onMouseLeave={() => highlight(null)}
    onFocus={() => highlight(action)} onBlur={() => highlight(null)}>
    <button disabled={!action.available} onClick={() => submit(action.intent)}>{action.label}</button>
    {!action.available && <small className="unavailable">{displayError(action.code ?? '', action.reason ?? 'Unavailable')}</small>}
  </div>)}</div>;
}

export function DecisionPanel({ decision, submit, highlight }: { decision: PendingDecision; submit: (intent: Intent) => void; highlight: (value: Highlight) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [order, setOrder] = useState(() => decision.candidates.map(c => c.id));
  const move = (index: number, delta: number) => setOrder(previous => {
    const next = [...previous]; const destination = index + delta;
    if (destination < 0 || destination >= next.length) return previous;
    [next[index], next[destination]] = [next[destination]!, next[index]!]; return next;
  });
  const commit = (cardIds: string[]) => {
    if (decision.submitIntent && 'cardIds' in decision.submitIntent) submit({ ...decision.submitIntent, cardIds });
  };
  return <section className="panel decision" data-testid="decision-panel">
    <p className="eyebrow">PENDING DECISION · {decision.playerId}</p><h2>{decision.kind.replaceAll('_', ' ')}</h2>
    {decision.mode === 'MULTI_SELECT' && <>
      <p className="muted">選擇卡片後確認；可不選。選擇是否合法由引擎驗證。</p>
      <div className="choice-list">{decision.candidates.map(candidate => <label key={candidate.id}
        onMouseEnter={() => highlight({ sourceId: candidate.id })} onMouseLeave={() => highlight(null)}>
        <input type="checkbox" checked={selected.includes(candidate.id)} onChange={event => setSelected(current => event.target.checked ? [...current, candidate.id] : current.filter(id => id !== candidate.id))} />
        <span>{candidate.label}<small>{candidate.id}</small></span>
      </label>)}</div>
      <button className="primary" onClick={() => commit(selected)}>確認選擇 ({selected.length})</button>
    </>}
    {decision.mode === 'ORDERED' && <><p className="muted">由上至下依序調查。使用箭頭調整順序。</p><ol className="order-list">{order.map((id, index) => <li key={id}>
      <span>{decision.candidates.find(c => c.id === id)?.label ?? id}</span>
      <button aria-label={`Move ${id} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
      <button aria-label={`Move ${id} down`} disabled={index === order.length - 1} onClick={() => move(index, 1)}>↓</button>
    </li>)}</ol><button className="primary" onClick={() => commit(order)}>確認調查順序</button></>}
    {decision.mode === 'WAITING' && <p>等待 {decision.playerId} 決定。</p>}
    <ActionList actions={decision.actions} submit={submit} highlight={highlight} />
    {decision.mode === 'ACTIONS' && decision.actions.length === 0 && <p role="status">目前沒有引擎提供的可執行選項。</p>}
  </section>;
}

function Card({ card, view, highlight }: { card: CardView; view: PlayerView; highlight: Highlight }) {
  if (card.hidden) return <div className="card card-back" aria-label="Hidden card"><span>DETECTIVE<br />CARD GAME</span></div>;
  const modifiers = view.modifiers.filter(m => m.targetEntryId === card.entryId);
  return <article className={`card ${card.orientation?.toLowerCase() ?? ''} ${highlight?.sourceId === card.id ? 'source-highlight' : ''} ${highlight?.targetId === card.id ? 'target-highlight' : ''}`} data-card-id={card.id}>
    <div className="card-top"><span>{card.type}</span><span>{card.level !== undefined ? `Lv ${card.level}` : card.firstLevel !== undefined ? `Lv ${card.firstLevel} / ${card.secondLevel}` : ''}</span></div>
    <h3>{card.name}</h3><small className="card-definition">{card.definitionId}</small>
    <div className="stats">{card.ap !== undefined && <span>AP <strong>{card.ap}</strong></span>}{card.lp !== undefined && <span>LP <strong>{card.lp}</strong></span>}</div>
    <div className="orientation">{card.orientation ?? card.face} {card.colors?.join(' · ')}</div>
    {!!card.keywords?.length && <div className="keywords">{card.keywords.join(' · ')}</div>}
    {card.abilitiesSuppressed && <small>Abilities suppressed</small>}
    {!!(card.setCount || card.underCount) && <small>SET {card.setCount} · UNDER {card.underCount}</small>}
    {modifiers.map((m, i) => <small className="modifier" key={i}>{m.stat} {m.value >= 0 ? '+' : ''}{m.value} · {m.duration}</small>)}
  </article>;
}
const zoneNames: Partial<Record<Zone, string>> = { FIELD: 'FIELD · 角色', PARTNER: 'PARTNER · 搭檔', CASE: 'CASE · 事件', EVIDENCE: 'EVIDENCE · 證據', FILE: 'FILE · 檔案', REMOVE: 'REMOVE · 移除', HAND: 'HAND · 手牌' };
function PlayerBoard({ playerId, view, highlight }: { playerId: string; view: PlayerView; highlight: Highlight }) {
  const player = view.players[playerId]!; const own = playerId === view.viewerId;
  const zone = (name: Zone) => <section className={`zone zone-${name.toLowerCase()}`} key={name} aria-label={`${playerId} ${name}`}>
    <h3 className="zone-label">{zoneNames[name] ?? name}<span>{player.zones[name].length}</span></h3>
    <div className="cards">{player.zones[name].map((card, index) => <Card key={card.id ?? `hidden-${index}`} card={card} view={view} highlight={highlight} />)}{player.zones[name].length === 0 && <span className="empty-zone">—</span>}</div>
  </section>;
  return <section className={`player-board ${own ? 'own-board' : 'opponent-board'}`}>
    <header className="player-heading"><h2>{playerId} <small>{own ? 'YOUR SIDE' : 'OPPONENT'}</small></h2><div className="player-counters"><span>Chapter {player.chapter}</span><span>Trace {String(player.traceDiscovered)}</span><span>DECK {player.zones.DECK.length}</span>{!own && <span>HAND {player.zones.HAND.length}</span>}</div></header>
    <div className="core-zones">{zone('PARTNER')}{zone('CASE')}{zone('FIELD')}</div>
    <div className="pile-zones">{zone('EVIDENCE')}{zone('FILE')}{zone('REMOVE')}</div>
    {own && zone('HAND')}
  </section>;
}

function DevPanel({ controller, view, actions, decision }: { controller: DevelopmentTools; view: PlayerView; actions: LegalAction[]; decision: PendingDecision | null }) {
  const [revealed, setRevealed] = useState(false); const [privateJson, setPrivateJson] = useState('');
  const [importText, setImportText] = useState(''); const [notice, setNotice] = useState('');
  const exportFile = () => { const blob = new Blob([controller.exportSnapshot()], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'conan-local-snapshot.json'; a.click(); URL.revokeObjectURL(url); };
  const copy = async () => { try { await navigator.clipboard.writeText(controller.exportSnapshot()); setNotice('Game State copied.'); } catch { setNotice('Clipboard unavailable. Use Export Snapshot.'); } };
  const reveal = () => { if (revealed) { setPrivateJson(''); setRevealed(false); } else { setPrivateJson(controller.exportSnapshot()); setRevealed(true); } };
  return <details className="panel developer" data-testid="dev-panel"><summary>Developer tools · 本機開發</summary>
    <p className="dev-warning">警告：Reveal、Export 與 Copy 會取得雙方手牌及牌庫等完整私密資料。僅供可信任的本機除錯使用。</p>
    <div className="dev-buttons"><button onClick={reveal}>{revealed ? 'Hide private snapshot' : 'Reveal private snapshot'}</button><button onClick={exportFile}>Export Snapshot</button><button onClick={() => void copy()}>Copy Game State</button></div>
    {revealed && <><p>手動擷取資料；牌局改變後請重新 Reveal。</p><pre data-testid="private-snapshot">{privateJson}</pre><details><summary>PendingEffects · private snapshot</summary><pre>{JSON.stringify(JSON.parse(privateJson).state?.pendingEffects ?? JSON.parse(privateJson).pendingEffects ?? [], null, 2)}</pre></details></>}
    <label className="import-file">Import Snapshot file<input type="file" accept=".json,application/json" onChange={async event => { const file = event.target.files?.[0]; if (!file) return; try { const ok = controller.importSnapshot(await file.text()); setNotice(ok ? 'Imported.' : 'Import failed; current match retained.'); } catch { setNotice('File could not be read.'); } }} /></label>
    <label>Import Snapshot text<textarea value={importText} onChange={event => setImportText(event.target.value)} placeholder="Paste snapshot JSON" /></label><button disabled={!importText.trim()} onClick={() => { if (controller.importSnapshot(importText)) setImportText(''); }}>Import Snapshot</button>
    <p role="status">{notice}</p>
    {[['LegalActions', actions], ['EventLog', view.events], ['PendingDecision', decision]].map(([name, data]) => <details key={String(name)}><summary>{String(name)}</summary><pre>{JSON.stringify(data, null, 2)}</pre></details>)}
  </details>;
}

export function App({ controller }: { controller: GameClient }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [highlight, setHighlight] = useState<Highlight>(null);
  if (!snapshot.view) return <main className="handoff" data-testid="handoff"><div className="handoff-content"><p className="eyebrow">LOCAL HOT-SEAT · PRIVATE HANDOFF</p><div className="handoff-mark" aria-hidden="true">↔</div><h1>{controller.privateCoverLabel ?? `請交給 ${snapshot.requiredPlayerId}`}</h1><p>{controller.privateCoverLabel ? "按 Ready 返回自己的牌桌。" : "把裝置交給這位玩家後，再開啟他的牌桌。"}</p><button className="primary ready" data-testid="ready-button" onClick={() => { setHighlight(null); controller.ready(); }}>Ready · 我準備好了</button><small>Fixture / development cards · 本地雙人測試</small>{snapshot.error && <p className="error" role="alert">{snapshot.error}</p>}</div></main>;
  const view = snapshot.view; const submit = (intent: Intent) => { setHighlight(null); controller.submit(intent); };
  return <main className="app-shell"><header className="app-header"><div><p className="eyebrow">DETECTIVE CARD GAME</p><h1>本地對戰桌</h1><small>Fixture / development cards · 無官方卡圖</small></div><div className="turn-indicator"><span>TURN {view.turn.number}</span><strong>{view.turn.playerId} · {view.turn.phase}</strong><small>{view.status} · Revision {view.revision}</small></div><button onClick={() => controller.lock()}>遮蔽牌桌</button></header>
    {snapshot.error && <div className="error" role="alert">{snapshot.error}</div>}
    {view.outcome && <div className="outcome" role="status">{view.outcome.winnerId} 勝利 · {view.outcome.reason}</div>}
    <div className="game-layout"><div className="table" data-testid="game-board">{[...view.playerOrder.filter(id => id !== view.viewerId), view.viewerId].map(id => <PlayerBoard key={id} playerId={id} view={view} highlight={highlight} />)}</div>
    <aside className="sidebar"><section className="panel flow"><p className="eyebrow">CURRENT FLOW</p><strong>{view.subflows.map(f => `${f.kind}${f.step ? ` / ${f.step}` : ''}`).join(' → ') || view.turn.phase}</strong><p className="muted">目前操作：{snapshot.requiredPlayerId}</p></section>
      {snapshot.decision ? <DecisionPanel key={snapshot.decision.id} decision={snapshot.decision} submit={submit} highlight={setHighlight} /> : <section className="panel" data-testid="legal-actions"><p className="eyebrow">ENGINE ACTIONS</p><h2>可用操作</h2><ActionList actions={snapshot.actions} submit={submit} highlight={setHighlight} />{snapshot.actions.length === 0 && <p>目前沒有可用操作。</p>}</section>}
      <section className="panel event-panel"><p className="eyebrow">EVENT LOG</p><h2>對局紀錄 <small>{view.events.length}</small></h2><ol className="event-log">{view.events.slice().reverse().map(event => <li key={event.sequence}><span className="event-sequence">{event.sequence}</span><div><strong>{event.type}</strong><small>{[event.playerId, event.detail].filter(Boolean).join(' · ')}</small></div></li>)}</ol></section>
    </aside></div>
    {import.meta.env?.DEV && controller.development && <DevPanel key={view.viewerId} controller={controller.development} view={view} actions={snapshot.actions} decision={snapshot.decision} />}
  </main>;
}
