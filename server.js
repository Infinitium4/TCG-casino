const { MAX_MONEY, isMoney, toCents, roundMoney, moneyRatio } = require('./underground/js/money');
  const { initializeClickerSchema, registerClickerRoutes } = require('./clicker');
  const { initializeRegistrationCaptcha, createRegistrationCaptcha } = require('./registration-captcha');
  const express = require('express');
  const { rateLimit } = require('express-rate-limit');
  const http = require('http');
  const session = require('express-session');
  const bcrypt = require('bcryptjs');
  const { createPasswordService } = require('./password-service');
  const passwordService = createPasswordService();
  const sqlite3 = require('sqlite3').verbose();
  const path = require('path');
  const fs = require('fs');
  const crypto = require('crypto');
  const { AsyncLocalStorage } = require('async_hooks');
  const { Server } = require('socket.io');
  const SQLiteStore = require('connect-sqlite3')(session);
  const { initializePlinkoSchema, registerPlinkoRoutes } = require('./plinko');
  const { initializeDiceSchema, registerDiceRoutes } = require('./dice');
  const { initializeMinesSchema, registerMinesRoutes } = require('./mines');
  const { initializeHorseRacingSchema, registerHorseRacingRoutes } = require('./horse-racing');
  const { initializeTowerSchema, registerTowerRoutes } = require('./tower');
  const { initializeScreenTimeSchema, registerScreenTimeRoutes } = require('./screen-time');
  const { registerFps } = require('./fps');
  const { initializeFpsShopSchema, registerFpsShop } = require('./fps-shop');
  const { initializeGeneralChatSchema, registerGeneralChat } = require('./general-chat');
  const { registerPlatformMaintenance } = require('./platform-maintenance');

  const app = express();
  const server = http.createServer(app);
  const IS_PRODUCTION = process.env.NODE_ENV === 'production';
  const PORT = Number(process.env.PORT || 5500);
  const HOST = process.env.HOST || (IS_PRODUCTION ? '127.0.0.1' : '0.0.0.0');
  const DATA_DIR = path.resolve(process.env.DATA_DIR || __dirname);
  const DB_PATH = path.join(DATA_DIR, 'database.sqlite');
  const SESSION_SECRET = process.env.SESSION_SECRET || (IS_PRODUCTION ? '' : 'underground-local-development-secret');
  const REGISTRATION_RATE_WINDOW_MS = Number(process.env.REGISTRATION_RATE_WINDOW_MS || 15 * 60 * 1000);
  const REGISTRATION_RATE_LIMIT = Number(process.env.REGISTRATION_RATE_LIMIT || 30);
  const REGISTRATION_CAPTCHA_RATE_LIMIT = Number(process.env.REGISTRATION_CAPTCHA_RATE_LIMIT || 60);
  const PRIMARY_ADMIN_USERNAME = process.env.ADMIN_USERNAME || (IS_PRODUCTION ? '' : 'admin');
  const CRASH_ENABLED = process.env.CRASH_ENABLED !== 'false';
  const CRASH_TEST_MODE = process.env.NODE_ENV === 'test';
  const CRASH_BETTING_WINDOW_MS = 1000;
  const CRASH_TIME_SCALE_MS = CRASH_TEST_MODE ? 500 : 12000;
  const CRASH_MAX_BET = 1_000_000;
  const MAX_CHIPS = MAX_MONEY;
  const GAME_DEFAULTS = {
    tower: { enabled: true, minBet: 0.01, maxBet: 1_000_000 },
    horses: { enabled: true, minBet: 0.01, maxBet: 1_000_000 },
    plinko: { enabled: true, minBet: 0.01, maxBet: 1_000_000 },
    dice: { enabled: true, minBet: 0.01, maxBet: 1_000_000 },
    mines: { enabled: true, minBet: 0.01, maxBet: 1_000_000 },
    roulette: { enabled: true, minBet: 0.01, maxBet: 1_000_000 },
    blackjack: { enabled: true, minBet: 0.01, maxBet: 1_000_000 },
    poker: { enabled: true, minBet: 0.01, maxBet: 1_000_000 },
    slots: { enabled: true, minBet: 0.01, maxBet: 1_000_000 },
    crash: { enabled: CRASH_ENABLED, minBet: 0.01, maxBet: CRASH_MAX_BET },
  };

  if (IS_PRODUCTION && SESSION_SECRET.length < 32) {
    throw new Error('En production, SESSION_SECRET doit contenir au moins 32 caractères.');
  }
  if (!Number.isInteger(REGISTRATION_RATE_WINDOW_MS) || REGISTRATION_RATE_WINDOW_MS < 60_000 ||
      !Number.isInteger(REGISTRATION_RATE_LIMIT) || REGISTRATION_RATE_LIMIT < 1 ||
      !Number.isInteger(REGISTRATION_CAPTCHA_RATE_LIMIT) || REGISTRATION_CAPTCHA_RATE_LIMIT < 1) {
    throw new Error('Les limites de requêtes d’inscription doivent être des entiers positifs et la fenêtre doit durer au moins une minute.');
  }

  async function requireCrashEnabled(req, res, next) {
    try {
      const settings = await getGameSettings('crash');
      if (settings?.enabled && !settings.maintenance) return next();
      const activeBet = req.session.userId ? await get(
        "SELECT id FROM crash_bets WHERE user_id = ? AND status = 'active' LIMIT 1",
        [req.session.userId]
      ) : null;
      if (activeBet) return next();
      return res.status(503).json({ error: 'Le jeu Crash est temporairement indisponible.' });
    } catch (error) {
      return next(error);
    }
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

  // Public immutable code/assets do not need a session lookup or SQLite touch.
  app.get('/assets/fps/models.bin', (req, res, next) => {
    const archive = path.join(GAME_DIR, 'assets/fps/models.bin.gz');
    res.vary('Accept-Encoding');
    if (!req.acceptsEncodings('gzip') || !fs.existsSync(archive)) return next();
    res.set('Content-Encoding', 'gzip');res.type('application/octet-stream');res.sendFile(archive);
  });
  for (const directory of ['js', 'css', 'assets']) {
    app.use('/' + directory, express.static(path.join(GAME_DIR, directory), { index: false, fallthrough: true }));
  }
  app.use('/auth-assets', express.static(AUTH_DIR, { index: false }));

  const sessionStore = new SQLiteStore({
    db: 'sessions.sqlite',
    dir: DATA_DIR,
    table: 'sessions'
  });
  const sessionMiddleware = session({
    store: sessionStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7,
      sameSite: 'lax',
      secure: false
    }
  });

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(sessionMiddleware);

  let resolveDatabaseReady;
  let rejectDatabaseReady;
  const databaseReady = new Promise((resolve, reject) => {
    resolveDatabaseReady = resolve;
    rejectDatabaseReady = reject;
  });
  databaseReady.catch(() => {});

  app.use((req, res, next) => {
    databaseReady.then(() => next()).catch((error) => {
      console.error('Initialisation de la base de données impossible :', error);
      res.status(500).json({ error: 'Le service de comptes est indisponible.' });
    });
  });

  app.use((req, res, next) => maintenance.guard(req, res, next));

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

      databaseReady
        .then(() => get('SELECT is_banned, is_bank, suspended_until FROM users WHERE id = ?', [socket.request.session.userId]))
        .then((user) => {
          if (!user || user.is_banned || user.is_bank || Number(user.suspended_until || 0) > Date.now()) {
            return next(new Error('AUTH_REQUIRED'));
          }
          next();
        })
        .catch(next);
    });
  });

  const db = new sqlite3.Database(DB_PATH, (error) => {
    if (error) {
      console.error('Erreur SQLite :', error.message);
      rejectDatabaseReady(error);
      process.exit(1);
    }
    console.log('Base SQLite connectée');
    db.configure('busyTimeout', 5000);
    db.run('PRAGMA foreign_keys = ON', (pragmaError) => {
      if (pragmaError) {
        rejectDatabaseReady(pragmaError);
        return;
      }
      initDatabase().then(resolveDatabaseReady, (initializationError) => {
        console.error('Initialisation de la base de données impossible :', initializationError);
        rejectDatabaseReady(initializationError);
      });
    });
  });

  const databaseTransactionContext = new AsyncLocalStorage();
  let databaseTransactionTail = Promise.resolve();

  function waitForDatabaseTransaction() {
    return databaseTransactionContext.getStore() ? Promise.resolve() : databaseTransactionTail;
  }

  function executeRun(sql, params) {
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

  function run(sql, params = []) {
    return waitForDatabaseTransaction().then(() => executeRun(sql, params));
  }

  function executeGet(sql, params) {
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

  function get(sql, params = []) {
    return waitForDatabaseTransaction().then(() => executeGet(sql, params));
  }

  function executeAll(sql, params) {
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

  function all(sql, params = []) {
    return waitForDatabaseTransaction().then(() => executeAll(sql, params));
  }

  function withDatabaseTransaction(work) {
    if (databaseTransactionContext.getStore()) {
      return Promise.resolve().then(work);
    }
    const operation = databaseTransactionTail.then(() =>
      databaseTransactionContext.run(true, async () => {
        await executeRun('BEGIN IMMEDIATE', []);
        try {
          const result = await work();
          await executeRun('COMMIT', []);
          return result;
        } catch (error) {
          await executeRun('ROLLBACK', []).catch((rollbackError) => {
            console.error('Annulation de la transaction SQLite impossible :', rollbackError);
          });
          throw error;
        }
      })
    );
    databaseTransactionTail = operation.catch(() => {});
    return operation;
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
        if (this.status === 'in-progress' || !isMoney(stake) || stake <= 0) return false;
        if (this.players.length < this.minPlayers || this.players.some((player) => player.chips < stake)) return false;

        this.deck = shuffleDeck(createDeck());
        this.dealerCards = [this.deck.pop(), this.deck.pop()];
        this.betAmount = stake;
        this.roundNumber += 1;
        this.round = 'player-turn';
        this.status = 'in-progress';
        this.dealerRevealed = false;

        for (const player of this.players) {
          player.chips = roundMoney(player.chips - stake);
          player.bet = stake;
          player.hand = [this.deck.pop(), this.deck.pop()];
          player.finished = isBlackjack(player.hand);
          player.hands = [{ cards: player.hand, bet: stake, finished: player.finished, fromSplit: false, payout: 0, outcome: null }];
          player.activeHand = 0;
          player.outcome = null;
          player.payout = 0;
        }

        this.lastAction = `Manche ${this.roundNumber} démarrée avec une mise de ${stake} €.`;
        this.recentHistory.push(this.lastAction);
        this.currentTurn = this.players.findIndex((player) => !player.finished);

        if (isBlackjack(this.dealerCards) || this.currentTurn < 0) {
          this.settleRound();
        }
        return true;
      },
      act(playerId, action) {
        if (this.status !== 'in-progress' || !['hit', 'stand', 'double', 'split'].includes(action)) return false;
        const player = this.players[this.currentTurn];
        if (!player || player.id !== Number(playerId) || player.finished) return false;
        player.hands ||= [{ cards: player.hand, bet: player.bet, finished: false, fromSplit: false, payout: 0, outcome: null }];
        player.activeHand ||= 0;
        const hand = player.hands[player.activeHand];
        if (!hand || hand.finished) return false;
        if (action === 'double' || action === 'split') {
          if (hand.cards.length !== 2 || player.chips < hand.bet || hand.splitAces) return false;
          if (action === 'split' && (player.hands.length !== 1 || calculateBlackjackValue([hand.cards[0]]) !== calculateBlackjackValue([hand.cards[1]]))) return false;
          if (this.deck.length < (action === 'split' ? 2 : 1)) return false;
          player.chips = roundMoney(player.chips - hand.bet);
          player.bet = roundMoney(player.bet + hand.bet);
          if (action === 'double') {
            hand.bet = roundMoney(hand.bet * 2);
            hand.cards.push(this.deck.pop());
            hand.finished = true;
            this.lastAction = `${player.username} double sa mise : ${calculateBlackjackValue(hand.cards)}.`;
          } else {
            const splitAces = getCardValue(hand.cards[0]) === 14;
            player.hands = hand.cards.map(card => {
              const cards = [card, this.deck.pop()];
              return { cards, bet: hand.bet, finished: splitAces || calculateBlackjackValue(cards) === 21, fromSplit: true, splitAces, payout: 0, outcome: null };
            });
            this.lastAction = `${player.username} sépare sa paire en deux mains.`;
          }
        } else if (action === 'hit') {
          if (!this.deck.length) return false;
          hand.cards.push(this.deck.pop());
          const total = calculateBlackjackValue(hand.cards);
          hand.finished = total >= 21;
          this.lastAction = total > 21 ? `${player.username} dépasse 21.` : `${player.username} tire une carte (${total}).`;
        } else {
          hand.finished = true;
          this.lastAction = `${player.username} reste à ${calculateBlackjackValue(hand.cards)}.`;
        }

        const nextHand = player.hands.findIndex(entry => !entry.finished);
        player.finished = nextHand < 0;
        player.activeHand = nextHand < 0 ? player.activeHand : nextHand;
        player.hand = player.hands[player.activeHand].cards;

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
          player.hands ||= [{ cards: player.hand, bet: player.bet, fromSplit: false }];
          for (const hand of player.hands) {
          const playerTotal = calculateBlackjackValue(hand.cards);
          const playerBlackjack = !hand.fromSplit && isBlackjack(hand.cards);
          const dealerBlackjack = isBlackjack(this.dealerCards);
          let payout = 0;

          if (playerBlackjack && dealerBlackjack) {
            hand.outcome = 'push';
            payout = hand.bet;
          } else if (playerBlackjack) {
            hand.outcome = 'blackjack';
            payout = moneyRatio(hand.bet, 5, 2);
          } else if (playerTotal > 21 || dealerBlackjack) {
            hand.outcome = 'loss';
          } else if (dealerTotal > 21 || playerTotal > dealerTotal) {
            hand.outcome = 'win';
            payout = moneyRatio(hand.bet, 2, 1);
          } else if (playerTotal === dealerTotal) {
            hand.outcome = 'push';
            payout = hand.bet;
          } else {
            hand.outcome = 'loss';
          }

          hand.payout = payout;
          hand.finished = true;
          }
          player.payout = roundMoney(player.hands.reduce((sum, hand) => sum + hand.payout, 0));
          player.outcome = player.hands.length === 1 ? player.hands[0].outcome : player.payout > player.bet ? 'win' : player.payout === player.bet ? 'push' : 'loss';
          player.chips = roundMoney(player.chips + player.payout);
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
      blinds: { small: 0.01, big: 0.01 },
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
          const amount = roundMoney((level - previousLevel) * contributors.length);
          const eligiblePlayers = contributors.map((entry) => entry.player).filter((player) => player && contenderSet.has(player));
          if (amount > 0) {
            if (eligiblePlayers.length) {
              pots.push({ amount, eligiblePlayers });
            } else if (pots.length) {
              pots[pots.length - 1].amount = roundMoney(pots[pots.length - 1].amount + amount);
            } else if (contenders.length) {
              pots.push({ amount, eligiblePlayers: contenders });
            }
          }
          previousLevel = level;
        }

        const recordedPot = pots.reduce((total, pot) => total + pot.amount, 0);
        const untrackedAmount = roundMoney(Number(this.pot || 0) - recordedPot);
        if (untrackedAmount > 0) {
          if (pots.length) {
            pots[0].amount = roundMoney(pots[0].amount + untrackedAmount);
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
          winner.chips = roundMoney(Number(winner.chips || 0) + payout);
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
          const potCents = toCents(pot.amount);
          const splitValue = Math.floor(potCents / winners.length);
          const remainder = potCents % winners.length;
          winners.sort((first, second) => {
            const firstDistance = (this.getPlayerIndex(first.id) - this.dealerIndex + this.players.length) % this.players.length || this.players.length;
            const secondDistance = (this.getPlayerIndex(second.id) - this.dealerIndex + this.players.length) % this.players.length || this.players.length;
            return firstDistance - secondDistance;
          });
          winners.forEach((player, index) => {
            const gain = (splitValue + (index < remainder ? 1 : 0)) / 100;
            player.chips = roundMoney(Number(player.chips || 0) + gain);
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
          smallBlindPlayer.chips = roundMoney(smallBlindPlayer.chips - smallBlind);
          smallBlindPlayer.bet = smallBlind;
          smallBlindPlayer.totalContribution = smallBlind;
          smallBlindPlayer.allIn = smallBlindPlayer.chips === 0;
          smallBlindPlayer.actionTakenThisRound = false;
          this.pot = roundMoney(this.pot + smallBlind);
        }
        if (bigBlindPlayer) {
          const bigBlind = Math.min(Number(bigBlindPlayer.chips || 0), this.blinds.big);
          bigBlindPlayer.chips = roundMoney(bigBlindPlayer.chips - bigBlind);
          bigBlindPlayer.bet = bigBlind;
          bigBlindPlayer.totalContribution = bigBlind;
          bigBlindPlayer.allIn = bigBlindPlayer.chips === 0;
          bigBlindPlayer.actionTakenThisRound = false;
          this.pot = roundMoney(this.pot + bigBlind);
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
        if (['bet', 'raise'].includes(type) && (!isMoney(amount) || amount <= 0)) return { ok: false, message: 'Montant invalide.' };
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
          const amountToCall = Math.max(0, roundMoney(Number(this.currentBet || 0) - Number(player.bet || 0)));
          if (amountToCall <= 0) {
            player.actionTakenThisRound = true;
            this.lastAction = `${player.username} check.`;
            this.recentHistory.push(this.lastAction);
            this.finalizeAction(player);
            return { ok: true, table: tableToPublicState(this) };
          }

          const chipValue = Math.min(Number(player.chips || 0), amountToCall);
          player.chips = roundMoney(Math.max(0, Number(player.chips || 0) - chipValue));
          player.bet = roundMoney(Number(player.bet || 0) + chipValue);
          player.totalContribution = roundMoney(Number(player.totalContribution || 0) + chipValue);
          this.pot = roundMoney(this.pot + chipValue);
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
            return { ok: false, message: 'Tu n’as pas assez de €.' };
          }

          const minimumRaise = Math.max(0.01, roundMoney((this.currentBet > 0 ? this.currentBet + this.blinds.big : this.blinds.big) - Number(player.bet || 0)));
          if (betAmount < minimumRaise) {
            return { ok: false, message: `Le montant doit être au moins ${minimumRaise}.` };
          }

          const previousBet = this.currentBet;
          player.chips = roundMoney(Math.max(0, Number(player.chips || 0) - betAmount));
          player.bet = roundMoney(Number(player.bet || 0) + betAmount);
          player.totalContribution = roundMoney(Number(player.totalContribution || 0) + betAmount);
          this.pot = roundMoney(this.pot + betAmount);
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
            return { ok: false, message: 'Tu n’as plus de €.' };
          }
          const previousBet = this.currentBet;
          player.chips = 0;
          player.bet = roundMoney(Number(player.bet || 0) + allInValue);
          player.totalContribution = roundMoney(Number(player.totalContribution || 0) + allInValue);
          this.pot = roundMoney(this.pot + allInValue);
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
      [userId, String(gameName), roundMoney(Number(bet)), String(result), roundMoney(Number(payout || 0)), roundMoney(Number(net || 0))]
    );
  }

  function updateUserChips(userId, delta) {
    return withDatabaseTransaction(async () => {
      const user = await get('SELECT id, chips, is_bank FROM users WHERE id = ?', [userId]);
      if (!user) {
        return null;
      }
      if (user.is_bank) {
        throw new Error('Le solde du compte banque ne peut pas être modifié par une action de jeu.');
      }
      const nextValue = Math.max(0, roundMoney(Number(user.chips) + Number(delta)));
      await run('UPDATE users SET chips = ? WHERE id = ?', [nextValue, userId]);
      return nextValue;
    });
  }

  async function getBankAccount() {
    const bank = await get(`SELECT u.id, u.username, u.chips
      FROM casino_bank_accounts a JOIN users u ON u.id = a.user_id
      WHERE a.game_name = 'global' AND u.is_bank = 1`);
    if (!bank) {
      throw new Error('Compte banque introuvable. Vérifie BANK_USERNAME.');
    }
    return bank;
  }

  async function recordBankSettlement(userId, gameName, playerNet, playerUsername = null) {
    const net = Number(playerNet);
    if (!isMoney(net)) {
      throw new Error('Résultat de partie invalide pour le règlement banque.');
    }

    const bank = await getBankAccount();
    const gameBank = await get(`SELECT u.id, u.username FROM casino_bank_accounts a
      JOIN users u ON u.id = a.user_id WHERE a.game_name = ? AND u.is_bank = 1`, [String(gameName)]);
    if (!gameBank) {
      throw new Error(`Compte banque introuvable pour le jeu ${gameName}.`);
    }
    const player = playerUsername
      ? { username: playerUsername }
      : await get('SELECT username FROM users WHERE id = ?', [userId]);
    const bankDelta = -net;
    await run('UPDATE users SET chips = ROUND(chips + ?, 2) WHERE id = ? AND is_bank = 1', [bankDelta, bank.id]);
    await run('UPDATE users SET chips = ROUND(chips + ?, 2) WHERE id = ? AND is_bank = 1', [bankDelta, gameBank.id]);
    await run(`
      INSERT INTO bank_ledger (player_user_id, player_username, game_name, player_net, bank_delta)
      VALUES (?, ?, ?, ?, ?)
    `, [userId, player?.username || 'Compte supprimé', String(gameName), net, bankDelta]);
  }

  async function persistBlackjackTable(table) {
    if (table.round !== 'finished' || table.recordedRound === table.roundNumber) {
      await withDatabaseTransaction(async () => {
        for (const player of table.players) {
          await run('UPDATE users SET chips = ? WHERE id = ?', [player.chips, player.id]);
        }
      });
      return;
    }

    const resultLabels = {
      blackjack: 'Blackjack',
      win: 'Victoire',
      push: 'Égalité',
      loss: 'Défaite'
    };

    await withDatabaseTransaction(async () => {
      for (const player of table.players) {
        const net = roundMoney(player.payout - player.bet);
        await run('UPDATE users SET chips = ? WHERE id = ?', [player.chips, player.id]);
        const result = player.hands?.length > 1
          ? player.hands.map((hand, index) => `Main ${index + 1} : ${resultLabels[hand.outcome] || 'Défaite'} (mise ${hand.bet})`).join(' · ')
          : resultLabels[player.outcome] || 'Défaite';
        await addGameHistory(player.id, 'blackjack', player.bet, result, player.payout, net);
        await recordBankSettlement(player.id, 'blackjack', net, player.username);
      }
    });
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
          ...(table.type === 'blackjack' ? {
            activeHand: player.activeHand || 0,
            hands: (player.hands || []).map(hand => ({
              ...hand,
              cards: isViewer || revealBlackjackHands ? [...hand.cards] : [],
              handCount: hand.cards.length
            })),
            canDouble: table.status === 'in-progress' && table.players[table.currentTurn] === player && !player.finished && player.hand.length === 2 && !player.hands?.[player.activeHand || 0]?.splitAces && player.chips >= (player.hands?.[player.activeHand || 0]?.bet || player.bet),
            canSplit: table.status === 'in-progress' && table.players[table.currentTurn] === player && !player.finished && (player.hands?.length || 1) === 1 && player.hand.length === 2 && calculateBlackjackValue([player.hand[0]]) === calculateBlackjackValue([player.hand[1]]) && player.chips >= player.bet
          } : {}),
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
      blinds: { ...(table.blinds || { small: 0.01, big: 0.01 }) },
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

  function isUserInActiveTable(userId) {
    const id = Number(userId);
    return [...blackjackTables.values(), ...pokerTables.values()].some((table) =>
      table.status === 'in-progress' && table.players.some((player) => Number(player.id) === id)
    );
  }

  async function hasActiveCrashBet(userId) {
    return !!(await get(
      "SELECT id FROM crash_bets WHERE user_id = ? AND status = 'active' LIMIT 1",
      [userId]
    ));
  }

  async function hasActiveTowerGame(userId) {
    return !!(await get("SELECT id FROM tower_games WHERE user_id = ? AND status IN ('PLAYING', 'PLACING')", [userId]));
  }
  async function hasOtherActiveBet(userId) {
    return await hasActiveCrashBet(userId) || await hasActiveTowerGame(userId);
  }

  async function startPokerRound(table) {
    const settings = await getGameSettings('poker');
    table.blinds = { small: Math.max(0.01, moneyRatio(settings.minBet, 1, 2)), big: settings.minBet };
    return withDatabaseTransaction(async () => {
      for (const player of table.players) {
        if (await hasOtherActiveBet(player.id)) return false;
      }
      return table.startRound();
    });
  }

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

  const activeCrashRounds = new Map();
  let crashEngineTimer = null;
  let crashEngineBusy = false;

  function generateCrashMultiplier() {
    if (CRASH_TEST_MODE) return 2;
    const random = (crypto.randomBytes(4).readUInt32BE(0) + 0.5) / 0x1_0000_0000;
    const multiplier = Math.max(1, Math.floor((0.99 / (1 - random)) * 100) / 100);
    return Math.min(multiplier, 1000);
  }

  function getCrashMultiplierAt(timestamp, startedAt) {
    if (!startedAt || timestamp <= startedAt) return 1;
    return Math.floor(Math.exp((timestamp - startedAt) / CRASH_TIME_SCALE_MS) * 100) / 100;
  }

  function crashActionError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
  }

  function publicCrashRound(round, now = Date.now()) {
    const crashed = round.status === 'crashed' || now >= Number(round.crashAt);
    const running = !crashed && (round.status === 'running' || now >= Number(round.startedAt));
    const state = {
      id: round.id,
      status: crashed ? 'crashed' : running ? 'running' : 'betting',
      bettingEndsAt: round.bettingEndsAt,
      startedAt: round.startedAt,
      crashAt: round.crashAt,
      serverNow: now,
      timeScaleMs: CRASH_TIME_SCALE_MS,
      multiplier: running
        ? getCrashMultiplierAt(now, round.startedAt)
        : crashed ? round.crashMultiplier : 1
    };
    if (crashed) {
      state.crashMultiplier = round.crashMultiplier;
      state.crashedAt = round.crashedAt ?? round.crashAt;
    }
    return state;
  }

  async function createCrashRound() {
    const createdAt = Date.now();
    const startsAt = createdAt + CRASH_BETTING_WINDOW_MS;
    const crashMultiplier = generateCrashMultiplier();
    const crashAt = startsAt + Math.ceil(Math.log(crashMultiplier) * CRASH_TIME_SCALE_MS);
    const round = {
      id: crypto.randomUUID(),
      status: 'betting',
      bettingEndsAt: startsAt,
      startedAt: startsAt,
      crashAt,
      crashMultiplier,
      crashedAt: null
    };
    await run(`
      INSERT INTO crash_rounds (id, status, betting_ends_at, started_at, crash_at, crash_multiplier)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [round.id, round.status, round.bettingEndsAt, round.startedAt, round.crashAt, round.crashMultiplier]);
    return round;
  }

  function crashRoundFromRow(row) {
    return {
      id: row.id,
      status: row.status,
      bettingEndsAt: Number(row.betting_ends_at),
      startedAt: Number(row.started_at),
      crashAt: Number(row.crash_at),
      crashMultiplier: Number(row.crash_multiplier),
      crashedAt: row.crashed_at === null ? null : Number(row.crashed_at)
    };
  }

  async function getCrashState(userId) {
    if (userId !== null) {
      const overdueRound = await get(`
        SELECT r.*, b.status AS bet_status
        FROM crash_bets b
        JOIN crash_rounds r ON r.id = b.round_id
        WHERE b.user_id = ? AND b.status = 'active'
        ORDER BY b.created_at DESC, b.rowid DESC LIMIT 1
      `, [userId]);
      if (overdueRound && Date.now() >= Number(overdueRound.crash_at)) {
        await finishCrashRound(crashRoundFromRow(overdueRound));
      }
    }
    const [latestBet, history, user] = await Promise.all([
      userId === null ? Promise.resolve(null) : get(`
        SELECT r.id, r.status, r.betting_ends_at, r.started_at, r.crash_at,
          r.crash_multiplier, r.crashed_at,
          b.id AS bet_id, b.username, b.stake, b.status AS bet_status,
          b.cashout_multiplier, b.payout
        FROM crash_bets b
        JOIN crash_rounds r ON r.id = b.round_id
        WHERE b.user_id = ?
        ORDER BY b.created_at DESC, b.rowid DESC LIMIT 1
      `, [userId]),
      all(`
        SELECT r.id, r.crash_multiplier AS multiplier, r.crashed_at
        FROM crash_rounds r
        JOIN crash_bets b ON b.round_id = r.id
        WHERE r.status = 'crashed' AND b.user_id = ?
        ORDER BY r.crashed_at DESC LIMIT 12
      `, [userId]),
      userId === null ? Promise.resolve(null) : get('SELECT chips FROM users WHERE id = ?', [userId])
    ]);
    if (userId !== null && !user) {
      throw crashActionError(404, 'Compte introuvable.');
    }
    const round = latestBet ? crashRoundFromRow(latestBet) : null;
    const ownBet = latestBet ? {
      id: latestBet.bet_id,
      stake: Number(latestBet.stake),
      status: latestBet.bet_status,
      cashoutMultiplier: latestBet.cashout_multiplier === null ? null : Number(latestBet.cashout_multiplier),
      payout: Number(latestBet.payout || 0)
    } : null;
    return {
      round: round ? publicCrashRound(round) : null,
      balance: user ? Number(user.chips) : null,
      ownBet,
      bets: latestBet ? [{
        username: latestBet.username,
        stake: Number(latestBet.stake),
        status: latestBet.bet_status,
        cashoutMultiplier: latestBet.cashout_multiplier === null ? null : Number(latestBet.cashout_multiplier),
        payout: Number(latestBet.payout || 0)
      }] : [],
      history: history.map((entry) => ({
        id: entry.id,
        multiplier: Number(entry.multiplier),
        crashedAt: entry.crashed_at
      }))
    };
  }

  async function broadcastCrashState(force = false) {
    if ((!force && activeCrashRounds.size === 0) || io.engine.clientsCount === 0) return;
    const subscribers = io.sockets.adapter.rooms.get('crash:watchers');
    if (!subscribers) return;
    const states = new Map();
    for (const socketId of subscribers) {
      const socket = io.sockets.sockets.get(socketId);
      const userId = socket?.data.user?.id;
      if (userId) {
        if (!states.has(userId)) states.set(userId, await getCrashState(userId));
        socket.emit('crash:state', states.get(userId));
      }
    }
  }

  async function placeCrashBet(userId, stake) {
    const settings = await getGameSettings('crash');
    if (!isMoney(stake) || stake < settings.minBet || stake > settings.maxBet) {
      throw crashActionError(400, `La mise doit être comprise entre ${settings.minBet} et ${settings.maxBet} €.`);
    }

    const result = await withDatabaseTransaction(async () => {
      if (isUserInActiveTable(userId) || await hasActiveTowerGame(userId)) {
        throw crashActionError(409, 'Termine ta partie en cours avant de miser au Crash.');
      }
      const existing = await get(`
        SELECT b.id, b.stake, b.status, r.id AS round_id, r.status AS round_status,
          r.betting_ends_at, r.started_at, r.crash_at, r.crash_multiplier, r.crashed_at
        FROM crash_bets b
        JOIN crash_rounds r ON r.id = b.round_id
        WHERE b.user_id = ? AND b.status = 'active'
        LIMIT 1
      `, [userId]);
      if (existing) {
        if (Number(existing.stake) !== stake) {
          throw crashActionError(409, 'Termine ta partie Crash en cours avant d’en lancer une autre.');
        }
        const user = await get('SELECT chips FROM users WHERE id = ?', [userId]);
        return {
          bet: { id: existing.id, stake: Number(existing.stake), status: existing.status },
          round: crashRoundFromRow({
            id: existing.round_id,
            status: existing.round_status,
            betting_ends_at: existing.betting_ends_at,
            started_at: existing.started_at,
            crash_at: existing.crash_at,
            crash_multiplier: existing.crash_multiplier,
            crashed_at: existing.crashed_at
          }),
          balance: Number(user.chips),
          duplicate: true
        };
      }
      const user = await get('SELECT username, chips FROM users WHERE id = ?', [userId]);
      if (!user) {
        throw crashActionError(404, 'Compte introuvable.');
      }
      if (Number(user.chips) < stake) {
        throw crashActionError(400, 'Solde insuffisant pour cette mise.');
      }
      const debit = await run('UPDATE users SET chips = ROUND(chips - ?, 2) WHERE id = ? AND chips >= ?', [stake, userId, stake]);
      if (debit.changes !== 1) {
        throw crashActionError(400, 'Solde insuffisant pour cette mise.');
      }
      const round = await createCrashRound();
      const bet = {
        id: crypto.randomUUID(),
        stake,
        status: 'active'
      };
      await run(`
        INSERT INTO crash_bets (id, round_id, user_id, username, stake, status)
        VALUES (?, ?, ?, ?, ?, 'active')
      `, [bet.id, round.id, userId, user.username, stake]);
      return { bet, round, balance: roundMoney(Number(user.chips) - stake), duplicate: false };
    });
    if (!result.duplicate) {
      activeCrashRounds.set(result.round.id, result.round);
      ensureCrashEngine();
    }
    return { ...result, round: publicCrashRound(result.round) };
  }

  async function cashoutCrashBet(userId, betId) {
    if (typeof betId !== 'string' || betId.length > 36) {
      throw crashActionError(400, 'Identifiant de pari invalide.');
    }
    const receivedAt = Date.now();
    const outcome = await withDatabaseTransaction(async () => {
      const bet = await get(`
        SELECT b.id, b.round_id, b.user_id, b.username, b.stake, b.status,
          b.cashout_multiplier, b.payout, r.status AS round_status,
          r.betting_ends_at, r.started_at, r.crash_at, r.crash_multiplier, r.crashed_at
        FROM crash_bets b
        JOIN crash_rounds r ON r.id = b.round_id
        WHERE b.id = ? AND b.user_id = ?
      `, [betId, userId]);
      if (!bet) {
        throw crashActionError(404, 'Pari introuvable.');
      }
      if (bet.status === 'cashed_out') {
        const user = await get('SELECT chips FROM users WHERE id = ?', [userId]);
        return {
          bet: {
            id: bet.id,
            stake: Number(bet.stake),
            status: bet.status,
            cashoutMultiplier: Number(bet.cashout_multiplier),
            payout: Number(bet.payout)
          },
          balance: Number(user.chips),
          duplicate: true
        };
      }
      if (bet.status === 'lost') {
        throw crashActionError(409, 'Le crash a déjà eu lieu. Ta mise est perdue.');
      }
      if (bet.status !== 'active') {
        throw crashActionError(409, 'Le retrait est trop tardif ou ce pari n’est plus actif.');
      }
      if (receivedAt >= Number(bet.crash_at)) {
        await finishCrashRound(crashRoundFromRow({
          id: bet.round_id,
          status: bet.round_status,
          betting_ends_at: bet.betting_ends_at,
          started_at: bet.started_at,
          crash_at: bet.crash_at,
          crash_multiplier: bet.crash_multiplier,
          crashed_at: bet.crashed_at
        }));
        return { error: crashActionError(409, 'Le crash a déjà eu lieu. Ta mise est perdue.') };
      }
      if (bet.round_status === 'crashed' || receivedAt < Number(bet.started_at)) {
        throw crashActionError(409, 'Le retrait est trop tardif ou ce pari n’est plus actif.');
      }
      const multiplier = getCrashMultiplierAt(receivedAt, Number(bet.started_at));
      const payout = moneyRatio(Number(bet.stake), Math.round(multiplier * 100), 100);
      const net = roundMoney(payout - Number(bet.stake));
      if (!isMoney(payout) || payout < 0) {
        throw crashActionError(400, 'Le gain calculé est invalide.');
      }
      const updated = await run(`
        UPDATE crash_bets
        SET status = 'cashed_out', cashout_multiplier = ?, payout = ?, settled_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND status = 'active'
      `, [multiplier, payout, bet.id, userId]);
      if (updated.changes !== 1) {
        throw crashActionError(409, 'Ce pari a déjà été réglé.');
      }
      const credit = await run(
        'UPDATE users SET chips = ROUND(chips + ?, 2) WHERE id = ? AND chips <= ?',
        [payout, userId, MAX_CHIPS - payout]
      );
      if (credit.changes !== 1) {
        throw crashActionError(400, 'Le solde maximal serait dépassé.');
      }
      await addGameHistory(userId, 'crash', Number(bet.stake), `Retrait à ${multiplier.toFixed(2)}x`, payout, net);
      await recordBankSettlement(userId, 'crash', net, bet.username);
      const user = await get('SELECT chips FROM users WHERE id = ?', [userId]);
      return {
        bet: {
          id: bet.id,
          stake: Number(bet.stake),
          status: 'cashed_out',
          cashoutMultiplier: multiplier,
          payout
        },
        balance: Number(user.chips),
        duplicate: false
      };
    });
    if (outcome.error) throw outcome.error;
    return outcome;
  }

  async function finishCrashRound(round) {
    return withDatabaseTransaction(async () => {
      const roundUpdate = await run(`
        UPDATE crash_rounds SET status = 'crashed', crashed_at = ?
        WHERE id = ? AND status != 'crashed'
      `, [round.crashAt, round.id]);
      if (roundUpdate.changes === 0) {
        return;
      }
      const activeBets = await all(
        "SELECT id, user_id, username, stake FROM crash_bets WHERE round_id = ? AND status = 'active'",
        [round.id]
      );
      await run(`
        UPDATE crash_bets SET status = 'lost', payout = 0, settled_at = CURRENT_TIMESTAMP
        WHERE round_id = ? AND status = 'active'
      `, [round.id]);
      for (const bet of activeBets) {
        // Legacy databases may contain bets whose account has been removed.
        // Keep the bank settlement without inserting history for a missing user.
        const player = await get('SELECT id FROM users WHERE id = ?', [bet.user_id]);
        if (player) {
          await addGameHistory(player.id, 'crash', Number(bet.stake), 'Crash', 0, -Number(bet.stake));
        }
        await recordBankSettlement(player?.id ?? null, 'crash', -Number(bet.stake), bet.username);
      }
      round.status = 'crashed';
      round.crashedAt = round.crashAt;
    });
  }

  async function initializeCrashGame() {
    const savedRounds = await all(`
      SELECT DISTINCT r.* FROM crash_rounds r
      JOIN crash_bets b ON b.round_id = r.id
      WHERE r.status IN ('betting', 'running')
    `);
    for (const savedRound of savedRounds) {
      const round = crashRoundFromRow(savedRound);
      const now = Date.now();
      if (round.status === 'betting' && now >= round.startedAt) {
        await run("UPDATE crash_rounds SET status = 'running' WHERE id = ? AND status = 'betting'", [round.id]);
        round.status = 'running';
      }
      if (round.status === 'running' && now >= round.crashAt) {
        await finishCrashRound(round);
      } else {
        activeCrashRounds.set(round.id, round);
      }
    }

    ensureCrashEngine();
  }

  function ensureCrashEngine() {
    if (activeCrashRounds.size && !crashEngineTimer) {
      crashEngineTimer = setInterval(() => {
        if (crashEngineBusy) return;
        crashEngineBusy = true;
        (async () => {
          try {
            const now = Date.now();
            let finishedRound = false;
            let changed = false;
            for (const round of activeCrashRounds.values()) {
              if (round.status === 'betting' && now >= round.startedAt) {
                const started = await run(
                  "UPDATE crash_rounds SET status = 'running' WHERE id = ? AND status = 'betting'",
                  [round.id]
                );
                if (started.changes) { round.status = 'running'; changed = true; }
              }
              if (round.status === 'running' && now >= round.crashAt) {
                await finishCrashRound(round);
                activeCrashRounds.delete(round.id);
                finishedRound = true;
              }
            }
            if (changed || finishedRound) await broadcastCrashState(true);
            if (!activeCrashRounds.size) { clearInterval(crashEngineTimer); crashEngineTimer = null; }
          } catch (error) {
            console.error('Erreur du moteur Crash :', error);
          } finally {
            crashEngineBusy = false;
          }
        })();
      }, 200);
      crashEngineTimer.unref();
    }
  }

  io.on('connection', async (socket) => {
    const user = await populateUserFromSocket(socket);
    if (!user) return;

    socket.emit('session:ready', { user });
    socket.on('plinko:subscribe', () => socket.join('plinko:feed'));
    socket.on('plinko:unsubscribe', () => socket.leave('plinko:feed'));
    socket.on('crash:unsubscribe', () => socket.leave('crash:watchers'));
    socket.on('crash:sync', async (acknowledge) => {
      try {
        await databaseReady;
        const settings = await getGameSettings('crash');
        if ((!settings?.enabled || settings.maintenance) && !await hasActiveCrashBet(user.id)) {
          if (typeof acknowledge === 'function') {
            acknowledge({ ok: false, error: 'Le jeu Crash est temporairement désactivé.' });
          }
          return;
        }
        socket.join('crash:watchers');
        const state = await getCrashState(user.id);
        if (typeof acknowledge === 'function') acknowledge({ ok: true, ...state });
        socket.emit('crash:state', state);
      } catch (error) {
        if (typeof acknowledge === 'function') {
          acknowledge({ ok: false, error: error.message || 'État Crash indisponible.' });
        }
      }
    });

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

    socket.on('poker:table:start', async ({ tableId } = {}) => {
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
      try {
        if (!await startPokerRound(table)) {
          return socket.emit('poker:table:error', {
            message: 'Impossible de démarrer : un joueur a une mise Crash active ou la main est invalide.'
          });
        }
      } catch (error) {
        console.error('Erreur au démarrage d’une main de poker :', error);
        return socket.emit('poker:table:error', { message: 'Impossible de démarrer la partie.' });
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
        avatar_image TEXT,
        chips INTEGER DEFAULT 0,
        is_admin INTEGER NOT NULL DEFAULT 0,
        is_banned INTEGER NOT NULL DEFAULT 0,
        suspended_until INTEGER,
        is_bank INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const userColumns = await all('PRAGMA table_info(users)');
    if (!userColumns.some((column) => column.name === 'is_admin')) {
      await run('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
    }
    if (!userColumns.some((column) => column.name === 'is_banned')) {
      await run('ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0');
    }
    if (!userColumns.some((column) => column.name === 'suspended_until')) {
      await run('ALTER TABLE users ADD COLUMN suspended_until INTEGER');
    }
    if (!userColumns.some((column) => column.name === 'avatar_image')) {
      await run('ALTER TABLE users ADD COLUMN avatar_image TEXT');
    }
    if (!userColumns.some((column) => column.name === 'profile_design')) {
      await run("ALTER TABLE users ADD COLUMN profile_design TEXT DEFAULT '{}'");
    }
    if (!userColumns.some((column) => column.name === 'infinite_money')) {
      await run('ALTER TABLE users ADD COLUMN infinite_money INTEGER NOT NULL DEFAULT 0');
    }
    if (!userColumns.some((column) => column.name === 'finite_chips')) {
      await run('ALTER TABLE users ADD COLUMN finite_chips INTEGER');
    }
    await run(`CREATE TRIGGER IF NOT EXISTS refill_infinite_money AFTER UPDATE OF chips ON users
      WHEN NEW.infinite_money = 1 AND NEW.is_admin = 1 AND NEW.is_bank = 0 AND NEW.chips < 1000000000000
      BEGIN UPDATE users SET chips = 1000000000000 WHERE id = NEW.id; END`);
    if (!userColumns.some((column) => column.name === 'is_bank')) {
      await run('ALTER TABLE users ADD COLUMN is_bank INTEGER NOT NULL DEFAULT 0');
    }

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

    await run(`
      CREATE TABLE IF NOT EXISTS crash_rounds (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('betting', 'running', 'crashed')),
        betting_ends_at INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        crash_at INTEGER NOT NULL,
        crash_multiplier REAL NOT NULL,
        crashed_at INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS crash_bets (
        id TEXT PRIMARY KEY,
        round_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        stake INTEGER NOT NULL CHECK (stake > 0),
        status TEXT NOT NULL CHECK (status IN ('active', 'cashed_out', 'lost')),
        cashout_multiplier REAL,
        payout INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        settled_at TEXT,
        UNIQUE (round_id, user_id),
        FOREIGN KEY(round_id) REFERENCES crash_rounds(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS admin_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_user_id INTEGER NOT NULL,
        target_user_id INTEGER,
        target_username TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        amount INTEGER,
        reason TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(admin_user_id) REFERENCES users(id),
        FOREIGN KEY(target_user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS casino_game_settings (
        game TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        maintenance INTEGER NOT NULL DEFAULT 0,
        min_bet INTEGER NOT NULL DEFAULT 1,
        max_bet INTEGER NOT NULL DEFAULT 1000000,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await run(`
      CREATE TABLE IF NOT EXISTS casino_platform_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    for (const [game, defaults] of Object.entries(GAME_DEFAULTS)) {
      await run(`
        INSERT OR IGNORE INTO casino_game_settings (game, enabled, min_bet, max_bet)
        VALUES (?, ?, ?, ?)
      `, [game, defaults.enabled ? 1 : 0, defaults.minBet, defaults.maxBet]);
    }
    await withDatabaseTransaction(async () => {
      const migrated = await get("SELECT setting_value FROM casino_platform_settings WHERE setting_key = 'cent_precision_v1'");
      if (!migrated) {
        await run('UPDATE casino_game_settings SET min_bet = 0.01 WHERE min_bet = 1');
        await run("INSERT INTO casino_platform_settings (setting_key, setting_value) VALUES ('cent_precision_v1', 'done')");
      }
    });
    await initializePlinkoSchema(run);
    await initializeDiceSchema(run);
    await initializeMinesSchema(run);
    await initializeTowerSchema(run);
    await initializeClickerSchema(run);
    await initializeScreenTimeSchema(run);
    await initializeFpsShopSchema(run);
    await initializeGeneralChatSchema(run);
    await maintenance.initialize();
    await initializeRegistrationCaptcha(run, all);
    await initializeHorseRacingSchema(run);
    await run(`
      INSERT OR IGNORE INTO casino_platform_settings (setting_key, setting_value)
      VALUES ('betting_paused', '0')
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS bank_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_user_id INTEGER,
        player_username TEXT NOT NULL,
        game_name TEXT NOT NULL,
        player_net INTEGER NOT NULL,
        bank_delta INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(player_user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    await run(`
      CREATE TABLE IF NOT EXISTS casino_bank_accounts (
        game_name TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT
      )
    `);

    const auditColumns = await all('PRAGMA table_info(admin_audit)');
    const auditForeignKeys = await all('PRAGMA foreign_key_list(admin_audit)');
    const targetIdColumn = auditColumns.find((column) => column.name === 'target_user_id');
    const needsAuditMigration = !auditColumns.some((column) => column.name === 'target_username') ||
      Boolean(targetIdColumn?.notnull) ||
      auditForeignKeys.some((foreignKey) => foreignKey.from === 'target_user_id' && foreignKey.on_delete !== 'SET NULL');
    if (needsAuditMigration) {
      await withDatabaseTransaction(async () => {
        await run(`
          CREATE TABLE admin_audit_migrated (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_user_id INTEGER NOT NULL,
            target_user_id INTEGER,
            target_username TEXT NOT NULL DEFAULT '',
            action TEXT NOT NULL,
            amount INTEGER,
            reason TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(admin_user_id) REFERENCES users(id),
            FOREIGN KEY(target_user_id) REFERENCES users(id) ON DELETE SET NULL
          )
        `);
        const oldAuditColumns = new Set(auditColumns.map((column) => column.name));
        const targetUsername = oldAuditColumns.has('target_username')
          ? "COALESCE(a.target_username, u.username, '')"
          : "COALESCE(u.username, '')";
        await run(`
          INSERT INTO admin_audit_migrated
            (id, admin_user_id, target_user_id, target_username, action, amount, reason, created_at)
          SELECT a.id, a.admin_user_id, a.target_user_id, ${targetUsername},
            a.action, a.amount, a.reason, a.created_at
          FROM admin_audit a
          LEFT JOIN users u ON u.id = a.target_user_id
        `);
        await run('DROP TABLE admin_audit');
        await run('ALTER TABLE admin_audit_migrated RENAME TO admin_audit');
      });
    }

    // Match hot history lookups and active-deadline scans without changing ledger data.
    for (const sql of [
      'CREATE INDEX IF NOT EXISTS history_user_recent ON game_history(user_id,id DESC)',
      'CREATE INDEX IF NOT EXISTS crash_bets_user_recent ON crash_bets(user_id,created_at DESC)',
      "CREATE INDEX IF NOT EXISTS crash_bets_round_active ON crash_bets(round_id) WHERE status='active'",
      "CREATE INDEX IF NOT EXISTS horse_running_deadline ON horse_races(ends_at_ms) WHERE status='running'",
      "CREATE INDEX IF NOT EXISTS horse_event_deadline ON horse_events(ends_at_ms) WHERE status='running'",
      "CREATE INDEX IF NOT EXISTS tower_expiry ON tower_games(expires_at) WHERE status IN ('PLAYING','PLACING')"
    ]) await run(sql);

    const adminUsername = PRIMARY_ADMIN_USERNAME;
    const secondAdminUsername = process.env.SECOND_ADMIN_USERNAME || (IS_PRODUCTION ? '' : 'admin2');
    const bankUsername = process.env.BANK_USERNAME || 'casino-bank';
    if (adminUsername && secondAdminUsername && adminUsername.toLowerCase() === secondAdminUsername.toLowerCase()) {
      throw new Error('ADMIN_USERNAME et SECOND_ADMIN_USERNAME doivent être différents.');
    }
    if ([adminUsername, secondAdminUsername].filter(Boolean).some((username) => username.toLowerCase() === bankUsername.toLowerCase())) {
      throw new Error('BANK_USERNAME doit être différent des noms des comptes administrateurs.');
    }

    const count = await get('SELECT COUNT(*) AS total FROM users');
    if ((count?.total || 0) === 0) {
      const adminPassword = process.env.ADMIN_PASSWORD || (IS_PRODUCTION ? '' : 'admin123');
      if (!adminUsername || !adminPassword) {
        console.log('Aucun compte utilisateur. Définis ADMIN_USERNAME et ADMIN_PASSWORD pour créer le compte administrateur initial.');
      } else {
        const passwordHash = await bcrypt.hash(adminPassword, 10);
        await run(
          'INSERT INTO users (username, password_hash, avatar, chips, is_admin) VALUES (?, ?, ?, 1500, 1)',
          [adminUsername, passwordHash, '🕶️']
        );
        console.log(`Compte administrateur initial créé : ${adminUsername}`);
      }
    } else if (adminUsername) {
      const admin = await get('SELECT id, is_bank, password_hash FROM users WHERE username = ?', [adminUsername]);
      if (admin?.is_bank) {
        throw new Error('ADMIN_USERNAME correspond déjà au compte banque.');
      }
      const configuredPassword = process.env.ADMIN_PASSWORD;
      if (admin && configuredPassword && !await bcrypt.compare(configuredPassword, admin.password_hash)) {
        const passwordHash = await bcrypt.hash(configuredPassword, 10);
        await withDatabaseTransaction(async () => {
          await run('UPDATE users SET is_admin = 1, password_hash = ? WHERE id = ?', [passwordHash, admin.id]);
          await recordAdminAction(admin.id, 'admin_password_updated', 'Synchronisation de ADMIN_PASSWORD au démarrage', { userId: admin.id, username: adminUsername });
        });
        await invalidateUserSessions(admin.id);
      } else {
        await run('UPDATE users SET is_admin = 1 WHERE username = ?', [adminUsername]);
      }
    }

    if (secondAdminUsername) {
      let secondAdmin = await get('SELECT id, is_bank FROM users WHERE username = ?', [secondAdminUsername]);
      if (secondAdmin?.is_bank) {
        throw new Error('SECOND_ADMIN_USERNAME correspond déjà au compte banque.');
      }
      if (!secondAdmin) {
        const password = process.env.SECOND_ADMIN_PASSWORD || (IS_PRODUCTION ? '' : 'admin123');
        if (!password) {
          console.log('Compte admin secondaire non créé : définis SECOND_ADMIN_PASSWORD.');
        } else {
          const passwordHash = await bcrypt.hash(password, 10);
          const created = await run(
            'INSERT INTO users (username, password_hash, avatar, chips, is_admin) VALUES (?, ?, ?, 1500, 1)',
            [secondAdminUsername, passwordHash, '🕶️']
          );
          secondAdmin = { id: created.id, is_bank: 0 };
          console.log(`Compte administrateur secondaire créé : ${secondAdminUsername}`);
        }
      } else {
        await run('UPDATE users SET is_admin = 1 WHERE id = ?', [secondAdmin.id]);
      }
    }

    let bank = await get('SELECT id, is_admin, is_bank FROM users WHERE username = ?', [bankUsername]);
    if (bank?.is_admin) {
      throw new Error('BANK_USERNAME correspond déjà à un compte administrateur.');
    }
    if (bank && !bank.is_bank) {
      throw new Error('BANK_USERNAME correspond déjà à un compte joueur. Choisis un pseudo réservé pour la banque.');
    }
    if (!bank) {
      const randomPassword = crypto.randomBytes(48).toString('hex');
      const passwordHash = await bcrypt.hash(randomPassword, 10);
      const created = await run(
        'INSERT INTO users (username, password_hash, avatar, chips, is_bank) VALUES (?, ?, ?, 0, 1)',
        [bankUsername, passwordHash, '🏦']
      );
      bank = { id: created.id };
      console.log(`Compte banque interne créé : ${bankUsername}`);
    } else {
      await run('UPDATE users SET is_bank = 1, is_admin = 0, is_banned = 0 WHERE id = ?', [bank.id]);
    }

    const globalBank = await get('SELECT user_id FROM casino_bank_accounts WHERE game_name = ?', ['global']);
    if (globalBank && Number(globalBank.user_id) !== Number(bank.id)) {
      throw new Error('Le compte banque global est associé à un autre compte interne.');
    }
    await run('INSERT OR IGNORE INTO casino_bank_accounts (game_name, user_id) VALUES (?, ?)', ['global', bank.id]);

    for (const gameName of Object.keys(GAME_DEFAULTS)) {
      const mapped = await get(`SELECT u.id, u.is_bank FROM casino_bank_accounts a
        JOIN users u ON u.id = a.user_id WHERE a.game_name = ?`, [gameName]);
      if (mapped) {
        if (!mapped.is_bank) throw new Error(`Le compte banque de ${gameName} n’est pas un compte interne.`);
        continue;
      }
      const username = `${bankUsername}-${gameName}`;
      let gameBank = await get('SELECT id, is_admin, is_bank FROM users WHERE username = ?', [username]);
      if (gameBank?.is_admin || (gameBank && !gameBank.is_bank)) {
        throw new Error(`Le pseudo ${username} est déjà utilisé par un compte non bancaire.`);
      }
      if (!gameBank) {
        const historical = await get('SELECT COALESCE(SUM(bank_delta), 0) AS balance FROM bank_ledger WHERE game_name = ?', [gameName]);
        const randomPassword = crypto.randomBytes(48).toString('hex');
        const passwordHash = await bcrypt.hash(randomPassword, 10);
        const created = await run(
          'INSERT INTO users (username, password_hash, avatar, chips, is_bank) VALUES (?, ?, ?, ?, 1)',
          [username, passwordHash, '🏦', Number(historical.balance)]
        );
        gameBank = { id: created.id };
      } else {
        await run('UPDATE users SET is_bank = 1, is_admin = 0, is_banned = 0 WHERE id = ?', [gameBank.id]);
      }
      await run('INSERT INTO casino_bank_accounts (game_name, user_id) VALUES (?, ?)', [gameName, gameBank.id]);
    }
  }

  const crashReady = databaseReady.then(initializeCrashGame);
  crashReady.catch((error) => {
    console.error('Initialisation du jeu Crash impossible :', error);
  });

  async function requireAuth(req, res, next) {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Connexion requise.' });
    }
    try {
      const user = await get('SELECT is_banned, is_bank, suspended_until FROM users WHERE id = ?', [req.session.userId]);
      if (!user) {
        return res.status(401).json({ error: 'Compte introuvable.' });
      }
      if (user.is_bank) {
        return res.status(403).json({ error: 'Le compte banque ne peut pas accéder aux jeux.' });
      }
      if (user.is_banned) {
        return res.status(403).json({ error: 'Ce compte est banni.' });
      }
      if (Number(user.suspended_until || 0) > Date.now()) {
        return res.status(403).json({ error: 'Ce compte est temporairement suspendu.' });
      }
      next();
    } catch (error) {
      console.error('Erreur de vérification du compte :', error);
      return res.status(500).json({ error: 'Vérification du compte impossible.' });
    }
  }

  async function requireAdmin(req, res, next) {
    if (req.session.supportOriginalUserId) {
      return res.status(403).json({ error: 'Quitte la vue support avant de gérer les comptes.' });
    }
    try {
      const admin = await get('SELECT is_admin, username FROM users WHERE id = ?', [req.session.userId]);
      if (!admin?.is_admin) {
        return res.status(403).json({ error: 'Accès administrateur requis.' });
      }
      req.adminUserId = Number(req.session.userId);
      req.isPrimaryAdmin = admin.username.toLowerCase() === PRIMARY_ADMIN_USERNAME.toLowerCase();
      next();
    } catch (error) {
      console.error('Erreur de vérification des droits administrateur :', error);
      return res.status(500).json({ error: 'Vérification des droits impossible.' });
    }
  }

  function requirePrimaryAdmin(req, res, next) {
    if (!req.isPrimaryAdmin) {
      return res.status(403).json({ error: 'Cette action est réservée à l’administrateur principal.' });
    }
    next();
  }

  async function getGameSettings(game) {
    const row = await get('SELECT * FROM casino_game_settings WHERE game = ?', [game]);
    return row ? {
      game: row.game,
      enabled: Boolean(row.enabled),
      maintenance: Boolean(row.maintenance),
      minBet: Number(row.min_bet),
      maxBet: Number(row.max_bet),
      updatedAt: row.updated_at
    } : null;
  }

  function requireBettingAvailable(game) {
    return async (req, res, next) => {
      try {
        const settings = await getGameSettings(game);
        if (!settings?.enabled || settings.maintenance) {
          return res.status(503).json({ error: `Le jeu ${game} est désactivé ou en maintenance.` });
        }
        if (await isBettingPaused()) {
          return res.status(503).json({ error: 'Les mises sont temporairement suspendues.' });
        }
        if (game !== 'tower' && await hasActiveTowerGame(req.session.userId)) return res.status(409).json({ error: 'Termine ou encaisse ta tour avant de jouer ailleurs.' });
        next();
      } catch (error) {
        next(error);
      }
    };
  }

  async function isBettingPaused() {
    const row = await get(
      "SELECT setting_value FROM casino_platform_settings WHERE setting_key = 'betting_paused'"
    );
    return row?.setting_value === '1';
  }

  async function recordAdminAction(adminId, action, reason, target = {}) {
    await run(`
      INSERT INTO admin_audit (admin_user_id, target_user_id, target_username, action, amount, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [adminId, target.userId || null, target.username || '', action, target.amount ?? null, reason]);
  }

  async function invalidateUserSessions(userId) {
    const sessions = await new Promise((resolve, reject) => {
      sessionStore.db.all('SELECT sid, sess FROM sessions WHERE expired > ?', [Date.now()], (error, rows) => {
        if (error) return reject(error);
        resolve(rows);
      });
    });
    const sessionIds = sessions.flatMap((row) => {
      try {
        const data = JSON.parse(row.sess);
        return Number(data.userId) === Number(userId) || Number(data.adminUserId) === Number(userId)
          ? [row.sid]
          : [];
      } catch {
        return [];
      }
    });
    await Promise.all(sessionIds.map((sessionId) => new Promise((resolve, reject) => {
      sessionStore.destroy(sessionId, (error) => error ? reject(error) : resolve());
    })));
    return sessionIds.length;
  }

  async function requireSupportAdmin(req, res, next) {
    const adminUserId = req.session.adminUserId || req.session.userId;
    if (!adminUserId) {
      return res.status(401).json({ error: 'Connexion administrateur requise.' });
    }
    try {
      const admin = await get('SELECT is_admin FROM users WHERE id = ?', [adminUserId]);
      if (!admin?.is_admin) {
        return res.status(403).json({ error: 'Accès administrateur requis.' });
      }
      req.adminUserId = Number(adminUserId);
      next();
    } catch (error) {
      console.error('Erreur de vérification des droits administrateur :', error);
      return res.status(500).json({ error: 'Vérification des droits impossible.' });
    }
  }

  function handleAsync(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
  }

  async function getUserById(userId) {
    return get('SELECT id, username, avatar, avatar_image, profile_design, infinite_money, chips, created_at FROM users WHERE id = ?', [userId]);
  }

  function validateAvatarImage(dataUrl) {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    if (!match) return null;
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0 || buffer.length > 1_000_000) return null;
    const isPng = match[1] === 'png' && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = match[1] === 'jpeg' && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isWebp = match[1] === 'webp' && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
    return isPng || isJpeg || isWebp ? `data:image/${match[1]};base64,${match[2]}` : null;
  }

  app.use(express.static(GAME_DIR, { index: false }));
  app.use('/auth-assets', express.static(AUTH_DIR));

  app.get('/', handleAsync(async (req, res) => {
    if (req.session.userId) {
      const user = await get('SELECT is_banned, is_bank, suspended_until FROM users WHERE id = ?', [req.session.userId]);
      if (user && !user.is_banned && !user.is_bank && Number(user.suspended_until || 0) <= Date.now()) {
        return res.sendFile(path.join(GAME_DIR, 'index.html'));
      }
    }
    return res.sendFile(path.join(AUTH_DIR, 'auth.html'));
  }));

  app.get('/game', handleAsync(async (req, res) => {
    if (!req.session.userId) {
      return res.redirect('/');
    }
    const user = await get('SELECT is_banned, is_bank, suspended_until FROM users WHERE id = ?', [req.session.userId]);
    if (!user || user.is_banned || user.is_bank || Number(user.suspended_until || 0) > Date.now()) {
      return res.redirect('/');
    }
    return res.sendFile(path.join(GAME_DIR, 'index.html'));
  }));

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

    const account = await get('SELECT is_banned, is_bank, suspended_until FROM users WHERE id = ?', [req.session.userId]);
    if (!account || account.is_banned || account.is_bank || Number(account.suspended_until || 0) > Date.now()) {
      return res.json({ authenticated: false });
    }
    const user = await getUserById(req.session.userId);
    res.json({ authenticated: true, user });
  });

  const registrationLimiter = rateLimit({
    windowMs: REGISTRATION_RATE_WINDOW_MS,
    limit: REGISTRATION_RATE_LIMIT,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Trop de tentatives de création de compte. Réessaie plus tard.' }
  });

  const loginLimiter = rateLimit({
    windowMs: 60000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Trop de tentatives de connexion. Patiente une minute avant de réessayer.' }
  });

  const registrationCaptcha = createRegistrationCaptcha({ run, get, withDatabaseTransaction, secret: SESSION_SECRET });
  const captchaLimiter = rateLimit({ windowMs: REGISTRATION_RATE_WINDOW_MS, limit: REGISTRATION_CAPTCHA_RATE_LIMIT,
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Trop de demandes d’image CAPTCHA. Réessaie plus tard.' } });
  app.get('/api/register/captcha', captchaLimiter, handleAsync(async (req, res) => {
    req.session.registrationCaptcha = true;
    res.set('Cache-Control', 'no-store');
    res.json(await registrationCaptcha.issue(req.sessionID));
  }));

  app.post('/api/register', registrationLimiter, handleAsync(async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const passwordConfirmation = String(req.body.passwordConfirmation || '');

    if (!username || username.length < 3) {
      return res.status(400).json({ error: 'Le pseudo doit contenir au moins 3 caractères.' });
    }

    if (password.length < 4) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 4 caractères.' });
    }
    if (password !== passwordConfirmation) {
      return res.status(400).json({ error: 'Les mots de passe ne correspondent pas.' });
    }

    const captchaResult = await registrationCaptcha.consume(req.sessionID, req.body?.captchaId, req.body?.captchaAnswer);
    if (captchaResult.status !== 'valid') {
      if (captchaResult.status === 'incorrect') {
        return res.status(400).json({
          error: `Réponse incorrecte. Il te reste ${captchaResult.attemptsRemaining} essai(s) pour cette image.`,
          captchaStatus: captchaResult.status
        });
      }
      if (captchaResult.status === 'attempts_exceeded') {
        return res.status(429).json({ error: 'Trop de réponses incorrectes. Charge une nouvelle image.', captchaStatus: captchaResult.status });
      }
      if (captchaResult.status === 'expired') {
        return res.status(400).json({ error: 'Cette image a expiré. Charge une nouvelle image.', captchaStatus: captchaResult.status });
      }
      return res.status(400).json({ error: 'CAPTCHA absent ou invalide. Charge une nouvelle image.', captchaStatus: 'not_found' });
    }

    try {
      const existing = await get('SELECT id FROM users WHERE username = ?', [username]);
      if (existing) {
        return res.status(409).json({ error: 'Ce pseudo est déjà utilisé.' });
      }

      const passwordHash = await passwordService.hash(password, 10);
      const created = await run(
        'INSERT INTO users (username, password_hash, avatar, chips) VALUES (?, ?, ?, 0)',
        [username, passwordHash, '🎲']
      );

      req.session.userId = created.id;
      delete req.session.adminUserId;
      delete req.session.supportOriginalUserId;
      const user = await getUserById(created.id);
      return res.status(201).json({ ok: true, user });
    } catch (error) {
      if (error.code === 'PASSWORD_BUSY') return res.set('Retry-After', '2').status(429).json({ error: error.message });
      console.error('Erreur register:', error);
      return res.status(500).json({ error: 'Erreur lors de l’inscription.' });
    }
  }));

  app.post('/api/login', loginLimiter, async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (!username || !password) {
      return res.status(400).json({ error: 'Pseudo et mot de passe requis.' });
    }

    try {
      const user = await get('SELECT id, username, password_hash, avatar, chips, created_at, is_admin, is_banned, is_bank, suspended_until FROM users WHERE username = ?', [username]);
      if (!user) {
        return res.status(404).json({ error: 'Compte introuvable.' });
      }

      const valid = await passwordService.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Mot de passe incorrect.' });
      }
      if (user.is_banned) {
        return res.status(403).json({ error: 'Ce compte est banni.' });
      }
      if (Number(user.suspended_until || 0) > Date.now()) {
        return res.status(403).json({ error: 'Ce compte est temporairement suspendu.' });
      }
      if (user.is_bank) {
        return res.status(403).json({ error: 'Le compte banque est interne et ne peut pas se connecter.' });
      }

      req.session.userId = user.id;
      if (user.is_admin) {
        req.session.adminUserId = user.id;
      } else {
        delete req.session.adminUserId;
      }
      delete req.session.supportOriginalUserId;
      return res.json({
        ok: true,
        user: {
          id: user.id,
          username: user.username,
          avatar: user.avatar,
          chips: user.chips,
          created_at: user.created_at,
          is_admin: Boolean(user.is_admin)
        }
      });
    } catch (error) {
      if (error.code === 'PASSWORD_BUSY') return res.set('Retry-After', '2').status(429).json({ error: error.message });
      console.error('Erreur login:', error);
      return res.status(500).json({ error: 'Erreur lors de la connexion.' });
    }
  });

  app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
      res.json({ ok: true, message: 'Déconnecté.' });
    });
  });

  app.get('/api/game-settings', handleAsync(async (req, res) => {
    const rows = await all('SELECT game, enabled, maintenance, min_bet, max_bet FROM casino_game_settings');
    res.json({
      games: Object.fromEntries(rows.filter(row => Object.hasOwn(GAME_DEFAULTS, row.game)).map((row) => [row.game, {
        enabled: Boolean(row.enabled),
        maintenance: Boolean(row.maintenance),
        minBet: Number(row.min_bet),
        maxBet: Number(row.max_bet)
      }])),
      bettingPaused: await isBettingPaused()
    });
  }));

  app.get('/api/admin/overview', requireAuth, requireAdmin, handleAsync(async (req, res) => {
    const connected = new Map();
    for (const socket of io.sockets.sockets.values()) {
      const user = socket.data.user;
      if (!user?.id || user.is_bank) continue;
      connected.set(Number(user.id), { id: Number(user.id), username: user.username, game: null });
    }

    const activeGames = [];
    for (const table of blackjackTables.values()) {
      if (table.status !== 'in-progress') continue;
      const players = table.players.map((player) => ({ id: Number(player.id), username: player.username, stake: Number(table.betAmount || 0) }));
      activeGames.push({ game: 'blackjack', id: table.id, name: table.name, players, wagered: players.reduce((sum, player) => sum + player.stake, 0) });
      for (const player of players) if (connected.has(player.id)) connected.get(player.id).game = 'blackjack';
    }
    for (const table of pokerTables.values()) {
      if (table.status !== 'in-progress') continue;
      const players = table.players.map((player) => ({ id: Number(player.id), username: player.username, stake: Number(player.totalContribution || 0) }));
      activeGames.push({ game: 'poker', id: table.id, name: table.name, players, wagered: Number(table.pot || 0) });
      for (const player of players) if (connected.has(player.id)) connected.get(player.id).game = 'poker';
    }
    const crashBets = await all(`
      SELECT b.user_id AS id, b.username, b.stake, r.id AS round_id, r.status, r.started_at
      FROM crash_bets b JOIN crash_rounds r ON r.id = b.round_id
      WHERE b.status = 'active'
    `);
    for (const bet of crashBets) {
      const roundId = String(bet.round_id);
      let game = activeGames.find((entry) => entry.game === 'crash' && entry.id === roundId);
      if (!game) {
        game = { game: 'crash', id: roundId, name: 'Crash', status: bet.status, players: [], wagered: 0 };
        activeGames.push(game);
      }
      game.players.push({ id: Number(bet.id), username: bet.username, stake: Number(bet.stake) });
      game.wagered += Number(bet.stake);
      if (connected.has(Number(bet.id))) connected.get(Number(bet.id)).game = 'crash';
    }

    const stats = await get(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE is_admin = 0 AND is_bank = 0) AS players,
        (SELECT COALESCE(SUM(chips), 0) FROM users WHERE is_admin = 0 AND is_bank = 0) AS chips,
        (SELECT COUNT(*) FROM game_history) AS games,
        (SELECT COALESCE(SUM(bet), 0) FROM game_history) AS wagered,
        (SELECT COALESCE(SUM(payout), 0) FROM game_history) AS payouts,
        (SELECT COALESCE(SUM(net), 0) FROM game_history) AS net
    `);
    res.json({
      onlinePlayers: [...connected.values()],
      activeGames,
      stats: {
        players: Number(stats.players),
        online: connected.size,
        chips: Number(stats.chips),
        games: Number(stats.games),
        wagered: Number(stats.wagered),
        payouts: Number(stats.payouts),
        net: Number(stats.net)
      }
    });
  }));

  app.get('/api/admin/audit', requireAuth, requireAdmin, handleAsync(async (req, res) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
    const entries = await all(`
      SELECT a.id, a.action, a.amount, a.reason, a.created_at,
        admin.username AS admin_username,
        COALESCE(target.username, a.target_username) AS target_username
      FROM admin_audit a
      JOIN users admin ON admin.id = a.admin_user_id
      LEFT JOIN users target ON target.id = a.target_user_id
      ORDER BY a.id DESC LIMIT ?
    `, [limit]);
    res.json({ entries });
  }));

  app.get('/api/admin/settings', requireAuth, requireAdmin, handleAsync(async (req, res) => {
    const rows = await all('SELECT game, enabled, maintenance, min_bet, max_bet, updated_at FROM casino_game_settings ORDER BY game');
    res.json({
      games: rows.filter(row => Object.hasOwn(GAME_DEFAULTS, row.game)).map((row) => ({
        game: row.game,
        enabled: Boolean(row.enabled),
        maintenance: Boolean(row.maintenance),
        minBet: Number(row.min_bet),
        maxBet: Number(row.max_bet),
        updatedAt: row.updated_at
      })),
      bettingPaused: await isBettingPaused(),
      maintenance: maintenance.getState(),
      canManage: req.isPrimaryAdmin
    });
  }));

  app.post('/api/admin/accounts/:id/disconnect', requireAuth, requireAdmin, handleAsync(async (req, res) => {
    const targetId = Number(req.params.id);
    const target = await get('SELECT id, username, is_admin, is_bank FROM users WHERE id = ?', [targetId]);
    if (!target) return res.status(404).json({ error: 'Compte introuvable.' });
    if (target.is_bank || (target.is_admin && !req.isPrimaryAdmin)) {
      return res.status(403).json({ error: 'Seul l’administrateur principal peut déconnecter un autre admin.' });
    }
    if (target.id === req.adminUserId) return res.status(400).json({ error: 'Tu ne peux pas déconnecter ta propre session.' });
    const sockets = [...io.sockets.sockets.values()].filter((socket) => Number(socket.data.user?.id) === targetId);
    const sessions = await invalidateUserSessions(targetId);
    for (const socket of sockets) socket.disconnect(true);
    await recordAdminAction(req.adminUserId, 'disconnect', 'Déconnexion forcée par le panneau admin', { userId: targetId, username: target.username });
    res.json({ ok: true, disconnected: sockets.length, sessions });
  }));

  app.post('/api/admin/accounts/:id/permissions', requireAuth, requireAdmin, requirePrimaryAdmin, handleAsync(async (req, res) => {
    const targetId = Number(req.params.id);
    const isAdmin = req.body?.isAdmin;
    const reason = String(req.body?.reason || '').trim().slice(0, 240);
    if (!Number.isSafeInteger(targetId) || targetId <= 0 || typeof isAdmin !== 'boolean' || !reason) {
      return res.status(400).json({ error: 'Compte, permission ou motif invalide.' });
    }
    if (targetId === req.adminUserId) return res.status(400).json({ error: 'Le rôle de l’administrateur principal ne peut pas être modifié ici.' });
    const target = await get('SELECT id, username, is_admin, is_bank FROM users WHERE id = ?', [targetId]);
    if (!target) return res.status(404).json({ error: 'Compte introuvable.' });
    if (target.is_bank || target.username.toLowerCase() === PRIMARY_ADMIN_USERNAME.toLowerCase()) {
      return res.status(400).json({ error: 'Ce compte ne peut pas être modifié.' });
    }
    if (Boolean(target.is_admin) === isAdmin) return res.status(400).json({ error: 'Ce rôle est déjà configuré ainsi.' });
    await run('UPDATE users SET is_admin = ? WHERE id = ?', [isAdmin ? 1 : 0, targetId]);
    await recordAdminAction(req.adminUserId, isAdmin ? 'admin_promoted' : 'admin_demoted', reason, { userId: targetId, username: target.username });
    if (!isAdmin) {
      await invalidateUserSessions(targetId);
      for (const socket of io.sockets.sockets.values()) {
        if (Number(socket.data.user?.id) === targetId) socket.disconnect(true);
      }
    }
    res.json({ ok: true, isAdmin });
  }));

  app.post('/api/admin/chips/distribute', requireAuth, requireAdmin, handleAsync(async (req, res) => {
    const amount = Number(req.body?.amount);
    const reason = String(req.body?.reason || '').trim().slice(0, 240);
    if (!isMoney(amount) || amount < 0.01 || amount > 1_000_000 || !reason) {
      return res.status(400).json({ error: 'Montant ou motif invalide.' });
    }
    const outcome = await withDatabaseTransaction(async () => {
      const players = await all('SELECT id, username, chips FROM users WHERE is_admin = 0 AND is_bank = 0');
      if (players.some((player) => Number(player.chips) + amount > MAX_CHIPS)) {
        return { error: 'La distribution dépasserait le solde maximal d’un joueur.' };
      }
      for (const player of players) {
        await run('UPDATE users SET chips = ROUND(chips + ?, 2) WHERE id = ?', [amount, player.id]);
        await recordAdminAction(req.adminUserId, 'token_distribution', reason, {
          userId: player.id,
          username: player.username,
          amount
        });
      }
      return { recipients: players.length };
    });
    if (outcome.error) return res.status(400).json({ error: outcome.error });
    res.json({ ok: true, amount, recipients: outcome.recipients });
  }));

  app.patch('/api/admin/games/:game', requireAuth, requireAdmin, requirePrimaryAdmin, handleAsync(async (req, res) => {
    const game = String(req.params.game);
    if (!Object.hasOwn(GAME_DEFAULTS, game)) return res.status(404).json({ error: 'Jeu inconnu.' });
    const current = await getGameSettings(game);
    const enabled = req.body?.enabled ?? current.enabled;
    const maintenance = req.body?.maintenance ?? current.maintenance;
    const minBet = req.body?.minBet ?? current.minBet;
    const maxBet = req.body?.maxBet ?? current.maxBet;
    const reason = String(req.body?.reason || '').trim().slice(0, 240);
    if (typeof enabled !== 'boolean' || typeof maintenance !== 'boolean' ||
        !isMoney(minBet) || !isMoney(maxBet) ||
        minBet < 0.01 || maxBet < minBet || maxBet > MAX_CHIPS || !reason) {
      return res.status(400).json({ error: 'Réglages ou motif invalides.' });
    }
    await run(`
      UPDATE casino_game_settings
      SET enabled = ?, maintenance = ?, min_bet = ?, max_bet = ?, updated_at = CURRENT_TIMESTAMP
      WHERE game = ?
    `, [enabled ? 1 : 0, maintenance ? 1 : 0, minBet, maxBet, game]);
    await recordAdminAction(req.adminUserId, 'game_settings', `${game}: ${reason}`);
    res.json({ ok: true, settings: await getGameSettings(game) });
  }));

  app.post('/api/admin/security/pause-bets', requireAuth, requireAdmin, requirePrimaryAdmin, handleAsync(async (req, res) => {
    const paused = req.body?.paused;
    const reason = String(req.body?.reason || '').trim().slice(0, 240);
    if (typeof paused !== 'boolean' || !reason) return res.status(400).json({ error: 'Statut ou motif invalide.' });
    await run(`
      INSERT INTO casino_platform_settings (setting_key, setting_value, updated_at)
      VALUES ('betting_paused', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP
    `, [paused ? '1' : '0']);
    await recordAdminAction(req.adminUserId, paused ? 'emergency_pause' : 'emergency_resume', reason);
    res.json({ ok: true, bettingPaused: paused });
  }));

  app.get('/api/admin/accounts', requireAuth, requireAdmin, handleAsync(async (req, res) => {
    const search = String(req.query.search || '').trim().slice(0, 40);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 25, 1), 50);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const searchPattern = `%${search}%`;
    const accounts = await all(`
      SELECT u.id, u.username, u.avatar, u.chips, u.infinite_money, u.created_at,
        u.is_admin, u.is_banned, u.suspended_until, u.is_bank, COUNT(h.id) AS games_played,
        COALESCE(SUM(h.net), 0) AS net_total
      FROM users u
      LEFT JOIN game_history h ON h.user_id = u.id
      WHERE u.username LIKE ?
      GROUP BY u.id
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT ? OFFSET ?
    `, [searchPattern, limit, offset]);
    const count = await get('SELECT COUNT(*) AS total FROM users WHERE username LIKE ?', [searchPattern]);
    const onlineIds = new Set([...io.sockets.sockets.values()]
      .map((socket) => Number(socket.data.user?.id))
      .filter(Number.isFinite));
    res.json({
      accounts: accounts.map((account) => ({
        ...account,
        is_online: onlineIds.has(Number(account.id)),
        is_suspended: Number(account.suspended_until || 0) > Date.now(),
        is_primary_admin: account.username.toLowerCase() === PRIMARY_ADMIN_USERNAME.toLowerCase()
      })),
      total: Number(count.total),
      limit,
      offset
    });
  }));

  async function getBankReport() {
    const bank = await getBankAccount();
    const gameBanks = await all(`SELECT a.game_name AS game, u.id, u.username, u.chips
      FROM casino_bank_accounts a JOIN users u ON u.id = a.user_id
      WHERE a.game_name != 'global' AND u.is_bank = 1 ORDER BY a.game_name`);
    const recent = await all(`
      SELECT player_username, game_name, player_net, bank_delta, created_at
      FROM bank_ledger ORDER BY id DESC LIMIT 30
    `);
    const totals = await get(`
      SELECT COUNT(*) AS settlements,
        COALESCE(SUM(CASE WHEN bank_delta > 0 THEN bank_delta ELSE 0 END), 0) AS collected,
        COALESCE(SUM(CASE WHEN bank_delta < 0 THEN bank_delta ELSE 0 END), 0) AS paid
      FROM bank_ledger
    `);
    return {
      bank,
      gameBanks,
      totals: {
        settlements: Number(totals.settlements),
        collected: Number(totals.collected),
        paid: Number(totals.paid)
      },
      recent
    };
  }

  app.get('/api/admin/bank', requireAuth, requireAdmin, handleAsync(async (req, res) => {
    res.json(await getBankReport());
  }));

  app.post('/api/admin/bank/reset', requireAuth, requireAdmin, handleAsync(async (req, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason || reason.length > 240) {
      return res.status(400).json({ error: 'Un motif de 1 à 240 caractères est obligatoire.' });
    }
    try {
      const resetAccounts = await withDatabaseTransaction(async () => {
        await getBankAccount();
        const banks = await all('SELECT id FROM users WHERE is_bank = 1');
        await run('UPDATE users SET chips = 0 WHERE is_bank = 1');
        await recordAdminAction(req.adminUserId, 'bank_reset', reason, {
          username: 'Banque globale et comptes par jeu',
          amount: banks.length
        });
        return banks.length;
      });
      res.json({ ok: true, resetAccounts, ...(await getBankReport()) });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      throw error;
    }
  }));

  app.get('/api/admin/accounts/:id', requireAuth, requireAdmin, handleAsync(async (req, res) => {
    const targetId = Number(req.params.id);
    if (!Number.isSafeInteger(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'Identifiant de compte invalide.' });
    }
    const user = await get(`
      SELECT id, username, avatar, chips, is_admin, is_banned, suspended_until, is_bank, created_at
      FROM users WHERE id = ?
    `, [targetId]);
    if (!user) {
      return res.status(404).json({ error: 'Compte introuvable.' });
    }
    const history = await all(`
      SELECT game_name, bet, result, payout, net, created_at
      FROM game_history WHERE user_id = ? ORDER BY id DESC LIMIT 25
    `, [targetId]);
    const audit = await all(`
      SELECT a.action, a.amount, a.reason, a.created_at, u.username AS admin_username
      FROM admin_audit a
      JOIN users u ON u.id = a.admin_user_id
      WHERE a.target_user_id = ?
      ORDER BY a.id DESC LIMIT 25
    `, [targetId]);
    res.json({ account: user, history, audit });
  }));

  app.post('/api/admin/infinite-money', requireAuth, requireAdmin, requirePrimaryAdmin, handleAsync(async (req, res) => {
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'Choisis activer ou désactiver.' });
    const outcome = await withDatabaseTransaction(async () => {
      if (isUserInActiveTable(req.adminUserId) || await hasOtherActiveBet(req.adminUserId)) return false;
      const user = await get('SELECT chips, finite_chips, infinite_money, username FROM users WHERE id = ?', [req.adminUserId]);
      if (Boolean(user.infinite_money) !== enabled) {
        await run('UPDATE users SET infinite_money = ?, finite_chips = ?, chips = ? WHERE id = ?',
          [enabled ? 1 : 0, enabled ? user.chips : null, enabled ? Math.max(Number(user.chips), 1000000000000) : Number(user.finite_chips ?? 1500), req.adminUserId]);
        await recordAdminAction(req.adminUserId, enabled ? 'infinite_money_enabled' : 'infinite_money_disabled', 'Mode argent infini du compte principal', { userId: req.adminUserId, username: user.username });
      }
      return true;
    });
    if (!outcome) return res.status(409).json({ error: 'Termine ta partie avant de changer ce mode.' });
    res.json({ ok: true, user: await getUserById(req.adminUserId) });
  }));

  app.post('/api/admin/accounts/:id/reset', requireAuth, requireAdmin, requirePrimaryAdmin, handleAsync(async (req, res) => {
    const targetId = Number(req.params.id);
    const reason = String(req.body?.reason || '').trim().slice(0, 240);
    if (!Number.isSafeInteger(targetId) || targetId <= 0 || !reason) return res.status(400).json({ error: 'Compte et motif obligatoires.' });
    const result = await withDatabaseTransaction(async () => {
      const target = await get('SELECT id, username, is_bank FROM users WHERE id = ?', [targetId]);
      if (!target) return { status: 404, error: 'Compte introuvable.' };
      if (target.is_bank) return { status: 403, error: 'Le compte banque ne peut pas être réinitialisé.' };
      if (isUserInActiveTable(targetId) || await hasOtherActiveBet(targetId)) return { status: 409, error: 'Ce compte joue une partie. Réessaie à la fin de la manche.' };
      await run("UPDATE users SET infinite_money = 0, finite_chips = NULL, chips = 0, avatar = '🎲', avatar_image = NULL, profile_design = '{}' WHERE id = ?", [targetId]);
      await run('DELETE FROM game_history WHERE user_id = ?', [targetId]);
      await run('DELETE FROM crash_bets WHERE user_id = ?', [targetId]);
      await recordAdminAction(req.adminUserId, 'account_reset', reason, { userId: targetId, username: target.username });
      return { status: 200 };
    });
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    for (const tables of [blackjackTables, pokerTables]) {
      for (const [tableId, table] of tables) {
        if (table.status === 'in-progress' || !table.players.some(player => Number(player.id) === targetId)) continue;
        table.removePlayer(targetId);
        if (!table.players.length) tables.delete(tableId);
        else io.to(`${table.type}:${tableId}`).emit(`${table.type}:table:update`, tableToPublicState(table));
      }
    }
    if (targetId !== req.adminUserId) {
      await invalidateUserSessions(targetId);
      for (const socket of io.sockets.sockets.values()) {
        if (Number(socket.data.user?.id) === targetId) socket.disconnect(true);
      }
    }
    res.json({ ok: true });
  }));

  app.post('/api/admin/accounts/:id/chips', requireAuth, requireAdmin, async (req, res) => {
    const targetId = Number(req.params.id);
    const delta = Number(req.body?.delta);
    const reason = String(req.body?.reason || '').trim().slice(0, 240);
    if (!Number.isSafeInteger(targetId) || targetId <= 0 ||
        !isMoney(delta) || delta === 0 || Math.abs(delta) > 1_000_000_000 ||
        !reason) {
      return res.status(400).json({ error: 'Montant ou motif invalide.' });
    }
    if (targetId === req.adminUserId) {
      return res.status(400).json({ error: 'Tu ne peux pas modifier ton propre solde.' });
    }

    try {
      const outcome = await withDatabaseTransaction(async () => {
        const target = await get('SELECT id, username, chips, is_admin, is_bank FROM users WHERE id = ?', [targetId]);
        if (!target) return { status: 404, error: 'Compte introuvable.' };
        if (target.is_bank || (target.is_admin && !req.isPrimaryAdmin) ||
            target.username.toLowerCase() === PRIMARY_ADMIN_USERNAME.toLowerCase()) {
          return { status: 400, error: 'Le solde de ce compte protégé ne peut pas être modifié ici.' };
        }
        const newBalance = roundMoney(Number(target.chips) + delta);
        if (!isMoney(newBalance) || newBalance < 0 || newBalance > MAX_CHIPS) {
          return { status: 400, error: `Le solde résultant doit être compris entre 0 et ${MAX_CHIPS}.` };
        }
        await run('UPDATE users SET chips = ? WHERE id = ?', [newBalance, targetId]);
        await run(`
          INSERT INTO admin_audit (admin_user_id, target_user_id, target_username, action, amount, reason)
          VALUES (?, ?, ?, 'chips_adjustment', ?, ?)
        `, [req.adminUserId, targetId, target.username, delta, reason]);
        return { status: 200, chips: newBalance };
      });
      if (outcome.status !== 200) {
        return res.status(outcome.status).json({ error: outcome.error });
      }
      return res.json({ ok: true, chips: outcome.chips });
    } catch (error) {
      console.error('Erreur de modification du solde :', error);
      return res.status(500).json({ error: 'La modification du solde a échoué.' });
    }
  });

  app.post('/api/admin/accounts/:id/ban', requireAuth, requireAdmin, async (req, res) => {
    const targetId = Number(req.params.id);
    const banned = req.body?.banned;
    const reason = String(req.body?.reason || '').trim().slice(0, 240);
    if (!Number.isSafeInteger(targetId) || targetId <= 0 ||
        typeof banned !== 'boolean' || !reason) {
      return res.status(400).json({ error: 'Statut de bannissement ou motif invalide.' });
    }
    if (targetId === req.adminUserId) {
      return res.status(400).json({ error: 'Tu ne peux pas bannir ton propre compte.' });
    }

    try {
      const outcome = await withDatabaseTransaction(async () => {
        const target = await get('SELECT id, username, is_admin, is_bank, is_banned FROM users WHERE id = ?', [targetId]);
        if (!target) return { status: 404, error: 'Compte introuvable.' };
        if (target.is_bank || (target.is_admin && !req.isPrimaryAdmin) ||
            target.username.toLowerCase() === PRIMARY_ADMIN_USERNAME.toLowerCase()) {
          return { status: 400, error: 'Ce compte protégé ne peut pas être banni ici.' };
        }
        if (Boolean(target.is_banned) === banned) {
          return { status: 400, error: banned ? 'Ce compte est déjà banni.' : 'Ce compte n’est pas banni.' };
        }
        await run('UPDATE users SET is_banned = ? WHERE id = ?', [banned ? 1 : 0, targetId]);
        await run(`
          INSERT INTO admin_audit (admin_user_id, target_user_id, target_username, action, reason)
          VALUES (?, ?, ?, ?, ?)
        `, [req.adminUserId, targetId, target.username, banned ? 'ban' : 'unban', reason]);
        return { status: 200 };
      });
      if (outcome.status !== 200) {
        return res.status(outcome.status).json({ error: outcome.error });
      }
    } catch (error) {
      console.error('Erreur de modification du bannissement :', error);
      return res.status(500).json({ error: 'Le changement de bannissement a échoué.' });
    }

    if (banned) {
      await invalidateUserSessions(targetId);
      for (const socket of io.sockets.sockets.values()) {
        if (Number(socket.data.user?.id) === targetId) {
          socket.disconnect(true);
        }
      }
    }
    return res.json({ ok: true, banned });
  });

  app.post('/api/admin/accounts/:id/suspend', requireAuth, requireAdmin, handleAsync(async (req, res) => {
    const targetId = Number(req.params.id);
    const minutes = Number(req.body?.minutes);
    const reason = String(req.body?.reason || '').trim().slice(0, 240);
    if (!Number.isSafeInteger(targetId) || targetId <= 0 || !Number.isSafeInteger(minutes) ||
        minutes < 0 || minutes > 10_080 || !reason) {
      return res.status(400).json({ error: 'Durée ou motif de suspension invalide.' });
    }
    if (targetId === req.adminUserId) return res.status(400).json({ error: 'Tu ne peux pas suspendre ta propre session.' });
    const target = await get('SELECT id, username, is_admin, is_bank FROM users WHERE id = ?', [targetId]);
    if (!target) return res.status(404).json({ error: 'Compte introuvable.' });
    if (target.is_bank || (target.is_admin && !req.isPrimaryAdmin) ||
        target.username.toLowerCase() === PRIMARY_ADMIN_USERNAME.toLowerCase()) {
      return res.status(403).json({ error: 'Tu ne peux pas suspendre ce compte.' });
    }
    const suspendedUntil = minutes === 0 ? null : Date.now() + minutes * 60_000;
    await run('UPDATE users SET suspended_until = ? WHERE id = ?', [suspendedUntil, targetId]);
    await recordAdminAction(req.adminUserId, minutes === 0 ? 'suspension_lifted' : 'suspension', reason, {
      userId: targetId,
      username: target.username,
      amount: minutes
    });
    if (minutes > 0) {
      await invalidateUserSessions(targetId);
      for (const socket of io.sockets.sockets.values()) {
        if (Number(socket.data.user?.id) === targetId) socket.disconnect(true);
      }
    }
    res.json({ ok: true, suspendedUntil });
  }));

  app.delete('/api/admin/accounts/:id', requireAuth, requireAdmin, handleAsync(async (req, res) => {
    const targetId = Number(req.params.id);
    const reason = 'Suppression confirmée par un administrateur.';
    if (!Number.isSafeInteger(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'Identifiant de compte invalide.' });
    }
    if (targetId === req.adminUserId) {
      return res.status(400).json({ error: 'Tu ne peux pas supprimer ton propre compte administrateur.' });
    }

    const target = await get('SELECT id, username, is_admin, is_bank FROM users WHERE id = ?', [targetId]);
    if (!target) {
      return res.status(404).json({ error: 'Compte introuvable.' });
    }
    if (target.is_bank || (target.is_admin && !req.isPrimaryAdmin) ||
        target.username.toLowerCase() === PRIMARY_ADMIN_USERNAME.toLowerCase()) {
      return res.status(400).json({ error: 'Ce compte protégé ne peut pas être supprimé ici.' });
    }
    const activeBlackjack = [...blackjackTables.values()].some((table) =>
      table.status === 'in-progress' && table.players.some((player) => player.id === targetId)
    );
    const activePoker = [...pokerTables.values()].some((table) =>
      table.status === 'in-progress' && table.players.some((player) => player.id === targetId)
    );
    const activeCrashBet = await get(
      "SELECT id FROM crash_bets WHERE user_id = ? AND status = 'active' LIMIT 1",
      [targetId]
    );
    if (activeBlackjack || activePoker || activeCrashBet) {
      return res.status(409).json({ error: 'Ce compte participe à une partie en cours. Réessaie après la fin de la manche.' });
    }

    let deletion;
    try {
      deletion = await withDatabaseTransaction(async () => {
        const currentTarget = await get(
          'SELECT id, username, is_admin, is_bank FROM users WHERE id = ?',
          [targetId]
        );
        if (!currentTarget) return { status: 404, error: 'Compte introuvable.' };
        if (currentTarget.is_bank || (currentTarget.is_admin && !req.isPrimaryAdmin) ||
            currentTarget.username.toLowerCase() === PRIMARY_ADMIN_USERNAME.toLowerCase()) {
          return { status: 400, error: 'Ce compte protégé ne peut pas être supprimé ici.' };
        }
        const activeCrashBetInTransaction = await get(
          "SELECT id FROM crash_bets WHERE user_id = ? AND status = 'active' LIMIT 1",
          [targetId]
        );
        if (activeCrashBetInTransaction || await hasActiveTowerGame(targetId)) {
          return { status: 409, error: 'Ce compte participe à une manche Crash en cours. Réessaie après le crash.' };
        }
        await run(`
          INSERT INTO admin_audit (admin_user_id, target_user_id, target_username, action, reason)
          VALUES (?, ?, ?, 'account_deleted', ?)
        `, [req.adminUserId, targetId, currentTarget.username, reason]);
        await run('DELETE FROM game_history WHERE user_id = ?', [targetId]);
        await run('DELETE FROM crash_bets WHERE user_id = ?', [targetId]);
        const deleted = await run('DELETE FROM users WHERE id = ?', [targetId]);
        if (deleted.changes !== 1) {
          return { status: 404, error: 'Compte introuvable.' };
        }
        return { status: 200, username: currentTarget.username };
      });
      if (deletion.status !== 200) {
        return res.status(deletion.status).json({ error: deletion.error });
      }
    } catch (error) {
      console.error('Erreur de suppression du compte :', error);
      return res.status(500).json({ error: 'La suppression du compte a échoué.' });
    }

    for (const [tableId, table] of blackjackTables) {
      if (!table.players.some((player) => player.id === targetId)) continue;
      table.removePlayer(targetId);
      if (!table.players.length) {
        blackjackTables.delete(tableId);
      } else {
        io.to(`blackjack:${table.id}`).emit('blackjack:table:update', tableToPublicState(table));
      }
    }
    for (const [tableId, table] of pokerTables) {
      if (!table.players.some((player) => player.id === targetId)) continue;
      table.removePlayer(targetId);
      if (!table.players.length) {
        pokerTables.delete(tableId);
      } else {
        io.to(`poker:${table.id}`).emit('poker:table:update', tableToPublicState(table));
      }
    }
    await invalidateUserSessions(targetId);
    for (const socket of io.sockets.sockets.values()) {
      if (Number(socket.data.user?.id) === targetId) {
        socket.disconnect(true);
      }
    }
    return res.json({ ok: true, deleted: { id: targetId, username: deletion.username } });
  }));

  app.post('/api/admin/support/:id/start', requireAuth, requireAdmin, handleAsync(async (req, res) => {
    const targetId = Number(req.params.id);
    if (!Number.isSafeInteger(targetId) || targetId <= 0 || targetId === req.adminUserId) {
      return res.status(400).json({ error: 'Compte cible invalide.' });
    }
    const target = await get('SELECT id, username, is_admin, is_bank, is_banned FROM users WHERE id = ?', [targetId]);
    if (!target) {
      return res.status(404).json({ error: 'Compte introuvable.' });
    }
    if ((target.is_admin && !req.isPrimaryAdmin) || target.is_bank || target.is_banned ||
        target.username.toLowerCase() === PRIMARY_ADMIN_USERNAME.toLowerCase()) {
      return res.status(400).json({ error: 'La vue support est indisponible pour ce compte.' });
    }
    await run(`
      INSERT INTO admin_audit (admin_user_id, target_user_id, target_username, action, reason)
      VALUES (?, ?, ?, 'support_start', 'Ouverture de la vue support temporaire')
    `, [req.adminUserId, targetId, target.username]);
    req.session.adminUserId = req.adminUserId;
    req.session.supportOriginalUserId = req.session.userId;
    req.session.userId = targetId;
    res.json({ ok: true });
  }));

  app.post('/api/admin/support/end', requireSupportAdmin, handleAsync(async (req, res) => {
    if (!req.session.supportOriginalUserId) {
      return res.status(400).json({ error: 'Aucune vue support active.' });
    }
    await run(`
      INSERT INTO admin_audit (admin_user_id, target_user_id, target_username, action, reason)
      VALUES (?, ?, ?, 'support_end', 'Fermeture de la vue support temporaire')
    `, [req.adminUserId, req.session.userId, (await getUserById(req.session.userId))?.username || 'Compte supprimé']);
    req.session.userId = req.session.adminUserId;
    delete req.session.adminUserId;
    delete req.session.supportOriginalUserId;
    req.session.save((error) => {
      if (error) {
        console.error('Erreur de fermeture de la vue support :', error);
        return res.status(500).json({ error: 'Impossible de revenir au compte administrateur.' });
      }
      res.json({ ok: true });
    });
  }));

  app.get('/api/me', requireAuth, async (req, res) => {
    const user = await getUserById(req.session.userId);
    const adminUserId = req.session.adminUserId || req.session.userId;
    const admin = await get('SELECT is_admin, username FROM users WHERE id = ?', [adminUserId]);
    const stats = await get(`
      SELECT COUNT(*) AS gamesPlayed,
        SUM(CASE WHEN net > 0 THEN 1 ELSE 0 END) AS wins,
        COALESCE(MAX(payout), 0) AS bestWin,
        MAX(created_at) AS lastPlayed
      FROM game_history WHERE user_id = ?
    `, [req.session.userId]);
    res.json({
      user,
      isAdmin: Boolean(admin?.is_admin),
      isPrimaryAdmin: Boolean(admin?.is_admin && admin.username.toLowerCase() === PRIMARY_ADMIN_USERNAME.toLowerCase()),
      supportMode: Boolean(req.session.supportOriginalUserId),
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

  app.patch('/api/profile/design', requireAuth, handleAsync(async (req, res) => {
    const { accent, style, banner, fit, position, bio } = req.body || {};
    if (!/^#[0-9a-f]{6}$/i.test(accent || '') ||
        !['aurora', 'midnight', 'sunset'].includes(style) ||
        !['cover', 'contain'].includes(fit) ||
        !Number.isInteger(position) || position < 0 || position > 100 ||
        typeof bio !== 'string' || bio.length > 160 ||
        (banner !== null && (typeof banner !== 'string' || !validateAvatarImage(banner)))) {
      return res.status(400).json({ error: 'Personnalisation invalide. Bannière PNG, JPEG ou WebP de 1 Mo maximum.' });
    }
    const design = { accent, style, banner, fit, position, bio };
    await run('UPDATE users SET profile_design = ? WHERE id = ?', [JSON.stringify(design), req.session.userId]);
    res.json({ ok: true, design });
  }));

  app.patch('/api/profile/avatar', requireAuth, async (req, res) => {
    const image = req.body?.image;
    if (image === null) {
      await run('UPDATE users SET avatar_image = NULL WHERE id = ?', [req.session.userId]);
      return res.json({ ok: true, user: await getUserById(req.session.userId) });
    }
    if (typeof image !== 'string') {
      return res.status(400).json({ error: 'Image de profil invalide.' });
    }
    const validatedImage = validateAvatarImage(image);
    if (!validatedImage) {
      return res.status(400).json({ error: 'Choisis une image PNG, JPEG ou WebP de 1 Mo maximum.' });
    }
    await run('UPDATE users SET avatar_image = ? WHERE id = ?', [validatedImage, req.session.userId]);
    res.json({ ok: true, user: await getUserById(req.session.userId) });
  });

  app.get('/api/crash/status', handleAsync(async (req, res) => {
    const settings = await getGameSettings('crash');
    const activeBet = req.session.userId ? await get(
      "SELECT id FROM crash_bets WHERE user_id = ? AND status = 'active' LIMIT 1",
      [req.session.userId]
    ) : null;
    res.json({ enabled: Boolean((settings?.enabled && !settings.maintenance) || activeBet) });
  }));

  app.get('/api/crash/state', requireAuth, requireCrashEnabled, handleAsync(async (req, res) => {
    await crashReady;
    res.json(await getCrashState(req.session.userId));
  }));

  app.post('/api/crash/bets', requireAuth, requireCrashEnabled, requireBettingAvailable('crash'), handleAsync(async (req, res) => {
    await crashReady;
    try {
      const stake = req.body?.stake;
      if (typeof stake !== 'number') {
        throw crashActionError(400, 'La mise doit être un montant numérique.');
      }
      const result = await placeCrashBet(req.session.userId, stake);
      await broadcastCrashState();
      return res.json({ ok: true, ...result });
    } catch (error) {
      if (error.status) {
        return res.status(error.status).json({ error: error.message });
      }
      throw error;
    }
  }));

  app.post('/api/crash/bets/:betId/cashout', requireAuth, requireCrashEnabled, handleAsync(async (req, res) => {
    await crashReady;
    try {
      const result = await cashoutCrashBet(req.session.userId, req.params.betId);
      await broadcastCrashState();
      return res.json({ ok: true, ...result });
    } catch (error) {
      if (error.status) {
        return res.status(error.status).json({ error: error.message });
      }
      throw error;
    }
  }));

  registerPlinkoRoutes({ app, io, requireAuth, handleAsync, run, get, all, withDatabaseTransaction,
    getGameSettings, isBettingPaused, isUserInActiveTable, hasActiveCrashBet: hasOtherActiveBet, addGameHistory, recordBankSettlement });
  registerClickerRoutes({ app, requireAuth, handleAsync, run, get, withDatabaseTransaction, isUserInActiveTable });
  registerScreenTimeRoutes({ app, requireAuth, handleAsync, run, get, withDatabaseTransaction });
  registerFps({ app, io, requireAuth, handleAsync, get, gameDir: GAME_DIR, path });
  const maintenance = registerPlatformMaintenance({ app, io, get, run, withDatabaseTransaction, requireAuth, requireAdmin, requirePrimaryAdmin, handleAsync, recordAdminAction, primaryUsername: PRIMARY_ADMIN_USERNAME,
    hasActiveGame: async (id) => isUserInActiveTable(id) || await hasOtherActiveBet(id) || Boolean(await get("SELECT id FROM mines_games WHERE user_id=? AND status='active' LIMIT 1", [id])) || Boolean(await get("SELECT id FROM horse_races WHERE user_id=? AND status!='settled' LIMIT 1", [id])) });
  registerGeneralChat({ app, io, requireAuth, requireAdmin, handleAsync, run, get, all, withDatabaseTransaction });
  registerFpsShop({ app, requireAuth, handleAsync, run, get, all, withDatabaseTransaction, isUserInActiveTable });
  registerDiceRoutes({ app, requireAuth, handleAsync, run, get, all, withDatabaseTransaction,
    getGameSettings, isBettingPaused, isUserInActiveTable, hasActiveCrashBet: hasOtherActiveBet, addGameHistory, recordBankSettlement });
  registerMinesRoutes({ app, requireAuth, handleAsync, run, get, all, withDatabaseTransaction,
    getGameSettings, isBettingPaused, isUserInActiveTable, hasActiveCrashBet: hasOtherActiveBet, addGameHistory, recordBankSettlement });
  registerHorseRacingRoutes({ app, requireAuth, handleAsync, run, get, all, withDatabaseTransaction,
    getGameSettings, isBettingPaused, isUserInActiveTable, hasActiveCrashBet: hasOtherActiveBet, addGameHistory, recordBankSettlement, databaseReady });

  registerTowerRoutes({ app, requireAuth, handleAsync, run, get, all, withDatabaseTransaction,
    getGameSettings, isBettingPaused, isUserInActiveTable, hasActiveCrashBet, addGameHistory, recordBankSettlement, databaseReady });

  app.get('/api/history', requireAuth, async (req, res) => {
    const rows = await all(
      'SELECT * FROM game_history WHERE user_id = ? ORDER BY id DESC LIMIT 50',
      [req.session.userId]
    );
    res.json({ history: rows });
  });

  app.get('/api/leaderboard', async (req, res) => {
    const rows = await all(`
      SELECT u.id, u.username, u.avatar, u.avatar_image, u.chips,
        (SELECT COUNT(*) FROM game_history gh WHERE gh.user_id = u.id AND gh.net > 0) AS wins,
        (SELECT COUNT(*) FROM game_history gh WHERE gh.user_id = u.id) AS games_played,
        (SELECT MAX(payout) FROM game_history gh WHERE gh.user_id = u.id) AS best_win
      FROM users u
      WHERE u.is_admin = 0 AND u.is_bank = 0
      ORDER BY u.chips DESC, u.id ASC
      LIMIT 10
    `);
    res.json({ leaderboard: rows });
  });

  app.get('/api/players/:id', requireAuth, handleAsync(async (req, res) => {
    const playerId = Number(req.params.id);
    if (!Number.isSafeInteger(playerId) || playerId <= 0) {
      return res.status(400).json({ error: 'Identifiant de joueur invalide.' });
    }
    const player = await get(`
      SELECT id, username, avatar, avatar_image, profile_design, chips, created_at
      FROM users WHERE id = ? AND is_admin = 0 AND is_bank = 0
    `, [playerId]);
    if (!player) return res.status(404).json({ error: 'Profil introuvable.' });
    const stats = await get(`
      SELECT COUNT(*) AS games_played,
        SUM(CASE WHEN net > 0 THEN 1 ELSE 0 END) AS wins,
        COALESCE(MAX(payout), 0) AS best_win,
        COALESCE(SUM(net), 0) AS net_total,
        MAX(created_at) AS last_played
      FROM game_history WHERE user_id = ?
    `, [playerId]);
    const gamesPlayed = Number(stats.games_played || 0);
    const wins = Number(stats.wins || 0);
    res.json({
      profile: {
        ...player,
        chips: Number(player.chips),
        gamesPlayed,
        wins,
        winRate: gamesPlayed ? Math.round((wins / gamesPlayed) * 1000) / 10 : 0,
        bestWin: Number(stats.best_win || 0),
        net: Number(stats.net_total || 0),
        lastPlayed: stats.last_played
      }
    });
  }));

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

  app.post('/api/blackjack/tables', requireAuth, requireBettingAvailable('blackjack'), async (req, res) => {
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

  app.post('/api/poker/tables', requireAuth, requireBettingAvailable('poker'), async (req, res) => {
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

  app.post('/api/blackjack/tables/:id/join', requireAuth, requireBettingAvailable('blackjack'), async (req, res) => {
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

  app.post('/api/blackjack/tables/:id/start', requireAuth, requireBettingAvailable('blackjack'), async (req, res) => {
    const table = blackjackTables.get(String(req.params.id));
    if (!table) {
      return res.status(404).json({ error: 'Table introuvable.' });
    }
    if (Number(table.hostId) !== Number(req.session.userId)) {
      return res.status(403).json({ error: 'Seul l’hôte peut lancer la manche.' });
    }

    const betAmount = Number(req.body?.betAmount);
    const settings = await getGameSettings('blackjack');
    if (!isMoney(betAmount) || betAmount < settings.minBet || betAmount > settings.maxBet) {
      return res.status(400).json({ error: `La mise doit être comprise entre ${settings.minBet} et ${settings.maxBet} €.` });
    }
    let start;
    try {
      start = await withDatabaseTransaction(async () => {
        for (const player of table.players) {
          if (await hasOtherActiveBet(player.id)) {
            return { status: 409, error: 'Tous les joueurs doivent terminer leur partie en cours avant de jouer au blackjack.' };
          }
          const user = await getUserById(player.id);
          if (!user) return { status: 404, error: 'Un joueur de la table est introuvable.' };
          player.chips = Number(user.chips);
        }
        if (!table.startRound(betAmount)) {
          return { status: 400, error: 'Mise invalide, table en cours ou solde insuffisant pour tous les joueurs.' };
        }
        await persistBlackjackTable(table);
        return { status: 200 };
      });
    } catch (error) {
      console.error('Erreur au démarrage d’une partie de blackjack :', error);
      return res.status(500).json({ error: 'Impossible de démarrer la partie.' });
    }
    if (start.status !== 200) {
      return res.status(start.status).json({ error: start.error });
    }

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
    try {
      const accepted = await withDatabaseTransaction(async () => {
        const snapshot = JSON.parse(JSON.stringify(table));
        try {
          if (!table.act(req.session.userId, action)) return false;
          await persistBlackjackTable(table);
          return true;
        } catch (error) {
          Object.assign(table, snapshot);
          throw error;
        }
      });
      if (!accepted) return res.status(400).json({ error: 'Action impossible : vérifie ton tour, tes cartes et ton solde.' });
    } catch (error) {
      console.error('Action blackjack non enregistrée :', error);
      return res.status(500).json({ error: 'Impossible d’enregistrer cette action.' });
    }
    io.to(`blackjack:${table.id}`).emit('blackjack:table:update', tableToPublicState(table));
    res.json({ table: tableToPublicState(table, req.session.userId, true) });
  });

  for (const [game, tables] of [['blackjack', blackjackTables], ['poker', pokerTables]]) {
    app.post(`/api/${game}/tables/:id/kick`, requireAuth, handleAsync(async (req, res) => {
      const actor = await get('SELECT id, is_admin FROM users WHERE id = ?', [req.session.userId]);
      const table = tables.get(String(req.params.id));
      if (!table) return res.status(404).json({ error: 'Table introuvable.' });
      if (!actor || (!actor.is_admin && Number(table.hostId) !== Number(actor.id))) {
        return res.status(403).json({ error: 'Seul l’hôte ou un administrateur peut expulser un joueur.' });
      }
      const playerId = req.body?.playerId;
      if (!Number.isSafeInteger(playerId) || playerId <= 0 || playerId === Number(actor.id)) {
        return res.status(400).json({ error: 'Choisis un autre joueur à expulser.' });
      }
      if (table.status === 'in-progress') {
        return res.status(409).json({ error: 'Attends la fin de la manche pour expulser un joueur.' });
      }
      if (!table.removePlayer(playerId)) return res.status(404).json({ error: 'Ce joueur n’est pas dans la table.' });
      if (!table.players.length) tables.delete(table.id);
      for (const socket of io.sockets.sockets.values()) {
        if (Number(socket.data.user?.id) === playerId) {
          socket.emit(`${game}:table:kicked`, { tableId: table.id });
          socket.leave(`${game}:${table.id}`);
        }
      }
      io.to(`${game}:${table.id}`).emit(`${game}:table:update`, tableToPublicState(table));
      res.json({ ok: true });
    }));
  }

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

  app.post('/api/poker/tables/:id/join', requireAuth, requireBettingAvailable('poker'), async (req, res) => {
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

  app.post('/api/poker/tables/:id/start', requireAuth, requireBettingAvailable('poker'), async (req, res) => {
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
    const settings = await getGameSettings('poker');
    table.blinds = { small: Math.max(0.01, moneyRatio(settings.minBet, 1, 2)), big: settings.minBet };
    try {
      if (!await startPokerRound(table)) {
        return res.status(409).json({
          error: 'Impossible de démarrer : un joueur a une mise Crash active ou la main est invalide.'
        });
      }
    } catch (error) {
      console.error('Erreur au démarrage d’une main de poker :', error);
      return res.status(500).json({ error: 'Impossible de démarrer la partie.' });
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
    const settings = await getGameSettings('poker');
    if (['bet', 'raise'].includes(action) && (!isMoney(amount) || amount > settings.maxBet)) {
      return res.status(400).json({ error: `La mise maximale est de ${settings.maxBet} €.` });
    }
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
    const normalizedGame = String(game || '');
    const normalizedBet = Number(bet);
    const normalizedPayout = Number(payout);
    const normalizedNet = Number(net);
    if (!['roulette', 'slots'].includes(normalizedGame) ||
        !isMoney(normalizedBet) || normalizedBet < 0 ||
        !isMoney(normalizedPayout) || normalizedPayout < 0 ||
        !isMoney(normalizedNet) || toCents(normalizedNet) !== toCents(normalizedPayout) - toCents(normalizedBet) ||
        typeof result !== 'string' || result.length > 80) {
      return res.status(400).json({ error: 'Payload invalide.' });
    }

    const gameSettings = await getGameSettings(normalizedGame);
    if (!gameSettings?.enabled || gameSettings.maintenance) {
      return res.status(503).json({ error: `Le jeu ${normalizedGame} est désactivé ou en maintenance.` });
    }
    if (await isBettingPaused()) {
      return res.status(503).json({ error: 'Les mises sont temporairement suspendues.' });
    }
    if (normalizedBet < gameSettings.minBet || normalizedBet > gameSettings.maxBet) {
      return res.status(400).json({ error: `La mise doit être comprise entre ${gameSettings.minBet} et ${gameSettings.maxBet} €.` });
    }

    try {
      const outcome = await withDatabaseTransaction(async () => {
        if (await hasActiveTowerGame(req.session.userId)) return { status: 409, error: 'Termine ou encaisse ta tour avant de jouer ailleurs.' };
        const user = await get('SELECT id, username, chips FROM users WHERE id = ?', [req.session.userId]);
        if (!user) return { status: 404, error: 'Utilisateur introuvable.' };
        if (normalizedBet > Number(user.chips)) {
          return { status: 400, error: 'La mise dépasse le solde du compte.' };
        }
        const newChips = roundMoney(Number(user.chips) + normalizedNet);
        if (!isMoney(newChips) || newChips < 0 || newChips > MAX_CHIPS) {
          return { status: 400, error: 'Le solde après la partie est invalide.' };
        }
        await addGameHistory(req.session.userId, normalizedGame, normalizedBet, result, normalizedPayout, normalizedNet);
        await run('UPDATE users SET chips = ? WHERE id = ?', [newChips, req.session.userId]);
        await recordBankSettlement(req.session.userId, normalizedGame, normalizedNet, user.username);
        return { status: 200 };
      });
      if (outcome.status !== 200) {
        return res.status(outcome.status).json({ error: outcome.error });
      }
      const updated = await getUserById(req.session.userId);
      return res.json({ ok: true, user: updated });
    } catch (error) {
      console.error('Erreur du règlement de partie :', error);
      return res.status(500).json({ error: 'Le résultat de la partie n’a pas pu être enregistré.' });
    }
  });

  app.post('/api/reset', requireAuth, async (req, res) => {
    const reset = await withDatabaseTransaction(async () => {
      if (await get("SELECT id FROM horse_races WHERE user_id = ? AND status != 'settled'", [req.session.userId])) return false;
      const activeCrashBet = await get(
        "SELECT id FROM crash_bets WHERE user_id = ? AND status = 'active' LIMIT 1",
        [req.session.userId]
      );
      if (activeCrashBet || await hasActiveTowerGame(req.session.userId)) return false;
      await run('UPDATE users SET infinite_money = 0, finite_chips = NULL, chips = 0, avatar = ? WHERE id = ?', ['🎲', req.session.userId]);
      await run('DELETE FROM game_history WHERE user_id = ?', [req.session.userId]);
      return true;
    });
    if (!reset) {
      return res.status(409).json({ error: 'Termine ta partie en cours avant de réinitialiser le compte.' });
    }
    const updated = await getUserById(req.session.userId);
    res.json({ ok: true, user: updated });
  });

  app.use((error, req, res, next) => {
    console.error('Erreur serveur API :', error);
    if (res.headersSent) {
      return next(error);
    }
    return res.status(500).json({ error: 'Une erreur serveur est survenue.' });
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
