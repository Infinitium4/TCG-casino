const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createBlackjackTable,
  createPokerTable,
  evaluatePokerHand,
  createDeck,
  canStartPokerTable,
  tableToPublicState
} = require('../server');

test('a 2-player poker table cannot start', () => {
  const table = createPokerTable('test-poker-2');
  table.addPlayer({ id: 1, username: 'Alice', chips: 500 });
  table.addPlayer({ id: 2, username: 'Bob', chips: 500 });
  assert.equal(canStartPokerTable(table), false);
});

test('a 3-player poker table can start', () => {
  const table = createPokerTable('test-poker-3');
  [1, 2, 3].forEach((id) => table.addPlayer({ id, username: `P${id}`, chips: 500 }));
  assert.equal(canStartPokerTable(table), true);
});

test('a 9th player cannot join a full poker table', () => {
  const table = createPokerTable('test-poker-full');
  for (let i = 1; i <= 8; i += 1) {
    table.addPlayer({ id: i, username: `P${i}`, chips: 500 });
  }
  assert.equal(table.addPlayer({ id: 9, username: 'P9', chips: 500 }), false);
});

test('a leaving player loses their committed poker bet', () => {
  const table = createPokerTable('test-poker-leave');
  table.addPlayer({ id: 1, username: 'Alice', chips: 500 });
  table.addPlayer({ id: 2, username: 'Bob', chips: 500 });
  table.addPlayer({ id: 3, username: 'Cara', chips: 500 });

  table.players[0].bet = 60;
  table.pot = 60;
  table.status = 'in-progress';

  const leftPlayer = table.removePlayer(1);

  assert.equal(leftPlayer.bet, 60);
  assert.equal(table.pot, 60);
  assert.equal(table.players.length, 2);
});

test('removing a player before the active turn keeps the turn pointer valid', () => {
  const table = createPokerTable('test-poker-turn-reindex');
  [1, 2, 3, 4].forEach((id) => table.addPlayer({ id, username: `P${id}`, chips: 500 }));
  table.status = 'in-progress';
  table.round = 'pre-flop';
  table.currentTurn = 3;

  table.removePlayer(1);

  assert.equal(table.players.some((player) => player.id === 1), false);
  assert.equal(table.currentTurn, 2);
  assert.equal(table.players[table.currentTurn].id, 4);
});

test('starting a poker table deals a hand and only begins with the pre-flop street', () => {
  const table = createPokerTable('test-poker-start');
  [1, 2, 3].forEach((id) => table.addPlayer({ id, username: `P${id}`, chips: 500 }));

  table.startRound();

  assert.equal(table.status, 'in-progress');
  assert.equal(table.round, 'pre-flop');
  assert.equal(table.board.length, 0);
  table.players.forEach((player) => {
    assert.equal(player.hand.length, 2);
  });
});

test('blackjack tables are isolated and can support multiple concurrent tables', () => {
  const tableA = createBlackjackTable('A');
  const tableB = createBlackjackTable('B');
  tableA.addPlayer({ id: 1, username: 'Alice', chips: 500 });
  tableB.addPlayer({ id: 2, username: 'Bob', chips: 500 });
  assert.equal(tableA.players.length, 1);
  assert.equal(tableB.players.length, 1);
  assert.notEqual(tableA.id, tableB.id);
});

test('poker hand evaluator ranks a flush above a straight', () => {
  const straight = evaluatePokerHand(['Ah', 'Kd', 'Qh', 'Jc', '10s', '2c', '3d']);
  const flush = evaluatePokerHand(['Ah', 'Kh', 'Qh', '2h', '3h', '7c', '8d']);
  assert.ok(flush.rank > straight.rank);
});

test('deck generation returns 52 unique cards', () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck).size, 52);
});

test('a poker table exposes private cards only to their owner', () => {
  const table = createPokerTable('test-poker-private');
  [1, 2, 3].forEach((id) => table.addPlayer({ id, username: `P${id}`, chips: 500 }));
  table.startRound();

  const aliceView = tableToPublicState(table, 1);
  const bobView = tableToPublicState(table, 2);

  assert.equal(aliceView.players[0].hand.length, 2);
  assert.equal(aliceView.players[1].hand.length, 0);
  assert.equal(bobView.players[1].hand.length, 2);
  assert.equal(bobView.players[0].hand.length, 0);
});

