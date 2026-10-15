const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MULTIPLIERS, PROBABILITIES, RTP, generateDrop, payoutFor } = require('../plinko');

test('all 65536 paths produce the exact binomial distribution and reference RTP', () => {
  const counts = Array(17).fill(0);
  for (let bits = 0; bits < 65536; bits++) {
    let decision = 0;
    const outcome = generateDrop(limit => { assert.equal(limit, 2); return (bits >> decision++) & 1; });
    assert.equal(outcome.path.length, 16);
    assert.equal(outcome.multiplier, MULTIPLIERS[outcome.slot]);
    counts[outcome.slot]++;
  }
  assert.deepEqual(counts.map(count => count / 65536), PROBABILITIES);
  assert.equal(RTP, 0.9898834228515625);
  assert.equal(counts[0], 1);
  assert.equal(counts[16], 1);
  assert.equal(counts[8], 12870);
  assert.equal(payoutFor(100, .3), 30);
  assert.equal(payoutFor(3, .5), 1.5);
  assert.equal(payoutFor(1_000_000, 110), 110_000_000);
});

function geometry() {
  const context = vm.createContext(Object.assign({}, require('../underground/js/money'), {}));
  const source = fs.readFileSync(path.join(__dirname, '../underground/js/plinko.js'), 'utf8');
  vm.runInContext(source.replace('return { initialize, setActive };', 'globalThis.ballPosition = ballPosition; return { initialize, setActive };'), context);
  return context.ballPosition;
}

test('rendered routes avoid every peg and finish at all 17 authoritative slots', () => {
  const position = geometry();
  for (let slot = 0; slot <= 16; slot++) {
    const route = Array.from({ length: 16 }, (_, index) => index < slot ? 1 : 0);
    for (let elapsed = 0; elapsed <= 3450; elapsed += 5) {
      const ball = position(route, elapsed);
      assert.ok(Number.isFinite(ball.x) && Number.isFinite(ball.y));
      for (let row = 0; row < 16; row++) {
        const y = 38 + row * 30;
        if (Math.abs(y - ball.y) > 9) continue;
        for (let column = 0; column < row + 3; column++) {
          const x = 360 + (column - (row + 2) / 2) * 32;
          assert.ok(Math.hypot(x - ball.x, y - ball.y) >= 8.2, `collision: slot ${slot}, time ${elapsed}, row ${row}`);
        }
      }
    }
    assert.equal(position(route, 3450).x, 360 + (2 * slot - 16) * 16);
    assert.equal(position(route, 3450).y, 535);
  }
});
