const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const sqlite3 = require('sqlite3');
const { generateRace } = require('../horse-racing');

test('horse betting and settlement are authenticated, atomic, durable and idempotent', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-horses-test-'));
  let child, baseUrl, db;
  async function stop() {
    if (child && child.exitCode === null) {
      const exit = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exit;
    }
  }
  t.after(async () => {
    await stop();
    if (db) await new Promise(resolve => db.close(resolve));
    assert.equal(path.dirname(dataDir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('tcg-horses-test-'));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  async function start() {
    const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), env: {
      ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dataDir,
      SESSION_SECRET: 'horse-racing-test-secret', ADMIN_USERNAME: 'horses-admin', ADMIN_PASSWORD: 'test-admin-password',
      SECOND_ADMIN_USERNAME: 'horses-admin2', SECOND_ADMIN_PASSWORD: 'test-admin2-password', CRASH_ENABLED: 'false'
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null) throw new Error(output);
      try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(output);
  }
  async function request(url, cookie, body) {
    const response = await fetch(baseUrl + url, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(cookie ? { Cookie: cookie } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
  }
  const sql = (query, params = []) => new Promise((resolve, reject) => db.all(query, params, (error, rows) => error ? reject(error) : resolve(rows)));
  await start();
  db = new sqlite3.Database(path.join(dataDir, 'database.sqlite')); db.configure('busyTimeout', 5000);
  assert.equal((await request('/api/horses/state')).status, 401);
  const cookie = (await request('/api/register', null, { username: 'horse-player', password: 'player-password' })).cookie;
  const other = (await request('/api/register', null, { username: 'other-player', password: 'player-password' })).cookie;
  for (const stake of [0, -1, 1.5, 1001, '25']) assert.equal((await request('/api/horses/bet', cookie, { stake, horseId: 1, requestId: 'invalid-stake-test' })).status, 400);
  assert.equal((await request('/api/horses/bet', cookie, { stake: 10, horseId: 6, requestId: 'invalid-horse-test' })).status, 400);
  const body = { stake: 100, horseId: 1, requestId: 'duplicate-test-request' };
  const duplicates = await Promise.all(Array.from({ length: 4 }, () => request('/api/horses/bet', cookie, body)));
  assert.ok(duplicates.every(result => result.status === 200 && result.body.balance === 900));
  const id = duplicates[0].body.race.id;
  assert.ok(duplicates.every(result => result.body.race.id === id && !Object.hasOwn(result.body.race, 'winner')));
  assert.equal((await request('/api/horses/bet', cookie, { ...body, horseId: 2 })).status, 409);
  assert.equal((await request('/api/horses/bet', cookie, { ...body, requestId: 'another-bet-request' })).status, 409);
  assert.equal((await request(`/api/horses/${id}/start`, other, {})).status, 404);
  assert.equal((await request(`/api/horses/${id}/settle`, cookie, {})).status, 409);
  assert.equal((await request('/api/reset', cookie, {})).status, 409);
  // Install a known winning outcome in this isolated test database, never via the public API.
  const winning = generateRace((min, max) => max ? 100 : min - 1);
  await sql('UPDATE horse_races SET winner = 1, outcome = ? WHERE id = ?', [JSON.stringify(winning), id]);
  const started = await request(`/api/horses/${id}/start`, cookie, {});
  assert.equal(started.body.race.winner, 1);
  const again = await request(`/api/horses/${id}/start`, cookie, {});
  assert.equal(again.body.race.startedAt, started.body.race.startedAt);
  assert.equal((await request(`/api/horses/${id}/settle`, cookie, { payout: 999999, winner: 5 })).status, 409);
  await stop(); await start();
  assert.equal((await request('/api/horses/state', cookie)).body.race.id, id);
  await sql("CREATE TRIGGER fail_horse_bank BEFORE INSERT ON bank_ledger WHEN NEW.game_name = 'horses' BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
  await sql('UPDATE horse_races SET ends_at_ms = ? WHERE id = ?', [Date.now() - 1, id]);
  assert.equal((await request(`/api/horses/${id}/settle`, cookie, {})).status, 500);
  assert.equal((await sql('SELECT chips FROM users WHERE username = ?', ['horse-player']))[0].chips, 900);
  assert.equal((await sql('SELECT status FROM horse_races WHERE id = ?', [id]))[0].status, 'running');
  assert.equal((await sql("SELECT * FROM game_history WHERE game_name = 'horses'")).length, 0);
  await sql('DROP TRIGGER fail_horse_bank');
  const settled = await Promise.all(Array.from({ length: 4 }, () => request(`/api/horses/${id}/settle`, cookie, { payout: 999999 })));
  assert.ok(settled.every(result => result.body.balance === 1300 && result.body.race.payout === 400));
  assert.equal((await sql("SELECT * FROM game_history WHERE game_name = 'horses'")).length, 1);
  assert.equal((await sql("SELECT * FROM bank_ledger WHERE game_name = 'horses'"))[0].bank_delta, -300);
  assert.equal((await request('/api/horses/bet', cookie, body)).body.balance, 1300);
  const losing = await request('/api/horses/bet', cookie, { stake: 100, horseId: 2, requestId: 'losing-race-request' });
  await sql('UPDATE horse_races SET winner = 1, outcome = ? WHERE id = ?', [JSON.stringify(winning), losing.body.race.id]);
  await request(`/api/horses/${losing.body.race.id}/start`, cookie, {});
  await sql('UPDATE horse_races SET ends_at_ms = ? WHERE id = ?', [Date.now() - 1, losing.body.race.id]);
  // Automatic settlement pays even if the player closes the page.
  await new Promise(resolve => setTimeout(resolve, 1200));
  const state = (await request('/api/horses/state', cookie)).body;
  assert.equal(state.balance, 1200); assert.equal(state.race.payout, 0); assert.equal(state.race.status, 'settled');
  assert.equal(state.history.length, 2);
  assert.equal((await sql("SELECT * FROM bank_ledger WHERE game_name = 'horses'")).reduce((sum, row) => sum + row.bank_delta, 0), -200);
  assert.equal((await request('/api/result', cookie, { game: 'horses', bet: 1, payout: 100000, net: 99999, result: 'Victoire' })).status, 400);
  await sql("UPDATE casino_game_settings SET maintenance = 1 WHERE game = 'horses'");
  assert.equal((await request('/api/horses/bet', cookie, { ...body, requestId: 'maintenance-request' })).status, 503);
  await sql("UPDATE casino_game_settings SET maintenance = 0 WHERE game = 'horses'");
  await sql("UPDATE casino_platform_settings SET setting_value = '1' WHERE setting_key = 'betting_paused'");
  assert.equal((await request('/api/horses/bet', cookie, { ...body, requestId: 'pause-test-request' })).status, 503);
  await sql("UPDATE casino_platform_settings SET setting_value = '0' WHERE setting_key = 'betting_paused'");

  const created = await request('/api/horses/tables', cookie, {});
  assert.equal(created.status, 200);
  const table = created.body.table, tableUrl = `/api/horses/tables/${table.id}`;
  assert.equal(new Set(table.horses.map(horse => horse.odds)).size, 5);
  assert.equal(new Set(table.horses.map(horse => horse.probability)).size, 5);
  assert.ok(Math.abs(table.horses.reduce((sum, horse) => sum + horse.probability, 0) - 1) < 1e-10);
  assert.equal((await request(`${tableUrl}/start`, cookie, { eventId: table.eventId })).status, 409);
  assert.equal((await request(`${tableUrl}/join`, other, {})).status, 200);
  assert.equal((await request(`${tableUrl}/start`, other, { eventId: table.eventId })).status, 403);
  const stored = (await sql('SELECT outcome FROM horse_events WHERE id=?', [table.eventId]))[0];
  const winner = JSON.parse(stored.outcome).order[0];
  const odds = table.horses.find(horse => horse.id === winner).oddsCents;
  const hostBet = { stake: 100, horseId: winner, requestId: 'shared-host-request', eventId: table.eventId, oddsCents: 999999 };
  const guestBet = { stake: 50, horseId: winner, requestId: 'shared-guest-request', eventId: table.eventId };
  const hostReplies = await Promise.all([request(`${tableUrl}/bet`, cookie, hostBet), request(`${tableUrl}/bet`, cookie, hostBet)]);
  assert.ok(hostReplies.every(result => result.status === 200 && result.body.balance === 1100));
  assert.ok(!Object.hasOwn(hostReplies[0].body.race, 'winner'));
  assert.equal((await request(`${tableUrl}/start`, cookie, { eventId: table.eventId })).status, 409);
  const guestReply = await request(`${tableUrl}/bet`, other, guestBet);
  assert.equal(guestReply.status, 200);
  assert.equal(guestReply.body.balance, 950);
  assert.equal(guestReply.body.table.players.filter(player => player.horseId === winner).length, 2);
  assert.equal(guestReply.body.race.odds, odds / 100);
  assert.equal((await request(`/api/horses/${hostReplies[0].body.race.id}/start`, cookie, {})).status, 409);
  const launches = await Promise.all([request(`${tableUrl}/start`, cookie, { eventId: table.eventId }), request(`${tableUrl}/start`, cookie, { eventId: table.eventId })]);
  assert.equal(launches[0].body.race.startedAt, launches[1].body.race.startedAt);
  const sharedGuest = (await request('/api/horses/state', other)).body;
  assert.equal(sharedGuest.race.startedAt, launches[0].body.race.startedAt);
  assert.deepEqual(sharedGuest.race.trajectories, launches[0].body.race.trajectories);
  assert.equal((await request(`${tableUrl}/leave`, other, {})).status, 409);
  assert.equal((await request(`${tableUrl}/bet`, other, { ...guestBet, requestId: 'late-shared-request' })).status, 409);
  await stop(); await start();
  assert.equal((await request('/api/horses/state', other)).body.table.eventId, table.eventId);
  await sql("CREATE TRIGGER fail_shared_bank BEFORE INSERT ON bank_ledger WHEN NEW.game_name='horses' BEGIN SELECT RAISE(ABORT,'shared rollback'); END");
  await sql('UPDATE horse_events SET ends_at_ms=? WHERE id=?', [Date.now() - 1, table.eventId]);
  await sql('UPDATE horse_races SET ends_at_ms=? WHERE event_id=?', [Date.now() - 1, table.eventId]);
  assert.equal((await request('/api/horses/state', cookie)).status, 500);
  assert.equal((await sql('SELECT chips FROM users WHERE username=?', ['horse-player']))[0].chips, 1100);
  assert.equal((await sql('SELECT chips FROM users WHERE username=?', ['other-player']))[0].chips, 950);
  await sql('DROP TRIGGER fail_shared_bank');
  const paidHost = (await request('/api/horses/state', cookie)).body;
  const paidGuest = (await request('/api/horses/state', other)).body;
  assert.equal(paidHost.balance, 1100 + Math.floor(100 * odds / 100));
  assert.equal(paidGuest.balance, 950 + Math.floor(50 * odds / 100));
  assert.equal(paidGuest.table.status, 'settled');
  assert.equal((await request('/api/horses/state', cookie)).body.balance, paidHost.balance);
  assert.equal((await request(`${tableUrl}/next`, other, { eventId: table.eventId })).status, 403);
  const next = (await request(`${tableUrl}/next`, cookie, { eventId: table.eventId })).body.table;
  assert.notEqual(next.eventId, table.eventId);
  assert.ok(next.horses.every((horse, index) => horse.odds !== table.horses[index].odds));
  assert.equal((await request(`${tableUrl}/next`, cookie, { eventId: table.eventId })).body.table.eventId, next.eventId);
  assert.equal((await request(`${tableUrl}/bet`, cookie, { ...hostBet, requestId: 'stale-cotes-request' })).status, 409);
  const leaveBet = { ...hostBet, eventId: next.eventId, requestId: 'refundable-request' };
  assert.equal((await request(`${tableUrl}/bet`, cookie, leaveBet)).status, 200);
  const left = await request(`${tableUrl}/leave`, cookie, {});
  assert.equal(left.body.balance, paidHost.balance);
  assert.equal((await request('/api/horses/state', other)).body.table.hostId, next.players.find(player => player.username === 'other-player').id);
  // Rejoining an unstarted race allows a fresh bet after the old one was refunded.
  await request(`${tableUrl}/join`, cookie, {});
  assert.equal((await request(`${tableUrl}/bet`, cookie, { ...leaveBet, requestId: 'rejoined-request' })).status, 200);
  await request(`${tableUrl}/leave`, cookie, {});
  await request(`${tableUrl}/leave`, other, {});
  assert.equal((await request(`${tableUrl}/join`, cookie, {})).status, 404);
  const capacity = (await request('/api/horses/tables', cookie, {})).body.table;
  await request(`/api/horses/tables/${capacity.id}/join`, other, {});
  const candidates = [];
  for (let i = 0; i < 7; i++) {
    const registered = await request('/api/register', null, { username: `horse-capacity-${i}`, password: 'capacity-password' });
    assert.equal(registered.status, 201);
    candidates.push(registered.cookie);
    if (i < 5) assert.equal((await request(`/api/horses/tables/${capacity.id}/join`, registered.cookie, {})).status, 200);
  }
  const finalSeat = await Promise.all(candidates.slice(5).map(candidate => request(`/api/horses/tables/${capacity.id}/join`, candidate, {})));
  assert.deepEqual(finalSeat.map(reply => reply.status).sort(), [200, 409]);
  assert.equal((await request('/api/horses/state', cookie)).body.table.players.length, 8);
  const outsider = candidates[finalSeat[0].status === 409 ? 5 : 6];
  assert.equal((await request(`/api/horses/tables/${capacity.id}/bet`, outsider, { ...hostBet, eventId: capacity.eventId })).status, 403);
  const solo = (await request('/api/horses/tables', outsider, {})).body.table;
  const soloUrl = `/api/horses/tables/${solo.id}`;
  assert.equal((await request(`${soloUrl}/start`, outsider, { eventId: solo.eventId })).status, 409);
  const soloBet = await request(`${soloUrl}/bet`, outsider, { stake: 25, horseId: 1, requestId: 'solo-table-request', eventId: solo.eventId });
  assert.equal(soloBet.body.balance, 975);
  const soloStart = await request(`${soloUrl}/start`, outsider, { eventId: solo.eventId });
  assert.equal(soloStart.status, 200);
  assert.equal(soloStart.body.race.status, 'running');
  assert.equal(soloStart.body.table.players.length, 1);
  await sql('UPDATE horse_events SET ends_at_ms=? WHERE id=?', [Date.now() - 1, solo.eventId]);
  await sql('UPDATE horse_races SET ends_at_ms=? WHERE event_id=?', [Date.now() - 1, solo.eventId]);
  const soloResult = (await request('/api/horses/state', outsider)).body;
  const soloPayout = soloResult.race.winner === 1 ? Math.floor(25 * solo.horses[0].oddsCents / 100) : 0;
  assert.equal(soloResult.race.status, 'settled');
  assert.equal(soloResult.balance, 975 + soloPayout);
  assert.equal((await request('/api/horses/state', outsider)).body.balance, soloResult.balance);
});
