import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicConfig, fetchSocketProtocols } from '../src/ui/ProductionBootstrap.tsx';
import { connectAfterAccess } from '../src/ui/OnlineScreen.tsx';

test('split-origin browser config requires explicit ticket mode while old cookie config stays same-origin', () => {
  const config = { webPublicUrl: 'https://web.example.com', gameServerPublicUrl: 'wss://server.example.com/ws', alphaRequired: true, alphaTransport: 'TICKET' };
  assert.deepEqual(parsePublicConfig(config, config.webPublicUrl), config);
  assert.throws(() => parsePublicConfig({ ...config, alphaTransport: undefined }, config.webPublicUrl));
  for (const url of ['ws://server.example.com/ws', 'wss://user:pw@server.example.com/ws', 'wss://server.example.com/ws?ticket=x', 'wss://server.example.com/a/../ws']) {
    assert.throws(() => parsePublicConfig({ ...config, gameServerPublicUrl: url }, config.webPublicUrl));
  }
});

test('socket admission stays in a relative POST and produces only a subprotocol tuple, never a credential URL', async () => {
  const ticket = 'ws1.100.200.' + 'x'.repeat(32) + '.' + 'y'.repeat(43);
  let requests = 0;
  const protocols = await fetchSocketProtocols(async (url, init) => {
    requests++; assert.equal(url, '/api/alpha/socket-ticket'); assert.equal(init!.method, 'POST');
    assert.equal(init!.body, '{}'); assert.equal(init!.credentials, 'same-origin'); assert.equal(init!.redirect, 'error');
    return Response.json({ ticket });
  });
  assert.equal(requests, 1); assert.deepEqual(protocols, ['conan-alpha.v1', ticket]);
  for (const value of [{}, { ticket: 'a,b' }, { ticket: 'bad query?x' }, { ticket: 'x'.repeat(9000) }]) {
    await assert.rejects(fetchSocketProtocols(async () => Response.json(value)), /SERVER_ERROR/);
  }
});

test('initial/reconnect admission waits for a fresh ticket after access, and failed ticket never connects', async () => {
  const events: string[] = [];
  await connectAfterAccess(protocols => { assert.deepEqual(protocols, ['conan-alpha.v1', 'ticket']); events.push('connect'); },
    async () => { events.push('access'); }, async () => { events.push('ticket'); return ['conan-alpha.v1', 'ticket']; });
  assert.deepEqual(events, ['access', 'ticket', 'connect']);
  await assert.rejects(connectAfterAccess(() => { assert.fail('Must not connect'); }, undefined, async () => { throw Error('ticket rejected'); }));
});
