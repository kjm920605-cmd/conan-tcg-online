import { test, expect } from '@playwright/test';
import { productionBrowsers } from './helpers.ts';

test('HTTPS/WSS alpha admission, privacy, refresh, active restart and finished recovery', async ({ browser }) => {
  const game = await productionBrowsers(browser);
  try {
    await game.joinRoom();
    expect(game.sockets.every(url => url === game.base.replace('https:', 'wss:') + '/ws')).toBe(true);
    for (const page of game.pages) {
      await expect(page.getByRole('link', { name: 'Local hot-seat' })).toHaveCount(0);
      await expect(page.getByTestId('dev-panel')).toHaveCount(0);
      expect(await page.evaluate(() => document.cookie)).not.toContain('__Host-alpha');
    }
    for (let i = 0; i < 25 && game.packets.get(game.a)!.view.turn.number < 4; i++) await game.step();
    expect(game.packets.get(game.a)!.view.turn.number).toBeGreaterThanOrEqual(4);
    const packet = game.packets.get(game.b)!; await game.b.reload();
    await expect(game.b.getByTestId('online-seat')).toHaveText('B');
    await expect.poll(() => game.packets.get(game.b)).toEqual(packet);
    await game.restart();
    for (let i = 0; i < 180 && game.packets.get(game.a)!.view.status !== 'FINISHED'; i++) await game.step();
    const final = game.packets.get(game.a)!; expect(final.view.status).toBe('FINISHED');
    await game.restart();
    await game.raw(game.a, { type: 'GAME_COMMAND', commandId: 'finished-production', matchId: final.matchId, expectedVersion: final.stateVersion, payload: { kind: 'END_MAIN' } });
    await expect.poll(() => game.messages.get(game.a)!.some(m => m.type === 'COMMAND_REJECTED' && m.code === 'MATCH_FINISHED')).toBe(true);
    for (const page of game.pages) {
      await expect(page.getByRole('status').filter({ hasText: '勝利' })).toBeVisible();
      const view = game.packets.get(page)!.view, other = view.viewerId === 'A' ? 'B' : 'A';
      expect(view.players[other]!.zones.HAND.every(card => card.hidden)).toBe(true);
      expect(await page.evaluate(() => localStorage.getItem('conan-local-fixture-v1'))).toBeNull();
    }
    game.assertNoSecrets(); expect(game.browserErrors).toEqual([]);
  } finally { await game.close(); }
});

test('production PendingDecision and a repeated redraw receipt survive actual process restart', async ({ browser }) => {
  const game = await productionBrowsers(browser);
  try {
    await game.joinRoom(); const owner = game.owner();
    await owner.getByTestId('decision-panel').getByRole('checkbox').first().check();
    await owner.getByRole('button', { name: '確認選擇 (1)', exact: true }).click(); await game.waitVersion(1);
    const command = game.commands.get(owner)!.find(m => m.type === 'MULLIGAN')!;
    const before = game.packets.get(game.a)!, durable = await game.store.loadMatch(before.matchId);
    expect(before.decision).not.toBeNull();
    // Lost/expired alpha admission must not discard the separately persisted PlayerSession credentials.
    await game.contexts[owner === game.a ? 0 : 1]!.clearCookies();
    await game.restart(owner);
    expect(game.packets.get(game.a)!.decision).toEqual(before.decision);
    await game.raw(owner, command);
    await expect.poll(() => game.messages.get(owner)!.some(m => m.type === 'COMMAND_ACCEPTED' && m.duplicate)).toBe(true);
    expect(await game.store.loadMatch(before.matchId)).toEqual(durable);
    await game.step(); expect(game.packets.get(game.a)!.view.status).toBe('PLAYING');
    game.assertNoSecrets(); expect(game.browserErrors).toEqual([]);
  } finally { await game.close(); }
});
