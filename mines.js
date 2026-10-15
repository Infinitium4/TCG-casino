const { isMoney, roundMoney, moneyRatio } = require('./underground/js/money');
const crypto = require('node:crypto');

const BOARD_SIZE = 25;
const RTP = 0.99;
const MAX_STAKE = 1_000_000;

function validMineCount(mineCount) {
  return Number.isInteger(mineCount) && mineCount >= 1 && mineCount <= 24;
}

function validSafeCount(mineCount, safeCount) {
  return validMineCount(mineCount) && Number.isInteger(safeCount) && safeCount >= 0 && safeCount <= BOARD_SIZE - mineCount;
}

function survivalFraction(mineCount, safeCount) {
  if (!validSafeCount(mineCount, safeCount)) throw new RangeError('Paramètres Mines invalides.');
  let numerator = 1n;
  let denominator = 1n;
  for (let index = 0; index < safeCount; index += 1) {
    numerator *= BigInt(BOARD_SIZE - index);
    denominator *= BigInt(BOARD_SIZE - mineCount - index);
  }
  return { numerator, denominator };
}

function survivalProbability(mineCount, safeCount) {
  const { numerator, denominator } = survivalFraction(mineCount, safeCount);
  return Number(denominator) / Number(numerator);
}

function multiplierFor(mineCount, safeCount) {
  return RTP / survivalProbability(mineCount, safeCount);
}

function payoutFor(stake, mineCount, safeCount) {
  if (!isMoney(stake) || stake < 0.01) throw new RangeError('Mise Mines invalide.');
  const { numerator, denominator } = survivalFraction(mineCount, safeCount);
  return moneyRatio(stake, numerator * 99n, denominator * 100n);
}

function generateMinePositions(mineCount, randomInt = crypto.randomInt) {
  if (!validMineCount(mineCount)) throw new RangeError('Nombre de mines invalide.');
  const positions = Array.from({ length: BOARD_SIZE }, (_, index) => index);
  for (let index = 0; index < mineCount; index += 1) {
    const selected = randomInt(index, BOARD_SIZE);
    [positions[index], positions[selected]] = [positions[selected], positions[index]];
  }
  return positions.slice(0, mineCount).sort((left, right) => left - right);
}

async function initializeMinesSchema(run) {
  await run(`CREATE TABLE IF NOT EXISTS mines_games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    stake INTEGER NOT NULL,
    mine_count INTEGER NOT NULL,
    mine_positions TEXT NOT NULL,
    revealed_positions TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    payout INTEGER NOT NULL DEFAULT 0,
    created_at_ms INTEGER NOT NULL,
    completed_at_ms INTEGER,
    UNIQUE(user_id, request_id)
  )`);
  await run("CREATE UNIQUE INDEX IF NOT EXISTS mines_one_active_game ON mines_games(user_id) WHERE status = 'active'");
  await run(`CREATE TABLE IF NOT EXISTS mines_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES mines_games(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    action TEXT NOT NULL,
    cell INTEGER,
    result_json TEXT NOT NULL,
    UNIQUE(game_id, request_id)
  )`);
  await run('CREATE INDEX IF NOT EXISTS mines_games_user_recent ON mines_games(user_id, id DESC)');
}