test('a full poker betting round advances to the flop when everyone calls', () => {
  const table = createPokerTable('test-poker-betting-round');
  [1, 2, 3].forEach((id) => table.addPlayer({ id, username: `P${id}`, chips: 500 }));
  table.startRound();

  let actionCount = 0;
  while (table.round === 'pre-flop' && actionCount < 10) {
    const playerId = table.players[table.currentTurn].id;
    const result = table.applyAction(playerId, 'call');
    assert.equal(result.ok, true, `call should be accepted for player ${playerId}`);
    actionCount += 1;
  }

  assert.equal(table.round, 'flop');
  assert.equal(table.board.length, 3);
});

test('a player can place a legal custom bet and rejects an illegal under-bet', () => {
  const table = createPokerTable('test-poker-bet-validation');
  [1, 2, 3].forEach((id) => table.addPlayer({ id, username: `P${id}`, chips: 500 }));
  table.startRound();

  const firstPlayerId = table.players[table.currentTurn].id;
  const legalBet = table.applyAction(firstPlayerId, 'bet', 60);
  assert.equal(legalBet.ok, true);
  assert.equal(Number(table.players[table.getPlayerIndex(firstPlayerId)].bet), 60);

  const nextPlayerId = table.players[table.currentTurn].id;
  const invalidBet = table.applyAction(nextPlayerId, 'bet', 10);
  assert.equal(invalidBet.ok, false);
  assert.equal(String(invalidBet.message).includes('au moins'), true);
});

test('a new round starts without community cards and only resolves after the first betting street', () => {
  const table = createPokerTable('test-poker-start-round');
  [1, 2, 3].forEach((id) => table.addPlayer({ id, username: `P${id}`, chips: 500 }));

  table.startRound();

  assert.equal(table.board.length, 0);
  assert.equal(table.round, 'pre-flop');
  assert.equal(table.players.every((player) => player.hand.length === 2), true);
});

test('a player who goes all-in remains active and is not treated as folded', () => {
  const table = createPokerTable('test-poker-all-in-active');
  [1, 2, 3].forEach((id) => table.addPlayer({ id, username: `P${id}`, chips: 100 }));
  table.startRound();

  table.currentTurn = 0;
  const result = table.applyAction(1, 'all-in');

  assert.equal(result.ok, true);
  assert.equal(table.players[0].allIn, true);
  assert.equal(table.players[0].folded, false);
  assert.equal(table.getActivePlayers().some((player) => player.id === 1), true);
  assert.equal(table.players[0].chips, 0);
});

test('an all-in round runs the remaining board streets automatically', () => {
  const table = createPokerTable('test-poker-all-in-runout');
  [1, 2, 3].forEach((id) => table.addPlayer({ id, username: `P${id}`, chips: 100 }));
  table.status = 'in-progress';
  table.round = 'flop';
  table.currentTurn = 2;
  table.pot = 150;
  table.board = ['2h', '3d', '4c'];
  table.deck = ['6s', '5h'];
  table.players[0].chips = 0;
  table.players[0].allIn = true;
  table.players[0].totalContribution = 50;
  table.players[0].hand = ['As', 'Kc'];
  table.players[1].chips = 0;
  table.players[1].allIn = true;
  table.players[1].totalContribution = 50;
  table.players[1].hand = ['Jh', '10d'];
  table.players[2].chips = 20;
  table.players[2].totalContribution = 50;
  table.players[2].hand = ['Qd', '8s'];

  const result = table.applyAction(3, 'all-in');

  assert.equal(result.ok, true);
  assert.equal(table.round, 'showdown');
  assert.equal(table.status, 'waiting');
  assert.equal(table.board.length, 5);
  assert.equal(table.pot, 0);
});

