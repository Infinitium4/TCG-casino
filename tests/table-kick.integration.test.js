const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { createPlayerFixture } = require('./helpers/player-fixture.cjs');

test('hosts and admins can kick between rounds; other players cannot; horse bets are refunded once', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-kick-'));
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), env: {
    ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dir,
    ADMIN_USERNAME: 'kick-admin', ADMIN_PASSWORD: 'kick-admin-password',
    SECOND_ADMIN_USERNAME: 'kick-admin2', SECOND_ADMIN_PASSWORD: 'kick-admin2-password'
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
  t.after(async () => {
    if (child.exitCode === null) {
      const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill(); await stopped;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(ready, output);
  const request = async (url, cookie, body) => {
    const response = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(cookie ? { Cookie: cookie } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const admin = await request('/api/login', null, { username: 'kick-admin', password: 'kick-admin-password' });
  const host = await createPlayerFixture(base, dir, { username: 'kick-host', password: 'password' });
  const guest = await createPlayerFixture(base, dir, { username: 'kick-guest', password: 'password' });
  const outsider = await createPlayerFixture(base, dir, { username: 'kick-outsider', password: 'password' });
  const hostId = (await request('/api/me', host.cookie)).body.user.id;
  const guestId = (await request('/api/me', guest.cookie)).body.user.id;
  for (const game of ['poker', 'blackjack', 'horses']) {
    const guestBalance = (await request('/api/me', guest.cookie)).body.user.chips;
    const created = await request(`/api/${game}/tables`, host.cookie, {});
    assert.ok(created.status < 300, JSON.stringify(created.body));
    const table = created.body.table;
    const url = `/api/${game}/tables/${table.id}`;
    assert.ok((await request(url + '/join', guest.cookie, {})).status < 300);
    assert.equal((await request(url + '/kick', null, { playerId: guestId })).status, 401);
    assert.equal((await request(url + '/kick', outsider.cookie, { playerId: guestId })).status, 403);
    assert.equal((await request(url + '/kick', host.cookie, { playerId: hostId })).status, 400);
    assert.equal((await request(url + '/kick', host.cookie, { playerId: 'wrong' })).status, 400);
    if (game === 'horses') {
      assert.equal((await request(url + '/bet', guest.cookie, { stake: 25, horseId: 1,
        requestId: 'kick-refund-test-0001', eventId: table.eventId })).status, 200);
    }
    assert.equal((await request(url + '/kick', host.cookie, { playerId: guestId })).status, 200);
    assert.ok((await request(url + '/kick', host.cookie, { playerId: guestId })).status >= 400);
    if (game === 'horses') assert.equal((await request('/api/me', guest.cookie)).body.user.chips, guestBalance);
    assert.ok((await request(url + '/join', guest.cookie, {})).status < 300);
    assert.equal((await request(url + '/kick', admin.cookie, { playerId: hostId })).status, 200);
    const snapshot = game === 'horses'
      ? (await request('/api/horses/state', guest.cookie)).body.table
      : (await request(url, guest.cookie)).body.table;
    assert.equal(snapshot.hostId, guestId);
    if (game === 'horses') {
      await request(url + '/bet', guest.cookie, { stake: 10, horseId: 1, requestId: 'kick-running-test-0001', eventId: snapshot.eventId });
      assert.equal((await request(url + '/start', guest.cookie, { eventId: snapshot.eventId })).status, 200);
      assert.equal((await request(url + '/kick', admin.cookie, { playerId: guestId })).status, 409);
    } else if (game === 'blackjack') {
      assert.equal((await request(url + '/start', guest.cookie, { betAmount: 1 })).status, 200);
      // Blackjack may finish immediately on a natural; only assert for an active hand.
      const current = (await request(url, guest.cookie)).body.table;
      if (current.status === 'in-progress') assert.equal((await request(url + '/kick', admin.cookie, { playerId: guestId })).status, 409);
      // Finish this isolated table so subsequent horse tests can use the account.
      for (let i = 0; i < 10; i++) {
        const current = (await request(url, guest.cookie)).body.table;
        if (current.status !== 'in-progress') break;
        await request(url + '/action', guest.cookie, { action: 'stand' });
      }
    }
  }
});
