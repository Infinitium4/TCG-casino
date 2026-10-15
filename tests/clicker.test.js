const test = require('node:test');
const assert = require('node:assert/strict');
const { clickerAllowance } = require('../clicker');
test('Clicker is available strictly below 10 chips', () => {
  for (const balance of [0, 0.05, 9.95]) {
    assert.deepEqual(clickerAllowance(balance), { remaining: Math.round((10 - balance) * 100) / 100, limit: 10, eligible: true });
  }
  for (const balance of [10, 10.01, 10000]) {
    assert.deepEqual(clickerAllowance(balance), { remaining: 0, limit: 10, eligible: false });
  }
});
