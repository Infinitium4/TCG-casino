const { createPlayerFixture } = require('./helpers/player-fixture.cjs');
const { moneyRatio, roundMoney, toCents, isMoney } = require('../underground/js/money');
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

test('games accept five-cent wagers and settle cent balances and bank entries', async (t) => {
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
        CRASH_ENABLED: 'true'
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
  async function sql(query, params = []) {
    const db = new sqlite3.Database(path.join(dataDir, 'database.sqlite'));
    db.configure('busyTimeout', 5000);
    try { return await new Promise((resolve, reject) => db.all(query, params, (error, rows) => error ? reject(error) : resolve(rows))); }
    finally { await new Promise(resolve => db.close(resolve)); }
  }
  let sequence = 0;
  const post = async (url, cookie, body) => {
    const result = await request(url, { cookie, method: 'POST', body: JSON.stringify(body) });
    assert.equal(result.response.status, 200, `${url}: ${JSON.stringify(result.body)}`);
    return result.body;
  };
  async function player(game) {
    return (await createPlayerFixture(baseUrl, dataDir, { username: `cent-${game}`, password: 'password' }, 1)).cookie;
  }
  const id = () => `cent-money-request-${++sequence}`;
  const settings = (await request('/api/game-settings')).body.games;
  assert.ok(Object.values(settings).every(game => game.minBet === 0.01));

  const dice = await player('dice');
  const roll = await post('/api/dice/roll', dice, { stake: 0.05, mode: 'under', threshold: 50, requestId: id() });
  assert.equal(roll.balance, roundMoney(0.95 + roll.roll.payout));
  const plinko = await player('plinko');
  const drop = await post('/api/plinko/drop', plinko, { stake: 0.05, risk: 'high', rows: 16, requestId: id() });
  assert.equal(drop.drop.payout, moneyRatio(0.05, Math.round(drop.drop.multiplier * 10), 10));
  assert.equal(drop.balance, roundMoney(0.95 + drop.drop.payout));

  const mines = await player('mines');
  const started = await post('/api/mines/start', mines, { stake: 0.05, mineCount: 24, requestId: id() });
  const row = (await sql('SELECT mine_positions FROM mines_games WHERE id = ?', [started.game.id]))[0];
  const positions = JSON.parse(row.mine_positions);
  const cell = Array.from({ length: 25 }, (_, i) => i).find(i => !positions.includes(i));
  const won = await post('/api/mines/reveal', mines, { gameId: started.game.id, cell, requestId: id() });
  assert.equal(won.game.payout, 1.24); assert.equal(won.balance, 2.19);

  const tower = await player('tower');
  const built = await post('/api/tower/start', tower, { stake: 0.05, requestId: id() });
  // Prepare a completed first placement; timing and geometry are covered in tower.integration.
  await sql("UPDATE tower_games SET floor = 1, ready_at = 0 WHERE id = ?", [built.game.id]);
  const cashed = await post('/api/tower/cashout', tower, { gameId: built.game.id, requestId: id() });
  assert.equal(cashed.game.payout, moneyRatio(0.05, Math.round(cashed.game.multiplier * 100), 100));
  assert.equal(cashed.balance, roundMoney(0.95 + cashed.game.payout));

  const horses = await player('horses');
  const bet = await post('/api/horses/bet', horses, { stake: 0.05, horseId: 1, requestId: id() });
  await post(`/api/horses/${bet.race.id}/start`, horses, {});
  await sql("UPDATE horse_races SET winner = 1, ends_at_ms = 0 WHERE id = ?", [bet.race.id]);
  const horseWin = await post(`/api/horses/${bet.race.id}/settle`, horses, {});
  assert.equal(horseWin.race.payout, 0.2); assert.equal(horseWin.balance, 1.15);

  for (const game of ['roulette', 'slots']) {
    const cookie = await player(game);
    const paid = await post('/api/result', cookie, { game, bet: 0.05, payout: 0.1, net: 0.05, result: 'Win' });
    assert.equal(paid.user.chips, 1.05);
  }
  const crash = await player('crash');
  const flight = await post('/api/crash/bets', crash, { stake: 0.05 });
  assert.equal(flight.balance, 0.95);
  for (let i = 0; i < 100; i++) {
    const state = (await request('/api/crash/state', { cookie: crash })).body;
    if (state.round?.status === 'running') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const withdrawn = await post(`/api/crash/bets/${flight.bet.id}/cashout`, crash, {});
  assert.equal(withdrawn.bet.payout, moneyRatio(0.05, Math.round(withdrawn.bet.cashoutMultiplier * 100), 100));
  assert.equal(withdrawn.balance, roundMoney(0.95 + withdrawn.bet.payout));

  const entries = await sql('SELECT player_net, bank_delta FROM bank_ledger');
  assert.equal(entries.length, 8);
  entries.forEach(entry => {
    assert.ok(isMoney(entry.player_net)); assert.ok(isMoney(entry.bank_delta));
    assert.equal(toCents(entry.player_net) + toCents(entry.bank_delta), 0);
  });
  // Existing defaults are upgraded once; custom admin limits survive restarts.
  await sql("UPDATE casino_game_settings SET min_bet = 1 WHERE game = 'dice'");
  await sql("UPDATE casino_game_settings SET min_bet = 0.05 WHERE game = 'slots'");
  await sql("DELETE FROM casino_platform_settings WHERE setting_key = 'cent_precision_v1'");
  await stopServer(); await startServer();
  const migrated = (await request('/api/game-settings')).body.games;
  assert.equal(migrated.dice.minBet, 0.01);
  assert.equal(migrated.slots.minBet, 0.05);
  await sql("UPDATE casino_game_settings SET min_bet = 1 WHERE game = 'dice'");
  await stopServer(); await startServer();
  assert.equal((await request('/api/game-settings')).body.games.dice.minBet, 1);
});
