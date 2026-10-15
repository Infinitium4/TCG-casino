const test = require('node:test');
const assert = require('node:assert/strict');
const { BOARD_SIZE, RTP, validMineCount, survivalProbability, multiplierFor, payoutFor, generateMinePositions } = require('../mines');

test('Mines survival probability and RTP multipliers match exact combinatorial odds', () => {
  for (const mineCount of [1, 10, 24]) {
    let probability = 1;
    for (let safeCount = 0; safeCount <= BOARD_SIZE - mineCount; safeCount += 1) {
      assert.ok(Math.abs(survivalProbability(mineCount, safeCount) - probability) < 1e-12);
      assert.ok(Math.abs(probability * multiplierFor(mineCount, safeCount) - RTP) < 1e-12);
      probability *= (BOARD_SIZE - mineCount - safeCount) / (BOARD_SIZE - safeCount);
    }
  }
  assert.equal(multiplierFor(10, 0), 0.99);
  assert.equal(payoutFor(100, 10, 0), 99);
  assert.equal(payoutFor(100, 1, 24), 2475);
  assert.equal(payoutFor(100, 24, 1), 2475);
});

test('Mines placement is unique, bounded and selects exactly the requested count', () => {
  for (const mineCount of [1, 10, 24]) {
    const positions = generateMinePositions(mineCount);
    assert.equal(positions.length, mineCount);
    assert.equal(new Set(positions).size, mineCount);
    assert.ok(positions.every(position => Number.isInteger(position) && position >= 0 && position < BOARD_SIZE));
  }
  assert.deepEqual(generateMinePositions(3, min => min), [0, 1, 2]);
  for (const mineCount of [0, 25, 1.5, '10']) assert.equal(validMineCount(mineCount), false);
  for (const value of [25, -1, 1.5]) assert.throws(() => survivalProbability(10, value), RangeError);
  assert.throws(() => payoutFor(0, 10, 1), RangeError);
});