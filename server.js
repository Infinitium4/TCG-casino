const express = require('express');
const http = require('http');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const SQLiteStore = require('connect-sqlite3')(session);

const app = express();
const server = http.createServer(app);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 5500);
const HOST = process.env.HOST || (IS_PRODUCTION ? '127.0.0.1' : '0.0.0.0');
const DATA_DIR = path.resolve(process.env.DATA_DIR || __dirname);
const DB_PATH = path.join(DATA_DIR, 'database.sqlite');
const SESSION_SECRET = process.env.SESSION_SECRET || (IS_PRODUCTION ? '' : 'underground-local-development-secret');

if (IS_PRODUCTION && SESSION_SECRET.length < 32) {
  throw new Error('En production, SESSION_SECRET doit contenir au moins 32 caractères.');
}

fs.mkdirSync(DATA_DIR, { recursive: true });

if (IS_PRODUCTION) {
  app.set('trust proxy', 1);
}

function resolveExistingPath(...candidatePaths) {
  for (const candidate of candidatePaths) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidatePaths[0];
}

const GAME_DIR = resolveExistingPath(
  path.join(__dirname, 'underground'),
  path.join(__dirname, 'TCG-casino', 'underground')
);

const AUTH_DIR = resolveExistingPath(
  path.join(__dirname, 'public'),
  path.join(__dirname, 'TCG-casino', 'public')
);

const sessionMiddleware = session({
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: DATA_DIR,
    table: 'sessions'
  }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 7,
    sameSite: 'lax',
    secure: IS_PRODUCTION
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);

const io = new Server(server, {
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling']
});

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, (error) => {
    if (error) {
      return next(error);
    }

    if (!socket.request.session || !socket.request.session.userId) {
      return next(new Error('AUTH_REQUIRED'));
    }

    next();
  });
});

const db = new sqlite3.Database(DB_PATH, (error) => {
  if (error) {
    console.error('Erreur SQLite :', error.message);
    process.exit(1);
  }
  console.log('Base SQLite connectée');
  initDatabase();
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onDone(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows);
    });
  });
}

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const HAND_RANKS = {
  'High Card': 0,
  'Pair': 1,
  'Two Pair': 2,
  'Three of a Kind': 3,
  'Straight': 4,
  'Flush': 5,
  'Full House': 6,
  'Four of a Kind': 7,
  'Straight Flush': 8,
  'Royal Flush': 9
};

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

function shuffleDeck(cards) {
  const copy = [...cards];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }
  return copy;
}

function getCardValue(card) {
  const value = String(card).slice(0, -1);
  if (value === 'A') return 14;
  if (value === 'K') return 13;
  if (value === 'Q') return 12;
  if (value === 'J') return 11;
  return Number(value);
}

function getCardSuit(card) {
  return String(card).slice(-1);
}

function calculateBlackjackValue(cards = []) {
  let total = 0;
  let aces = 0;

  for (const card of cards) {
    const rank = String(card).slice(0, -1);
    if (rank === 'A') {
      total += 11;
      aces += 1;
    } else if (['J', 'Q', 'K'].includes(rank)) {
      total += 10;
    } else {
      total += Number(rank);
    }
  }

  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }

  return total;
}

function isBlackjack(cards) {
  return cards.length === 2 && calculateBlackjackValue(cards) === 21;
}

function compareValues(a, b) {
  return Number(b) - Number(a);
}

function chooseCombinations(cards, size) {
  const results = [];
  function backtrack(start, current) {
    if (current.length === size) {
      results.push([...current]);
      return;
    }
    for (let index = start; index < cards.length; index += 1) {
      current.push(cards[index]);
      backtrack(index + 1, current);
      current.pop();
    }
  }
  backtrack(0, []);
  return results;
}

function compareHandScore(a, b) {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const currentA = Number(a[index] ?? 0);
    const currentB = Number(b[index] ?? 0);
    if (currentA !== currentB) {
      return currentA - currentB;
    }
  }
  return 0;
}

function evaluateFiveCards(cards) {
  const values = cards.map(getCardValue).sort(compareValues);
  const suitMap = {};
  for (const card of cards) {
    const suit = getCardSuit(card);
    suitMap[suit] = (suitMap[suit] || 0) + 1;
  }

  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  const sortedCounts = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  const isFlush = Object.values(suitMap).some((count) => count >= 5);
  const uniqueValues = [...new Set(values)];
  const straightHigh = (() => {
    if (uniqueValues.length < 5) return null;
    const sortedUnique = [...new Set(uniqueValues)].sort((a, b) => a - b);
    const hasAceLow = sortedUnique.includes(14) && sortedUnique.includes(5) && sortedUnique.includes(4) && sortedUnique.includes(3) && sortedUnique.includes(2);
    if (hasAceLow) return 5;
    for (let index = 0; index <= sortedUnique.length - 5; index += 1) {
      const slice = sortedUnique.slice(index, index + 5);
      const test = slice.every((value, subIndex) => {
        if (subIndex === 0) return true;
        return value === slice[subIndex - 1] + 1;
      });
      if (test) {
        return slice[slice.length - 1];
      }
    }
    return null;
  })();

  const isStraight = straightHigh !== null;

  if (isStraight && isFlush) {
    const royalValues = [10, 11, 12, 13, 14];
    const royal = cards.map(getCardValue).sort(compareValues).filter((value) => royalValues.includes(value));
    if (royal.length === 5) {
      return { rank: HAND_RANKS['Royal Flush'], name: 'Royal Flush', score: [9, 14], best: cards.slice().sort((a, b) => getCardValue(b) - getCardValue(a)) };
    }
    return { rank: HAND_RANKS['Straight Flush'], name: 'Straight Flush', score: [8, straightHigh], best: cards.slice().sort((a, b) => getCardValue(b) - getCardValue(a)) };
  }

  if (sortedCounts[0][1] === 4) {
    const quadValue = sortedCounts[0][0];
    const kicker = values.find((value) => value !== quadValue);
    return { rank: HAND_RANKS['Four of a Kind'], name: 'Four of a Kind', score: [7, quadValue, kicker], best: cards.slice().sort((a, b) => getCardValue(b) - getCardValue(a)) };
  }

  if (sortedCounts[0][1] === 3 && sortedCounts[1][1] === 2) {
    return { rank: HAND_RANKS['Full House'], name: 'Full House', score: [6, sortedCounts[0][0], sortedCounts[1][0]], best: cards.slice() };
  }

  if (isFlush) {
    return { rank: HAND_RANKS['Flush'], name: 'Flush', score: [5, ...values.slice().reverse()], best: cards.slice().sort((a, b) => getCardValue(b) - getCardValue(a)) };
  }

  if (isStraight) {
    return { rank: HAND_RANKS['Straight'], name: 'Straight', score: [4, straightHigh], best: cards.slice() };
  }

  if (sortedCounts[0][1] === 3) {
    const tripValue = sortedCounts[0][0];
    const kickers = values.filter((value) => value !== tripValue).sort(compareValues).slice(0, 2).reverse();
    return { rank: HAND_RANKS['Three of a Kind'], name: 'Three of a Kind', score: [3, tripValue, ...kickers], best: cards.slice() };
  }

  if (sortedCounts[0][1] === 2 && sortedCounts[1][1] === 2) {
    const pairs = sortedCounts.slice(0, 2).map(([value]) => value).sort((a, b) => b - a);
    const kicker = values.find((value) => !pairs.includes(value));
    return { rank: HAND_RANKS['Two Pair'], name: 'Two Pair', score: [2, ...pairs, kicker], best: cards.slice() };
  }

  if (sortedCounts[0][1] === 2) {
    const pairValue = sortedCounts[0][0];
    const kickers = values.filter((value) => value !== pairValue).sort(compareValues).slice(0, 3).reverse();
    return { rank: HAND_RANKS['Pair'], name: 'Pair', score: [1, pairValue, ...kickers], best: cards.slice() };
  }

  return { rank: HAND_RANKS['High Card'], name: 'High Card', score: [0, ...values.slice().reverse()], best: cards.slice() };
}

