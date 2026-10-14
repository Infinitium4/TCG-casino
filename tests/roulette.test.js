const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { window: {}, getRouletteColor: number => ['0', '00'].includes(String(number)) ? 'green' : String(number) === '7' ? 'red' : 'black' };
const source = fs.readFileSync('underground/js/roulette.js', 'utf8').replace('window.rouletteModule = { initialize };', 'window.rouletteModule = { initialize, evaluateRouletteBet };');
vm.runInNewContext(source, context);
const evaluate = context.window.rouletteModule.evaluateRouletteBet;
test('roulette settles independent number and color stakes together', () => {
  const bets = [{ type: 'exact', exactNumber: 7, amount: 10 }, { type: 'exact', exactNumber: 8, amount: 25 }, { type: 'exact', exactNumber: 7, amount: 5 }, { type: 'red', amount: 20 }];
  assert.deepEqual(bets.map(bet => evaluate(bet, '7').payoutTotal), [360, 0, 180, 40]);
  assert.equal(bets.reduce((sum, bet) => sum + evaluate(bet, '7').payoutTotal, 0), 580);
});
test('roulette distinguishes zero and double zero and excludes both from outside bets', () => {
  for (const number of ['0', '00']) {
    assert.equal(evaluate({ type: 'exact', exactNumber: number, amount: 10 }, number).payoutTotal, 360);
    assert.equal(evaluate({ type: 'exact', exactNumber: number === '0' ? '00' : 0, amount: 10 }, number).payoutTotal, 0);
    for (const type of ['red', 'black', 'even', 'odd', 'manque', 'passe']) assert.equal(evaluate({ type, amount: 10 }, number).payoutTotal, 0);
  }
});
