const { isMoney, roundMoney, moneyRatio } = require('./underground/js/money');
const crypto = require('node:crypto');
const { initializeHorseTables, registerHorseTables } = require('./horse-tables');

const HORSES = Object.freeze([
  { id: 1, name: 'Éclair', color: '#ef454f' },
  { id: 2, name: 'Tornade', color: '#42a7ef' },
  { id: 3, name: 'Flash', color: '#48ce91' },
  { id: 4, name: 'Tempête', color: '#f5ce55' },
  { id: 5, name: 'Comète', color: '#b482ef' }
]);

function generateRace(randomInt = crypto.randomInt) {
  const order = HORSES.map(horse => horse.id);
  for (let i = order.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const trajectories = HORSES.map(horse => {
    const weights = Array.from({ length: 16 }, () => randomInt(50, 151));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let progress = 0;
    return { id: horse.id, finishMs: 12000 + order.indexOf(horse.id) * 500,
      checkpoints: [0, ...weights.map(weight => (progress += weight / total)), 1].slice(0, 17).map((value, index) => index === 16 ? 1 : value) };
  });
  return { order, trajectories, durationMs: 14000 };
}

async function initializeHorseRacingSchema(run) {
  await run(`CREATE TABLE IF NOT EXISTS horse_races (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL, horse_id INTEGER NOT NULL CHECK(horse_id BETWEEN 1 AND 5),
    stake INTEGER NOT NULL CHECK(stake > 0), winner INTEGER NOT NULL,
    outcome TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('ready','running','settled')),
    created_at_ms INTEGER NOT NULL, started_at_ms INTEGER, ends_at_ms INTEGER,
    payout INTEGER NOT NULL DEFAULT 0, settled_at_ms INTEGER,
    UNIQUE(user_id, request_id)
  )`);
  await run("CREATE UNIQUE INDEX IF NOT EXISTS horse_races_one_active ON horse_races(user_id) WHERE status != 'settled'");
  await initializeHorseTables(run);
}

function registerHorseRacingRoutes(deps) {
  const { app, requireAuth, handleAsync, run, get, all, withDatabaseTransaction,
    getGameSettings, isBettingPaused, isUserInActiveTable, hasActiveCrashBet,
    addGameHistory, recordBankSettlement, databaseReady = Promise.resolve() } = deps;
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const publicRace = row => row && ({ id: row.id, requestId: row.request_id, horseId: row.horse_id,
    stake: row.stake, status: row.status, startedAt: row.started_at_ms, endsAt: row.ends_at_ms,
    ...(row.status !== 'ready' ? { ...JSON.parse(row.outcome), winner: row.winner } : {}),
    payout: row.payout, odds: Number(row.odds_cents || 400) / 100, eventId: row.event_id || null, cancelled: Boolean(row.cancelled) });
  async function settle(row) {
    if (!row || row.status !== 'running' || Date.now() < row.ends_at_ms) return row;
    const payout = row.horse_id === row.winner ? moneyRatio(row.stake, Number(row.odds_cents || 400), 100) : 0;
    const user = await get('SELECT chips, username FROM users WHERE id = ?', [row.user_id]);
    if (!isMoney(roundMoney(user.chips + payout))) throw fail(409, 'Le solde maximal serait dépassé.');
    const update = await run("UPDATE horse_races SET status = 'settled', payout = ?, settled_at_ms = ? WHERE id = ? AND status = 'running'", [payout, Date.now(), row.id]);
    if (update.changes) {
      await run('UPDATE users SET chips = ROUND(chips + ?, 2) WHERE id = ?', [payout, row.user_id]);
      await addGameHistory(row.user_id, 'horses', row.stake, payout ? 'Victoire' : 'Défaite', payout, roundMoney(payout - row.stake));
      await recordBankSettlement(row.user_id, 'horses', roundMoney(payout - row.stake), user.username);
    }
    return get('SELECT * FROM horse_races WHERE id = ?', [row.id]);
  }
  function route(handler) {
    return handleAsync(async (req, res) => {
      try { await handler(req, res); }
      catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); throw error; }
    });
  }
  const tablesApi = registerHorseTables(deps, { HORSES, generateRace, publicRace, settle, route });
  const settlementTimer = setInterval(() => {
    databaseReady.then(() => withDatabaseTransaction(async () => {
      await tablesApi.settleDue();
      const due = await all("SELECT * FROM horse_races WHERE event_id IS NULL AND status = 'running' AND ends_at_ms <= ?", [Date.now()]);
      for (const row of due) await settle(row);
    })).catch(error => console.error('Règlement hippique impossible :', error));
  }, 1000);
  settlementTimer.unref();
  async function response(userId, row) {
    const user = await get('SELECT chips FROM users WHERE id = ?', [userId]);
    return { race: publicRace(row), balance: user.chips, serverNow: Date.now() };
  }
  app.get('/api/horses/state', requireAuth, route(async (req, res) => {
    const payload = await withDatabaseTransaction(async () => {
      const shared = await tablesApi.state(req.session.userId);
      if (shared.table) return shared;
      const row = await settle(await get('SELECT * FROM horse_races WHERE user_id = ? AND event_id IS NULL ORDER BY created_at_ms DESC, rowid DESC LIMIT 1', [req.session.userId]));
      return { ...await response(req.session.userId, row), ...shared, race: publicRace(row) };
    });
    const history = await all("SELECT * FROM horse_races WHERE user_id = ? AND status = 'settled' ORDER BY settled_at_ms DESC LIMIT 10", [req.session.userId]);
    res.json({ ...payload, horses: HORSES, settings: await getGameSettings('horses'), paused: await isBettingPaused(), history: history.map(publicRace) });
  }));
  app.post('/api/horses/bet', requireAuth, route(async (req, res) => {
    const { stake, horseId, requestId } = req.body || {};
    if (!isMoney(stake) || stake <= 0 || stake > 1_000_000 || !Number.isInteger(horseId) || horseId < 1 || horseId > 5 || typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) throw fail(400, 'Cheval, mise ou identifiant invalide.');
    const payload = await withDatabaseTransaction(async () => {
      const userId = req.session.userId;
      const existing = await get('SELECT * FROM horse_races WHERE user_id = ? AND request_id = ?', [userId, requestId]);
      if (existing) {
        if (existing.stake !== stake || existing.horse_id !== horseId) throw fail(409, 'Ce pari existe avec des paramètres différents.');
        return response(userId, await settle(existing));
      }
      const settings = await getGameSettings('horses');
      if (!settings?.enabled || settings.maintenance || await isBettingPaused()) throw fail(503, 'Les paris hippiques sont suspendus.');
      if (stake < settings.minBet || stake > settings.maxBet) throw fail(400, `Mise autorisée : ${settings.minBet} à ${settings.maxBet} €.`);
      if (await get('SELECT table_id FROM horse_table_members WHERE user_id = ?', [userId])) throw fail(409, 'Utilise le panneau de paris de ta table.');
      await settle(await get("SELECT * FROM horse_races WHERE user_id = ? AND status != 'settled'", [userId]));
      if (await get("SELECT id FROM horse_races WHERE user_id = ? AND status != 'settled'", [userId])) throw fail(409, 'Termine ta course avant de miser à nouveau.');
      if (isUserInActiveTable(userId) || await hasActiveCrashBet(userId)) throw fail(409, 'Termine ta partie en cours avant de miser.');
      const user = await get('SELECT chips FROM users WHERE id = ?', [userId]);
      if (!isMoney(roundMoney(user.chips - stake + stake * 4))) throw fail(400, 'Le solde maximal serait dépassé.');
      const debit = await run('UPDATE users SET chips = ROUND(chips - ?, 2) WHERE id = ? AND chips >= ?', [stake, userId, stake]);
      if (!debit.changes) throw fail(400, 'Solde insuffisant.');
      const outcome = generateRace();
      const id = crypto.randomUUID();
      await run("INSERT INTO horse_races (id,user_id,request_id,horse_id,stake,winner,outcome,status,created_at_ms) VALUES (?,?,?,?,?,?,?,'ready',?)", [id, userId, requestId, horseId, stake, outcome.order[0], JSON.stringify(outcome), Date.now()]);
      return response(userId, await get('SELECT * FROM horse_races WHERE id = ?', [id]));
    });
    res.json(payload);
  }));
  app.post('/api/horses/:id/start', requireAuth, route(async (req, res) => {
    const payload = await withDatabaseTransaction(async () => {
      let row = await get('SELECT * FROM horse_races WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
      if (!row) throw fail(404, 'Course introuvable.');
      if (row.event_id) throw fail(409, 'Seul l’hôte peut lancer la course depuis la table.');
      if (row.status === 'ready') {
        const start = Date.now() + 3000;
        await run("UPDATE horse_races SET status = 'running', started_at_ms = ?, ends_at_ms = ? WHERE id = ? AND status = 'ready'", [start, start + JSON.parse(row.outcome).durationMs, row.id]);
        row = await get('SELECT * FROM horse_races WHERE id = ?', [row.id]);
      }
      return response(req.session.userId, await settle(row));
    });
    res.json(payload);
  }));
  app.post('/api/horses/:id/settle', requireAuth, route(async (req, res) => {
    const payload = await withDatabaseTransaction(async () => {
      const row = await get('SELECT * FROM horse_races WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
      if (!row) throw fail(404, 'Course introuvable.');
      if (row.status === 'ready' || row.status === 'running' && Date.now() < row.ends_at_ms) throw fail(409, 'La course n’est pas terminée.');
      if (row.event_id) {
        await tablesApi.settleDue();
        return tablesApi.state(req.session.userId);
      }
      return response(req.session.userId, await settle(row));
    });
    res.json(payload);
  }));
}

module.exports = { HORSES, generateRace, initializeHorseRacingSchema, registerHorseRacingRoutes };