function evaluatePokerHand(cards) {
  const normalized = cards.map((card) => String(card).trim());
  if (normalized.length < 5) {
    return { rank: 0, name: 'High Card', score: [0], best: [] };
  }

  let best = null;
  const picks = normalized.length > 5 ? chooseCombinations(normalized, 5) : [normalized];

  for (const combo of picks) {
    const current = evaluateFiveCards(combo);
    if (!best || compareHandScore(current.score, best.score) > 0) {
      best = current;
    }
  }

  return best;
}

function sanitizeUser(user) {
  return {
    id: Number(user.id),
    username: user.username,
    avatar: user.avatar || '🎲',
    chips: Number(user.chips || 0),
    created_at: user.created_at
  };
}

function createBlackjackTable(id = `bj-${Date.now()}`) {
  return {
    id,
    type: 'blackjack',
    name: `Table ${id}`,
    maxPlayers: 5,
    minPlayers: 1,
    status: 'waiting',
    players: [],
    hostId: null,
    deck: [],
    dealerCards: [],
    round: 'waiting',
    roundNumber: 0,
    betAmount: 0,
    currentTurn: -1,
    dealerRevealed: false,
    lastAction: 'En attente de joueurs.',
    recentHistory: [],
    addPlayer(player) {
      if (this.status === 'in-progress') return false;
      if (this.players.length >= this.maxPlayers) return false;
      if (this.players.some((entry) => entry.id === player.id)) return false;
      const safePlayer = {
        id: Number(player.id),
        username: player.username,
        avatar: player.avatar || '🎲',
        chips: Number(player.chips || 0),
        hand: [],
        bet: 0,
        finished: false,
        outcome: null,
        payout: 0,
        connected: true
      };
      this.players.push(safePlayer);
      if (!this.hostId) this.hostId = safePlayer.id;
      return true;
    },
    removePlayer(playerId) {
      if (this.status === 'in-progress') return null;
      const index = this.players.findIndex((player) => player.id === Number(playerId));
      if (index >= 0) {
        const [removed] = this.players.splice(index, 1);
        if (this.hostId === removed.id && this.players.length > 0) {
          this.hostId = this.players[0].id;
        }
        return removed;
      }
      return null;
    },
    startRound(betAmount) {
      const stake = Number(betAmount);
      if (this.status === 'in-progress' || !Number.isInteger(stake) || stake <= 0) return false;
      if (this.players.length < this.minPlayers || this.players.some((player) => player.chips < stake)) return false;

      this.deck = shuffleDeck(createDeck());
      this.dealerCards = [this.deck.pop(), this.deck.pop()];
      this.betAmount = stake;
      this.roundNumber += 1;
      this.round = 'player-turn';
      this.status = 'in-progress';
      this.dealerRevealed = false;

      for (const player of this.players) {
        player.chips -= stake;
        player.bet = stake;
        player.hand = [this.deck.pop(), this.deck.pop()];
        player.finished = isBlackjack(player.hand);
        player.outcome = null;
        player.payout = 0;
      }

      this.lastAction = `Manche ${this.roundNumber} démarrée avec une mise de ${stake} jetons.`;
      this.recentHistory.push(this.lastAction);
      this.currentTurn = this.players.findIndex((player) => !player.finished);

      if (isBlackjack(this.dealerCards) || this.currentTurn < 0) {
        this.settleRound();
      }
      return true;
    },
    act(playerId, action) {
      if (this.status !== 'in-progress' || !['hit', 'stand'].includes(action)) return false;
      const player = this.players[this.currentTurn];
      if (!player || player.id !== Number(playerId) || player.finished) return false;

      if (action === 'hit') {
        player.hand.push(this.deck.pop());
        const total = calculateBlackjackValue(player.hand);
        this.lastAction = total > 21
          ? `${player.username} dépasse 21 et perd la manche.`
          : `${player.username} tire une carte (${total}).`;
        if (total >= 21) player.finished = true;
      } else {
        player.finished = true;
        this.lastAction = `${player.username} reste à ${calculateBlackjackValue(player.hand)}.`;
      }

      this.recentHistory.push(this.lastAction);
      this.currentTurn = this.players.findIndex((entry) => !entry.finished);
      if (this.currentTurn < 0) this.settleRound();
      return true;
    },
    settleRound() {
      this.round = 'dealer-turn';
      this.dealerRevealed = true;
      if (!isBlackjack(this.dealerCards)) {
        while (calculateBlackjackValue(this.dealerCards) < 17) {
          this.dealerCards.push(this.deck.pop());
        }
      }

      const dealerTotal = calculateBlackjackValue(this.dealerCards);
      for (const player of this.players) {
        const playerTotal = calculateBlackjackValue(player.hand);
        const playerBlackjack = isBlackjack(player.hand);
        const dealerBlackjack = isBlackjack(this.dealerCards);
        let payout = 0;

        if (playerBlackjack && dealerBlackjack) {
          player.outcome = 'push';
          payout = player.bet;
        } else if (playerBlackjack) {
          player.outcome = 'blackjack';
          payout = Math.floor(player.bet * 2.5);
        } else if (playerTotal > 21 || dealerBlackjack) {
          player.outcome = 'loss';
        } else if (dealerTotal > 21 || playerTotal > dealerTotal) {
          player.outcome = 'win';
          payout = player.bet * 2;
        } else if (playerTotal === dealerTotal) {
          player.outcome = 'push';
          payout = player.bet;
        } else {
          player.outcome = 'loss';
        }

        player.payout = payout;
        player.chips += payout;
        player.finished = true;
      }

      this.status = 'waiting';
      this.round = 'finished';
      this.currentTurn = -1;
      this.lastAction = `Manche ${this.roundNumber} terminée. Le croupier totalise ${dealerTotal}.`;
      this.recentHistory.push(this.lastAction);
    }
  };
}

