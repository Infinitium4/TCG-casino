const crypto = require('node:crypto');

function thresholdUnits(threshold) {
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 1 || threshold > 99) return null;
  const units = Math.round(threshold * 100);
  return Math.abs(threshold * 100 - units) < 1e-8 ? units : null;
}
function winningOutcomes(mode, threshold) {
  const units = thresholdUnits(threshold);
  if (units === null || !['under', 'over'].includes(mode)) throw new RangeError('Paramètres Dice invalides.');
  return mode === 'under' ? units : 10000 - units;
}
function rollDice(stake, mode, threshold, randomInt = crypto.randomInt) {
  const outcomes = winningOutcomes(mode, threshold);
  const units = thresholdUnits(threshold);
  const resultUnits = randomInt(10000);
  const won = mode === 'under' ? resultUnits < units : resultUnits >= units;
  return { result: resultUnits / 100, won, probability: outcomes / 100,
    multiplier: 9900 / outcomes, payout: won ? Math.floor(stake * 9900 / outcomes) : 0 };
}

async function initializeDiceSchema(run) {
  await run(`CREATE TABLE IF NOT EXISTS dice_rolls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    stake INTEGER NOT NULL,
    mode TEXT NOT NULL,
    threshold_units INTEGER NOT NULL,
    result_units INTEGER NOT NULL,
    payout INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL,
    UNIQUE(user_id, request_id)
  )`);
  await run('CREATE INDEX IF NOT EXISTS dice_rolls_user_recent ON dice_rolls(user_id, id DESC)');
}

function registerDiceRoutes(deps) {
  const { app, requireAuth, handleAsync, run, get, all, withDatabaseTransaction,
    getGameSettings, isBettingPaused, isUserInActiveTable, hasActiveCrashBet,
    addGameHistory, recordBankSettlement } = deps;
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const present = row => {
    const threshold = row.threshold_units / 100;
    const outcomes = winningOutcomes(row.mode, threshold);
    return { id: row.id, requestId: row.request_id, stake: row.stake, mode: row.mode, threshold,
      result: row.result_units / 100, won: row.mode === 'under' ? row.result_units < row.threshold_units : row.result_units >= row.threshold_units,
      multiplier: 9900 / outcomes, probability: outcomes / 100, payout: row.payout, createdAt: row.created_at_ms };
  };
  app.get('/api/dice/state', requireAuth, handleAsync(async (req, res) => {
    const user = await get('SELECT chips FROM users WHERE id = ?', [req.session.userId]);
    const history = await all('SELECT * FROM dice_rolls WHERE user_id = ? ORDER BY id DESC LIMIT 20', [req.session.userId]);
    res.json({ balance: user.chips, settings: await getGameSettings('dice'),
      paused: await isBettingPaused(), rtp: .99, history: history.map(present) });
  }));
  app.post('/api/dice/roll', requireAuth, handleAsync(async (req, res) => {
    const { stake, mode, threshold, requestId } = req.body || {};
    const units = thresholdUnits(threshold);
    if (!Number.isSafeInteger(stake) || stake < 1 || stake > 1_000_000 || units === null ||
        !['under', 'over'].includes(mode) || typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) {
      return res.status(400).json({ error: 'Mise ou paramètres Dice invalides. Seuil de 1 à 99, avec deux décimales maximum.' });
    }
    try {
      const result = await withDatabaseTransaction(async () => {
        const userId = req.session.userId;
        const user = await get('SELECT chips, username, is_bank, is_banned, suspended_until FROM users WHERE id = ?', [userId]);
        if (!user || user.is_bank || user.is_banned || Number(user.suspended_until || 0) > Date.now()) throw fail(403, 'Compte indisponible.');
        const existing = await get('SELECT * FROM dice_rolls WHERE user_id = ? AND request_id = ?', [userId, requestId]);
        if (existing) {
          if (existing.stake !== stake || existing.mode !== mode || existing.threshold_units !== units) throw fail(409, 'Cet identifiant correspond à une autre partie.');
          return { roll: present(existing), balance: user.chips, replay: true };
        }
        const settings = await getGameSettings('dice');
        if (!settings?.enabled || settings.maintenance || await isBettingPaused()) throw fail(503, 'Les mises Dice sont suspendues.');
        if (stake < settings.minBet || stake > settings.maxBet) throw fail(400, `Mise autorisée : ${settings.minBet} à ${Math.min(settings.maxBet, 1_000_000)} jetons.`);
        if (isUserInActiveTable(userId) || await hasActiveCrashBet(userId)) throw fail(409, 'Termine ta partie en cours avant de jouer à Dice.');
        const now = Date.now();
        const last = await get('SELECT created_at_ms FROM dice_rolls WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);
        if (last && now - last.created_at_ms < 250) throw fail(429, 'Attends un instant avant de relancer.');
        if (user.chips < stake) throw fail(400, 'Solde insuffisant.');
        const outcome = rollDice(stake, mode, threshold);
        if (!Number.isSafeInteger(user.chips - stake + outcome.payout)) throw fail(400, 'Le solde maximal serait dépassé.');
        const debit = await run('UPDATE users SET chips = chips - ? WHERE id = ? AND chips >= ?', [stake, userId, stake]);
        if (!debit.changes) throw fail(400, 'Solde insuffisant.');
        await run('UPDATE users SET chips = chips + ? WHERE id = ?', [outcome.payout, userId]);
        const saved = await run(`INSERT INTO dice_rolls (user_id, request_id, stake, mode, threshold_units, result_units, payout, created_at_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [userId, requestId, stake, mode, units, Math.round(outcome.result * 100), outcome.payout, now]);
        await addGameHistory(userId, 'dice', stake, `${mode === 'under' ? 'Under <' : 'Over ≥'} ${threshold.toFixed(2)} · Résultat ${outcome.result.toFixed(2)}`, outcome.payout, outcome.payout - stake);
        await recordBankSettlement(userId, 'dice', outcome.payout - stake, user.username);
        const settled = await get('SELECT chips FROM users WHERE id = ?', [userId]);
        return { roll: { id: saved.id, requestId, stake, mode, threshold: units / 100, ...outcome, createdAt: now }, balance: settled.chips, replay: false };
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      throw error;
    }
  }));
}
module.exports = { thresholdUnits, winningOutcomes, rollDice, initializeDiceSchema, registerDiceRoutes };
