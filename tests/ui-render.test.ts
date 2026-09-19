import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../src/ui/App.tsx';
import { readCardCatalog, compileContent } from '../src/cards/index.ts';
import { LocalController } from '../src/local/controller.ts';
import { fixtureOptions } from '../src/local/decks.ts';

const content = compileContent(await readCardCatalog(new URL('../data/', import.meta.url)));
const render = (controller: LocalController) => renderToStaticMarkup(createElement(App, { controller }));
test('handoff renders only the cover and never exports private state', () => {
  const controller = LocalController.create(content, fixtureOptions(42));
  controller.exportSnapshot = () => { throw new Error('render must never export'); };
  const html = render(controller);
  assert.match(html, /data-testid="handoff"/);
  assert.doesNotMatch(html, /game-board|dev-panel|data-card-id|decision-panel|EVENT LOG/);
});
test('ready board shows public zones and own decision, then removes it on handoff', () => {
  const controller = LocalController.create(content, fixtureOptions(42));
  controller.ready();
  controller.exportSnapshot = () => { throw new Error('render must never export'); };
  const view = controller.getSnapshot().view!;
  const html = render(controller);
  assert.match(html, /game-board/);
  assert.match(html, /decision-panel/);
  assert.match(html, /MULLIGAN/);
  for (const zone of ['PARTNER','CASE','FIELD','EVIDENCE','FILE','REMOVE','DECK','HAND']) assert.ok(html.includes(zone), zone);
  const ownCard = view.players[view.viewerId]!.zones.HAND[0]!;
  assert.ok(html.includes(ownCard.id!));
  controller.submit({ kind: 'MULLIGAN', choiceId: controller.getSnapshot().decision!.id, cardIds: [] });
  const cover = render(controller);
  assert.match(cover, /handoff/);
  assert.ok(!cover.includes(ownCard.id!));
  assert.doesNotMatch(cover, /game-board|decision-panel|dev-panel/);
});
