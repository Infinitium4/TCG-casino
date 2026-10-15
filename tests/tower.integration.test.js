const { createPlayerFixture } = require('./helpers/player-fixture.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');

async function getFreePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

test('Tower starts once, validates authoritative placements, resumes and settles once', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-casino-tower-'));
  const root = path.resolve(__dirname, '..');
  let serverProcess = null;
  let baseUrl = '';
  const processes = [];

  async function startServer() {
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    serverProcess = spawn(process.execPath, [path.join(root, 'server.js')], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: String(port),
        DATA_DIR: dataDir,
        SESSION_SECRET: 'crash-test-session-secret',
        ADMIN_USERNAME: 'crash-admin',
        ADMIN_PASSWORD: 'crash-admin-password',
        SECOND_ADMIN_USERNAME: 'crash-admin-2',
        SECOND_ADMIN_PASSWORD: 'crash-admin-2-password',
        BANK_USERNAME: 'casino-bank',
        CRASH_ENABLED: 'false'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    processes.push(serverProcess);
    let output = '';
    serverProcess.stdout.on('data', (chunk) => { output += chunk.toString(); });
    serverProcess.stderr.on('data', (chunk) => { output += chunk.toString(); });

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (serverProcess.exitCode !== null) {
        throw new Error(`Server exited before becoming ready:\n${output}`);
      }
      try {
        const response = await fetch(`${baseUrl}/api/health`);
        if (response.ok) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Server did not start in time:\n${output}`);
  }

  async function stopServer() {
    if (!serverProcess || serverProcess.exitCode !== null) return;
    const stopping = new Promise((resolve) => serverProcess.once('exit', resolve));
    serverProcess.kill();
    await Promise.race([stopping, new Promise((resolve) => setTimeout(resolve, 3000))]);
  }

  async function request(url, { cookie, ...options } = {}) {
    const response = await fetch(`${baseUrl}${url}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(options.headers || {})
      }
    });
    const setCookie = response.headers.get('set-cookie');
    const nextCookie = setCookie ? setCookie.split(';')[0] : cookie;
    return { response, body: await response.json(), cookie: nextCookie };
  }

  async function register(username) {
    const result = await createPlayerFixture(baseUrl, dataDir, { username, password: 'player-password' });
    assert.equal(result.response.status, 201, result.body.error);
    return result.cookie;
  }

  t.after(async () => {
    for (const process of processes) {
      if (process.exitCode === null) {
        process.kill();
        await Promise.race([
          new Promise((resolve) => process.once('exit', resolve)),
          new Promise((resolve) => setTimeout(resolve, 3000))
        ]);
      }
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await startServer();
  assert.equal((await request('/api/tower/state')).response.status, 401);
  const cookie = await register('tower-alice');
  const bob = await register('tower-bob');
  const start = { stake: 100, requestId: 'tower-start-request-0001' };
  const starts = await Promise.all(Array.from({ length: 4 }, () => request('/api/tower/start', { cookie, method: 'POST', body: JSON.stringify(start) })));
  for (const attempt of starts) assert.equal(attempt.response.status, 200, attempt.body.error);
  assert.equal(starts.filter(attempt => !attempt.body.replay).length, 1);
  const first = starts[0].body;
  assert.equal(first.balance, 900);
  assert.equal(first.game.floor, 0);
  const gameId = first.game.id;
  assert.ok(starts.every(attempt => attempt.body.game.id === gameId));
  const duplicateStart = await request('/api/tower/start', { cookie, method: 'POST', body: JSON.stringify({ ...start, requestId: 'tower-new-start-request-0002' }) });
  assert.equal(duplicateStart.response.status, 409);
  const state = await request('/api/tower/state', { cookie });
  assert.equal(state.body.game.id, gameId);
  assert.equal((await request('/api/tower/state', { cookie: bob })).body.game, null);
  const stolen = await request('/api/tower/cashout', { cookie: bob, method: 'POST', body: JSON.stringify({ gameId, requestId: 'tower-stolen-request-0001' }) });
  assert.equal(stolen.response.status, 404);
  assert.equal((await request('/api/reset', { cookie, method: 'POST', body: '{}' })).response.status, 409);
  const otherGame = await request('/api/dice/roll', { cookie, method: 'POST', body: JSON.stringify({ stake: 100, threshold: 50, mode: 'under', requestId: 'dice-blocked-request-0001' }) });
  assert.equal(otherGame.response.status, 409);
  const executeSql = sql => new Promise((resolve, reject) => {
    const db = new sqlite3.Database(path.join(dataDir, 'database.sqlite'));
    db.exec(sql, error => db.close(() => error ? reject(error) : resolve()));
  });
  const prepare = async (id, phase = .25) => {
    const current = (await request('/api/tower/state', { cookie })).body.game;
    const motion = { ...current.motion, speed: 0, phase, startsAt: 0 };
    await executeSql(`UPDATE tower_games SET ready_at = 0, expires_at = ${Date.now() + 120000}, motion = '${JSON.stringify(motion)}' WHERE id = '${id}';`);
  };
  await prepare(gameId);
  const zeroCashout = await request('/api/tower/cashout', { cookie, method: 'POST', body: JSON.stringify({ gameId, requestId: 'tower-zero-cashout-0001' }) });
  assert.equal(zeroCashout.response.status, 409);
  const place = { gameId, floor: 0, requestId: 'tower-place-request-0001', x: 0, multiplier: 999, payout: 999999, success: false, timestamp: 0 };
  const placements = await Promise.all(Array.from({ length: 4 }, () => request('/api/tower/place', { cookie, method: 'POST', body: JSON.stringify(place) })));
  for (const attempt of placements) assert.equal(attempt.response.status, 200, attempt.body.error);
  assert.equal(placements.filter(attempt => !attempt.body.replay).length, 1);
  const placed = placements[0].body;
  assert.equal(placed.game.floor, 1); assert.equal(placed.game.lastPlacement.perfect, true);
  assert.equal(placed.game.platforms[1].width, 180);
  assert.equal(placed.game.score, 125);
  assert.equal(placed.game.multiplier, 1.08);
  assert.equal(placed.balance, 900);
  const early = await request('/api/tower/place', { cookie, method: 'POST', body: JSON.stringify({ ...place, floor: 1, requestId: 'tower-early-place-request-0002' }) });
  assert.equal(early.response.status, 409);
  await stopServer(); await startServer();
  const restored = await request('/api/tower/state', { cookie });
  assert.equal(restored.body.game.id, gameId); assert.equal(restored.body.game.floor, 1);
  assert.equal(restored.body.balance, 900);
  await executeSql(`UPDATE tower_games SET ready_at = 0 WHERE id = '${gameId}';`);
  await executeSql("CREATE TRIGGER fail_tower_bank BEFORE INSERT ON bank_ledger WHEN NEW.game_name = 'tower' BEGIN SELECT RAISE(ABORT, 'test rollback'); END;");
  const cash = { gameId, requestId: 'tower-cashout-request-0001', payout: 999999, multiplier: 999 };
  const failed = await request('/api/tower/cashout', { cookie, method: 'POST', body: JSON.stringify(cash) });
  assert.equal(failed.response.status, 500);
  assert.equal((await request('/api/tower/state', { cookie })).body.balance, 900);
  assert.equal((await request('/api/history', { cookie })).body.history.length, 0);
  await executeSql('DROP TRIGGER fail_tower_bank;');
  const cashouts = await Promise.all(Array.from({ length: 4 }, () => request('/api/tower/cashout', { cookie, method: 'POST', body: JSON.stringify(cash) })));
  for (const attempt of cashouts) assert.equal(attempt.response.status, 200, attempt.body.error);
  assert.equal(cashouts.filter(attempt => !attempt.body.replay).length, 1);
  assert.equal(cashouts[0].body.balance, 1008);
  assert.equal(cashouts[0].body.game.payout, 108);
  assert.equal(cashouts[0].body.game.status, 'CASHOUT');
  assert.equal((await request('/api/history', { cookie })).body.history.filter(row => row.game_name === 'tower').length, 1);
  const secondCash = await request('/api/tower/cashout', { cookie, method: 'POST', body: JSON.stringify({ ...cash, requestId: 'tower-double-cashout-request-0002' }) });
  assert.equal(secondCash.response.status, 409);
  const second = await request('/api/tower/start', { cookie, method: 'POST', body: JSON.stringify({ ...start, requestId: 'tower-start-request-0003' }) });
  assert.equal(second.response.status, 200);
  const secondId = second.body.game.id;
  await prepare(secondId, .5);
  const miss = await request('/api/tower/place', { cookie, method: 'POST', body: JSON.stringify({ ...place, gameId: secondId, requestId: 'tower-miss-request-0002', x: 300, success: true }) });
  assert.equal(miss.response.status, 200);
  assert.equal(miss.body.game.status, 'LOST');
  assert.equal(miss.body.game.payout, 0);
  assert.equal(miss.body.balance, 908);
  const abandoned = await request('/api/tower/start', { cookie, method: 'POST', body: JSON.stringify({ ...start, requestId: 'tower-start-request-0004' }) });
  assert.equal(abandoned.response.status, 200);
  await executeSql(`UPDATE tower_games SET expires_at = 0 WHERE id = '${abandoned.body.game.id}';`);
  const expired = await request('/api/tower/state', { cookie });
  assert.equal(expired.body.game.status, 'LOST'); assert.equal(expired.body.balance, 808);
  assert.equal((await request('/api/history', { cookie })).body.history.filter(row => row.game_name === 'tower').length, 3);
  await request('/api/tower/state', { cookie });
  assert.equal((await request('/api/history', { cookie })).body.history.filter(row => row.game_name === 'tower').length, 3);
  for (const stake of [-1, 0, 0.001, '100', 1000001]) {
    const invalid = await request('/api/tower/start', { cookie, method: 'POST', body: JSON.stringify({ ...start, stake }) });
    assert.equal(invalid.response.status, 400);
  }
  const insufficient = await request('/api/tower/start', { cookie, method: 'POST', body: JSON.stringify({ ...start, stake: 1000000, requestId: 'tower-insufficient-request-0001' }) });
  assert.equal(insufficient.response.status, 400);
  const complete = await request('/api/tower/start', { cookie, method: 'POST', body: JSON.stringify({ ...start, requestId: 'tower-complete-start-request-0001' }) });
  assert.equal(complete.response.status, 200);
  for (let floor = 0; floor < 8; floor++) {
    await prepare(complete.body.game.id);
    const step = await request('/api/tower/place', { cookie, method: 'POST', body: JSON.stringify({ gameId: complete.body.game.id, floor, requestId: `tower-complete-place-request-000${floor}` }) });
    assert.equal(step.response.status, 200, step.body.error);
    assert.equal(step.body.game.floor, floor + 1);
    if (floor < 7) assert.equal(step.body.game.status, 'PLACING');
    else {
      assert.equal(step.body.game.status, 'CASHOUT');
      assert.equal(step.body.game.payout, 365);
      assert.equal(step.body.balance, 1073);
      assert.equal(step.body.game.score, 1000);
    }
  }
  const login = await request('/api/login', { method: 'POST', body: JSON.stringify({ username: 'crash-admin', password: 'crash-admin-password' }) });
  const admin = login.cookie;
  const bank = await request('/api/admin/bank', { cookie: admin });
  const records = bank.body.recent.filter(row => row.game_name === 'tower');
  assert.equal(records.length, 4);
  assert.equal(records.reduce((sum, row) => sum + row.bank_delta, 0), -73);
  await request('/api/admin/security/pause-bets', { cookie: admin, method: 'POST', body: JSON.stringify({ paused: true, reason: 'Tower integration test' }) });
  const paused = await request('/api/tower/start', { cookie, method: 'POST', body: JSON.stringify({ ...start, requestId: 'tower-paused-start-request-0001' }) });
  assert.equal(paused.response.status, 503);
  const oldCashout = await request('/api/tower/cashout', { cookie, method: 'POST', body: JSON.stringify(cash) });
  assert.equal(oldCashout.response.status, 200);
  assert.equal(oldCashout.body.replay, true);
});
