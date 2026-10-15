const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createBlackjackTable,
  createPokerTable,
  evaluatePokerHand,
  createDeck,
  canStartPokerTable,
  tableToPublicState,
  calculateBlackjackValue
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

test('leaving during a hand folds the player and keeps their contribution for the pot', () => {
  const table = createPokerTable('test-poker-leave-fold');
  [1, 2, 3].forEach((id) => table.addPlayer({ id, username: `P${id}`, chips: 500 }));
  table.status = 'in-progress';
  table.round = 'river';
  table.currentTurn = 0;
  table.pot = 90;
  table.board = ['2h', '3d', '4c', '8s', '9h'];
  table.players.forEach((player) => {
    player.totalContribution = 30;
    player.hand = ['10h', 'Jc'];
  });

  const leaveResult = table.leavePlayer(3);
  const foldResult = table.applyAction(1, 'fold');

  assert.equal(leaveResult.ok, true);
  assert.equal(leaveResult.folded, true);
  assert.equal(foldResult.ok, true);
  assert.equal(table.players.some((player) => player.id === 3), false);
  assert.equal(table.players[1].chips, 590);
  assert.equal(table.pot, 0);
});

test('leaving on the current turn folds immediately and advances action only once', () => {
  const table = createPokerTable('test-poker-leave-on-turn');
  [1, 2, 3].forEach((id) => table.addPlayer({ id, username: `P${id}`, chips: 500 }));
  table.status = 'in-progress';
  table.round = 'flop';
  table.currentTurn = 0;
  table.pot = 60;
  table.players.forEach((player) => {
    player.totalContribution = 20;
    player.hand = ['10h', 'Jc'];
  });

  const firstLeave = table.leavePlayer(1);
  const nextTurn = table.players[table.currentTurn].id;
  const historyLength = table.recentHistory.length;
  const repeatedLeave = table.leavePlayer(1);

  assert.equal(firstLeave.ok, true);
  assert.equal(table.players.some((player) => player.id === 1), false);
  assert.equal(table.departedContributions[0].totalContribution, 20);
  assert.equal(nextTurn, 2);
  assert.equal(repeatedLeave.ok, false);
  assert.equal(table.players[table.currentTurn].id, 2);
  assert.equal(table.recentHistory.length, historyLength);
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

test('showdown reveals only remaining hands and identifies the winner', () => {
  const table = createPokerTable('test-poker-showdown-reveal');
  [1, 2, 3].forEach((id) => table.addPlayer({ id, username: `P${id}`, chips: 500 }));
  table.players.forEach((player) => {
    player.hand = ['Ah', 'Kd'];
  });
  table.players[2].folded = true;
  table.showdownWinnerIds = [2];

  const beforeShowdown = tableToPublicState(table, 1);
  assert.equal(beforeShowdown.players[1].hand.length, 0);

  table.round = 'showdown';
  const showdown = tableToPublicState(table, 1);

  assert.deepEqual(showdown.players[1].hand, ['Ah', 'Kd']);
  assert.equal(showdown.players[1].isWinner, true);
  assert.equal(showdown.players[2].hand.length, 0);
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

test('every actionable player must check before the street advances', () => {
  const table = createPokerTable('test-poker-check-turns');
  [1, 2, 3].forEach((id) => table.addPlayer({ id, username: `P${id}`, chips: 500 }));
  table.status = 'in-progress';
  table.round = 'flop';
  table.currentBet = 0;
  table.currentTurn = 0;
  table.board = ['2h', '3d', '4c'];
  table.players.forEach((player) => {
    player.bet = 0;
    player.actionTakenThisRound = false;
    player.hand = ['10h', 'Jc'];
  });

  assert.equal(table.applyAction(1, 'check').ok, true);
  assert.equal(table.round, 'flop');
  assert.equal(table.players[table.currentTurn].id, 2);
  assert.equal(table.applyAction(2, 'check').ok, true);
  assert.equal(table.round, 'flop');
  assert.equal(table.applyAction(3, 'check').ok, true);
  assert.equal(table.round, 'turn');
});

test('the big blind still gets an action after everyone calls pre-flop', () => {
  const table = createPokerTable('test-poker-big-blind-option');
  [1, 2, 3].forEach((id) => table.addPlayer({ id, username: `P${id}`, chips: 500 }));
  table.startRound();

  for (let actionCount = 0; actionCount < 2; actionCount += 1) {
    const playerId = table.players[table.currentTurn].id;
    assert.equal(table.applyAction(playerId, 'call').ok, true);
  }

  assert.equal(table.round, 'pre-flop');
  assert.equal(table.players[table.currentTurn].id, table.players[table.bigBlindIndex].id);
  assert.equal(table.applyAction(table.players[table.currentTurn].id, 'call').ok, true);
  assert.equal(table.round, 'flop');
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

test('a player can bet an arbitrary valid chip amount', () => {
  const table = createPokerTable('test-poker-arbitrary-bet');
  [1, 2, 3].forEach((id) => table.addPlayer({ id, username: `P${id}`, chips: 500 }));
  table.status = 'in-progress';
  table.round = 'flop';
  table.currentTurn = 0;
  table.currentBet = 0;

  const result = table.applyAction(1, 'bet', 37);

  assert.equal(result.ok, true);
  assert.equal(table.players[0].bet, 37);
  assert.equal(table.currentBet, 37);
});

test('a raise makes previous callers act again', () => {
  const table = createPokerTable('test-poker-reopen-action');
  [1, 2, 3].forEach((id) => table.addPlayer({ id, username: `P${id}`, chips: 500 }));
  table.status = 'in-progress';
  table.round = 'flop';
  table.currentTurn = 0;
  table.currentBet = 0;

  assert.equal(table.applyAction(1, 'bet', 40).ok, true);
  assert.equal(table.applyAction(2, 'call').ok, true);
  assert.equal(table.applyAction(3, 'raise', 60).ok, true);
  assert.equal(table.players[0].actionTakenThisRound, false);
  assert.equal(table.players[table.currentTurn].id, 1);
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
  table.pot = 0.03;
  table.board = ['Ah', 'Kh', 'Qh', 'Jh', '10h'];
  table.players.forEach((player) => {
    player.totalContribution = 0.01;
    player.hand = ['2c', '3d'];
  });
  table.players[2].folded = true;

  table.resolveShowdownWinner();

  assert.equal(table.players[0].chips, 500.01);
  assert.equal(table.players[1].chips, 500.02);
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

  table.players[0].chips = 480;
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

test('blackjack hand values count aces as eleven or one as needed', () => {
  assert.equal(calculateBlackjackValue(['A♠', 'A♦', '9♣']), 21);
  assert.equal(calculateBlackjackValue(['A♠', 'K♣', '5♦']), 16);
});

test('blackjack tables debit each player and deal private hands', () => {
  const table = createBlackjackTable('test-blackjack-multiplayer-start');
  table.addPlayer({ id: 1, username: 'Alice', chips: 500 });
  table.addPlayer({ id: 2, username: 'Bob', chips: 500 });

  assert.equal(table.startRound(25), true);
  assert.equal(table.players.every((player) => player.chips >= 475 && player.bet === 25 && player.hand.length === 2), true);
  assert.equal(table.dealerCards.length, 2);
  assert.equal(table.betAmount, 25);
});

test('blackjack hands are visible to table players but hidden in public state', () => {
  const table = createBlackjackTable('test-blackjack-visible-hands');
  table.addPlayer({ id: 1, username: 'Alice', chips: 500 });
  table.addPlayer({ id: 2, username: 'Bob', chips: 500 });
  table.startRound(25);

  const publicView = tableToPublicState(table);
  const participantView = tableToPublicState(table, 1, true);
  assert.equal(publicView.players[0].hand.length, 0);
  assert.equal(publicView.players[1].hand.length, 0);
  assert.equal(participantView.players[0].hand.length, 2);
  assert.equal(participantView.players[1].hand.length, 2);
});

test('blackjack turns progress in order and settle each player against the dealer', () => {
  const table = createBlackjackTable('test-blackjack-turn-order');
  table.addPlayer({ id: 1, username: 'Alice', chips: 100 });
  table.addPlayer({ id: 2, username: 'Bob', chips: 100 });
  table.status = 'in-progress';
  table.round = 'player-turn';
  table.roundNumber = 1;
  table.betAmount = 10;
  table.currentTurn = 0;
  table.dealerCards = ['10♠', '6♠'];
  table.deck = ['3♣'];
  table.players[0].chips = 90;
  table.players[0].bet = 10;
  table.players[0].hand = ['10♣', '8♣'];
  table.players[1].chips = 90;
  table.players[1].bet = 10;
  table.players[1].hand = ['K♦', 'Q♥'];

  const aliceView = tableToPublicState(table, 1);
  assert.equal(aliceView.players[0].hand.length, 2);
  assert.equal(aliceView.players[1].hand.length, 0);
  assert.equal(aliceView.dealerCards[1], null);
  assert.equal(table.act(2, 'stand'), false);
  assert.equal(table.act(1, 'stand'), true);
  assert.equal(table.currentTurn, 1);
  assert.equal(table.act(2, 'stand'), true);
  assert.equal(table.status, 'waiting');
  assert.equal(table.round, 'finished');
  assert.equal(table.players[0].outcome, 'loss');
  assert.equal(table.players[1].outcome, 'win');
  assert.equal(table.players[1].chips, 110);
});
