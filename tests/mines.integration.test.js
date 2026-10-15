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
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

test('Mines settles games atomically and hides active mine positions', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-casino-mines-'));
  const root = path.resolve(__dirname, '..');
  const processes = [];
  let serverProcess = null;
  let baseUrl = '';

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
        SESSION_SECRET: 'mines-test-session-secret',
        ADMIN_USERNAME: 'mines-admin',
        ADMIN_PASSWORD: 'mines-admin-password',
        SECOND_ADMIN_USERNAME: 'mines-admin-2',
        SECOND_ADMIN_PASSWORD: 'mines-admin-2-password',
        BANK_USERNAME: 'mines-bank',
        CRASH_ENABLED: 'false'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    processes.push(serverProcess);
    let output = '';
    serverProcess.stdout.on('data', chunk => { output += chunk.toString(); });
    serverProcess.stderr.on('data', chunk => { output += chunk.toString(); });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (serverProcess.exitCode !== null) throw new Error(`Server exited before becoming ready:\n${output}`);
      try {
        const response = await fetch(`${baseUrl}/api/health`);
        if (response.ok) return;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Server did not start in time:\n${output}`);
  }

  async function stopServer() {
    if (!serverProcess || serverProcess.exitCode !== null) return;
    const stopping = new Promise(resolve => serverProcess.once('exit', resolve));
    serverProcess.kill();
    await Promise.race([stopping, new Promise(resolve => setTimeout(resolve, 3000))]);
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
    return { response, body: await response.json(), cookie: setCookie ? setCookie.split(';')[0] : cookie };
  }

  async function register(username) {
    const result = await request('/api/register', { method: 'POST', body: JSON.stringify({ username, password: 'player-password' }) });
    assert.equal(result.response.status, 201, result.body.error);
    return result.cookie;
  }

  async function readGame(gameId) {
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(path.join(dataDir, 'database.sqlite'));
      db.get('SELECT * FROM mines_games WHERE id = ?', [gameId], (error, row) => {
        db.close(closeError => error || closeError ? reject(error || closeError) : resolve(row));
      });
    });
  }

  t.after(async () => {
    for (const process of processes) {
      if (process.exitCode === null) {
        process.kill();
        await Promise.race([new Promise(resolve => process.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
      }
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await startServer();
  assert.equal((await request('/api/mines/state')).response.status, 401);
  const alice = await register('mines-alice');
  const bob = await register('mines-bob');
  const carol = await register('mines-carol');
  const initial = await request('/api/mines/state', { cookie: alice });
  assert.equal(initial.body.settings.enabled, true);
  for (const invalid of [
    { stake: 0, mineCount: 10, requestId: 'mines-invalid-zero-alice' },
    { stake: 1.5, mineCount: 10, requestId: 'mines-invalid-frac-alice' },
    { stake: 1001, mineCount: 10, requestId: 'mines-invalid-funds-alice' },
    { stake: 100, mineCount: 25, requestId: 'mines-invalid-count-alice' }
  ]) {
    assert.equal((await request('/api/mines/start', { cookie: alice, method: 'POST', body: JSON.stringify(invalid) })).response.status, 400);
  }

  const startBody = { stake: 100, mineCount: 1, requestId: 'mines-start-request-alice' };
  const started = await request('/api/mines/start', { cookie: alice, method: 'POST', body: JSON.stringify(startBody) });
  assert.equal(started.response.status, 200, started.body.error);
  assert.equal(started.body.balance, 900);
  assert.equal(started.body.game.status, 'active');
  assert.equal('mines' in started.body.game, false);
  assert.equal((await request('/api/mines/state', { cookie: alice })).body.game.mines, undefined);
  const replayedStart = await request('/api/mines/start', { cookie: alice, method: 'POST', body: JSON.stringify(startBody) });
  assert.equal(replayedStart.body.replay, true);
  assert.equal(replayedStart.body.balance, 900);
  assert.equal((await request('/api/mines/start', { cookie: alice, method: 'POST', body: JSON.stringify({ ...startBody, requestId: 'mines-second-start-alice' }) })).response.status, 409);

  const aliceGame = await readGame(started.body.game.id);
  const aliceMine = JSON.parse(aliceGame.mine_positions)[0];
  const safeCell = (aliceMine + 1) % 25;
  const revealBody = { gameId: started.body.game.id, cell: safeCell, requestId: 'mines-reveal-request-alice' };
  const reveals = await Promise.all(Array.from({ length: 2 }, () => request('/api/mines/reveal', { cookie: alice, method: 'POST', body: JSON.stringify(revealBody) })));
  assert.ok(reveals.every(result => result.response.status === 200));
  assert.equal(reveals.filter(result => !result.body.replay).length, 1);
  assert.equal(reveals[0].body.game.safeCount, 1);
  assert.equal(reveals[0].body.game.multiplier, 1.03125);
  assert.equal((await request('/api/mines/reveal', { cookie: alice, method: 'POST', body: JSON.stringify({ gameId: started.body.game.id, cell: safeCell, requestId: 'mines-reveal-again-alice' }) })).response.status, 409);
  const cashoutBody = { gameId: started.body.game.id, requestId: 'mines-cashout-request-alice' };
  const cashout = await request('/api/mines/cashout', { cookie: alice, method: 'POST', body: JSON.stringify(cashoutBody) });
  assert.equal(cashout.body.game.status, 'cashed_out');
  assert.equal(cashout.body.game.payout, 103);
  assert.equal(cashout.body.balance, 1003);
  const cashoutReplay = await request('/api/mines/cashout', { cookie: alice, method: 'POST', body: JSON.stringify(cashoutBody) });
  assert.equal(cashoutReplay.body.replay, true);
  assert.equal(cashoutReplay.body.balance, 1003);
  assert.equal((await request('/api/mines/cashout', { cookie: alice, method: 'POST', body: JSON.stringify({ gameId: started.body.game.id, requestId: 'mines-other-cashout-alice' }) })).response.status, 409);
  await new Promise(resolve => setTimeout(resolve, 260));
  const restarted = await request('/api/mines/start', { cookie: alice, method: 'POST', body: JSON.stringify({ stake: 100, mineCount: 10, requestId: 'mines-restart-request-alice' }) });
  assert.equal(restarted.response.status, 200, restarted.body.error);
  assert.equal(restarted.body.balance, 903);
  const restartedCashout = await request('/api/mines/cashout', { cookie: alice, method: 'POST', body: JSON.stringify({ gameId: restarted.body.game.id, requestId: 'mines-restart-cashout-alice' }) });
  assert.equal(restartedCashout.body.game.status, 'cashed_out');
  assert.equal(restartedCashout.body.balance, 1002);

  const bobStart = await request('/api/mines/start', { cookie: bob, method: 'POST', body: JSON.stringify({ stake: 100, mineCount: 10, requestId: 'mines-start-request-bob' }) });
  assert.equal(bobStart.response.status, 200, bobStart.body.error);
  const bobMines = JSON.parse((await readGame(bobStart.body.game.id)).mine_positions);
  const loss = await request('/api/mines/reveal', { cookie: bob, method: 'POST', body: JSON.stringify({ gameId: bobStart.body.game.id, cell: bobMines[0], requestId: 'mines-loss-request-bob' }) });
  assert.equal(loss.body.game.status, 'lost');
  assert.equal(loss.body.game.payout, 0);
  assert.equal(loss.body.balance, 900);
  assert.equal(loss.body.game.mines.length, 10);
  assert.equal((await request('/api/mines/cashout', { cookie: bob, method: 'POST', body: JSON.stringify({ gameId: bobStart.body.game.id, requestId: 'mines-loss-cashout-bob' }) })).response.status, 409);
  assert.equal((await request('/api/history', { cookie: bob })).body.history.filter(row => row.game_name === 'mines').length, 1);

  const carolStart = await request('/api/mines/start', { cookie: carol, method: 'POST', body: JSON.stringify({ stake: 100, mineCount: 24, requestId: 'mines-start-request-carol' }) });
  assert.equal(carolStart.response.status, 200, carolStart.body.error);
  const carolMines = JSON.parse((await readGame(carolStart.body.game.id)).mine_positions);
  const onlySafeCell = Array.from({ length: 25 }, (_, cell) => cell).find(cell => !carolMines.includes(cell));
  const autoWin = await request('/api/mines/reveal', { cookie: carol, method: 'POST', body: JSON.stringify({ gameId: carolStart.body.game.id, cell: onlySafeCell, requestId: 'mines-win-request-carol' }) });
  assert.equal(autoWin.body.game.status, 'won');
  assert.equal(autoWin.body.game.payout, 2475);
  assert.equal(autoWin.body.balance, 3375);
  assert.equal((await request('/api/history', { cookie: alice })).body.history.filter(row => row.game_name === 'mines').length, 2);
});