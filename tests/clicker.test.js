const test = require('node:test');
const assert = require('node:assert/strict');
const { clickerAllowance } = require('../clicker');
test('Clicker is available strictly below 1000 chips', () => {
  for (const balance of [0, 1, 999]) {
    assert.deepEqual(clickerAllowance(balance), { remaining: 1000 - balance, limit: 1000, eligible: true });
  }
  for (const balance of [1000, 1001, 1000000]) {
    assert.deepEqual(clickerAllowance(balance), { remaining: 0, limit: 1000, eligible: false });
  }
});
