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

test('Plinko settles atomically, deduplicates requests and survives a restart', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-casino-plinko-'));
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
    const result = await request('/api/register', {
      method: 'POST',
      body: JSON.stringify({ username, password: 'player-password' })
    });
    assert.equal(result.response.status, 201, result.body.error);
    return result.cookie;
  }

  async function waitForState(cookie, predicate, timeout = 3000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const { response, body } = await request('/api/crash/state', { cookie });
      assert.equal(response.status, 200, body.error);
      if (predicate(body)) return body;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Timed out waiting for Crash state.');
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
  const anonymous = await request('/api/plinko/state');
  assert.equal(anonymous.response.status, 401);
  const alice = await register('plinko-alice');
  const bob = await register('plinko-bob');
  const initial = await request('/api/plinko/state', { cookie: alice });
  assert.equal(initial.body.rows, 16);
  assert.equal(initial.body.multipliers.length, 17);
  assert.deepEqual(initial.body.risks, ['high']);
  const bet = { stake: 100, requestId: 'unique-plinko-request-0001', risk: 'high', rows: 16, payout: 99999999, slot: 0, multiplier: 999 };
  const results = await Promise.all(Array.from({ length: 5 }, () => request('/api/plinko/drop', { cookie: alice, method: 'POST', body: JSON.stringify(bet) })));
  for (const result of results) assert.equal(result.response.status, 200, result.body.error);
  assert.equal(results.filter(result => !result.body.replay).length, 1);
  const first = results[0].body;
  assert.ok(Number.isInteger(first.drop.id));
  assert.equal(first.drop.path.length, 16);
  assert.ok(first.drop.path.every(direction => direction === 0 || direction === 1));
  assert.equal(first.drop.slot, first.drop.path.reduce((sum, value) => sum + value, 0));
  assert.equal(first.drop.multiplier, initial.body.multipliers[first.drop.slot]);
  assert.equal(first.drop.payout, Math.floor(100 * first.drop.multiplier));
  assert.equal(first.balance, initial.body.balance - 100 + first.drop.payout);
  assert.ok(results.every(result => result.body.drop.id === first.drop.id));
  const history = await request('/api/history', { cookie: alice });
  assert.equal(history.body.history.filter(entry => entry.game_name === 'plinko').length, 1);
  const state = await request('/api/plinko/state', { cookie: bob });
  assert.equal(state.body.history.length, 0);
  assert.equal(state.body.recent[0].username, 'plinko-alice');
  for (const field of ['user_id', 'requestId', 'path', 'slot', 'balance', 'password_hash']) assert.equal(Object.hasOwn(state.body.recent[0], field), false);
  const conflicting = await request('/api/plinko/drop', { cookie: alice, method: 'POST', body: JSON.stringify({ ...bet, stake: 50 }) });
  assert.equal(conflicting.response.status, 409);
  for (const override of [{ stake: -1 }, { stake: 1.5 }, { stake: '100' }, { stake: 1000001 }, { rows: 15 }, { risk: 'low' }, { requestId: 'x' }]) {
    const invalid = await request('/api/plinko/drop', { cookie: bob, method: 'POST', body: JSON.stringify({ ...bet, ...override }) });
    assert.equal(invalid.response.status, 400);
  }
  const insufficient = await request('/api/plinko/drop', { cookie: bob, method: 'POST', body: JSON.stringify({ ...bet, stake: 1000000 }) });
  assert.equal(insufficient.response.status, 400);
  assert.equal((await request('/api/plinko/state', { cookie: bob })).body.balance, initial.body.balance);

  const login = await request('/api/login', { method: 'POST', body: JSON.stringify({ username: 'crash-admin', password: 'crash-admin-password' }) });
  assert.equal(login.response.status, 200);
  const admin = login.cookie;
  const bank = await request('/api/admin/bank', { cookie: admin });
  assert.equal(bank.response.status, 200);
  assert.equal(bank.body.recent.filter(entry => entry.game_name === 'plinko').length, 1);
  assert.equal(bank.body.recent[0].bank_delta, 100 - first.drop.payout);
  const executeSql = sql => new Promise((resolve, reject) => {
    const db = new sqlite3.Database(path.join(dataDir, 'database.sqlite'));
    db.exec(sql, error => db.close(() => error ? reject(error) : resolve()));
  });
  // Fail the final bank write: the debit, credit, drop and history must all roll back.
  await executeSql("CREATE TRIGGER fail_plinko_bank BEFORE INSERT ON bank_ledger WHEN NEW.game_name = 'plinko' BEGIN SELECT RAISE(ABORT, 'test rollback'); END;");
  const bobBet = { ...bet, requestId: 'rollback-plinko-request-0002' };
  const failed = await request('/api/plinko/drop', { cookie: bob, method: 'POST', body: JSON.stringify(bobBet) });
  assert.equal(failed.response.status, 500);
  const afterFailure = await request('/api/plinko/state', { cookie: bob });
  assert.equal(afterFailure.body.balance, initial.body.balance);
  assert.equal(afterFailure.body.history.length, 0);
  assert.equal((await request('/api/history', { cookie: bob })).body.history.length, 0);
  await executeSql('DROP TRIGGER fail_plinko_bank;');
  const retried = await request('/api/plinko/drop', { cookie: bob, method: 'POST', body: JSON.stringify(bobBet) });
  assert.equal(retried.response.status, 200);
  assert.equal(retried.body.replay, false);
  await executeSql(`UPDATE plinko_drops SET created_at_ms = ${Date.now()} WHERE user_id = (SELECT id FROM users WHERE username = 'plinko-bob');`);
  const tooFast = await request('/api/plinko/drop', { cookie: bob, method: 'POST', body: JSON.stringify({ ...bobBet, requestId: 'rate-limit-plinko-request-0003' }) });
  assert.equal(tooFast.response.status, 429);
  const rapidReplay = await request('/api/plinko/drop', { cookie: bob, method: 'POST', body: JSON.stringify(bobBet) });
  assert.equal(rapidReplay.response.status, 200);
  assert.equal(rapidReplay.body.replay, true);

  const charlie = await register('plinko-charlie');
  const created = await request('/api/blackjack/tables', { cookie: charlie, method: 'POST', body: '{}' });
  assert.equal(created.response.status, 201);
  const tableId = created.body.table.id;
  await request(`/api/blackjack/tables/${tableId}/join`, { cookie: charlie, method: 'POST', body: '{}' });
  const started = await request(`/api/blackjack/tables/${tableId}/start`, { cookie: charlie, method: 'POST', body: JSON.stringify({ betAmount: 10 }) });
  assert.equal(started.response.status, 200);
  // A natural blackjack may settle instantly; only active tables must be blocked.
  if (started.body.table.status === 'in-progress') {
    const blocked = await request('/api/plinko/drop', { cookie: charlie, method: 'POST', body: JSON.stringify(bet) });
    assert.equal(blocked.response.status, 409);
  }
  await request('/api/admin/security/pause-bets', { cookie: admin, method: 'POST', body: JSON.stringify({ paused: true, reason: 'Plinko integration test' }) });
  const paused = await request('/api/plinko/drop', { cookie: bob, method: 'POST', body: JSON.stringify({ ...bet, requestId: 'unique-paused-request-0002' }) });
  assert.equal(paused.response.status, 503);
  const retryWhilePaused = await request('/api/plinko/drop', { cookie: alice, method: 'POST', body: JSON.stringify(bet) });
  assert.equal(retryWhilePaused.response.status, 200);
  assert.equal(retryWhilePaused.body.replay, true);

  await stopServer();
  await startServer();
  const replay = await request('/api/plinko/drop', { cookie: alice, method: 'POST', body: JSON.stringify(bet) });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.replay, true);
  assert.deepEqual(replay.body.drop.path, first.drop.path);
  assert.equal(replay.body.drop.id, first.drop.id);
  assert.equal((await request('/api/history', { cookie: alice })).body.history.filter(entry => entry.game_name === 'plinko').length, 1);
});
