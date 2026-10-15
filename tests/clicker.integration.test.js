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

test('Clicker enforces balance threshold, unlimited daily reuse, atomic credits and persistence', async (t) => {
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
  assert.equal((await request('/api/clicker/state')).response.status, 401);
  const alice = await register('clicker-alice');
  const bob = await register('clicker-bob');
  const initial = (await request('/api/clicker/state', { cookie: alice })).body;
  assert.equal(initial.balance, 0); assert.equal(initial.eligible, true);
  const payload = { requestId: 'clicker-request-000001', payout: 9999999, userId: 2 };
  const click = (body, cookie = alice, headers = {}) => request('/api/clicker/click', { cookie, method: 'POST', body: JSON.stringify(body), headers });
  const state = async (cookie = alice) => (await request('/api/clicker/state', { cookie })).body;
  async function execute(sql) {
    const connection = new sqlite3.Database(path.join(dataDir, 'database.sqlite'));
    try { await new Promise((resolve, reject) => connection.run(sql, error => error ? reject(error) : resolve())); }
    finally { await new Promise(resolve => connection.close(resolve)); }
  }
  await execute("UPDATE users SET chips = 10 WHERE username = 'clicker-alice'");
  assert.equal((await click(payload)).response.status, 409);
  assert.equal((await click(payload, alice, { 'Sec-Fetch-Site': 'cross-site' })).response.status, 403);
  assert.equal((await request('/api/clicker/click', { method: 'POST', body: JSON.stringify(payload) })).response.status, 401);
  assert.equal((await click({ requestId: 'short' })).response.status, 400);
  await execute("UPDATE users SET chips = 9.90 WHERE username = 'clicker-alice'");
  const repeated = await Promise.all(Array.from({ length: 12 }, () => click(payload)));
  assert.ok(repeated.every(r => r.response.status === 200));
  assert.equal(repeated.filter(r => !r.body.replay).length, 1);
  assert.equal((await state()).balance, 9.95);
  assert.equal((await state(bob)).balance, 0);
  const race = await Promise.all(Array.from({ length: 30 }, (_, i) => click({ requestId: `clicker-final-race-${i}` })));
  assert.equal(race.filter(r => r.response.status === 200).length, 1);
  assert.equal(race.filter(r => r.response.status === 409).length, 29);
  assert.equal((await state()).balance, 10);
  assert.equal((await click(payload)).body.replay, true);
  await execute("UPDATE users SET chips = 10.01 WHERE username = 'clicker-alice'");
  assert.equal((await click({ requestId: 'clicker-over-limit-0001' })).response.status, 409);
  await execute("UPDATE users SET chips = 0 WHERE username = 'clicker-alice'");
  // Refill after spending: 200 clicks earn exactly 10 euros.
  for (let start = 0; start < 200; start += 25) {
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => click({ requestId: `clicker-unlimited-${start + i}` })));
    assert.ok(results.every(r => r.response.status === 200));
  }
  assert.equal((await state()).balance, 10);
  await execute("UPDATE users SET chips = 9.95 WHERE username = 'clicker-alice'");
  assert.equal((await click(payload)).body.balance, 9.95);
  // Old receipts must also prevent replay across days.
  await execute("UPDATE clicker_gains SET day = '2000-01-01'");
  assert.equal((await click(payload)).body.balance, 9.95);
  await stopServer(); await startServer();
  assert.equal((await state()).balance, 9.95);
  assert.equal((await click(payload)).body.replay, true);
  assert.equal((await click({ requestId: 'clicker-after-restart-0001' })).body.balance, 10);
  await execute("UPDATE users SET chips = 9.95 WHERE username = 'clicker-bob'");
  await execute("CREATE TRIGGER clicker_test_failure BEFORE UPDATE OF chips ON users WHEN OLD.username = 'clicker-bob' BEGIN SELECT RAISE(ABORT, 'test credit failure'); END");
  assert.equal((await click(payload, bob)).response.status, 500);
  assert.equal((await state(bob)).balance, 9.95);
  await execute('DROP TRIGGER clicker_test_failure');
  const recovered = await click(payload, bob);
  assert.equal(recovered.body.replay, false); assert.equal(recovered.body.balance, 10);
  assert.equal((await request('/api/reset', { cookie: alice, method: 'POST', body: '{}' })).response.status, 200);
  assert.equal((await click(payload)).body.replay, true);
  assert.equal((await state()).balance, 0);
  assert.equal((await click({ requestId: 'clicker-after-reset-0001' })).body.balance, 0.05);
  // After restart the in-memory limiter has a fresh window; invalid attempts must also consume the IP quota.
  for (let i = 0; i < 5; i++) {
    assert.equal((await request('/api/register', { method: 'POST', body: '{}' })).response.status, 400);
  }
  const limited = await request('/api/register', { method: 'POST', body: '{}' });
  assert.equal(limited.response.status, 429);
  assert.ok(Number(limited.response.headers.get('retry-after')) > 0);
});
