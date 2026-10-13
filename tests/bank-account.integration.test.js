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

test('internal bank settles solo game results and stays protected from account management', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-casino-bank-'));
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverProcess = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: dataDir,
      SESSION_SECRET: 'bank-test-session-secret',
      ADMIN_USERNAME: 'test-admin',
      ADMIN_PASSWORD: 'test-admin-password',
      SECOND_ADMIN_USERNAME: 'test-admin-2',
      SECOND_ADMIN_PASSWORD: 'test-admin-2-password',
      BANK_USERNAME: 'casino-bank',
      CRASH_ENABLED: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  serverProcess.stdout.on('data', (chunk) => { output += chunk.toString(); });
  serverProcess.stderr.on('data', (chunk) => { output += chunk.toString(); });

  t.after(async () => {
    if (serverProcess.exitCode === null) {
      serverProcess.kill();
      await Promise.race([
        new Promise((resolve) => serverProcess.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 3000))
      ]);
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  async function waitForServer() {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (serverProcess.exitCode !== null) {
        throw new Error(`Server exited before becoming ready:\n${output}`);
      }
      try {
        const response = await fetch(`${baseUrl}/api/health`);
        if (response.ok) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Server did not start in time:\n${output}`);
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
    const body = await response.json();
    return { response, body, cookie: nextCookie };
  }

  async function login(username, password) {
    const { response, body, cookie } = await request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    assert.equal(response.status, 200, body.error);
    return cookie;
  }

  await waitForServer();

  const adminCookie = await login('test-admin', 'test-admin-password');
  const admin2Cookie = await login('test-admin-2', 'test-admin-2-password');
  const primaryAdminProfile = await request('/api/me', { cookie: adminCookie });
  const secondaryAdminProfile = await request('/api/me', { cookie: admin2Cookie });
  assert.equal(primaryAdminProfile.body.isPrimaryAdmin, true);
  assert.equal(secondaryAdminProfile.body.isPrimaryAdmin, false);
  const adminBank = await request('/api/admin/bank', { cookie: adminCookie });
  const admin2Bank = await request('/api/admin/bank', { cookie: admin2Cookie });
  assert.equal(adminBank.response.status, 200, adminBank.body.error);
  assert.equal(admin2Bank.response.status, 200, admin2Bank.body.error);
  assert.equal(adminBank.body.bank.username, 'casino-bank');
  assert.equal(adminBank.body.bank.chips, 0);

  const registered = await request('/api/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'bank-test-player', password: 'player-pass' })
  });
  assert.equal(registered.response.status, 201, registered.body.error);
  let playerCookie = registered.cookie;
  assert.ok(playerCookie);
  const avatarImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p1sAAAAASUVORK5CYII=';
  const avatarUpload = await request('/api/profile/avatar', {
    cookie: playerCookie,
    method: 'PATCH',
    body: JSON.stringify({ image: avatarImage })
  });
  assert.equal(avatarUpload.response.status, 200, avatarUpload.body.error);
  assert.equal(avatarUpload.body.user.avatar_image, avatarImage);
  const invalidAvatar = await request('/api/profile/avatar', {
    cookie: playerCookie,
    method: 'PATCH',
    body: JSON.stringify({ image: 'data:image/svg+xml;base64,PHN2Zy8+' })
  });
  assert.equal(invalidAvatar.response.status, 400);
  const crashStatus = await request('/api/crash/status');
  assert.equal(crashStatus.body.enabled, false);
  const disabledCrashState = await request('/api/crash/state', { cookie: playerCookie });
  assert.equal(disabledCrashState.response.status, 503);
  const disabledCrashBet = await request('/api/crash/bets', {
    cookie: playerCookie,
    method: 'POST',
    body: JSON.stringify({ stake: 10, roundId: 'disabled' })
  });
  assert.equal(disabledCrashBet.response.status, 503);

  const bankAccount = (await request('/api/admin/accounts?search=casino-bank', { cookie: adminCookie })).body.accounts[0];
  assert.equal(bankAccount.is_bank, 1);
  const protectedAdjustment = await request(`/api/admin/accounts/${bankAccount.id}/chips`, {
    cookie: adminCookie,
    method: 'POST',
    body: JSON.stringify({ delta: 10, reason: 'should be blocked' })
  });
  assert.equal(protectedAdjustment.response.status, 400);
  const protectedBan = await request(`/api/admin/accounts/${bankAccount.id}/ban`, {
    cookie: adminCookie,
    method: 'POST',
    body: JSON.stringify({ banned: true, reason: 'should be blocked' })
  });
  assert.equal(protectedBan.response.status, 400);
  const protectedDeletion = await request(`/api/admin/accounts/${bankAccount.id}`, {
    cookie: adminCookie,
    method: 'DELETE',
    body: JSON.stringify({ reason: 'should be blocked' })
  });
  assert.equal(protectedDeletion.response.status, 400);
  const protectedSupport = await request(`/api/admin/support/${bankAccount.id}/start`, {
    cookie: adminCookie,
    method: 'POST',
    body: '{}'
  });
  assert.equal(protectedSupport.response.status, 400);

  const loss = await request('/api/result', {
    cookie: playerCookie,
    method: 'POST',
    body: JSON.stringify({ game: 'slots', bet: 100, result: 'Défaite', payout: 0, net: -100 })
  });
  assert.equal(loss.response.status, 200, loss.body.error);
  assert.equal(loss.body.user.chips, 900);

  const win = await request('/api/result', {
    cookie: playerCookie,
    method: 'POST',
    body: JSON.stringify({ game: 'roulette', bet: 100, result: 'Victoire', payout: 300, net: 200 })
  });
  assert.equal(win.response.status, 200, win.body.error);
  assert.equal(win.body.user.chips, 1100);

  const mismatch = await request('/api/result', {
    cookie: playerCookie,
    method: 'POST',
    body: JSON.stringify({ game: 'slots', bet: 100, result: 'Défaite', payout: 0, net: 10 })
  });
  assert.equal(mismatch.response.status, 400);

  const settled = await request('/api/admin/bank', { cookie: adminCookie });
  assert.equal(settled.response.status, 200, settled.body.error);
  assert.equal(settled.body.bank.chips, -100);
  assert.equal(settled.body.totals.settlements, 2);
  assert.equal(settled.body.totals.collected, 100);
  assert.equal(settled.body.totals.paid, -200);
  assert.equal(settled.body.recent.length, 2);

  const leaderboard = await request('/api/leaderboard');
  assert.equal(leaderboard.response.status, 200);
  assert.deepEqual(leaderboard.body.leaderboard.map((entry) => entry.username), ['bank-test-player']);
  assert.equal(leaderboard.body.leaderboard[0].chips, 1100);
  assert.equal(leaderboard.body.leaderboard[0].avatar_image, avatarImage);
  const publicProfile = await request(`/api/players/${registered.body.user.id}`, { cookie: adminCookie });
  assert.equal(publicProfile.response.status, 200, publicProfile.body.error);
  assert.equal(publicProfile.body.profile.username, 'bank-test-player');
  assert.equal(publicProfile.body.profile.chips, 1100);
  assert.equal(publicProfile.body.profile.gamesPlayed, 2);
  assert.equal(publicProfile.body.profile.wins, 1);
  assert.equal(publicProfile.body.profile.avatar_image, avatarImage);

  const primarySettings = await request('/api/admin/settings', { cookie: adminCookie });
  const secondarySettings = await request('/api/admin/settings', { cookie: admin2Cookie });
  assert.equal(primarySettings.body.canManage, true);
  assert.equal(secondarySettings.body.canManage, false);
  const overview = await request('/api/admin/overview', { cookie: adminCookie });
  assert.equal(overview.response.status, 200, overview.body.error);
  assert.equal(overview.body.stats.players, 1);
  assert.equal(overview.body.stats.online, 0);
  const deniedGameChange = await request('/api/admin/games/roulette', {
    cookie: admin2Cookie,
    method: 'PATCH',
    body: JSON.stringify({ enabled: false, maintenance: false, minBet: 1, maxBet: 100, reason: 'test' })
  });
  assert.equal(deniedGameChange.response.status, 403);

  const configuredGame = await request('/api/admin/games/roulette', {
    cookie: adminCookie,
    method: 'PATCH',
    body: JSON.stringify({ enabled: true, maintenance: false, minBet: 50, maxBet: 200, reason: 'test limits' })
  });
  assert.equal(configuredGame.response.status, 200, configuredGame.body.error);
  const belowMinimum = await request('/api/result', {
    cookie: playerCookie,
    method: 'POST',
    body: JSON.stringify({ game: 'roulette', bet: 10, result: 'Défaite', payout: 0, net: -10 })
  });
  assert.equal(belowMinimum.response.status, 400);

  const disabledSlots = await request('/api/admin/games/slots', {
    cookie: adminCookie,
    method: 'PATCH',
    body: JSON.stringify({ enabled: false, maintenance: false, minBet: 1, maxBet: 1_000_000, reason: 'test disable' })
  });
  assert.equal(disabledSlots.response.status, 200, disabledSlots.body.error);
  const blockedSlots = await request('/api/result', {
    cookie: playerCookie,
    method: 'POST',
    body: JSON.stringify({ game: 'slots', bet: 100, result: 'Défaite', payout: 0, net: -100 })
  });
  assert.equal(blockedSlots.response.status, 503);
  const enabledSlots = await request('/api/admin/games/slots', {
    cookie: adminCookie,
    method: 'PATCH',
    body: JSON.stringify({ enabled: true, maintenance: false, minBet: 1, maxBet: 1_000_000, reason: 'test enable' })
  });
  assert.equal(enabledSlots.response.status, 200, enabledSlots.body.error);

  const distribution = await request('/api/admin/chips/distribute', {
    cookie: adminCookie,
    method: 'POST',
    body: JSON.stringify({ amount: 25, reason: 'test distribution' })
  });
  assert.equal(distribution.response.status, 200, distribution.body.error);
  assert.equal(distribution.body.recipients, 1);

  const paused = await request('/api/admin/security/pause-bets', {
    cookie: adminCookie,
    method: 'POST',
    body: JSON.stringify({ paused: true, reason: 'test pause' })
  });
  assert.equal(paused.response.status, 200, paused.body.error);
  const blockedBet = await request('/api/result', {
    cookie: playerCookie,
    method: 'POST',
    body: JSON.stringify({ game: 'roulette', bet: 100, result: 'Défaite', payout: 0, net: -100 })
  });
  assert.equal(blockedBet.response.status, 503);
  const resumed = await request('/api/admin/security/pause-bets', {
    cookie: adminCookie,
    method: 'POST',
    body: JSON.stringify({ paused: false, reason: 'test resume' })
  });
  assert.equal(resumed.response.status, 200, resumed.body.error);

  const accounts = await request('/api/admin/accounts?search=bank-test-player', { cookie: adminCookie });
  const playerId = accounts.body.accounts[0].id;
  const deniedPromotion = await request(`/api/admin/accounts/${playerId}/permissions`, {
    cookie: admin2Cookie,
    method: 'POST',
    body: JSON.stringify({ isAdmin: true, reason: 'should be denied' })
  });
  assert.equal(deniedPromotion.response.status, 403);
  const disconnected = await request(`/api/admin/accounts/${playerId}/disconnect`, {
    cookie: adminCookie,
    method: 'POST',
    body: '{}'
  });
  assert.equal(disconnected.response.status, 200, disconnected.body.error);
  assert.equal(disconnected.body.disconnected, 0);
  const revokedSession = await request('/api/me', { cookie: playerCookie });
  assert.equal(revokedSession.response.status, 401);
  const suspension = await request(`/api/admin/accounts/${playerId}/suspend`, {
    cookie: adminCookie,
    method: 'POST',
    body: JSON.stringify({ minutes: 30, reason: 'test suspension' })
  });
  assert.equal(suspension.response.status, 200, suspension.body.error);
  const suspendedLogin = await request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'bank-test-player', password: 'player-pass' })
  });
  assert.equal(suspendedLogin.response.status, 403);
  const suspensionLifted = await request(`/api/admin/accounts/${playerId}/suspend`, {
    cookie: adminCookie,
    method: 'POST',
    body: JSON.stringify({ minutes: 0, reason: 'test suspension lifted' })
  });
  assert.equal(suspensionLifted.response.status, 200, suspensionLifted.body.error);
  playerCookie = await login('bank-test-player', 'player-pass');
  const promoted = await request(`/api/admin/accounts/${playerId}/permissions`, {
    cookie: adminCookie,
    method: 'POST',
    body: JSON.stringify({ isAdmin: true, reason: 'test promotion' })
  });
  assert.equal(promoted.response.status, 200, promoted.body.error);
  const promotedAccess = await request('/api/admin/bank', { cookie: playerCookie });
  assert.equal(promotedAccess.response.status, 200, promotedAccess.body.error);
  const demoted = await request(`/api/admin/accounts/${playerId}/permissions`, {
    cookie: adminCookie,
    method: 'POST',
    body: JSON.stringify({ isAdmin: false, reason: 'test demotion' })
  });
  assert.equal(demoted.response.status, 200, demoted.body.error);
  const demotedAccess = await request('/api/admin/bank', { cookie: playerCookie });
  assert.equal(demotedAccess.response.status, 401);
  const audit = await request('/api/admin/audit?limit=100', { cookie: adminCookie });
  assert.equal(audit.response.status, 200, audit.body.error);
  const actions = audit.body.entries.map((entry) => entry.action);
  assert.ok(actions.includes('token_distribution'));
  assert.ok(actions.includes('emergency_pause'));
  assert.ok(actions.includes('suspension'));
  assert.ok(actions.includes('admin_promoted'));
  assert.ok(actions.includes('admin_demoted'));

  for (const cookie of [admin2Cookie, await login('bank-test-player', 'player-pass')]) {
    const deniedReset = await request(`/api/admin/accounts/${playerId}/reset`, { cookie, method: 'POST', body: JSON.stringify({ reason: 'Permission test' }) });
    assert.equal(deniedReset.response.status, 403);
    const deniedInfinite = await request('/api/admin/infinite-money', { cookie, method: 'POST', body: JSON.stringify({ enabled: true }) });
    assert.equal(deniedInfinite.response.status, 403);
  }
  const deniedBankReset = await request(`/api/admin/accounts/${bankAccount.id}/reset`, { cookie: adminCookie, method: 'POST', body: JSON.stringify({ reason: 'Protected bank' }) });
  assert.equal(deniedBankReset.response.status, 403);
  const adminBefore = (await request('/api/me', { cookie: adminCookie })).body.user.chips;
  const infinite = await request('/api/admin/infinite-money', { cookie: adminCookie, method: 'POST', body: JSON.stringify({ enabled: true }) });
  assert.equal(infinite.response.status, 200, infinite.body.error);
  assert.equal(infinite.body.user.infinite_money, 1);
  const infiniteLoss = await request('/api/result', { cookie: adminCookie, method: 'POST', body: JSON.stringify({ game: 'roulette', bet: 100, result: 'Défaite', payout: 0, net: -100 }) });
  assert.equal(infiniteLoss.response.status, 200, infiniteLoss.body.error);
  assert.equal(infiniteLoss.body.user.chips, 1000000000000);
  const finite = await request('/api/admin/infinite-money', { cookie: adminCookie, method: 'POST', body: JSON.stringify({ enabled: false }) });
  assert.equal(finite.response.status, 200);
  assert.equal(finite.body.user.chips, adminBefore);
  assert.equal(finite.body.user.infinite_money, 0);
  const bankBeforeReset = (await request('/api/admin/bank', { cookie: adminCookie })).body.bank.chips;
  const reset = await request(`/api/admin/accounts/${playerId}/reset`, { cookie: adminCookie, method: 'POST', body: JSON.stringify({ reason: 'Reset test account' }) });
  assert.equal(reset.response.status, 200, reset.body.error);
  const resetCookie = await login('bank-test-player', 'player-pass');
  const resetAccount = (await request('/api/me', { cookie: resetCookie })).body;
  assert.equal(resetAccount.user.chips, 1000);
  assert.equal(resetAccount.user.avatar_image, null);
  assert.equal(resetAccount.stats.gamesPlayed, 0);
  assert.equal(resetAccount.isAdmin, false);
  assert.equal((await request('/api/admin/bank', { cookie: adminCookie })).body.bank.chips, bankBeforeReset);
  const resetAudit = (await request('/api/admin/audit?limit=100', { cookie: adminCookie })).body.entries;
  assert.ok(resetAudit.some(entry => entry.action === 'account_reset' && entry.target_username === 'bank-test-player'));
});
