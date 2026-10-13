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

test('CRS phase 1 uses existing accounts, creates factions atomically and persists after restart', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-casino-crs-'));
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
  const anonymous = await request('/api/crs/state');
  assert.equal(anonymous.response.status, 401);
  const anonymousChoice = await request('/api/crs/faction', { method: 'POST', body: JSON.stringify({ faction: 'crs' }) });
  assert.equal(anonymousChoice.response.status, 401);
  const alice = await register('crs-alice');
  const bob = await register('crs-bob');
  const initial = await request('/api/crs/state', { cookie: alice });
  assert.equal(initial.response.status, 200);
  assert.equal(initial.body.player, null);
  assert.equal(initial.body.citadel, null);
  assert.deepEqual(initial.body.buildings, []);
  assert.equal(initial.body.account.chips, 1000);
  for (const faction of ['invalid', '', null, 1, { id: 'crs' }]) {
    const invalid = await request('/api/crs/faction', { cookie: alice, method: 'POST', body: JSON.stringify({ faction }) });
    assert.equal(invalid.response.status, 400);
  }
  const [one, two] = await Promise.all(['crs', 'manifestants'].map(faction => request('/api/crs/faction', {
    cookie: alice, method: 'POST', body: JSON.stringify({ faction, supplies: 999999, chips: 999999, headquarters_level: 10, userId: 1234 })
  })));
  assert.deepEqual([one.response.status, two.response.status].sort(), [201, 409]);
  const created = one.response.status === 201 ? one.body : two.body;
  assert.equal(created.player.supplies, 250);
  assert.equal(created.player.rating, 1000);
  assert.equal(created.citadel.headquarters_level, 1);
  assert.equal(created.buildings.length, 1);
  assert.equal(created.buildings[0].level, 1);
  assert.equal(created.buildings[0].x, 5);
  assert.equal(created.account.chips, 1000);
  const rejectedChange = await request('/api/crs/faction', { cookie: alice, method: 'POST', body: JSON.stringify({ faction: 'manifestants' }) });
  assert.equal(rejectedChange.response.status, 409);
  const otherBefore = await request('/api/crs/state?userId=' + created.player.user_id, { cookie: bob });
  assert.equal(otherBefore.body.player, null, 'session controls identity even with a forged user ID');
  const other = await request('/api/crs/faction', { cookie: bob, method: 'POST', body: JSON.stringify({ faction: 'manifestants' }) });
  assert.equal(other.response.status, 201);
  assert.equal(other.body.player.faction, 'manifestants');
  assert.notEqual(other.body.player.user_id, created.player.user_id);
  assert.equal(other.body.factions.manifestants.headquarters[0], 'Lycée révolté');
  const me = await request('/api/me', { cookie: alice });
  assert.equal(me.body.user.chips, 1000);
  const casinoHistory = await request('/api/history', { cookie: alice });
  assert.deepEqual(casinoHistory.body.history, []);
  const asset = await fetch(baseUrl + '/js/crs.js');
  assert.equal(asset.status, 200);
  assert.match(await asset.text(), /crsModule/);
  for (const imagePath of ['buildings/crs/evolutions.png', 'buildings/manifestants/evolutions.png', 'units/crs/planche.png', 'units/manifestants/planche.png', 'maps/examples/cartes.png', 'ui/icones.png']) {
    const image = await fetch(baseUrl + '/games/crs-vs-manifestants/assets/' + imagePath);
    assert.equal(image.status, 200, imagePath);
    assert.match(image.headers.get('content-type'), /image\/png/);
    const bytes = Buffer.from(await image.arrayBuffer());
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  }
  await stopServer();
  await startServer();
  const login = await request('/api/login', { method: 'POST', body: JSON.stringify({ username: 'crs-alice', password: 'player-password' }) });
  assert.equal(login.response.status, 200);
  const persisted = await request('/api/crs/state', { cookie: login.cookie });
  assert.deepEqual(persisted.body.player, created.player);
  assert.deepEqual(persisted.body.citadel, created.citadel);
  assert.deepEqual(persisted.body.buildings, created.buildings);
  const afterRestart = await request('/api/crs/faction', { cookie: login.cookie, method: 'POST', body: JSON.stringify({ faction: 'crs' }) });
  assert.equal(afterRestart.response.status, 409);
});
