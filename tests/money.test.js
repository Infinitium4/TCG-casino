const test = require('node:test');
const assert = require('node:assert/strict');
const { isMoney, toCents, roundMoney, moneyRatio, MAX_MONEY } = require('../underground/js/money');
const { rollDice } = require('../dice');
const { payoutFor: plinkoPayout } = require('../plinko');
const { payoutFor: minesPayout } = require('../mines');
const { createBlackjackTable, createPokerTable } = require('../server');

test('money accepts cents, rejects sub-cent inputs and rounds exact half cents upwards', () => {
  for (const value of [0, 0.01, 0.05, 0.29, -0.05, 1000000000000, MAX_MONEY]) assert.ok(isMoney(value));
  for (const value of ['0.05', null, NaN, Infinity, 0.001, 1.005, MAX_MONEY + 1]) assert.equal(isMoney(value), false);
  assert.equal(toCents(0.29), 29);
  assert.equal(roundMoney(0.1 + 0.2), 0.3);
  assert.equal(moneyRatio(0.05, 5, 2), 0.13);
  assert.equal(moneyRatio(0.05, 3, 10), 0.02);
  assert.equal(moneyRatio(0.05, 108, 100), 0.05);
});

test('small wagers keep their fractional winnings in Dice, Plinko and Mines', () => {
  assert.equal(rollDice(0.05, 'under', 50, () => 0).payout, 0.1);
  assert.equal(rollDice(0.05, 'under', 60, () => 0).payout, 0.08);
  assert.equal(plinkoPayout(0.05, 0.5), 0.03);
  assert.equal(plinkoPayout(0.05, 110), 5.5);
  assert.equal(minesPayout(0.05, 1, 1), 0.05);
  assert.equal(minesPayout(0.05, 24, 1), 1.24);
});

test('Blackjack pays a five-cent natural with cent precision', () => {
  const table = createBlackjackTable('cent-blackjack');
  table.addPlayer({ id: 1, username: 'Alice', chips: 0.2 });
  table.addPlayer({ id: 2, username: 'Bob', chips: 0.2 });
  const alice = table.players[0];
  alice.chips = 0.15; alice.bet = 0.05; alice.hand = ['Ah', 'Ks'];
  alice.hands = [{ cards: alice.hand, bet: 0.05, fromSplit: false }];
  table.players[1].hand = ['10h', '8s']; table.players[1].bet = 0.05;
  table.dealerCards = ['10c', '7d'];
  table.settleRound();
  assert.equal(alice.payout, 0.13);
  assert.equal(alice.chips, 0.28);
});

test('Poker conserves every cent in an odd tied pot', () => {
  const table = createPokerTable('cent-poker');
  [1, 2, 3].forEach(id => table.addPlayer({ id, username: `P${id}`, chips: 0.1 }));
  table.dealerIndex = 0; table.pot = 0.15;
  table.board = ['Ah', 'Kh', 'Qh', 'Jh', '10h'];
  table.players.forEach(player => { player.totalContribution = 0.05; player.hand = ['2c', '3d']; });
  table.players[2].folded = true;
  table.resolveShowdownWinner();
  assert.deepEqual(table.players.map(player => player.chips), [0.17, 0.18, 0.1]);
  assert.equal(table.players.reduce((sum, player) => sum + toCents(player.chips), 0), 45);
});

test('money displays show both decimal places for small balances', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const context = {};
  vm.runInNewContext(fs.readFileSync('underground/js/utils.js', 'utf8'), context);
  assert.equal(context.formatChips(0.05), '0,05');
  assert.equal(context.formatChips(0.1 + 0.2), '0,30');
  assert.equal(context.formatChips(0), '0,00');
});