function createPokerTable(id = `poker-${Date.now()}`) {
  const table = {
    id,
    type: 'poker',
    name: `Poker ${id}`,
    maxPlayers: 8,
    minPlayers: 3,
    status: 'waiting',
    hostId: null,
    players: [],
    departedContributions: [],
    deck: [],
    board: [],
    currentBet: 0,
    pot: 0,
    round: 'waiting',
    showdownWinnerIds: [],
    currentTurn: 0,
    lastAction: 'Aucune action',
    dealerIndex: 0,
    smallBlindIndex: 0,
    bigBlindIndex: 0,
    blinds: { small: 10, big: 20 },
    recentHistory: [],
    addPlayer(player) {
      if (this.status === 'in-progress') return false;
      if (this.players.length >= this.maxPlayers) return false;
      if (this.players.some((entry) => entry.id === player.id)) return false;
      const safePlayer = {
        id: Number(player.id),
        username: player.username,
        avatar: player.avatar || '🎲',
        chips: Number(player.chips || 0),
        hand: [],
        bet: 0,
        totalContribution: 0,
        folded: false,
        allIn: false,
        connected: true,
        isDealer: false,
        isSmallBlind: false,
        isBigBlind: false
      };
      this.players.push(safePlayer);
      if (!this.hostId) this.hostId = safePlayer.id;
      return true;
    },
    removePlayer(playerId) {
      const index = this.players.findIndex((player) => player.id === Number(playerId));
      if (index < 0) return null;

      const [removed] = this.players.splice(index, 1);
      if (this.hostId === removed.id && this.players.length > 0) {
        this.hostId = this.players[0].id;
      }

      if (this.status === 'in-progress' && this.players.length > 0) {
        if (index < this.currentTurn) {
          this.currentTurn = Math.max(0, this.currentTurn - 1);
        } else if (index === this.currentTurn) {
          this.currentTurn = Math.min(this.currentTurn, this.players.length - 1);
        }
        if (this.currentTurn >= this.players.length) {
          this.currentTurn = 0;
        }
        if (this.players[this.currentTurn] && this.players[this.currentTurn].folded) {
          this.currentTurn = this.getNextLivePlayerIndex(this.currentTurn);
        }
      }

      if (this.players.length < this.minPlayers && this.status === 'in-progress') {
        this.status = 'waiting';
        this.round = 'waiting';
        this.board = [];
        this.currentBet = 0;
        this.lastAction = 'Table mise en attente.';
      }

      return removed;
    },
    leavePlayer(playerId) {
      const index = this.getPlayerIndex(playerId);
      const player = this.players[index];
      if (!player) {
        return { ok: false, message: 'Joueur introuvable dans la table.' };
      }
      if (this.status !== 'in-progress') {
        return { ok: !!this.removePlayer(playerId), removed: true, folded: false };
      }

      const wasCurrentTurn = this.players[this.currentTurn]?.id === player.id;
      const committed = Number(player.totalContribution || 0);
      this.departedContributions.push({ totalContribution: committed });
      this.players.splice(index, 1);
      if (this.hostId === player.id) {
        this.hostId = this.players[0]?.id || null;
      }
      this.lastAction = `${player.username} quitte la table et se couche.`;
      this.recentHistory.push(this.lastAction);

      if (!this.players.length) {
        this.currentTurn = 0;
        this.status = 'waiting';
        this.round = 'waiting';
        return { ok: true, removed: true, folded: true, committed };
      }

      if (index < this.currentTurn) {
        this.currentTurn -= 1;
      } else if (wasCurrentTurn) {
        this.currentTurn = (index - 1 + this.players.length) % this.players.length;
      } else if (this.currentTurn >= this.players.length) {
        this.currentTurn = 0;
      }

      if (this.resolveLastActivePlayer()) {
        return { ok: true, removed: true, folded: true, committed };
      } else if (this.isBettingRoundComplete()) {
        this.advanceStreet();
      } else if (wasCurrentTurn) {
        this.currentTurn = this.getNextActionablePlayerIndex(this.currentTurn);
      }
      return { ok: true, removed: true, folded: true, committed };
    },
    getActivePlayers() {
      return this.players.filter((player) => !player.folded && (Number(player.chips || 0) > 0 || !!player.allIn));
    },
    getActionablePlayers() {
      return this.players.filter((player) => !player.folded && Number(player.chips || 0) > 0);
    },
    getPlayerIndex(playerId) {
      return this.players.findIndex((player) => Number(player.id) === Number(playerId));
    },
    getNextActionablePlayerIndex(startIndex = this.currentTurn) {
      if (!this.players.length) {
        return 0;
      }
      for (let offset = 1; offset <= this.players.length; offset += 1) {
        const candidate = (startIndex + offset) % this.players.length;
        const player = this.players[candidate];
        if (player && !player.folded && Number(player.chips || 0) > 0) {
          return candidate;
        }
      }
      return startIndex;
    },
    buildSidePots(contenders = this.getActivePlayers()) {
      const contenderSet = new Set(contenders);
      const contributionEntries = [
        ...this.players.map((player) => ({ player, totalContribution: Number(player.totalContribution || 0) })),
        ...this.departedContributions.map((entry) => ({ player: null, totalContribution: Number(entry.totalContribution || 0) }))
      ];
      const levels = [...new Set(contributionEntries
        .map((entry) => entry.totalContribution)
        .filter((contribution) => contribution > 0))].sort((a, b) => a - b);
      const pots = [];
      let previousLevel = 0;

      for (const level of levels) {
        const contributors = contributionEntries.filter((entry) => entry.totalContribution >= level);
        const amount = (level - previousLevel) * contributors.length;
        const eligiblePlayers = contributors.map((entry) => entry.player).filter((player) => player && contenderSet.has(player));
        if (amount > 0) {
          if (eligiblePlayers.length) {
            pots.push({ amount, eligiblePlayers });
          } else if (pots.length) {
            pots[pots.length - 1].amount += amount;
          } else if (contenders.length) {
            pots.push({ amount, eligiblePlayers: contenders });
          }
        }
        previousLevel = level;
      }

      const recordedPot = pots.reduce((total, pot) => total + pot.amount, 0);
      const untrackedAmount = Number(this.pot || 0) - recordedPot;
      if (untrackedAmount > 0) {
        if (pots.length) {
          pots[0].amount += untrackedAmount;
        } else if (contenders.length) {
          pots.push({ amount: untrackedAmount, eligiblePlayers: contenders });
        }
      }
      return pots;
    },
    getNextLivePlayerIndex(startIndex = this.currentTurn) {
      if (!this.players.length) {
        return 0;
      }
      for (let offset = 1; offset <= this.players.length; offset += 1) {
        const candidate = (startIndex + offset) % this.players.length;
        const player = this.players[candidate];
        if (player && !player.folded && (Number(player.chips || 0) > 0 || !!player.allIn)) {
          return candidate;
        }
      }
      return startIndex;
    },
    isBettingRoundComplete() {
      const activePlayers = this.getActivePlayers();
      if (activePlayers.length <= 1) {
        return true;
      }

      const highestBet = Math.max(...this.players.map((player) => Number(player.bet || 0)), 0);
      const actionablePlayers = this.getActionablePlayers();
      if (!actionablePlayers.length) {
        return true;
      }
      const everyoneMatched = actionablePlayers.every((player) => Number(player.bet || 0) >= highestBet);
      const everyoneActed = actionablePlayers.every((player) => player.actionTakenThisRound);
      return everyoneMatched && everyoneActed;
    },
    resolveLastActivePlayer() {
      const activePlayers = this.getActivePlayers();
      if (activePlayers.length !== 1) {
        return false;
      }

      const winner = activePlayers[0];
      const payout = Number(this.pot || 0);
      if (payout > 0) {
        winner.chips = Number(winner.chips || 0) + payout;
      }
      this.pot = 0;
      this.currentBet = 0;
      this.round = 'showdown';
      this.status = 'waiting';
      this.currentTurn = this.getPlayerIndex(winner.id);
      this.showdownWinnerIds = [winner.id];
      this.lastAction = `${winner.username} remporte le pot après les abandons.`;
      this.recentHistory.push(this.lastAction);
      return true;
    },
    resolveShowdownWinner() {
      const contenders = this.getActivePlayers();
      if (!contenders.length) {
        this.pot = 0;
        this.round = 'showdown';
        this.status = 'waiting';
        this.showdownWinnerIds = [];
        this.lastAction = 'Showdown terminé sans gagnant.';
        this.recentHistory.push(this.lastAction);
        return [];
      }

      const evaluations = new Map();
      for (const player of contenders) {
        const hand = [...(this.board || []), ...(player.hand || [])];
        evaluations.set(player, evaluatePokerHand(hand));
      }

      const pots = this.buildSidePots(contenders);
      if (!pots.length) {
        this.pot = 0;
        this.round = 'showdown';
        this.status = 'waiting';
        this.showdownWinnerIds = [];
        this.lastAction = 'Showdown terminé sans gagnant.';
        this.recentHistory.push(this.lastAction);
        return [];
      }

      const payouts = new Map();
      const handNames = new Set();
      for (const pot of pots) {
        let bestScore = null;
        let winners = [];
        for (const player of pot.eligiblePlayers) {
          const evaluation = evaluations.get(player);
          if (!bestScore || compareHandScore(evaluation.score, bestScore.score) > 0) {
            bestScore = evaluation;
            winners = [player];
          } else if (compareHandScore(evaluation.score, bestScore.score) === 0) {
            winners.push(player);
          }
        }

        if (!winners.length) {
          continue;
        }
        handNames.add(bestScore.name);
        const splitValue = Math.floor(pot.amount / winners.length);
        const remainder = pot.amount % winners.length;
        winners.sort((first, second) => {
          const firstDistance = (this.getPlayerIndex(first.id) - this.dealerIndex + this.players.length) % this.players.length || this.players.length;
          const secondDistance = (this.getPlayerIndex(second.id) - this.dealerIndex + this.players.length) % this.players.length || this.players.length;
          return firstDistance - secondDistance;
        });
        winners.forEach((player, index) => {
          const gain = splitValue + (index < remainder ? 1 : 0);
          player.chips = Number(player.chips || 0) + gain;
          payouts.set(player, (payouts.get(player) || 0) + gain);
        });
      }

      const winners = [...payouts.keys()];

      this.pot = 0;
      this.currentBet = 0;
      this.round = 'showdown';
      this.status = 'waiting';
      this.currentTurn = this.getPlayerIndex(winners[0].id);
      this.showdownWinnerIds = winners.map((player) => player.id);

      if (winners.length > 1) {
        this.lastAction = `${winners.map((player) => player.username).join(', ')} se partagent les pots (${[...handNames].join(', ')}).`;
      } else {
        this.lastAction = `${winners[0].username} remporte ${pots.length > 1 ? 'les pots' : 'le pot'} avec ${[...handNames].join(', ')}.`;
      }
      this.recentHistory.push(this.lastAction);
      return winners;
    },
    resetActionsAfterRaise(actingPlayer, previousBet) {
      if (this.currentBet <= previousBet) {
        return;
      }
      this.players.forEach((player) => {
        if (player.id !== actingPlayer.id && !player.folded && Number(player.chips || 0) > 0) {
          player.actionTakenThisRound = false;
        }
      });
    },
    finalizeAction(player) {
      player.actionTakenThisRound = true;
      if (this.resolveLastActivePlayer()) {
        return;
      }
      if (this.isBettingRoundComplete()) {
        this.advanceStreet();
        return;
      }
      this.currentTurn = this.getNextActionablePlayerIndex(this.currentTurn);
    },
    startRound() {
      if (this.status === 'in-progress' || !canStartPokerTable(this)) {
        return false;
      }

      this.status = 'in-progress';
      this.round = 'pre-flop';
      this.showdownWinnerIds = [];
      this.board = [];
      this.currentBet = 0;
      this.pot = 0;
      this.departedContributions = [];
      this.recentHistory = [];
      this.deck = shuffleDeck(createDeck());

      this.players.forEach((player) => {
        player.hand = [this.deck.pop(), this.deck.pop()];
        player.bet = 0;
        player.totalContribution = 0;
        player.folded = false;
        player.allIn = false;
        player.actionTakenThisRound = false;
        player.isDealer = false;
        player.isSmallBlind = false;
        player.isBigBlind = false;
      });

      this.dealerIndex = this.players.length ? (this.dealerIndex + 1) % this.players.length : 0;
      this.smallBlindIndex = this.players.length ? (this.dealerIndex + 1) % this.players.length : 0;
      this.bigBlindIndex = this.players.length ? (this.smallBlindIndex + 1) % this.players.length : 0;
      this.players[this.dealerIndex].isDealer = true;
      this.players[this.smallBlindIndex].isSmallBlind = true;
      this.players[this.bigBlindIndex].isBigBlind = true;

      const smallBlindPlayer = this.players[this.smallBlindIndex];
      const bigBlindPlayer = this.players[this.bigBlindIndex];
      if (smallBlindPlayer) {
        const smallBlind = Math.min(Number(smallBlindPlayer.chips || 0), this.blinds.small);
        smallBlindPlayer.chips -= smallBlind;
        smallBlindPlayer.bet = smallBlind;
        smallBlindPlayer.totalContribution = smallBlind;
        smallBlindPlayer.allIn = smallBlindPlayer.chips === 0;
        smallBlindPlayer.actionTakenThisRound = false;
        this.pot += smallBlind;
      }
      if (bigBlindPlayer) {
        const bigBlind = Math.min(Number(bigBlindPlayer.chips || 0), this.blinds.big);
        bigBlindPlayer.chips -= bigBlind;
        bigBlindPlayer.bet = bigBlind;
        bigBlindPlayer.totalContribution = bigBlind;
        bigBlindPlayer.allIn = bigBlindPlayer.chips === 0;
        bigBlindPlayer.actionTakenThisRound = false;
        this.pot += bigBlind;
      }

      this.currentBet = Math.max(smallBlindPlayer?.bet || 0, bigBlindPlayer?.bet || 0);
      this.currentTurn = this.getNextActionablePlayerIndex(this.bigBlindIndex);
      this.lastAction = 'La main démarre.';
      return true;
    },
    advanceStreet() {
      if (this.round === 'pre-flop') {
        this.round = 'flop';
        while (this.board.length < 3) {
          this.board.push(this.deck.pop());
        }
        this.currentBet = 0;
        this.players.forEach((player) => {
          player.bet = 0;
          player.actionTakenThisRound = false;
        });
        this.lastAction = 'Flop.';
        this.recentHistory.push(this.lastAction);
        this.currentTurn = this.getNextActionablePlayerIndex(this.bigBlindIndex);
        if (this.getActionablePlayers().length <= 1) this.advanceStreet();
        return;
      }
      if (this.round === 'flop') {
        this.round = 'turn';
        if (this.board.length < 4) {
          this.board.push(this.deck.pop());
        }
        this.currentBet = 0;
        this.players.forEach((player) => {
          player.bet = 0;
          player.actionTakenThisRound = false;
        });
        this.lastAction = 'Turn.';
        this.recentHistory.push(this.lastAction);
        this.currentTurn = this.getNextActionablePlayerIndex(this.bigBlindIndex);
        if (this.getActionablePlayers().length <= 1) this.advanceStreet();
        return;
      }
      if (this.round === 'turn') {
        this.round = 'river';
        if (this.board.length < 5) {
          this.board.push(this.deck.pop());
        }
        this.currentBet = 0;
        this.players.forEach((player) => {
          player.bet = 0;
          player.actionTakenThisRound = false;
        });
        this.lastAction = 'River.';
        this.recentHistory.push(this.lastAction);
        this.currentTurn = this.getNextActionablePlayerIndex(this.bigBlindIndex);
        if (this.getActionablePlayers().length <= 1) this.advanceStreet();
        return;
      }
      this.resolveShowdownWinner();
      this.lastAction = this.lastAction || 'Showdown.';
      this.recentHistory.push(this.lastAction);
    },
    applyAction(userId, type, amount = 0) {
      const playerIndex = this.getPlayerIndex(userId);
      if (playerIndex < 0) {
        return { ok: false, message: 'Joueur introuvable dans la table.' };
      }
      const player = this.players[playerIndex];
      if (this.status !== 'in-progress') {
        return { ok: false, message: 'La table n’est pas en cours.' };
      }
      if (player.folded) {
        return { ok: false, message: 'Tu as déjà quitté la main.' };
      }
      if (Number(this.players[this.currentTurn]?.id) !== Number(userId)) {
        return { ok: false, message: 'Ce n’est pas ton tour.' };
      }

      if (type === 'fold') {
        player.folded = true;
        player.actionTakenThisRound = true;
        this.lastAction = `${player.username} se couche.`;
        this.recentHistory.push(this.lastAction);
        this.finalizeAction(player);
        return { ok: true, table: tableToPublicState(this) };
      }

      if (type === 'check') {
        if (this.currentBet > Number(player.bet || 0)) {
          return { ok: false, message: 'Tu dois suivre pour continuer.' };
        }
        player.actionTakenThisRound = true;
        this.lastAction = `${player.username} check.`;
        this.recentHistory.push(this.lastAction);
        this.finalizeAction(player);
        return { ok: true, table: tableToPublicState(this) };
      }

      if (type === 'call') {
        const amountToCall = Math.max(0, Number(this.currentBet || 0) - Number(player.bet || 0));
        if (amountToCall <= 0) {
          player.actionTakenThisRound = true;
          this.lastAction = `${player.username} check.`;
          this.recentHistory.push(this.lastAction);
          this.finalizeAction(player);
          return { ok: true, table: tableToPublicState(this) };
        }

        const chipValue = Math.min(Number(player.chips || 0), amountToCall);
        player.chips = Math.max(0, Number(player.chips || 0) - chipValue);
        player.bet = Number(player.bet || 0) + chipValue;
        player.totalContribution = Number(player.totalContribution || 0) + chipValue;
        this.pot += chipValue;
        if (Number(player.chips || 0) <= 0) {
          player.allIn = true;
        }
        player.actionTakenThisRound = true;
        this.lastAction = `${player.username} suit pour ${chipValue}.`;
        this.recentHistory.push(this.lastAction);
        this.finalizeAction(player);
        return { ok: true, table: tableToPublicState(this) };
      }

      if (type === 'bet' || type === 'raise') {
        const betAmount = Math.max(0, Number(amount || 0));
        if (betAmount <= 0) {
          return { ok: false, message: 'Le montant de mise est invalide.' };
        }
        if (betAmount > Number(player.chips || 0)) {
          return { ok: false, message: 'Tu n’as pas assez de jetons.' };
        }

        const minimumRaise = Math.max(1, (this.currentBet > 0 ? this.currentBet + this.blinds.big : this.blinds.big) - Number(player.bet || 0));
        if (betAmount < minimumRaise) {
          return { ok: false, message: `Le montant doit être au moins ${minimumRaise}.` };
        }

        const previousBet = this.currentBet;
        player.chips = Math.max(0, Number(player.chips || 0) - betAmount);
        player.bet = Number(player.bet || 0) + betAmount;
        player.totalContribution = Number(player.totalContribution || 0) + betAmount;
        this.pot += betAmount;
        this.currentBet = Math.max(this.currentBet, player.bet);
        this.resetActionsAfterRaise(player, previousBet);
        if (Number(player.chips || 0) <= 0) {
          player.allIn = true;
        }
        player.actionTakenThisRound = true;
        this.lastAction = `${player.username} ${type === 'bet' ? 'mise' : 'relance'} ${betAmount}.`;
        this.recentHistory.push(this.lastAction);
        this.finalizeAction(player);
        return { ok: true, table: tableToPublicState(this) };
      }

      if (type === 'all-in') {
        const allInValue = Number(player.chips || 0);
        if (allInValue <= 0) {
          return { ok: false, message: 'Tu n’as plus de jetons.' };
        }
        const previousBet = this.currentBet;
        player.chips = 0;
        player.bet = Number(player.bet || 0) + allInValue;
        player.totalContribution = Number(player.totalContribution || 0) + allInValue;
        this.pot += allInValue;
        this.currentBet = Math.max(this.currentBet, player.bet);
        this.resetActionsAfterRaise(player, previousBet);
        player.allIn = true;
        player.actionTakenThisRound = true;
        this.lastAction = `${player.username} all-in pour ${allInValue}.`;
        this.recentHistory.push(this.lastAction);
        this.finalizeAction(player);
        return { ok: true, table: tableToPublicState(this) };
      }

      return { ok: false, message: 'Action inconnue.' };
    }
  };

  return table;
}

