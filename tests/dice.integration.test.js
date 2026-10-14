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

test('Dice validates, settles atomically and recovers repeated rolls after restart', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-casino-dice-'));
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
  assert.equal((await request('/api/dice/state')).response.status, 401);
  const bet = { stake: 100, mode: 'under', threshold: 50, requestId: 'dice-idempotent-request-0001', result: 0, payout: 99999999, multiplier: 99999 };
  assert.equal((await request('/api/dice/roll', { method: 'POST', body: JSON.stringify(bet) })).response.status, 401);
  const alice = await register('dice-alice');
  const bob = await register('dice-bob');
  const initial = await request('/api/dice/state', { cookie: alice });
  assert.equal(initial.body.settings.enabled, true);
  assert.equal(initial.body.rtp, .99);
  const attempts = await Promise.all(Array.from({ length: 5 }, () => request('/api/dice/roll', { cookie: alice, method: 'POST', body: JSON.stringify(bet) })));
  for (const attempt of attempts) assert.equal(attempt.response.status, 200, attempt.body.error);
  assert.equal(attempts.filter(attempt => !attempt.body.replay).length, 1);
  const first = attempts[0].body;
  assert.ok(Number.isInteger(first.roll.id));
  assert.ok(first.roll.result >= 0 && first.roll.result <= 99.99);
  assert.equal(first.roll.won, first.roll.result < 50);
  assert.equal(first.roll.multiplier, 1.98);
  assert.equal(first.roll.payout, first.roll.won ? 198 : 0);
  assert.equal(first.balance, initial.body.balance - 100 + first.roll.payout);
  assert.ok(attempts.every(attempt => attempt.body.roll.id === first.roll.id));
  assert.equal((await request('/api/history', { cookie: alice })).body.history.filter(row => row.game_name === 'dice').length, 1);
  assert.equal((await request('/api/dice/state', { cookie: bob })).body.history.length, 0);
  for (const change of [{ stake: 101 }, { mode: 'over' }, { threshold: 60 }]) {
    const conflict = await request('/api/dice/roll', { cookie: alice, method: 'POST', body: JSON.stringify({ ...bet, ...change }) });
    assert.equal(conflict.response.status, 409);
  }
  for (const change of [{ stake: -1 }, { stake: 1.5 }, { stake: '100' }, { stake: 1000001 }, { threshold: 0 }, { threshold: 100 }, { threshold: 1.001 }, { threshold: '50' }, { threshold: null }, { mode: 'invalid' }, { requestId: 'short' }]) {
    const invalid = await request('/api/dice/roll', { cookie: bob, method: 'POST', body: JSON.stringify({ ...bet, ...change }) });
    assert.equal(invalid.response.status, 400);
  }
  const insufficient = await request('/api/dice/roll', { cookie: bob, method: 'POST', body: JSON.stringify({ ...bet, stake: 1000000 }) });
  assert.equal(insufficient.response.status, 400);
  const login = await request('/api/login', { method: 'POST', body: JSON.stringify({ username: 'crash-admin', password: 'crash-admin-password' }) });
  assert.equal(login.response.status, 200);
  const admin = login.cookie;
  const bank = await request('/api/admin/bank', { cookie: admin });
  assert.equal(bank.body.recent.filter(row => row.game_name === 'dice').length, 1);
  assert.equal(bank.body.recent[0].bank_delta, 100 - first.roll.payout);
  const executeSql = sql => new Promise((resolve, reject) => {
    const db = new sqlite3.Database(path.join(dataDir, 'database.sqlite'));
    db.exec(sql, error => db.close(() => error ? reject(error) : resolve()));
  });
  await executeSql("CREATE TRIGGER fail_dice_bank BEFORE INSERT ON bank_ledger WHEN NEW.game_name = 'dice' BEGIN SELECT RAISE(ABORT, 'test rollback'); END;");
  const failed = await request('/api/dice/roll', { cookie: bob, method: 'POST', body: JSON.stringify(bet) });
  assert.equal(failed.response.status, 500);
  const afterFailure = await request('/api/dice/state', { cookie: bob });
  assert.equal(afterFailure.body.balance, initial.body.balance);
  assert.equal(afterFailure.body.history.length, 0);
  assert.equal((await request('/api/history', { cookie: bob })).body.history.length, 0);
  await executeSql('DROP TRIGGER fail_dice_bank;');
  const distinct = await Promise.all([1, 2].map(index => request('/api/dice/roll', { cookie: bob, method: 'POST', body: JSON.stringify({ ...bet, requestId: `dice-concurrent-request-000${index}` }) })));
  assert.deepEqual(distinct.map(result => result.response.status).sort(), [200, 429]);
  assert.equal((await request('/api/dice/state', { cookie: bob })).body.history.length, 1);
  for (const [index, mode, threshold] of [[1, 'under', 1], [2, 'under', 99], [3, 'over', 1], [4, 'over', 99], [5, 'under', 1.01]]) {
    const cookie = await register(`dice-extreme-${index}`);
    const response = await request('/api/dice/roll', { cookie, method: 'POST', body: JSON.stringify({ ...bet, mode, threshold }) });
    assert.equal(response.response.status, 200);
    const roll = response.body.roll;
    const outcomes = mode === 'under' ? Math.round(threshold * 100) : 10000 - Math.round(threshold * 100);
    assert.equal(roll.probability, outcomes / 100);
    assert.equal(roll.won, mode === 'under' ? roll.result < threshold : roll.result >= threshold);
    assert.equal(roll.payout, roll.won ? Math.floor(100 * 9900 / outcomes) : 0);
  }
  await request('/api/admin/security/pause-bets', { cookie: admin, method: 'POST', body: JSON.stringify({ paused: true, reason: 'Dice integration test' }) });
  const paused = await request('/api/dice/roll', { cookie: bob, method: 'POST', body: JSON.stringify({ ...bet, requestId: 'dice-paused-request-0003' }) });
  assert.equal(paused.response.status, 503);
  const retryPaused = await request('/api/dice/roll', { cookie: alice, method: 'POST', body: JSON.stringify(bet) });
  assert.equal(retryPaused.response.status, 200);
  assert.equal(retryPaused.body.replay, true);
  await stopServer(); await startServer();
  const replay = await request('/api/dice/roll', { cookie: alice, method: 'POST', body: JSON.stringify(bet) });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.replay, true);
  assert.deepEqual(replay.body.roll, first.roll);
  assert.equal(replay.body.balance, first.balance);
  assert.equal((await request('/api/history', { cookie: alice })).body.history.filter(row => row.game_name === 'dice').length, 1);
});
