const crypto = require('node:crypto');
const { positionAt, evaluatePlacement } = require('./underground/js/tower-motion');
const DEFAULT_MULTIPLIERS = [1.08, 1.22, 1.4, 1.64, 1.95, 2.35, 2.9, 3.65];
const IDLE_MS = 120000;
const FALL_MS = 700;
const INITIAL_WIDTH = 180;
// Uniform timing reference: max success interval / horizontal travel interval.
const RANDOM_TIMING_BOUND = .9 * INITIAL_WIDTH / (552 - INITIAL_WIDTH);
function validateMultipliers(values) {
  if (!Array.isArray(values) || values.length !== 8) throw new Error('TOWER_MULTIPLIERS doit contenir 8 multiplicateurs.');
  let previous = 1;
  for (const value of values) {
    if (!Number.isFinite(value) || value <= previous || value > 20 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-8 || value / previous * RANDOM_TIMING_BOUND > .99) throw new Error('Table Tower invalide : valeurs croissantes à deux décimales, limitées à 20x et au budget de référence.');
    previous = value;
  }
  return Object.freeze([...values]);
}
const MULTIPLIERS = validateMultipliers(process.env.TOWER_MULTIPLIERS ? JSON.parse(process.env.TOWER_MULTIPLIERS) : DEFAULT_MULTIPLIERS);
function createMotion(width, floor, startsAt, phase = crypto.randomInt(1000000) / 1000000) {
  const minX = 24 + width / 2, maxX = 576 - width / 2;
  return { width, minX, maxX, speed: 150 + floor * 28, startsAt, phase };
}
async function initializeTowerSchema(run) {
  await run(`CREATE TABLE IF NOT EXISTS tower_games (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stake INTEGER NOT NULL, status TEXT NOT NULL, floor INTEGER NOT NULL DEFAULT 0,
    platforms TEXT NOT NULL, motion TEXT NOT NULL, multipliers TEXT NOT NULL,
    ready_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, payout INTEGER NOT NULL DEFAULT 0,
    last_placement TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`);
  await run("CREATE UNIQUE INDEX IF NOT EXISTS tower_one_active ON tower_games(user_id) WHERE status IN ('PLAYING', 'PLACING')");
  await run('CREATE INDEX IF NOT EXISTS tower_user_recent ON tower_games(user_id, created_at DESC)');
  await run(`CREATE TABLE IF NOT EXISTS tower_actions (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, request_id TEXT NOT NULL,
    action TEXT NOT NULL, request TEXT NOT NULL, game_id TEXT NOT NULL REFERENCES tower_games(id) ON DELETE CASCADE,
    PRIMARY KEY(user_id, request_id)
  )`);
}
function registerTowerRoutes(deps) {
  const { app, requireAuth, handleAsync, run, get, all, withDatabaseTransaction,
    getGameSettings, isBettingPaused, isUserInActiveTable, hasActiveCrashBet,
    addGameHistory, recordBankSettlement, databaseReady } = deps;
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const active = row => row && ['PLAYING', 'PLACING'].includes(row.status);
  const snapshot = (row, now = Date.now()) => {
    const multipliers = JSON.parse(row.multipliers);
    return { id: row.id, stake: row.stake, status: row.status === 'PLACING' && now >= row.ready_at ? 'PLAYING' : row.status,
      floor: row.floor, platforms: JSON.parse(row.platforms), motion: JSON.parse(row.motion),
      multiplier: row.floor ? multipliers[row.floor - 1] : 1, nextMultiplier: multipliers[row.floor] || null,
      multipliers, readyAt: row.ready_at, expiresAt: row.expires_at, payout: row.payout,
      lastPlacement: row.last_placement ? JSON.parse(row.last_placement) : null, createdAt: row.created_at,
      score: row.floor * 100 + JSON.parse(row.platforms).filter(platform => platform.perfect).length * 25 };
  };
  async function settle(row, status, now, reason = '') {
    const payout = status === 'CASHOUT' ? Math.floor(row.stake * Math.round(JSON.parse(row.multipliers)[row.floor - 1] * 100) / 100) : 0;
    const user = await get('SELECT username, chips FROM users WHERE id = ?', [row.user_id]);
    if (!user || !Number.isSafeInteger(user.chips + payout)) throw fail(400, 'Le solde maximal serait dépassé.');
    const updated = await run("UPDATE tower_games SET status = ?, payout = ?, updated_at = ? WHERE id = ? AND status IN ('PLAYING', 'PLACING')", [status, payout, now, row.id]);
    if (!updated.changes) throw fail(409, 'Cette partie est déjà réglée.');
    await run('UPDATE users SET chips = chips + ? WHERE id = ?', [payout, row.user_id]);
    await addGameHistory(row.user_id, 'tower', row.stake, `${status === 'CASHOUT' ? 'Encaissé' : 'Perdu'} · ${row.floor} étages${reason ? ` · ${reason}` : ''}`, payout, payout - row.stake);
    await recordBankSettlement(row.user_id, 'tower', payout - row.stake, user.username);
    return { ...row, status, payout, updated_at: now };
  }
  async function expireUser(userId, now) {
    const row = await get("SELECT * FROM tower_games WHERE user_id = ? AND status IN ('PLAYING', 'PLACING')", [userId]);
    if (row && now >= row.expires_at) return settle(row, 'LOST', now, 'Temps écoulé');
    return row;
  }
  const response = async (row, replay = false) => ({ ok: true, game: snapshot(row), replay,
    serverNow: Date.now(), balance: (await get('SELECT chips FROM users WHERE id = ?', [row.user_id])).chips });
  app.get('/api/tower/state', requireAuth, handleAsync(async (req, res) => {
    const payload = await withDatabaseTransaction(async () => {
      const row = await expireUser(req.session.userId, Date.now());
      const latest = row || await get('SELECT * FROM tower_games WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [req.session.userId]);
      const history = await all("SELECT * FROM tower_games WHERE user_id = ? AND status IN ('CASHOUT', 'LOST') ORDER BY updated_at DESC LIMIT 20", [req.session.userId]);
      return { game: latest ? snapshot(latest) : null, serverNow: Date.now(),
        balance: (await get('SELECT chips FROM users WHERE id = ?', [req.session.userId])).chips,
        settings: await getGameSettings('tower'), paused: await isBettingPaused(), multipliers: MULTIPLIERS, history: history.map(row => snapshot(row)) };
    });
    res.json(payload);
  }));
  function actionRoute(action) {
    app.post(`/api/tower/${action}`, (req, res, next) => { req.towerReceivedAt = Date.now(); next(); }, requireAuth, handleAsync(async (req, res) => {
      const { requestId, gameId, floor, stake } = req.body || {};
      const request = action === 'start' ? { stake } : action === 'place' ? { gameId, floor } : { gameId };
      if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId) ||
          (action === 'start' ? !Number.isSafeInteger(stake) || stake < 1 || stake > 1_000_000 : typeof gameId !== 'string' || !/^[a-f0-9-]{36}$/.test(gameId) || action === 'place' && (!Number.isInteger(floor) || floor < 0 || floor >= 8))) {
        return res.status(400).json({ error: 'Paramètres Tower Rush invalides.' });
      }
      try {
        await withDatabaseTransaction(() => expireUser(req.session.userId, Date.now()));
        const payload = await withDatabaseTransaction(async () => {
          const userId = req.session.userId, now = Date.now(), receivedAt = req.towerReceivedAt;
          const user = await get('SELECT chips, is_bank, is_banned, suspended_until FROM users WHERE id = ?', [userId]);
          if (!user || user.is_bank || user.is_banned || Number(user.suspended_until || 0) > now) throw fail(403, 'Compte indisponible.');
          const prior = await get('SELECT * FROM tower_actions WHERE user_id = ? AND request_id = ?', [userId, requestId]);
          if (prior) {
            if (prior.action !== action || prior.request !== JSON.stringify(request)) throw fail(409, 'Cet identifiant correspond à une autre action.');
            return response(await get('SELECT * FROM tower_games WHERE id = ?', [prior.game_id]), true);
          }
          let row;
          if (action === 'start') {
            const settings = await getGameSettings('tower');
            if (!settings?.enabled || settings.maintenance || await isBettingPaused()) throw fail(503, 'Les mises Tower Rush sont suspendues.');
            if (stake < settings.minBet || stake > settings.maxBet) throw fail(400, 'Mise hors des limites autorisées.');
            if (isUserInActiveTable(userId) || await hasActiveCrashBet(userId) || await get("SELECT id FROM horse_races WHERE user_id = ? AND status != 'settled'", [userId])) throw fail(409, 'Termine ta partie en cours avant de construire une tour.');
            if (await get("SELECT id FROM tower_games WHERE user_id = ? AND status IN ('PLAYING', 'PLACING')", [userId])) throw fail(409, 'Tu as déjà une tour en cours.');
            const debit = await run('UPDATE users SET chips = chips - ? WHERE id = ? AND chips >= ?', [stake, userId, stake]);
            if (!debit.changes) throw fail(400, 'Solde insuffisant.');
            const id = crypto.randomUUID(), readyAt = now + 500;
            await run(`INSERT INTO tower_games (id, user_id, stake, status, platforms, motion, multipliers, ready_at, expires_at, created_at, updated_at)
              VALUES (?, ?, ?, 'PLAYING', ?, ?, ?, ?, ?, ?, ?)`, [id, userId, stake, JSON.stringify([{ x: 300, width: INITIAL_WIDTH }]),
              JSON.stringify(createMotion(INITIAL_WIDTH, 0, readyAt)), JSON.stringify(MULTIPLIERS), readyAt, now + IDLE_MS, now, now]);
            row = await get('SELECT * FROM tower_games WHERE id = ?', [id]);
          } else {
            row = await get('SELECT * FROM tower_games WHERE id = ? AND user_id = ?', [gameId, userId]);
            if (!row) throw fail(404, 'Tour introuvable.');
            if (!active(row)) throw fail(409, 'Cette partie est terminée.');
            if (receivedAt < row.ready_at) throw fail(409, 'Attends la fin de la chute avant de continuer.');
            if (now - receivedAt > 1500) throw fail(409, 'Requête trop ancienne. Réessaie.');
            if (action === 'cashout') {
              if (!row.floor) throw fail(409, 'Construis au moins un étage avant d’encaisser.');
              row = await settle(row, 'CASHOUT', now);
            } else {
              if (floor !== row.floor) throw fail(409, 'Cet étage a déjà été joué.');
              const platforms = JSON.parse(row.platforms), motion = JSON.parse(row.motion);
              const placement = evaluatePlacement(platforms[platforms.length - 1], motion, receivedAt);
              const details = { ...placement, receivedAt, floor: floor + 1 };
              await run('UPDATE tower_games SET last_placement = ? WHERE id = ?', [JSON.stringify(details), row.id]);
              row.last_placement = JSON.stringify(details);
              if (!placement.success) row = await settle(row, 'LOST', now);
              else {
                platforms.push({ ...placement.platform, perfect: placement.perfect });
                const nextFloor = floor + 1, readyAt = now + FALL_MS;
                await run(`UPDATE tower_games SET floor = ?, platforms = ?, motion = ?, status = 'PLACING', ready_at = ?, expires_at = ?, updated_at = ? WHERE id = ?`,
                  [nextFloor, JSON.stringify(platforms), JSON.stringify(createMotion(placement.platform.width, nextFloor, readyAt)), readyAt, now + IDLE_MS, now, row.id]);
                row = await get('SELECT * FROM tower_games WHERE id = ?', [row.id]);
                if (nextFloor === MULTIPLIERS.length) row = await settle(row, 'CASHOUT', now, 'Tour complète');
              }
            }
          }
          await run('INSERT INTO tower_actions (user_id, request_id, action, request, game_id) VALUES (?, ?, ?, ?, ?)', [userId, requestId, action, JSON.stringify(request), row.id]);
          return response(row);
        });
        res.json(payload);
      } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        throw error;
      }
    }));
  }
  for (const action of ['start', 'place', 'cashout']) actionRoute(action);
  const sweep = () => withDatabaseTransaction(async () => {
    const now = Date.now();
    const rows = await all("SELECT * FROM tower_games WHERE status IN ('PLAYING', 'PLACING') AND expires_at <= ?", [now]);
    for (const row of rows) await settle(row, 'LOST', now, 'Temps écoulé');
  });
  databaseReady.then(async () => {
    await sweep();
    const timer = setInterval(() => sweep().catch(error => console.error('Expiration Tower Rush :', error.message)), 30000);
    timer.unref();
  }).catch(error => console.error('Initialisation Tower Rush :', error.message));
}
module.exports = { MULTIPLIERS, RANDOM_TIMING_BOUND, validateMultipliers, createMotion, positionAt, evaluatePlacement, initializeTowerSchema, registerTowerRoutes };