function canStartPokerTable(table) {
  return !!table && table.players.length >= table.minPlayers && table.players.length <= table.maxPlayers;
}

function addGameHistory(userId, gameName, bet, result, payout, net) {
  return run(
    'INSERT INTO game_history (user_id, game_name, bet, result, payout, net) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, String(gameName), Number(bet), String(result), Number(payout || 0), Number(net || 0)]
  );
}

function updateUserChips(userId, delta) {
  return getUserById(userId).then(async (user) => {
    if (!user) {
      return null;
    }
    const nextValue = Math.max(0, Number(user.chips) + Number(delta));
    await run('UPDATE users SET chips = ? WHERE id = ?', [nextValue, userId]);
    return nextValue;
  });
}

async function persistBlackjackTable(table) {
  for (const player of table.players) {
    await run('UPDATE users SET chips = ? WHERE id = ?', [player.chips, player.id]);
  }

  if (table.round !== 'finished' || table.recordedRound === table.roundNumber) {
    return;
  }

  const resultLabels = {
    blackjack: 'Blackjack',
    win: 'Victoire',
    push: 'Égalité',
    loss: 'Défaite'
  };

  for (const player of table.players) {
    await addGameHistory(
      player.id,
      'blackjack',
      player.bet,
      resultLabels[player.outcome] || 'Défaite',
      player.payout,
      player.payout - player.bet
    );
  }
  table.recordedRound = table.roundNumber;
}

