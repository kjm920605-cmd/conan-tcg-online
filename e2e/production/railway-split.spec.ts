import { test, expect } from '@playwright/test';
import { productionBrowsers } from './helpers.ts';

test('separate HTTPS Web/Server use first-party Alpha and direct WSS through refresh, restart and final recovery', async ({ browser }) => {
  const game = await productionBrowsers(browser, true);
  try {
    await game.joinRoom();
    await game.smoke();
    expect(new URL(game.gameUrl).host).not.toBe(new URL(game.base).host);
    expect(game.sockets.every(url => url === game.gameUrl)).toBe(true);
    for (const context of game.contexts) {
      const cookies = await context.cookies();
      const alpha = cookies.find(cookie => cookie.name === '__Host-alpha')!;
      expect(alpha.domain).toBe('alpha.example.com'); expect(alpha.httpOnly).toBe(true); expect(alpha.sameSite).toBe('Strict');
      expect(cookies.some(cookie => cookie.domain === 'game.example.net')).toBe(false);
    }
    const owner = game.owner();
    await owner.getByTestId('decision-panel').getByRole('checkbox').first().check();
    await owner.getByRole('button', { name: '確認選擇 (1)', exact: true }).click(); await game.waitVersion(1);
    const command = game.commands.get(owner)!.find(message => message.type === 'MULLIGAN')!;
    await game.restart();
    const before = await game.store.loadMatch(game.packets.get(game.a)!.matchId);
    await game.raw(owner, command);
    await expect.poll(() => game.messages.get(owner)!.some(message => message.type === 'COMMAND_ACCEPTED' && message.duplicate)).toBe(true);
    expect(await game.store.loadMatch(before!.match.id)).toEqual(before);
    const packet = game.packets.get(game.b)!; await game.b.reload();
    await expect(game.b.getByTestId('online-seat')).toHaveText('B'); await expect.poll(() => game.packets.get(game.b)).toEqual(packet);
    for (let i = 0; i < 180 && game.packets.get(game.a)!.view.status !== 'FINISHED'; i++) await game.step();
    const final = game.packets.get(game.a)!; expect(final.view.status).toBe('FINISHED');
    await game.restart();
    await game.raw(game.a, { type: 'GAME_COMMAND', commandId: 'split-finished', matchId: final.matchId, expectedVersion: final.stateVersion, payload: { kind: 'END_MAIN' } });
    await expect.poll(() => game.messages.get(game.a)!.some(message => message.type === 'COMMAND_REJECTED' && message.code === 'MATCH_FINISHED')).toBe(true);
    for (const page of game.pages) {
      expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => /alpha|ticket/i.test(key)))).toEqual([]);
      const view = game.packets.get(page)!.view, other = view.viewerId === 'A' ? 'B' : 'A';
      expect(view.players[other]!.zones.HAND.every(card => card.hidden)).toBe(true);
    }
    game.assertNoSecrets(); expect(game.browserErrors).toEqual([]);
  } finally { await game.close(); }
});
