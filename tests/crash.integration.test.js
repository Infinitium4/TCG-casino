const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

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

test('Crash debits once, accepts one authoritative cashout, settles losses, and persists rounds', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-casino-crash-'));
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
  const adminLogin = await request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'crash-admin', password: 'crash-admin-password' })
  });
  assert.equal(adminLogin.response.status, 200, adminLogin.body.error);
  const enabledGame = await request('/api/admin/games/crash', {
    cookie: adminLogin.cookie,
    method: 'PATCH',
    body: JSON.stringify({ enabled: true, maintenance: false, minBet: 1, maxBet: 1_000_000, reason: 'Enable Crash for this test' })
  });
  assert.equal(enabledGame.response.status, 200, enabledGame.body.error);
  const crashStatus = await request('/api/crash/status');
  assert.equal(crashStatus.body.enabled, true);
  const playerCookie = await register('crash-player');
  const observerCookie = await register('crash-observer');

  const banner = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p1sAAAAASUVORK5CYII=';
  const design = { accent: '#6ee7c7', style: 'midnight', banner, fit: 'contain', position: 35, bio: 'Mon profil personnalisé' };
  const saveDesign = await request('/api/profile/design', { cookie: playerCookie, method: 'PATCH', body: JSON.stringify(design) });
  assert.equal(saveDesign.response.status, 200, saveDesign.body.error);
  const profileAccount = await request('/api/me', { cookie: playerCookie });
  assert.deepEqual(JSON.parse(profileAccount.body.user.profile_design), design);
  const publicProfile = await request(`/api/players/${profileAccount.body.user.id}`, { cookie: observerCookie });
  assert.equal(publicProfile.response.status, 200);
  assert.deepEqual(JSON.parse(publicProfile.body.profile.profile_design), design);
  for (const invalidDesign of [{ accent: 'red' }, { banner: 'javascript:alert(1)' }, { position: 101 }, { bio: 'x'.repeat(161) }]) {
    const invalid = await request('/api/profile/design', { cookie: playerCookie, method: 'PATCH', body: JSON.stringify({ ...design, ...invalidDesign }) });
    assert.equal(invalid.response.status, 400);
  }
  const observerAccount = await request('/api/me', { cookie: observerCookie });
  assert.deepEqual(JSON.parse(observerAccount.body.user.profile_design), {});

  const unauthenticated = await request('/api/crash/state');
  assert.equal(unauthenticated.response.status, 401);

  const initial = await request('/api/crash/state', { cookie: playerCookie });
  assert.equal(initial.response.status, 200, initial.body.error);
  assert.equal(initial.body.balance, 1000);
  assert.equal(initial.body.round, null);

  for (const stake of [0, -1, 1.5, 1_000_001]) {
    const invalid = await request('/api/crash/bets', {
      cookie: playerCookie,
      method: 'POST',
      body: JSON.stringify({ stake })
    });
    assert.equal(invalid.response.status, 400);
  }
  const tooLarge = await request('/api/crash/bets', {
    cookie: observerCookie,
    method: 'POST',
    body: JSON.stringify({ stake: 1001 })
  });
  assert.equal(tooLarge.response.status, 400);

  const crashPlayer = (await request('/api/admin/accounts?search=crash-player', { cookie: adminLogin.cookie })).body.accounts[0];
  for (let index = 0; index < 3; index += 1) {
    const balanceAdjustment = await request(`/api/admin/accounts/${crashPlayer.id}/chips`, {
      cookie: adminLogin.cookie,
      method: 'POST',
      body: JSON.stringify({ delta: 1_000_000_000, reason: 'High-balance cashout test' })
    });
    assert.equal(balanceAdjustment.response.status, 200, balanceAdjustment.body.error);
  }

  const [firstBetRequest, secondBetRequest] = await Promise.all([
    request('/api/crash/bets', {
      cookie: playerCookie,
      method: 'POST',
      body: JSON.stringify({ stake: 100 })
    }),
    request('/api/crash/bets', {
      cookie: playerCookie,
      method: 'POST',
      body: JSON.stringify({ stake: 100 })
    })
  ]);
  const placed = firstBetRequest.body.duplicate ? secondBetRequest : firstBetRequest;
  const duplicateBet = firstBetRequest.body.duplicate ? firstBetRequest : secondBetRequest;
  assert.equal(placed.response.status, 200, placed.body.error);
  assert.equal(placed.body.balance, 3_000_000_900);
  assert.equal(duplicateBet.response.status, 200, duplicateBet.body.error);
  assert.equal(duplicateBet.body.duplicate, true);
  assert.equal(duplicateBet.body.bet.id, placed.body.bet.id);
  const changedDuplicate = await request('/api/crash/bets', {
    cookie: playerCookie,
    method: 'POST',
    body: JSON.stringify({ stake: 101 })
  });
  assert.equal(changedDuplicate.response.status, 409);

  const runningState = await waitForState(playerCookie, (state) => state.round.status === 'running');
  const refreshedDuringFlight = await request('/api/crash/state', { cookie: playerCookie });
  assert.equal(refreshedDuringFlight.response.status, 200, refreshedDuringFlight.body.error);
  assert.equal(refreshedDuringFlight.body.round.id, runningState.round.id);
  assert.equal(refreshedDuringFlight.body.round.status, 'running');
  assert.ok(refreshedDuringFlight.body.round.multiplier <= 2);
  const withdrawn = await request(`/api/crash/bets/${placed.body.bet.id}/cashout`, {
    cookie: playerCookie,
    method: 'POST'
  });
  assert.equal(withdrawn.response.status, 200, withdrawn.body.error);
  assert.equal(withdrawn.body.bet.status, 'cashed_out');
  assert.equal(withdrawn.body.bet.payout, Math.floor(withdrawn.body.bet.cashoutMultiplier * 100));
  assert.equal(withdrawn.body.balance, 3_000_000_900 + withdrawn.body.bet.payout);
  assert.ok(withdrawn.body.balance > 2_147_483_647);

  const duplicateCashout = await request(`/api/crash/bets/${placed.body.bet.id}/cashout`, {
    cookie: playerCookie,
    method: 'POST'
  });
  assert.equal(duplicateCashout.response.status, 200, duplicateCashout.body.error);
  assert.equal(duplicateCashout.body.duplicate, true);
  assert.equal(duplicateCashout.body.balance, withdrawn.body.balance);

  const observerBeforeBet = await request('/api/crash/state', { cookie: observerCookie });
  assert.equal(observerBeforeBet.body.round, null);

  const losingBet = await request('/api/crash/bets', {
    cookie: observerCookie,
    method: 'POST',
    body: JSON.stringify({ stake: 80 })
  });
  assert.equal(losingBet.response.status, 200, losingBet.body.error);
  assert.equal(losingBet.body.balance, 920);
  assert.notEqual(losingBet.body.round.id, placed.body.round.id);
  const blackjackTable = await request('/api/blackjack/tables', {
    cookie: observerCookie,
    method: 'POST',
    body: JSON.stringify({ tableName: 'Crash isolation test' })
  });
  assert.equal(blackjackTable.response.status, 201, blackjackTable.body.error);
  const blockedBlackjack = await request(`/api/blackjack/tables/${blackjackTable.body.table.id}/start`, {
    cookie: observerCookie,
    method: 'POST',
    body: JSON.stringify({ betAmount: 1 })
  });
  assert.equal(blockedBlackjack.response.status, 409);
  const crashed = await waitForState(observerCookie, (state) =>
    state.round.id === losingBet.body.round.id && state.round.status === 'crashed'
  );
  assert.equal(crashed.round.crashMultiplier, 2);
  assert.equal(crashed.round.multiplier, crashed.round.crashMultiplier);
  assert.equal(crashed.ownBet.status, 'lost');
  const lateCashout = await request(`/api/crash/bets/${losingBet.body.bet.id}/cashout`, {
    cookie: observerCookie,
    method: 'POST'
  });
  assert.equal(lateCashout.response.status, 409);
  assert.match(lateCashout.body.error, /ta mise est perdue/i);

  const historyBeforeRestart = await request('/api/history', { cookie: observerCookie });
  assert.equal(historyBeforeRestart.response.status, 200);
  assert.equal(historyBeforeRestart.body.history[0].game_name, 'crash');
  assert.equal(historyBeforeRestart.body.history[0].net, -80);

  await stopServer();
  await startServer();
  const login = await request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'crash-observer', password: 'player-password' })
  });
  assert.equal(login.response.status, 200, login.body.error);
  const persistedHistory = await request('/api/history', { cookie: login.cookie });
  assert.equal(persistedHistory.response.status, 200);
  assert.equal(persistedHistory.body.history[0].game_name, 'crash');
  assert.equal(persistedHistory.body.history[0].net, -80);
  const persistedCrashHistory = await request('/api/crash/state', { cookie: login.cookie });
  assert.equal(persistedCrashHistory.response.status, 200);
  assert.ok(persistedCrashHistory.body.history.some((entry) => entry.id === crashed.round.id || entry.multiplier === 2));
});