function tableToPublicState(table, viewerId = null, revealBlackjackHands = false) {
  const viewer = viewerId ? Number(viewerId) : null;

  return {
    id: table.id,
    type: table.type,
    name: table.name,
    status: table.status,
    hostId: table.hostId,
    players: table.players.map((player) => {
      const isViewer = viewer !== null && Number(player.id) === Number(viewer);
      const revealHand = table.round === 'showdown' && !player.folded;
      return {
        id: player.id,
        username: player.username,
        avatar: player.avatar,
        chips: player.chips,
        connected: player.connected,
        bet: player.bet,
        hand: isViewer || revealHand || (table.type === 'blackjack' && revealBlackjackHands) ? [...(player.hand || [])] : [],
        isWinner: (table.showdownWinnerIds || []).includes(Number(player.id)),
        handCount: (player.hand || []).length,
        finished: !!player.finished,
        outcome: player.outcome || null,
        payout: Number(player.payout || 0),
        folded: !!player.folded,
        allIn: !!player.allIn,
        isDealer: !!player.isDealer,
        isSmallBlind: !!player.isSmallBlind,
        isBigBlind: !!player.isBigBlind
      };
    }),
    maxPlayers: table.maxPlayers,
    minPlayers: table.minPlayers,
    currentBet: table.currentBet || 0,
    pot: table.pot || 0,
    blinds: { ...(table.blinds || { small: 10, big: 20 }) },
    board: table.board || [],
    round: table.round || 'waiting',
    dealerIndex: table.dealerIndex ?? 0,
    smallBlindIndex: table.smallBlindIndex ?? 0,
    bigBlindIndex: table.bigBlindIndex ?? 0,
    currentTurn: table.currentTurn ?? 0,
    lastAction: table.lastAction || 'Aucune action',
    recentHistory: table.recentHistory || [],
    roundNumber: table.roundNumber || 0,
    betAmount: table.betAmount || 0,
    dealerCards: table.type === 'blackjack'
      ? (table.dealerRevealed ? [...table.dealerCards] : table.dealerCards.map((card, index) => index === 1 ? null : card))
      : [],
    dealerRevealed: !!table.dealerRevealed,
    dealerTotal: table.type === 'blackjack' && table.dealerRevealed ? calculateBlackjackValue(table.dealerCards) : null
  };
}

