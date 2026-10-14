const test = require('node:test');
const assert = require('node:assert/strict');
const { createBlackjackTable, tableToPublicState } = require('../server');

function game(cards = ['8♣', '8♦'], chips = 90) {
  const table = createBlackjackTable('blackjack-actions');
  table.addPlayer({ id: 1, username: 'Alice', chips });
  table.addPlayer({ id: 2, username: 'Bob', chips: 90 });
  Object.assign(table, { status: 'in-progress', round: 'player-turn', currentTurn: 0, roundNumber: 1, betAmount: 10, dealerCards: ['10♠', '7♥'], deck: ['2♠', '3♠', '10♥', '10♦'] });
  Object.assign(table.players[0], { hand: cards, bet: 10 });
  Object.assign(table.players[1], { hand: ['10♣', '9♦'], bet: 10 });
  return table;
}

test('double debits one extra stake, draws exactly one card and moves to the next player', () => {
  const table = game(['5♣', '6♦']);
  assert.equal(tableToPublicState(table, 1).players[0].canDouble, true);
  assert.equal(table.act(1, 'double'), true);
  assert.equal(table.players[0].chips, 80);
  assert.equal(table.players[0].bet, 20);
  assert.equal(table.players[0].hand.length, 3);
  assert.equal(table.currentTurn, 1);
  assert.equal(table.act(1, 'double'), false);
  table.act(2, 'stand');
  assert.equal(table.players[0].payout, 40);
  assert.equal(table.players[0].chips, 120);
});

test('split creates two stakes, plays both hands before the next player and settles each independently', () => {
  const table = game();
  table.deck = ['3♠', '2♠', '10♥', '10♦'];
  assert.equal(table.act(1, 'split'), true);
  const alice = table.players[0];
  assert.equal(alice.chips, 80);
  assert.equal(alice.bet, 20);
  assert.deepEqual(alice.hands.map(hand => hand.cards), [['8♣', '10♦'], ['8♦', '10♥']]);
  assert.equal(table.act(1, 'split'), false);
  assert.equal(table.act(1, 'stand'), true);
  assert.equal(table.currentTurn, 0);
  assert.equal(alice.activeHand, 1);
  assert.equal(table.act(1, 'hit'), true);
  assert.equal(table.act(1, 'stand'), true);
  assert.equal(table.currentTurn, 1);
  table.act(2, 'stand');
  assert.deepEqual(alice.hands.map(hand => hand.payout), [20, 20]);
  assert.equal(alice.chips, 120);
});

test('split aces receive one card each and split 21 pays ordinary winnings', () => {
  const table = game(['A♣', 'A♦']);
  table.deck = ['9♠', '10♦'];
  assert.equal(table.act(1, 'split'), true);
  assert.equal(table.currentTurn, 1);
  assert.equal(table.players[0].hands.every(hand => hand.finished && hand.cards.length === 2), true);
  table.act(2, 'stand');
  assert.deepEqual(table.players[0].hands.map(hand => hand.payout), [20, 20]);
  assert.equal(table.players[0].hands[0].outcome, 'win');
});

test('double and split reject insufficient funds, wrong turns, extra cards and mismatched pairs', () => {
  for (const action of ['double', 'split']) {
    const table = game(undefined, 9);
    assert.equal(table.act(1, action), false);
    assert.equal(table.players[0].chips, 9);
    assert.equal(table.players[0].bet, 10);
    assert.equal(table.act(2, action), false);
    table.players[0].hand.push('2♣');
    assert.equal(table.act(1, action), false);
  }
  assert.equal(game(['8♣', '9♦']).act(1, 'split'), false);
});

test('double after split uses only the active hand stake and split cards stay private', () => {
  const table = game();
  table.act(1, 'split');
  table.act(1, 'double');
  assert.equal(table.players[0].bet, 30);
  assert.equal(table.players[0].chips, 70);
  assert.deepEqual(table.players[0].hands.map(hand => hand.bet), [20, 10]);
  assert.equal(table.players[0].activeHand, 1);
  const hidden = tableToPublicState(table).players[0];
  assert.equal(hidden.hands.every(hand => hand.cards.length === 0), true);
  const visible = tableToPublicState(table, 1).players[0];
  assert.equal(visible.hands[0].cards.length, 3);
});

test('a new round resets split hands and stakes', () => {
  const table = game();
  table.act(1, 'split');
  table.act(1, 'stand');
  table.act(1, 'stand');
  table.act(2, 'stand');
  assert.equal(table.startRound(10), true);
  assert.equal(table.players[0].hands.length, 1);
  assert.equal(table.players[0].bet, 10);
  assert.equal(table.players[0].activeHand, 0);
});

test('split settles a losing hand and a pushing hand without paying the lost stake', () => {
  const table = game();
  table.deck = ['10♠', '9♦', '7♥'];
  table.act(1, 'split');
  table.act(1, 'hit');
  assert.equal(table.players[0].activeHand, 1);
  table.act(1, 'stand');
  table.act(2, 'stand');
  assert.deepEqual(table.players[0].hands.map(hand => hand.outcome), ['loss', 'push']);
  assert.equal(table.players[0].payout, 10);
  assert.equal(table.players[0].chips, 90);
  assert.equal(table.players[0].outcome, 'loss');
});

test('split accepts different ranks worth ten and double remains available on each split hand', () => {
  const table = game(['10?', 'K?']);
  table.deck = ['2?', '3?', '4?', '5?'];
  assert.equal(tableToPublicState(table, 1).players[0].canSplit, true);
  assert.equal(table.act(1, 'split'), true);
  assert.equal(table.act(1, 'double'), true);
  assert.equal(table.players[0].activeHand, 1);
  assert.equal(tableToPublicState(table, 1).players[0].canDouble, true);
  assert.equal(table.act(1, 'double'), true);
  assert.equal(table.players[0].bet, 40);
  assert.equal(table.players[0].chips, 60);
  assert.deepEqual(table.players[0].hands.map(hand => hand.bet), [20, 20]);
  assert.equal(table.currentTurn, 1);
});
