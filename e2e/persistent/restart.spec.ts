import { test, expect } from '@playwright/test';
import { persistentBrowsers } from './helpers.ts';

test('A: real process restart restores both seats and exact projections after several turns', async ({ browser }) => {
  const game = await persistentBrowsers(browser);
  try {
    await game.join();
    for (let i = 0; i < 25 && game.packets.get(game.a)!.view.turn.number < 4; i++) await game.step();
    expect(game.packets.get(game.a)!.view.turn.number).toBeGreaterThanOrEqual(4);
    const packet = game.packets.get(game.a)!; const durable = await game.store.loadMatch(packet.matchId);
    await game.restart(); expect(await game.store.loadMatch(packet.matchId)).toEqual(durable);
    await game.step(); expect(game.packets.get(game.a)!.stateVersion).toBe(packet.stateVersion + 1);
  } finally { await game.close(); }
});

test('B: pending decision id, owner and legal options survive an actual server restart', async ({ browser }) => {
  const game = await persistentBrowsers(browser);
  try {
    await game.join(); await game.step();
    const packet = game.packets.get(game.owner())!; expect(packet.decision).not.toBeNull();
    const durable = await game.store.loadMatch(packet.matchId);
    await game.restart(); expect(await game.store.loadMatch(packet.matchId)).toEqual(durable);
    expect(game.packets.get(game.owner())!.decision).toEqual(packet.decision);
    await game.step(); expect(game.packets.get(game.a)!.view.status).toBe('PLAYING');
  } finally { await game.close(); }
});

test('C: redraw command retransmitted after restart cannot consume RNG or cost twice', async ({ browser }) => {
  const game = await persistentBrowsers(browser);
  try {
    await game.join(); const owner = game.owner();
    const initial = game.packets.get(owner)!;
    await owner.getByTestId('decision-panel').getByRole('checkbox').first().check();
    await owner.getByRole('button', { name: '確認選擇 (1)', exact: true }).click(); await game.waitVersion(1);
    const command = game.commands.get(owner)!.find(m => m.type === 'MULLIGAN')!;
    expect(command).toBeTruthy();
    const durable = await game.store.loadMatch(initial.matchId);
    await game.restart(); await game.raw(owner, command);
    await expect.poll(() => game.messages.get(owner)!.some(m => m.type === 'COMMAND_ACCEPTED' && m.duplicate)).toBe(true);
    expect(await game.store.loadMatch(initial.matchId)).toEqual(durable);
    const counts = await game.store.pool.query('SELECT count(*)::int AS count FROM match_commands WHERE match_id=$1', [initial.matchId]);
    expect(counts.rows[0].count).toBe(1);
    await game.step(); expect(game.packets.get(owner)!.stateVersion).toBe(2);
  } finally { await game.close(); }
});

test('D: completed online fixture match remains final and rejects gameplay after restart', async ({ browser }) => {
  const game = await persistentBrowsers(browser);
  try {
    await game.join();
    for (let i = 0; i < 180 && game.packets.get(game.a)!.view.status !== 'FINISHED'; i++) await game.step();
    const final = game.packets.get(game.a)!; expect(final.view.status).toBe('FINISHED');
    const durable = await game.store.loadMatch(final.matchId); expect(durable!.match.finishedAt).not.toBeNull();
    await game.restart();
    for (const page of game.pages) await expect(page.getByRole('status').filter({ hasText: '勝利' })).toBeVisible();
    await game.raw(game.a, { type: 'GAME_COMMAND', commandId: 'after-restart-finish', matchId: final.matchId, expectedVersion: final.stateVersion, payload: { kind: 'END_MAIN' } });
    await expect.poll(() => game.messages.get(game.a)!.some(m => m.type === 'COMMAND_REJECTED' && m.code === 'MATCH_FINISHED')).toBe(true);
    expect(await game.store.loadMatch(final.matchId)).toEqual(durable);
  } finally { await game.close(); }
});
