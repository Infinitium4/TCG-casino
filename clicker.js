const LIMIT = 10;
const CREDIT = 0.05;
function clickerAllowance(balance) {
  return { remaining: Math.max(0, Math.round((LIMIT - balance) * 100) / 100), limit: LIMIT, eligible: balance < LIMIT };
}
async function initializeClickerSchema(run) {
  await run(`CREATE TABLE IF NOT EXISTS clicker_gains (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL, request_id TEXT NOT NULL,
    PRIMARY KEY(user_id, day, request_id))`);
  await run('CREATE INDEX IF NOT EXISTS clicker_gains_request ON clicker_gains(user_id, request_id)');
}
function registerClickerRoutes({ app, requireAuth, handleAsync, run, get, withDatabaseTransaction, isUserInActiveTable }) {
  const fail = (status, message) => Object.assign(new Error(message), { status });
  async function state(userId) {
    const user = await get('SELECT chips FROM users WHERE id = ?', [userId]);
    return { balance: user.chips, ...clickerAllowance(user.chips) };
  }
  app.get('/api/clicker/state', requireAuth, handleAsync(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await withDatabaseTransaction(() => state(req.session.userId)));
  }));
  app.post('/api/clicker/click', requireAuth, handleAsync(async (req, res) => {
    // JSON-only requests and same-origin browser checks prevent cross-site form credits.
    if (!req.is('application/json') || req.get('Sec-Fetch-Site') === 'cross-site') return res.status(403).json({ error: 'Requête non autorisée.' });
    const { requestId } = req.body || {};
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) return res.status(400).json({ error: 'Identifiant de clic invalide.' });
    try {
      const result = await withDatabaseTransaction(async () => {
        const userId = req.session.userId, now = Date.now();
        const user = await get('SELECT chips, is_bank, is_banned, suspended_until, infinite_money FROM users WHERE id = ?', [userId]);
        if (!user || user.is_bank || user.is_banned || Number(user.suspended_until || 0) > now) throw fail(403, 'Compte indisponible.');
        const current = await state(userId);
        const existing = await get('SELECT 1 FROM clicker_gains WHERE user_id = ? AND request_id = ?', [userId, requestId]);
        if (existing) return { ...current, replay: true };
        if (!current.eligible) throw fail(409, 'Clicker disponible uniquement avec moins de 10 €.');
        if (isUserInActiveTable(userId)) throw fail(409, 'Termine ta partie à table avant de cliquer.');
        if (user.infinite_money) throw fail(409, 'Désactive le solde infini avant de cliquer.');
        const day = new Date(now).toISOString().slice(0, 10);
        await run('INSERT INTO clicker_gains (user_id, day, request_id) VALUES (?, ?, ?)', [userId, day, requestId]);
        const credit = await run('UPDATE users SET chips = MIN(?, ROUND(chips + ?, 2)) WHERE id = ? AND chips < ?', [LIMIT, CREDIT, userId, LIMIT]);
        if (credit.changes !== 1) throw fail(409, 'Solde insuffisamment bas pour utiliser le Clicker.');
        return { ...await state(userId), replay: false };
      });
      res.json(result);
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      throw error;
    }
  }));
}
module.exports = { clickerAllowance, initializeClickerSchema, registerClickerRoutes };
