(function (root) {
  const MAX_MONEY = Math.floor(Number.MAX_SAFE_INTEGER / 100);
  function isMoney(value) {
    return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_MONEY
      && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
  }
  function toCents(value) {
    if (!isMoney(value)) throw new RangeError('Montant invalide : deux décimales maximum.');
    return Math.round(value * 100);
  }
  function roundMoney(value) {
    return Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
  }
  // Round a rational payout to the nearest cent, with exact integer arithmetic.
  function moneyRatio(stake, numerator, denominator) {
    const cents = BigInt(toCents(stake));
    const n = BigInt(numerator), d = BigInt(denominator);
    if (cents < 0n || n < 0n || d <= 0n) throw new RangeError('Gain invalide.');
    const result = (cents * n * 2n + d) / (d * 2n);
    if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Gain maximal dépassé.');
    return Number(result) / 100;
  }
  const api = { MAX_MONEY, isMoney, toCents, roundMoney, moneyRatio };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(globalThis);