const blackjackTables = new Map();
const pokerTables = new Map();

async function populateUserFromSocket(socket) {
  const user = await getUserById(socket.request.session.userId);
  if (!user) {
    socket.disconnect();
    return null;
  }
  socket.data.user = sanitizeUser(user);
  return socket.data.user;
}

function emitTables(namespace, tableMap) {
  const payload = [...tableMap.values()].map(tableToPublicState);
  namespace.emit('tables:update', payload);
}

io.on('connection', async (socket) => {
  const user = await populateUserFromSocket(socket);
  if (!user) return;

  socket.emit('session:ready', { user });

  socket.on('blackjack:tables:list', () => {
    socket.emit('blackjack:tables:list', [...blackjackTables.values()].map(tableToPublicState));
  });

  socket.on('blackjack:table:create', ({ tableName } = {}) => {
    const table = createBlackjackTable();
    table.name = tableName || `Table ${table.id}`;
    if (!table.addPlayer(user)) {
      return socket.emit('blackjack:table:error', { message: 'Impossible de créer la table.' });
    }
    blackjackTables.set(table.id, table);
    socket.join(`blackjack:${table.id}`);
    emitTables(io.to(`blackjack:${table.id}`), blackjackTables);
    socket.emit('blackjack:table:joined', tableToPublicState(table));
  });

  socket.on('blackjack:table:join', ({ tableId } = {}) => {
    const table = blackjackTables.get(String(tableId));
    if (!table) {
      return socket.emit('blackjack:table:error', { message: 'Table introuvable.' });
    }
    const alreadyJoined = table.players.some((player) => player.id === Number(user.id));
    if (!alreadyJoined && !table.addPlayer(user)) {
      return socket.emit('blackjack:table:error', { message: 'La table est pleine ou tu y es déjà inscrit.' });
    }
    const joinedPlayer = table.players.find((player) => player.id === Number(user.id));
    if (joinedPlayer) joinedPlayer.connected = true;
    socket.join(`blackjack:${table.id}`);
    socket.emit('blackjack:table:update', tableToPublicState(table, user.id));
    socket.to(`blackjack:${table.id}`).emit('blackjack:table:update', tableToPublicState(table));
  });

  socket.on('poker:tables:list', () => {
    socket.emit('poker:tables:list', [...pokerTables.values()].map(tableToPublicState));
  });

  socket.on('poker:table:create', ({ tableName } = {}) => {
    const table = createPokerTable();
    table.name = tableName || `Table ${table.id}`;
    if (!table.addPlayer(user)) {
      return socket.emit('poker:table:error', { message: 'Impossible de créer la table.' });
    }
    pokerTables.set(table.id, table);
    socket.join(`poker:${table.id}`);
    emitTables(io.to(`poker:${table.id}`), pokerTables);
    socket.emit('poker:table:joined', tableToPublicState(table, user.id));
  });

  socket.on('poker:table:join', ({ tableId } = {}) => {
    const table = pokerTables.get(String(tableId));
    if (!table) {
      return socket.emit('poker:table:error', { message: 'Table introuvable.' });
    }
    if (!table.addPlayer(user)) {
      return socket.emit('poker:table:error', { message: 'La table est complète ou tu y es déjà inscrit.' });
    }
    socket.join(`poker:${table.id}`);
    io.to(`poker:${table.id}`).emit('poker:table:update', tableToPublicState(table, user.id));
  });

  socket.on('poker:table:start', ({ tableId } = {}) => {
    const table = pokerTables.get(String(tableId));
    if (!table) {
      return socket.emit('poker:table:error', { message: 'Table introuvable.' });
    }
    if (table.hostId !== user.id) {
      return socket.emit('poker:table:error', { message: 'Seul l’hôte peut lancer la partie.' });
    }
    if (table.status === 'in-progress') {
      return socket.emit('poker:table:error', { message: 'Une partie est déjà en cours.' });
    }
    if (!canStartPokerTable(table)) {
      return socket.emit('poker:table:error', { message: 'Une table de poker doit contenir entre 3 et 8 joueurs.' });
    }
    if (!table.startRound()) {
      return socket.emit('poker:table:error', { message: 'Impossible de démarrer une nouvelle main.' });
    }
    io.to(`poker:${table.id}`).emit('poker:table:update', tableToPublicState(table, user.id));
  });

  socket.on('poker:table:action', ({ tableId, action, amount } = {}) => {
    const table = pokerTables.get(String(tableId));
    if (!table) {
      return socket.emit('poker:table:error', { message: 'Table introuvable.' });
    }
    const result = table.applyAction(user.id, action, Number(amount || 0));
    if (!result.ok) {
      return socket.emit('poker:table:error', { message: result.message });
    }
    io.to(`poker:${table.id}`).emit('poker:table:update', tableToPublicState(table, user.id));
  });

  socket.on('poker:table:leave', ({ tableId } = {}) => {
    const table = pokerTables.get(String(tableId));
    if (!table) {
      return socket.emit('poker:table:error', { message: 'Table introuvable.' });
    }

    const result = table.leavePlayer(user.id);
    if (result.ok) {
      if (result.committed > 0) {
        updateUserChips(user.id, -result.committed).catch(() => {});
      }
      socket.leave(`poker:${table.id}`);
      io.to(`poker:${table.id}`).emit('poker:table:update', tableToPublicState(table));
      socket.emit('poker:table:left', { tableId: table.id, folded: result.folded, committed: result.committed });
    }
  });

  socket.on('disconnect', () => {
    const playerId = socket.data.user?.id;
    if (!playerId) return;
    for (const table of blackjackTables.values()) {
      const player = table.players.find((entry) => entry.id === playerId);
      if (player) {
        player.connected = false;
      }
    }
    for (const table of pokerTables.values()) {
      const player = table.players.find((entry) => entry.id === playerId);
      if (player) {
        player.connected = false;
      }
    }
  });
});

async function initDatabase() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      avatar TEXT DEFAULT '🎲',
      chips INTEGER DEFAULT 1000,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS game_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      game_name TEXT NOT NULL,
      bet INTEGER NOT NULL,
      result TEXT NOT NULL,
      payout INTEGER NOT NULL,
      net INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  const count = await get('SELECT COUNT(*) AS total FROM users');
  if ((count?.total || 0) === 0) {
    const adminUsername = process.env.ADMIN_USERNAME || (IS_PRODUCTION ? '' : 'admin');
    const adminPassword = process.env.ADMIN_PASSWORD || (IS_PRODUCTION ? '' : 'admin123');
    if (!adminUsername || !adminPassword) {
      console.log('Aucun administrateur initial défini; crée le premier compte depuis le site.');
      return;
    }

    const passwordHash = await bcrypt.hash(adminPassword, 10);
    await run(
      'INSERT INTO users (username, password_hash, avatar, chips) VALUES (?, ?, ?, 1500)',
      [adminUsername, passwordHash, '🕶️']
    );
    console.log(`Compte administrateur initial créé : ${adminUsername}`);
  }
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Connexion requise.' });
  }
  next();
}

