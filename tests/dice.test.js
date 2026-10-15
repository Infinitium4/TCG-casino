const test = require('node:test');
const assert = require('node:assert/strict');
const { thresholdUnits, winningOutcomes, rollDice } = require('../dice');

test('Dice probabilities count all 10000 outcomes exactly in both modes and at extreme thresholds', () => {
  for (const threshold of [1, 1.01, 50, 60, 98.99, 99]) {
    for (const mode of ['under', 'over']) {
      let wins = 0;
      for (let result = 0; result < 10000; result++) {
        const roll = rollDice(10000, mode, threshold, limit => { assert.equal(limit, 10000); return result; });
        wins += Number(roll.won);
        assert.equal(roll.result, result / 100);
        assert.equal(roll.payout, roll.won ? Math.round(1000000 * 9900 / winningOutcomes(mode, threshold)) / 100 : 0);
      }
      assert.equal(wins, winningOutcomes(mode, threshold));
      const odds = rollDice(100, mode, threshold, () => 0);
      assert.equal(odds.probability, wins / 100);
      assert.ok(Math.abs(wins / 10000 * odds.multiplier - .99) < 1e-12);
    }
  }
});

test('Under excludes equality and Over includes equality, with integer payout arithmetic', () => {
  assert.equal(rollDice(100, 'under', 60, () => 5999).won, true);
  assert.equal(rollDice(100, 'under', 60, () => 6000).won, false);
  assert.equal(rollDice(100, 'over', 60, () => 6000).won, true);
  assert.equal(rollDice(100, 'over', 60, () => 5999).won, false);
  assert.equal(rollDice(100, 'under', 50, () => 4200).payout, 198);
  assert.equal(rollDice(100, 'under', 60, () => 4200).payout, 165);
  assert.equal(rollDice(1, 'under', 60, () => 0).payout, 1.65);
  assert.equal(rollDice(1_000_000, 'under', 1, () => 0).payout, 99_000_000);
  for (const value of [0, 100, 1.001, 99.001, '50', null, NaN, Infinity]) assert.equal(thresholdUnits(value), null);
  assert.equal(thresholdUnits(1.01), 101);
  assert.throws(() => winningOutcomes('invalid', 50), RangeError);
});
