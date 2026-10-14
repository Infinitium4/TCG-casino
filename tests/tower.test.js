const test = require('node:test');
const assert = require('node:assert/strict');
const { createMotion, positionAt, evaluatePlacement, validateMultipliers, MULTIPLIERS, RANDOM_TIMING_BOUND } = require('../tower');

test('Tower motion is deterministic, bounded, continuous and accelerates each floor', () => {
  const motion = createMotion(180, 0, 1000, 0);
  assert.equal(positionAt(motion, 1000), motion.minX);
  const travel = (motion.maxX - motion.minX) / motion.speed * 1000;
  assert.equal(positionAt(motion, 1000 + travel), motion.maxX);
  assert.equal(positionAt(motion, 1000 + travel * 2), motion.minX);
  for (let now = 0; now < 100000; now += 17) assert.ok(positionAt(motion, now) >= motion.minX && positionAt(motion, now) <= motion.maxX);
  assert.ok(createMotion(180, 7, 1000, 0).speed > motion.speed);
});
test('perfect placements keep width, partial overlaps cut the platform and misses fail', () => {
  const base = { x: 300, width: 180 };
  const at = x => ({ width: 180, minX: x, maxX: x + 100, speed: 0, phase: 0, startsAt: 0 });
  const perfect = evaluatePlacement(base, at(302), 0);
  assert.equal(perfect.perfect, true); assert.deepEqual(perfect.platform, base);
  const partial = evaluatePlacement(base, at(340), 0);
  assert.equal(partial.success, true); assert.equal(partial.perfect, false);
  assert.equal(partial.platform.width, 140); assert.equal(partial.platform.x, 320);
  assert.equal(evaluatePlacement(base, at(382), 0).success, false);
  assert.equal(evaluatePlacement(base, at(500), 0).success, false);
});
test('multipliers are capped and respect the documented uniform timing budget', () => {
  let previous = 1;
  for (const value of MULTIPLIERS) { assert.ok(value / previous * RANDOM_TIMING_BOUND <= .99); previous = value; }
  for (const table of [[], [110, 111, 112, 113, 114, 115, 116, 117], [1.01, 1.02, 1.03, 1.04, 1.05, 1.06, 1.07, NaN], [1.15, 1.14, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8]]) assert.throws(() => validateMultipliers(table));
});