test('the river showdown pays the best hand the full pot', () => {
  const table = createPokerTable('test-poker-showdown');
  [1, 2, 3].forEach((id) => table.addPlayer({ id, username: `P${id}`, chips: 500 }));

  table.status = 'in-progress';
  table.round = 'river';
  table.currentTurn = 0;
  table.currentBet = 0;
  table.pot = 180;
  table.board = ['2h', '3d', '4c', '5s', '9h'];

  table.players[0].hand = ['As', '6c'];
  table.players[1].hand = ['Jh', '7d'];
  table.players[2].hand = ['Qd', '8s'];
  table.players.forEach((player) => {
    player.bet = 0;
    player.folded = false;
    player.allIn = false;
    player.actionTakenThisRound = true;
    player.totalContribution = 60;
  });

  const result = table.applyAction(1, 'check');

  assert.equal(result.ok, true);
  assert.equal(table.pot, 0);
  assert.equal(table.players[0].chips, 680);
  assert.equal(table.round, 'showdown');
});

test('showdown awards the main pot and side pot only to eligible players', () => {
  const table = createPokerTable('test-poker-side-pots');
  [1, 2, 3].forEach((id) => table.addPlayer({ id, username: `P${id}`, chips: 500 }));
  table.status = 'in-progress';
  table.round = 'river';
  table.dealerIndex = 0;
  table.pot = 250;
  table.board = ['2h', '3d', '4c', '8s', '9h'];
  table.players[0].chips = 0;
  table.players[0].allIn = true;
  table.players[0].totalContribution = 50;
  table.players[0].hand = ['5h', '6c'];
  table.players[1].totalContribution = 100;
  table.players[1].hand = ['10h', 'Jc'];
  table.players[2].totalContribution = 100;
  table.players[2].hand = ['Qd', 'Ks'];

  table.resolveShowdownWinner();

  assert.equal(table.players[0].chips, 150);
  assert.equal(table.players[1].chips, 500);
  assert.equal(table.players[2].chips, 600);
  assert.equal(table.pot, 0);
});

test('a tied pot is split and its odd chip goes clockwise from the dealer', () => {
  const table = createPokerTable('test-poker-split-pot');
  [1, 2, 3].forEach((id) => table.addPlayer({ id, username: `P${id}`, chips: 500 }));
  table.status = 'in-progress';
  table.round = 'river';
  table.dealerIndex = 0;
  table.pot = 3;
  table.board = ['Ah', 'Kh', 'Qh', 'Jh', '10h'];
  table.players.forEach((player) => {
    player.totalContribution = 1;
    player.hand = ['2c', '3d'];
  });
  table.players[2].folded = true;

  table.resolveShowdownWinner();

  assert.equal(table.players[0].chips, 501);
  assert.equal(table.players[1].chips, 502);
  assert.equal(table.players[2].chips, 500);
  assert.equal(table.pot, 0);
});

test('a hand cannot be restarted while betting is still in progress', () => {
  const table = createPokerTable('test-poker-no-mid-hand-restart');
  [1, 2, 3].forEach((id) => table.addPlayer({ id, username: `P${id}`, chips: 500 }));
  table.startRound();
  const originalHands = table.players.map((player) => [...player.hand]);

  assert.equal(table.startRound(), false);
  assert.deepEqual(table.players.map((player) => player.hand), originalHands);
  assert.equal(table.round, 'pre-flop');
});

test('a last active player wins immediately after the others fold', () => {
  const table = createPokerTable('test-poker-fold-win');
  [1, 2, 3].forEach((id) => table.addPlayer({ id, username: `P${id}`, chips: 500 }));
  table.startRound();

  table.players[0].bet = 20;
  table.pot = 20;
  table.currentBet = 20;
  table.players[1].folded = true;
  table.players[2].folded = true;
  table.currentTurn = 0;

  const result = table.applyAction(1, 'check');

  assert.equal(result.ok, true);
  assert.equal(table.round, 'showdown');
  assert.equal(table.pot, 0);
  assert.equal(table.players[0].chips, 500);
  assert.equal(table.players[1].folded, true);
  assert.equal(table.players[2].folded, true);
});