async function getUserById(userId) {
  return get('SELECT id, username, avatar, chips, created_at FROM users WHERE id = ?', [userId]);
}

app.use(express.static(GAME_DIR, { index: false }));
app.use('/auth-assets', express.static(AUTH_DIR));

app.get('/', (req, res) => {
  if (req.session.userId) {
    res.sendFile(path.join(GAME_DIR, 'index.html'));
    return;
  }
  res.sendFile(path.join(AUTH_DIR, 'auth.html'));
});

app.get('/game', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/');
  }
  res.sendFile(path.join(GAME_DIR, 'index.html'));
});

app.get('/poker/game/:tableId', requireAuth, (req, res) => {
  const table = pokerTables.get(String(req.params.tableId));
  if (!table) {
    return res.redirect('/game');
  }
  const isParticipant = table.players.some((player) => Number(player.id) === Number(req.session.userId));
  if (!isParticipant) {
    return res.redirect('/game');
  }
  res.sendFile(path.join(GAME_DIR, 'poker-game.html'));
});

app.get('/blackjack/game/:tableId', requireAuth, (req, res) => {
  const table = blackjackTables.get(String(req.params.tableId));
  if (!table || !table.players.some((player) => Number(player.id) === Number(req.session.userId))) {
    return res.redirect('/game');
  }
  res.sendFile(path.join(GAME_DIR, 'blackjack-game.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'API Underground en ligne.' });
});

app.get('/api/session', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ authenticated: false });
  }

  const user = await getUserById(req.session.userId);
  res.json({ authenticated: true, user });
});

app.post('/api/register', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!username || username.length < 3) {
    return res.status(400).json({ error: 'Le pseudo doit contenir au moins 3 caractères.' });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 4 caractères.' });
  }

  try {
    const existing = await get('SELECT id FROM users WHERE username = ?', [username]);
    if (existing) {
      return res.status(409).json({ error: 'Ce pseudo est déjà utilisé.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const created = await run(
      'INSERT INTO users (username, password_hash, avatar, chips) VALUES (?, ?, ?, 1000)',
      [username, passwordHash, '🎲']
    );

    req.session.userId = created.id;
    const user = await getUserById(created.id);
    return res.status(201).json({ ok: true, user });
  } catch (error) {
    console.error('Erreur register:', error);
    return res.status(500).json({ error: 'Erreur lors de l’inscription.' });
  }
});

app.post('/api/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!username || !password) {
    return res.status(400).json({ error: 'Pseudo et mot de passe requis.' });
  }

  try {
    const user = await get('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) {
      return res.status(404).json({ error: 'Compte introuvable.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Mot de passe incorrect.' });
    }

    req.session.userId = user.id;
    return res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        chips: user.chips,
        created_at: user.created_at
      }
    });
  } catch (error) {
    console.error('Erreur login:', error);
    return res.status(500).json({ error: 'Erreur lors de la connexion.' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true, message: 'Déconnecté.' });
  });
});

app.get('/api/me', requireAuth, async (req, res) => {
  const user = await getUserById(req.session.userId);
  const stats = await get(`
    SELECT COUNT(*) AS gamesPlayed,
      SUM(CASE WHEN net > 0 THEN 1 ELSE 0 END) AS wins,
      COALESCE(MAX(payout), 0) AS bestWin,
      MAX(created_at) AS lastPlayed
    FROM game_history WHERE user_id = ?
  `, [req.session.userId]);
  res.json({
    user,
    stats: {
      gamesPlayed: Number(stats.gamesPlayed || 0),
      wins: Number(stats.wins || 0),
      bestWin: Number(stats.bestWin || 0),
      lastPlayed: stats.lastPlayed || null
    }
  });
});

app.patch('/api/profile', requireAuth, async (req, res) => {
  const avatar = String(req.body.avatar || '');
  if (!avatar || avatar.length > 16) {
    return res.status(400).json({ error: 'Avatar invalide.' });
  }

  await run('UPDATE users SET avatar = ? WHERE id = ?', [avatar, req.session.userId]);
  res.json({ ok: true, user: await getUserById(req.session.userId) });
});

app.get('/api/history', requireAuth, async (req, res) => {
  const rows = await all(
    'SELECT * FROM game_history WHERE user_id = ? ORDER BY id DESC LIMIT 50',
    [req.session.userId]
  );
  res.json({ history: rows });
});

app.get('/api/leaderboard', async (req, res) => {
  const rows = await all(`
    SELECT u.username, u.avatar, u.chips,
      (SELECT COUNT(*) FROM game_history gh WHERE gh.user_id = u.id AND gh.net > 0) AS wins,
      (SELECT COUNT(*) FROM game_history gh WHERE gh.user_id = u.id) AS games_played,
      (SELECT MAX(payout) FROM game_history gh WHERE gh.user_id = u.id) AS best_win
    FROM users u
    ORDER BY u.chips DESC, wins DESC
    LIMIT 10
  `);
  res.json({ leaderboard: rows });
});

app.get('/api/blackjack/tables', requireAuth, (req, res) => {
  res.json({ tables: [...blackjackTables.values()].map((table) => tableToPublicState(table, req.session.userId)) });
});

app.get('/api/blackjack/tables/:id', requireAuth, (req, res) => {
  const table = blackjackTables.get(String(req.params.id));
  if (!table) {
    return res.status(404).json({ error: 'Table introuvable.' });
  }
  if (!table.players.some((player) => Number(player.id) === Number(req.session.userId))) {
    return res.status(403).json({ error: 'Tu n’as pas accès à cette table.' });
  }
  res.json({ table: tableToPublicState(table, req.session.userId, true) });
});

app.get('/api/poker/tables', requireAuth, (req, res) => {
  res.json({ tables: [...pokerTables.values()].map((table) => tableToPublicState(table, req.session.userId)) });
});

app.get('/api/poker/tables/:id', requireAuth, (req, res) => {
  const table = pokerTables.get(String(req.params.id));
  if (!table) {
    return res.status(404).json({ error: 'Table introuvable.' });
  }
  const isParticipant = table.players.some((player) => Number(player.id) === Number(req.session.userId));
  if (!isParticipant) {
    return res.status(403).json({ error: 'Tu n’as pas accès à cette table.' });
  }
  res.json({ table: tableToPublicState(table, req.session.userId) });
});

app.post('/api/blackjack/tables', requireAuth, async (req, res) => {
  const { tableName } = req.body || {};
  const table = createBlackjackTable();
  table.name = tableName || `Table ${table.id}`;
  const user = await getUserById(req.session.userId);
  if (!user || !table.addPlayer(user)) {
    return res.status(400).json({ error: 'Impossible de créer la table.' });
  }
  blackjackTables.set(table.id, table);
  res.status(201).json({ table: tableToPublicState(table, req.session.userId) });
});

app.post('/api/poker/tables', requireAuth, async (req, res) => {
  const { tableName } = req.body || {};
  const table = createPokerTable();
  table.name = tableName || `Table ${table.id}`;
  const user = await getUserById(req.session.userId);
  if (!user || !table.addPlayer(user)) {
    return res.status(400).json({ error: 'Impossible de créer la table.' });
  }
  pokerTables.set(table.id, table);
  res.status(201).json({ table: tableToPublicState(table, req.session.userId) });
});

