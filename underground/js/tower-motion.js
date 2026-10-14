(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.towerMotion = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
function positionAt(motion, now) {
  const span = motion.maxX - motion.minX;
  const phase = ((Math.max(0, now - motion.startsAt) / 1000 * motion.speed / span + motion.phase * 2) % 2 + 2) % 2;
  return motion.minX + span * (phase <= 1 ? phase : 2 - phase);
}
function evaluatePlacement(base, motion, now) {
  const x = positionAt(motion, now);
  const left = Math.max(base.x - base.width / 2, x - motion.width / 2);
  const right = Math.min(base.x + base.width / 2, x + motion.width / 2);
  const overlap = Math.max(0, right - left);
  const perfect = overlap > 0 && Math.abs(x - base.x) <= 3;
  const success = perfect || overlap >= Math.max(24, motion.width * .55);
  return { success, perfect, x, overlap, platform: success ? perfect ? { ...base } : { x: (left + right) / 2, width: Math.floor(overlap) } : null };
}
  return { positionAt, evaluatePlacement };
});
