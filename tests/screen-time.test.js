const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite = require('sqlite3');
const { initializeScreenTimeSchema, registerScreenTimeRoutes, dayAt, splitDays } = require('../screen-time');

async function fixture(t, timestamp = Date.parse('2026-10-15T12:00:00Z')) {
  const db = new sqlite.Database(':memory:');
  t.after(() => new Promise(resolve => db.close(resolve)));
  const run = (sql, args = []) => new Promise((resolve, reject) =>
    db.run(sql, args, error => error ? reject(error) : resolve()));
  const get = (sql, args = []) => new Promise((resolve, reject) =>
    db.get(sql, args, (error, row) => error ? reject(error) : resolve(row)));
  await run('PRAGMA foreign_keys=ON');
  await run('CREATE TABLE users(id INTEGER PRIMARY KEY)');
  await run('INSERT INTO users VALUES (1),(2)');
  await initializeScreenTimeSchema(run);
  const routes = new Map();
  registerScreenTimeRoutes({ app: {
    get(url, auth, handler) { routes.set('GET ' + url, handler); },
    post(url, auth, handler) { routes.set('POST ' + url, handler); }
  }, requireAuth() {}, handleAsync: fn => fn, run, get,
  withDatabaseTransaction: fn => fn(), now: () => timestamp });
  async function request(method, userId, body, supportOriginalUserId) {
    const response = { code: 200, set() {}, status(code) { this.code = code; return this; }, json(data) { this.body = data; } };
    await routes.get(`${method} /api/screen-time${method === 'POST' ? '/heartbeat' : ''}`)(
      { session: { userId, supportOriginalUserId }, body }, response);
    return response;
  }
  return { request, tick(ms) { timestamp += ms; }, run, get,
    beat: (tabId, active = true, userId = 1) => request('POST', userId, { tabId, active }),
    status: (userId = 1) => request('GET', userId) };
}

test('visible time is shared across tabs, survives snapshots and stays private per account', async t => {
  const h = await fixture(t);
  assert.equal((await h.beat('first-tab-0000001')).body.totalSeconds, 0);
  h.tick(10000); await h.beat('second-tab-000001');
  h.tick(10000); await h.beat('first-tab-0000001');
  assert.equal((await h.status()).body.totalSeconds, 20);
  assert.equal((await h.status()).body.totalSeconds, 20, 'reading twice cannot double count');
  assert.equal((await h.status(2)).body.totalSeconds, 0);
  h.tick(5000); await h.beat('first-tab-0000001', false);
  h.tick(5000); await h.beat('second-tab-000001', false);
  h.tick(60000);
  assert.equal((await h.status()).body.totalSeconds, 30, 'hidden tabs stop counting');
  await h.beat('first-tab-0000001');
  h.tick(10000);
  assert.equal((await h.status()).body.totalSeconds, 40, 'resume does not include hidden time');
});

test('a disconnected browser expires after 30 seconds and cannot submit forged durations', async t => {
  const h = await fixture(t);
  await h.beat('first-tab-0000001'); h.tick(3600000);
  assert.equal((await h.status()).body.totalSeconds, 30);
  assert.equal((await h.status()).body.totalSeconds, 30);
  await h.request('POST', 1, { tabId: 'first-tab-0000001', active: true, duration: 999999 });
  assert.equal((await h.status()).body.totalSeconds, 30);
  assert.equal((await h.request('POST', 1, { tabId: '../invalid', active: true })).code, 400);
  assert.equal((await h.request('POST', 1, { tabId: 'first-tab-0000001', active: 'true' })).code, 400);
  assert.equal((await h.request('POST', 1, { tabId: 'support-tab-0001', active: true }, 2)).code, 403);
});

test('the daily counter crosses Paris midnight without losing total time', async t => {
  const h = await fixture(t, Date.parse('2026-10-15T21:59:55Z'));
  await h.beat('first-tab-0000001'); h.tick(10000);
  const result = (await h.beat('first-tab-0000001')).body;
  assert.equal(result.day, '2026-10-16');
  assert.equal(result.todaySeconds, 5);
  assert.equal(result.totalSeconds, 10);
  assert.equal((await h.get("SELECT duration_ms FROM screen_time_days WHERE user_id=1 AND day='2026-10-15'")).duration_ms, 5000);
});

test('Paris day boundaries handle both daylight saving transitions', () => {
  for (const start of ['2026-03-28T22:59:55Z', '2026-10-24T21:59:55Z']) {
    const timestamp = Date.parse(start);
    const parts = splitDays(timestamp, timestamp + 10000);
    assert.equal(parts.length, 2);
    assert.deepEqual(parts.map(p => p[1]), [5000, 5000]);
    assert.notEqual(dayAt(timestamp), dayAt(timestamp + 10000));
  }
  assert.equal(dayAt(Date.parse('2026-10-25T01:30:00Z')), '2026-10-25');
});