function registerMinesRoutes(deps) {
  const { app, requireAuth, handleAsync, run, get, all, withDatabaseTransaction,
    getGameSettings, isBettingPaused, isUserInActiveTable, hasActiveCrashBet,
    addGameHistory, recordBankSettlement } = deps;
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const validRequestId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(value);
  const parsePositions = value => JSON.parse(value || '[]');
  const present = (game, includeMines = game.status !== 'active') => {
    const mines = parsePositions(game.mine_positions);
    const revealed = parsePositions(game.revealed_positions);
    const safeCount = revealed.filter(position => !mines.includes(position)).length;
    return {
      id: game.id,
      stake: game.stake,
      mineCount: game.mine_count,
      revealed,
      safeCount,
      multiplier: multiplierFor(game.mine_count, safeCount),
      potential: payoutFor(game.stake, game.mine_count, safeCount),
      status: game.status,
      payout: game.payout,
      ...(includeMines ? { mines } : {})
    };
  };
  const currentBalance = async userId => (await get('SELECT chips FROM users WHERE id = ?', [userId])).chips;
  const recordSettlement = async (userId, user, game, payout, result) => {
    await addGameHistory(userId, 'mines', game.stake, result, payout, roundMoney(payout - game.stake));
    await recordBankSettlement(userId, 'mines', roundMoney(payout - game.stake), user.username);
  };

  app.get('/api/mines/state', requireAuth, handleAsync(async (req, res) => {
    const userId = req.session.userId;
    const [user, latest, history] = await Promise.all([
      get('SELECT chips FROM users WHERE id = ?', [userId]),
      get('SELECT * FROM mines_games WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]),
      all(`SELECT id, stake, mine_count, revealed_positions, mine_positions, status, payout
        FROM mines_games WHERE user_id = ? AND status != 'active' ORDER BY id DESC LIMIT 10`, [userId])
    ]);
    res.json({
      balance: user.chips,
      settings: await getGameSettings('mines'),
      paused: await isBettingPaused(),
      game: latest ? present(latest) : null,
      history: history.map(game => {
        const mines = parsePositions(game.mine_positions);
        const revealed = parsePositions(game.revealed_positions);
        return {
          id: game.id,
          stake: game.stake,
          mineCount: game.mine_count,
          safeCount: revealed.filter(position => !mines.includes(position)).length,
          status: game.status,
          payout: game.payout
        };
      })
    });
  }));

  app.post('/api/mines/start', requireAuth, handleAsync(async (req, res) => {
    const { stake, mineCount, requestId } = req.body || {};
    if (!isMoney(stake) || stake < 0.01 || stake > MAX_STAKE || !validMineCount(mineCount) || !validRequestId(requestId)) {
      return res.status(400).json({ error: 'Mise ou nombre de mines invalide.' });
    }
    try {
      const result = await withDatabaseTransaction(async () => {
        const userId = req.session.userId;
        const user = await get('SELECT chips, username, is_bank, is_banned, suspended_until FROM users WHERE id = ?', [userId]);
        if (!user || user.is_bank || user.is_banned || Number(user.suspended_until || 0) > Date.now()) throw fail(403, 'Compte indisponible.');
        const existing = await get('SELECT * FROM mines_games WHERE user_id = ? AND request_id = ?', [userId, requestId]);
        if (existing) {
          if (existing.stake !== stake || existing.mine_count !== mineCount) throw fail(409, 'Cet identifiant correspond à une autre partie.');
          return { game: present(existing), balance: user.chips, replay: true };
        }
        const settings = await getGameSettings('mines');
        if (!settings?.enabled || settings.maintenance || await isBettingPaused()) throw fail(503, 'Les mises Mines sont suspendues.');
        if (stake < settings.minBet || stake > settings.maxBet) throw fail(400, `Mise autorisée : ${settings.minBet} à ${Math.min(settings.maxBet, MAX_STAKE)} €.`);
        if (isUserInActiveTable(userId) || await hasActiveCrashBet(userId)) throw fail(409, 'Termine ta partie en cours avant de jouer à Mines.');
        const active = await get("SELECT id FROM mines_games WHERE user_id = ? AND status = 'active'", [userId]);
        if (active) throw fail(409, 'Termine ta partie Mines en cours avant d’en lancer une autre.');
        const last = await get('SELECT created_at_ms FROM mines_games WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);
        if (last && Date.now() - last.created_at_ms < 250) throw fail(429, 'Attends un instant avant de relancer.');
        if (user.chips < stake) throw fail(400, 'Solde insuffisant.');
        const debit = await run('UPDATE users SET chips = ROUND(chips - ?, 2) WHERE id = ? AND chips >= ?', [stake, userId, stake]);
        if (!debit.changes) throw fail(400, 'Solde insuffisant.');
        const createdAt = Date.now();
        const saved = await run(`INSERT INTO mines_games (user_id, request_id, stake, mine_count, mine_positions, created_at_ms)
          VALUES (?, ?, ?, ?, ?, ?)`, [userId, requestId, stake, mineCount, JSON.stringify(generateMinePositions(mineCount)), createdAt]);
        const game = await get('SELECT * FROM mines_games WHERE id = ?', [saved.id]);
        const updatedUser = await get('SELECT chips FROM users WHERE id = ?', [userId]);
        return { game: present(game), balance: updatedUser.chips, replay: false };
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      throw error;
    }
  }));

  app.post('/api/mines/reveal', requireAuth, handleAsync(async (req, res) => {
    const { gameId, cell, requestId } = req.body || {};
    if (!Number.isSafeInteger(gameId) || gameId < 1 || !Number.isInteger(cell) || cell < 0 || cell >= BOARD_SIZE || !validRequestId(requestId)) {
      return res.status(400).json({ error: 'Case ou identifiant de requête invalide.' });
    }
    try {
      const result = await withDatabaseTransaction(async () => {
        const userId = req.session.userId;
        const game = await get('SELECT * FROM mines_games WHERE id = ? AND user_id = ?', [gameId, userId]);
        if (!game) throw fail(404, 'Partie Mines introuvable.');
        const previous = await get('SELECT * FROM mines_actions WHERE game_id = ? AND request_id = ?', [gameId, requestId]);
        if (previous) {
          if (previous.action !== 'reveal' || previous.cell !== cell) throw fail(409, 'Cet identifiant correspond à une autre action.');
          const saved = JSON.parse(previous.result_json);
          return { ...saved, balance: await currentBalance(userId), replay: true };
        }
        if (game.status !== 'active') throw fail(409, 'Cette partie est déjà terminée.');
        const mines = parsePositions(game.mine_positions);
        const revealed = parsePositions(game.revealed_positions);
        if (revealed.includes(cell)) throw fail(409, 'Cette case a déjà été révélée.');
        const nextRevealed = [...revealed, cell];
        const hitMine = mines.includes(cell);
        const safeCount = nextRevealed.filter(position => !mines.includes(position)).length;
        let status = 'active';
        let payout = 0;
        let user = null;
        if (hitMine) status = 'lost';
        else if (safeCount === BOARD_SIZE - game.mine_count) {
          status = 'won';
          payout = payoutFor(game.stake, game.mine_count, safeCount);
        }
        if (status !== 'active') {
          user = await get('SELECT chips, username FROM users WHERE id = ?', [userId]);
          if (!isMoney(roundMoney(user.chips + payout))) throw fail(400, 'Le solde maximal serait dépassé.');
          if (payout) await run('UPDATE users SET chips = ROUND(chips + ?, 2) WHERE id = ?', [payout, userId]);
        }
        await run(`UPDATE mines_games SET revealed_positions = ?, status = ?, payout = ?, completed_at_ms = ? WHERE id = ?`,
          [JSON.stringify(nextRevealed), status, payout, status === 'active' ? null : Date.now(), gameId]);
        const updated = await get('SELECT * FROM mines_games WHERE id = ?', [gameId]);
        const response = { game: present(updated), hitMine };
        if (status !== 'active') await recordSettlement(userId, user, game, payout, hitMine ? 'Mine' : `Toutes les cases sûres · ${multiplierFor(game.mine_count, safeCount).toFixed(2)}x`);
        await run(`INSERT INTO mines_actions (game_id, request_id, action, cell, result_json) VALUES (?, ?, 'reveal', ?, ?)`,
          [gameId, requestId, cell, JSON.stringify(response)]);
        return { ...response, balance: await currentBalance(userId), replay: false };
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      throw error;
    }
  }));

  app.post('/api/mines/cashout', requireAuth, handleAsync(async (req, res) => {
    const { gameId, requestId } = req.body || {};
    if (!Number.isSafeInteger(gameId) || gameId < 1 || !validRequestId(requestId)) {
      return res.status(400).json({ error: 'Partie ou identifiant de requête invalide.' });
    }
    try {
      const result = await withDatabaseTransaction(async () => {
        const userId = req.session.userId;
        const game = await get('SELECT * FROM mines_games WHERE id = ? AND user_id = ?', [gameId, userId]);
        if (!game) throw fail(404, 'Partie Mines introuvable.');
        const previous = await get('SELECT * FROM mines_actions WHERE game_id = ? AND request_id = ?', [gameId, requestId]);
        if (previous) {
          if (previous.action !== 'cashout') throw fail(409, 'Cet identifiant correspond à une autre action.');
          const saved = JSON.parse(previous.result_json);
          return { ...saved, balance: await currentBalance(userId), replay: true };
        }
        if (game.status !== 'active') throw fail(409, 'Cette partie est déjà terminée.');
        const mines = parsePositions(game.mine_positions);
        const revealed = parsePositions(game.revealed_positions);
        const safeCount = revealed.filter(position => !mines.includes(position)).length;
        const payout = payoutFor(game.stake, game.mine_count, safeCount);
        const user = await get('SELECT chips, username FROM users WHERE id = ?', [userId]);
        if (!isMoney(roundMoney(user.chips + payout))) throw fail(400, 'Le solde maximal serait dépassé.');
        await run('UPDATE users SET chips = ROUND(chips + ?, 2) WHERE id = ?', [payout, userId]);
        await run("UPDATE mines_games SET status = 'cashed_out', payout = ?, completed_at_ms = ? WHERE id = ?", [payout, Date.now(), gameId]);
        const updated = await get('SELECT * FROM mines_games WHERE id = ?', [gameId]);
        const response = { game: present(updated), hitMine: false };
        await recordSettlement(userId, user, game, payout, `Encaissement · ${multiplierFor(game.mine_count, safeCount).toFixed(2)}x`);
        await run(`INSERT INTO mines_actions (game_id, request_id, action, cell, result_json) VALUES (?, ?, 'cashout', NULL, ?)`,
          [gameId, requestId, JSON.stringify(response)]);
        return { ...response, balance: await currentBalance(userId), replay: false };
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      throw error;
    }
  }));
}

module.exports = {
  BOARD_SIZE,
  RTP,
  validMineCount,
  validSafeCount,
  survivalProbability,
  multiplierFor,
  payoutFor,
  generateMinePositions,
  initializeMinesSchema,
  registerMinesRoutes
};