app.post('/api/blackjack/tables/:id/join', requireAuth, async (req, res) => {
  const table = blackjackTables.get(String(req.params.id));
  if (!table) {
    return res.status(404).json({ error: 'Table introuvable.' });
  }
  const user = await getUserById(req.session.userId);
  if (!user) {
    return res.status(404).json({ error: 'Utilisateur introuvable.' });
  }
  if (!table.addPlayer(user)) {
    return res.status(400).json({ error: 'Impossible de rejoindre cette table.' });
  }
  io.to(`blackjack:${table.id}`).emit('blackjack:table:update', tableToPublicState(table));
  res.json({ table: tableToPublicState(table, req.session.userId, true) });
});

app.post('/api/blackjack/tables/:id/start', requireAuth, async (req, res) => {
  const table = blackjackTables.get(String(req.params.id));
  if (!table) {
    return res.status(404).json({ error: 'Table introuvable.' });
  }
  if (Number(table.hostId) !== Number(req.session.userId)) {
    return res.status(403).json({ error: 'Seul l’hôte peut lancer la manche.' });
  }

  for (const player of table.players) {
    const user = await getUserById(player.id);
    if (!user) {
      return res.status(404).json({ error: 'Un joueur de la table est introuvable.' });
    }
    player.chips = Number(user.chips);
  }

  const betAmount = Number(req.body?.betAmount);
  if (!table.startRound(betAmount)) {
    return res.status(400).json({ error: 'Mise invalide, table en cours ou solde insuffisant pour tous les joueurs.' });
  }

  await persistBlackjackTable(table);
  io.to(`blackjack:${table.id}`).emit('blackjack:table:update', tableToPublicState(table));
  res.json({ table: tableToPublicState(table, req.session.userId, true) });
});

app.post('/api/blackjack/tables/:id/action', requireAuth, async (req, res) => {
  const table = blackjackTables.get(String(req.params.id));
  if (!table) {
    return res.status(404).json({ error: 'Table introuvable.' });
  }
  if (!table.players.some((player) => Number(player.id) === Number(req.session.userId))) {
    return res.status(403).json({ error: 'Tu n’es pas dans cette table.' });
  }
  const action = String(req.body?.action || '').toLowerCase();
  if (!table.act(req.session.userId, action)) {
    return res.status(400).json({ error: 'Action invalide ou ce n’est pas ton tour.' });
  }

  await persistBlackjackTable(table);
  io.to(`blackjack:${table.id}`).emit('blackjack:table:update', tableToPublicState(table));
  res.json({ table: tableToPublicState(table, req.session.userId, true) });
});

app.post('/api/blackjack/tables/:id/leave', requireAuth, (req, res) => {
  const table = blackjackTables.get(String(req.params.id));
  if (!table) {
    return res.status(404).json({ error: 'Table introuvable.' });
  }
  const removed = table.removePlayer(req.session.userId);
  if (!removed) {
    return res.status(400).json({ error: 'Impossible de quitter une manche en cours ou cette table.' });
  }
  if (!table.players.length) {
    blackjackTables.delete(table.id);
  } else {
    io.to(`blackjack:${table.id}`).emit('blackjack:table:update', tableToPublicState(table));
  }
  res.json({ ok: true });
});

app.post('/api/poker/tables/:id/join', requireAuth, async (req, res) => {
  const table = pokerTables.get(String(req.params.id));
  if (!table) {
    return res.status(404).json({ error: 'Table introuvable.' });
  }
  const user = await getUserById(req.session.userId);
  if (!user) {
    return res.status(404).json({ error: 'Utilisateur introuvable.' });
  }
  if (table.status === 'in-progress') {
    return res.status(400).json({ error: 'Cette table est déjà en cours.' });
  }
  if (!table.addPlayer(user)) {
    return res.status(400).json({ error: 'Impossible de rejoindre cette table.' });
  }
  res.json({ table: tableToPublicState(table, req.session.userId) });
});

app.post('/api/poker/tables/:id/start', requireAuth, async (req, res) => {
  const table = pokerTables.get(String(req.params.id));
  if (!table) {
    return res.status(404).json({ error: 'Table introuvable.' });
  }
  if (table.hostId !== req.session.userId) {
    return res.status(403).json({ error: 'Seul l’hôte peut lancer la partie.' });
  }
  if (table.status === 'in-progress') {
    return res.status(400).json({ error: 'Une partie est déjà en cours.' });
  }
  if (!canStartPokerTable(table)) {
    return res.status(400).json({ error: 'Une table doit contenir au moins 3 joueurs.' });
  }
  if (!table.startRound()) {
    return res.status(400).json({ error: 'Impossible de démarrer une nouvelle main.' });
  }
  res.json({ ok: true, table: tableToPublicState(table, req.session.userId) });
});

app.post('/api/poker/tables/:id/action', requireAuth, async (req, res) => {
  const table = pokerTables.get(String(req.params.id));
  if (!table) {
    return res.status(404).json({ error: 'Table introuvable.' });
  }

  const action = String(req.body.action || '').toLowerCase();
  const amount = Number(req.body.amount || 0);
  const result = table.applyAction(req.session.userId, action, amount);
  if (!result.ok) {
    return res.status(400).json({ error: result.message });
  }

  res.json({ ok: true, table: tableToPublicState(table, req.session.userId) });
});

app.post('/api/poker/tables/:id/leave', requireAuth, async (req, res) => {
  const table = pokerTables.get(String(req.params.id));
  if (!table) {
    return res.status(404).json({ error: 'Table introuvable.' });
  }

  const player = table.players.find((entry) => entry.id === Number(req.session.userId));
  if (!player) {
    return res.status(404).json({ error: 'Tu n’es pas dans cette table.' });
  }

  const result = table.leavePlayer(req.session.userId);
  if (!result.ok) {
    return res.status(400).json({ error: result.message || 'Impossible de quitter la table.' });
  }
  if (result.committed > 0) {
    await updateUserChips(req.session.userId, -result.committed);
  }

  io.to(`poker:${table.id}`).emit('poker:table:update', tableToPublicState(table));
  res.json({ ok: true, table: tableToPublicState(table, req.session.userId), folded: result.folded, committed: result.committed });
});

app.post('/api/result', requireAuth, async (req, res) => {
  const { game, bet, result, payout, net } = req.body || {};

  if (!game || !Number.isFinite(Number(bet))) {
    return res.status(400).json({ error: 'Payload invalide.' });
  }

  const user = await getUserById(req.session.userId);
  if (!user) {
    return res.status(404).json({ error: 'Utilisateur introuvable.' });
  }

  const newChips = user.chips + Number(net || 0);

  await addGameHistory(req.session.userId, game, bet, result, payout, net);
  await run('UPDATE users SET chips = ? WHERE id = ?', [Math.max(newChips, 0), req.session.userId]);

  const updated = await getUserById(req.session.userId);
  res.json({ ok: true, user: updated });
});

app.post('/api/reset', requireAuth, async (req, res) => {
  await run('UPDATE users SET chips = 1000, avatar = ? WHERE id = ?', ['🎲', req.session.userId]);
  await run('DELETE FROM game_history WHERE user_id = ?', [req.session.userId]);
  const updated = await getUserById(req.session.userId);
  res.json({ ok: true, user: updated });
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Route API introuvable.' });
  }
  res.sendFile(path.join(GAME_DIR, 'index.html'));
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Serveur démarré sur http://${HOST}:${PORT}`);
  });
}

module.exports = {
  app,
  server,
  io,
  createDeck,
  shuffleDeck,
  calculateBlackjackValue,
  createBlackjackTable,
  createPokerTable,
  canStartPokerTable,
  evaluatePokerHand,
  tableToPublicState,
  addGameHistory,
  updateUserChips,
  getUserById,
  HAND_RANKS
};
