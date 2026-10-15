const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { initializeRegistrationCaptcha, createRegistrationCaptcha } = require('../registration-captcha');

async function createCaptchaFixture(t, generatedCodes = ['ABC234']) {
  const db = new sqlite3.Database(':memory:');
  t.after(() => new Promise(resolve => db.close(resolve)));
  const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, function(error) {
    error ? reject(error) : resolve({ changes: this.changes });
  }));
  const get = (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (error, row) => error ? reject(error) : resolve(row)));
  const all = (sql, args = []) => new Promise((resolve, reject) => db.all(sql, args, (error, rows) => error ? reject(error) : resolve(rows)));
  let queue = Promise.resolve();
  const withDatabaseTransaction = work => {
    const result = queue.then(async () => {
      await run('BEGIN IMMEDIATE');
      try { const value = await work(); await run('COMMIT'); return value; }
      catch (error) { await run('ROLLBACK'); throw error; }
    });
    queue = result.catch(() => {});
    return result;
  };
  let time = 1000;
  await initializeRegistrationCaptcha(run, all);
  let nextCode = 0;
  const captcha = createRegistrationCaptcha({
    run,
    get,
    withDatabaseTransaction,
    secret: 'captcha-test-session-secret-with-more-than-32-chars',
    now: () => time,
    generateCode: () => generatedCodes[nextCode++]
  });
  return { captcha, advanceTime: milliseconds => { time += milliseconds; } };
}

test('visual challenges are dynamic SVG images without plaintext answers', async t => {
  const { captcha } = await createCaptchaFixture(t, ['ABC234', 'DEF567']);
  const first = await captcha.issue('alice');
  const second = await captcha.issue('alice');
  assert.deepEqual(Object.keys(first).sort(), ['id', 'image']);
  assert.match(first.image, /^data:image\/svg\+xml,/);
  const svg = decodeURIComponent(first.image.slice(first.image.indexOf(',') + 1));
  assert.match(svg, /<path d=/);
  assert.doesNotMatch(svg, /<text|ABC234/);
  assert.notEqual(second.id, first.id);
  assert.notEqual(second.image, first.image);
  assert.equal((await captcha.consume('alice', first.id, 'ABC234')).status, 'not_found');
});

test('correct answers are case-insensitive and only one concurrent request can consume a challenge', async t => {
  const { captcha } = await createCaptchaFixture(t);
  const challenge = await captcha.issue('alice');
  assert.equal((await captcha.consume('bob', challenge.id, 'ABC234')).status, 'not_found');
  const parallel = await Promise.all(Array.from({ length: 8 }, () => captcha.consume('alice', challenge.id, 'abc234')));
  assert.equal(parallel.filter(result => result.status === 'valid').length, 1);
  assert.equal((await captcha.consume('alice', challenge.id, 'ABC234')).status, 'not_found');
});

test('incorrect answers are limited to five attempts per challenge', async t => {
  const { captcha } = await createCaptchaFixture(t);
  const challenge = await captcha.issue('alice');
  for (let attempt = 1; attempt < 5; attempt++) {
    const result = await captcha.consume('alice', challenge.id, 'ZZZZZZ');
    assert.equal(result.status, 'incorrect');
    assert.equal(result.attemptsRemaining, 5 - attempt);
  }
  assert.equal((await captcha.consume('alice', challenge.id, 'ZZZZZZ')).status, 'attempts_exceeded');
  assert.equal((await captcha.consume('alice', challenge.id, 'ABC234')).status, 'not_found');
});

test('challenges expire after two minutes and renewal invalidates the previous image', async t => {
  const fixture = await createCaptchaFixture(t, ['ABC234', 'DEF567', 'GHJ789']);
  const { captcha, advanceTime } = fixture;
  let challenge = await captcha.issue('alice');
  advanceTime(2 * 60 * 1000);
  assert.equal((await captcha.consume('alice', challenge.id, 'ABC234')).status, 'expired');

  const oldChallenge = await captcha.issue('alice');
  challenge = await captcha.issue('alice');
  assert.equal((await captcha.consume('alice', oldChallenge.id, 'DEF567')).status, 'not_found');
  assert.equal((await captcha.consume('alice', challenge.id, 'GHJ789')).status, 'valid');
});
