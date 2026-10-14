const test = require('node:test');
const assert = require('node:assert/strict');
const { generateRace, HORSES } = require('../horse-racing');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { generateMarket, weightedOrder } = require('../horse-tables');

test('each table offers five distinct odds tied to the actual weighted winning probabilities', () => {
  const weights = [8, 12, 20, 28, 40];
  const market = generateMarket(HORSES, () => weights.shift());
  assert.equal(new Set(market.map(horse => horse.odds)).size, 5);
  assert.equal(new Set(market.map(horse => horse.probability)).size, 5);
  assert.ok(Math.abs(market.reduce((sum, horse) => sum + horse.probability, 0) - 1) < 1e-10);
  const total = market.reduce((sum, horse) => sum + horse.weight, 0);
  const wins = [0, 0, 0, 0, 0];
  for (let first = 0; first < total; first++) {
    let called = false;
    const order = weightedOrder(market, () => { if (called) return 0; called = true; return first; });
    assert.equal(new Set(order).size, 5);
    wins[order[0] - 1]++;
  }
  assert.deepEqual(wins, market.map(horse => horse.weight));
  for (const horse of market) {
    assert.ok(horse.odds * horse.probability <= .8);
    assert.ok(horse.odds * horse.probability > .79);
  }
});

test('legacy solo races retain their original uniform winning probabilities', () => {
  const wins = [0, 0, 0, 0, 0];
  const orders = new Set();
  for (let a = 0; a < 5; a++) for (let b = 0; b < 4; b++) for (let c = 0; c < 3; c++) for (let d = 0; d < 2; d++) {
    const draws = [a, b, c, d];
    const race = generateRace((min, max) => max ? 100 : draws.shift());
    wins[race.order[0] - 1]++;
    orders.add(race.order.join(','));
    assert.equal(race.trajectories.length, 5);
    for (const trajectory of race.trajectories) {
      assert.equal(trajectory.checkpoints[0], 0);
      assert.equal(trajectory.checkpoints.at(-1), 1);
      assert.equal(trajectory.finishMs, 12000 + race.order.indexOf(trajectory.id) * 500);
      assert.ok(trajectory.checkpoints.every((value, i, values) => i === 0 || value >= values[i - 1]));
    }
  }
  assert.equal(orders.size, 120);
  assert.deepEqual(wins, [24, 24, 24, 24, 24]);
});

test('browser trajectories never reverse or finish before the authoritative winning horse', () => {
  const source = fs.readFileSync(path.join(__dirname, '../underground/js/horses.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source.replace('return { initialize, setActive };', 'globalThis.progressAt = progressAt; return { initialize, setActive };'), context);
  for (let sample = 0; sample < 50; sample++) {
    const race = generateRace();
    for (const entry of race.trajectories) {
      let previous = 0;
      for (let elapsed = 0; elapsed <= 14000; elapsed += 25) {
        const progress = context.progressAt(entry, elapsed);
        assert.ok(progress >= previous && progress <= 1);
        if (elapsed < entry.finishMs) assert.ok(progress < 1);
        previous = progress;
      }
      assert.equal(context.progressAt(entry, entry.finishMs), 1);
    }
  }
  assert.equal(HORSES.length, 5);
});
