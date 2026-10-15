const crypto = require('node:crypto');

const MULTIPLIERS = Object.freeze([110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110]);
const ROWS = 16;
function binomial(n, k) {
  let value = 1;
  for (let i = 1; i <= k; i++) value = value * (n - i + 1) / i;
  return value;
}
const PROBABILITIES = MULTIPLIERS.map((_, k) => binomial(ROWS, k) / 2 ** ROWS);
const RTP = MULTIPLIERS.reduce((sum, value, k) => sum + value * PROBABILITIES[k], 0);

function generateDrop(randomInt = crypto.randomInt) {
  const path = Array.from({ length: ROWS }, () => randomInt(2));
  const slot = path.reduce((sum, direction) => sum + direction, 0);
  return { path, slot, multiplier: MULTIPLIERS[slot] };
}
function payoutFor(stake, multiplier) {
  // Integer tenths avoid floating point rounding errors (e.g. 0.3x).
  return Math.floor(stake * Math.round(multiplier * 10) / 10);
}

async function initializePlinkoSchema(run) {
  await run(`CREATE TABLE IF NOT EXISTS plinko_drops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    stake INTEGER NOT NULL,
    risk TEXT NOT NULL,
    path TEXT NOT NULL,
    slot INTEGER NOT NULL,
    multiplier REAL NOT NULL,
    payout INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL,
    UNIQUE(user_id, request_id)
  )`);
  await run('CREATE INDEX IF NOT EXISTS plinko_drops_user_recent ON plinko_drops(user_id, id DESC)');
}

function registerPlinkoRoutes(deps) {
  const { app, io, requireAuth, handleAsync, run, get, all, withDatabaseTransaction,
    getGameSettings, isBettingPaused, isUserInActiveTable, hasActiveCrashBet,
    addGameHistory, recordBankSettlement } = deps;
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const publicDrop = row => ({ id: row.id, username: row.username, stake: row.stake,
    multiplier: row.multiplier, payout: row.payout, createdAt: row.created_at_ms });
  const privateDrop = row => ({ ...publicDrop(row), requestId: row.request_id,
    path: JSON.parse(row.path), slot: row.slot, risk: row.risk });

  app.get('/api/plinko/state', requireAuth, handleAsync(async (req, res) => {
    const settings = await getGameSettings('plinko');
    const user = await get('SELECT chips FROM users WHERE id = ?', [req.session.userId]);
    const history = await all('SELECT * FROM plinko_drops WHERE user_id = ? ORDER BY id DESC LIMIT 20', [req.session.userId]);
    const recent = await all(`SELECT d.*, u.username FROM plinko_drops d JOIN users u ON u.id = d.user_id
      ORDER BY d.id DESC LIMIT 20`);
    res.json({ settings, balance: user.chips, rows: ROWS, multipliers: MULTIPLIERS,
      probabilities: PROBABILITIES, rtp: RTP, risks: ['high'],
      paused: await isBettingPaused(), history: history.map(privateDrop), recent: recent.map(publicDrop) });
  }));

  app.post('/api/plinko/drop', requireAuth, handleAsync(async (req, res) => {
    const { stake, requestId, risk = 'high', rows = ROWS } = req.body || {};
    if (!Number.isSafeInteger(stake) || stake <= 0 || stake > 1_000_000 ||
        typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId) ||
        risk !== 'high' || rows !== ROWS) {
      return res.status(400).json({ error: 'Mise ou paramètres Plinko invalides.' });
    }
    try {
      const result = await withDatabaseTransaction(async () => {
        const userId = req.session.userId;
        const existing = await get('SELECT * FROM plinko_drops WHERE user_id = ? AND request_id = ?', [userId, requestId]);
        const user = await get('SELECT chips, username, is_bank, is_banned, suspended_until FROM users WHERE id = ?', [userId]);
        if (!user || user.is_bank || user.is_banned || Number(user.suspended_until || 0) > Date.now()) throw fail(403, 'Compte indisponible.');
        if (existing) {
          if (existing.stake !== stake || existing.risk !== risk) throw fail(409, 'Ce lancer existe avec une autre mise.');
          return { drop: privateDrop(existing), balance: user.chips, replay: true };
        }
        const settings = await getGameSettings('plinko');
        if (!settings?.enabled || settings.maintenance || await isBettingPaused()) throw fail(503, 'Les mises Plinko sont suspendues.');
        if (stake < settings.minBet || stake > settings.maxBet) throw fail(400, `Mise autorisée : ${settings.minBet} à ${Math.min(settings.maxBet, 1_000_000)} jetons.`);
        if (isUserInActiveTable(userId) || await hasActiveCrashBet(userId)) throw fail(409, 'Termine ta partie en cours avant de lancer une bille.');
        const now = Date.now();
        const last = await get('SELECT created_at_ms FROM plinko_drops WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);
        if (last && now - last.created_at_ms < 250) throw fail(429, 'Attends un instant avant de relancer.');
        if (user.chips < stake) throw fail(400, 'Solde insuffisant.');
        const outcome = generateDrop();
        const payout = payoutFor(stake, outcome.multiplier);
        const balance = user.chips - stake + payout;
        if (!Number.isSafeInteger(balance) || balance < 0) throw fail(400, 'Le solde maximal serait dépassé.');
        const debit = await run('UPDATE users SET chips = chips - ? WHERE id = ? AND chips >= ?', [stake, userId, stake]);
        if (!debit.changes) throw fail(400, 'Solde insuffisant.');
        await run('UPDATE users SET chips = chips + ? WHERE id = ?', [payout, userId]);
        const saved = await run(`INSERT INTO plinko_drops (user_id, request_id, stake, risk, path, slot, multiplier, payout, created_at_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [userId, requestId, stake, risk, JSON.stringify(outcome.path), outcome.slot, outcome.multiplier, payout, now]);
        await addGameHistory(userId, 'plinko', stake, `Case ${outcome.slot + 1} · ${outcome.multiplier}x`, payout, payout - stake);
        await recordBankSettlement(userId, 'plinko', payout - stake, user.username);
        const settledUser = await get('SELECT chips FROM users WHERE id = ?', [userId]);
        return { drop: { id: saved.id, requestId, stake, risk, ...outcome, payout, createdAt: now }, balance: settledUser.chips, replay: false, username: user.username };
      });
      if (!result.replay) io.to('plinko:feed').emit('plinko:drop', publicDrop({
        id: result.drop.id, username: result.username, stake, multiplier: result.drop.multiplier,
        payout: result.drop.payout, created_at_ms: result.drop.createdAt
      }));
      delete result.username;
      res.json({ ok: true, ...result });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      throw error;
    }
  }));
}

module.exports = { MULTIPLIERS, ROWS, RTP, PROBABILITIES, generateDrop, payoutFor, initializePlinkoSchema, registerPlinkoRoutes };
