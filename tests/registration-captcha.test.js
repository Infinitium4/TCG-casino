const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { initializeRegistrationCaptcha, createRegistrationCaptcha } = require('../registration-captcha');

test('registration calculations expire, belong to one session, and can only be consumed once', async t => {
  const db = new sqlite3.Database(':memory:');
  t.after(() => new Promise(resolve => db.close(resolve)));
  const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, function(error) {
    error ? reject(error) : resolve({ changes: this.changes });
  }));
  const get = (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (error, row) => error ? reject(error) : resolve(row)));
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
  await initializeRegistrationCaptcha(run);
  const captcha = createRegistrationCaptcha({ run, get, withDatabaseTransaction, now: () => time });
  const answer = challenge => String(challenge.question.match(/\d+/g).map(Number).reduce((a, b) => a + b));
  let challenge = await captcha.issue('alice');
  assert.deepEqual(Object.keys(challenge).sort(), ['id', 'question']);
  assert.equal(await captcha.consume('bob', challenge.id, answer(challenge)), false);
  const parallel = await Promise.all(Array.from({ length: 5 }, () => captcha.consume('alice', challenge.id, answer(challenge))));
  assert.equal(parallel.filter(Boolean).length, 1);
  challenge = await captcha.issue('alice');
  assert.equal(await captcha.consume('alice', challenge.id, '99'), false);
  assert.equal(await captcha.consume('alice', challenge.id, answer(challenge)), false);
  challenge = await captcha.issue('alice');
  time += 5 * 60 * 1000;
  assert.equal(await captcha.consume('alice', challenge.id, answer(challenge)), false);
  const old = await captcha.issue('alice');
  challenge = await captcha.issue('alice');
  assert.notEqual(challenge.id, old.id);
  assert.equal(await captcha.consume('alice', old.id, answer(old)), false);
  challenge = await captcha.issue('alice');
  assert.equal(await captcha.consume('alice', challenge.id, Number(answer(challenge))), false);
  assert.equal(await captcha.consume('alice', undefined, undefined), false);
});
