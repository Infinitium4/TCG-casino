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
      BANK_USERNAME: 'casino-bank'
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
  const playerCookie = registered.cookie;
  assert.ok(playerCookie);

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
});
