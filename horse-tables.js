const crypto = require('node:crypto');

function generateMarket(horses, randomInt = crypto.randomInt) {
  const weights = new Set();
  while (weights.size < 5) weights.add(randomInt(8, 41));
  const values = [...weights];
  const total = values.reduce((sum, value) => sum + value, 0);
  return horses.map((horse, index) => ({ ...horse, weight: values[index],
    probability: values[index] / total, oddsCents: Math.floor(80 * total / values[index]),
    odds: Math.floor(80 * total / values[index]) / 100 }));
}

function weightedOrder(market, randomInt = crypto.randomInt) {
  const remaining = [...market];
  const order = [];
  while (remaining.length) {
    let draw = randomInt(remaining.reduce((sum, horse) => sum + horse.weight, 0));
    const index = remaining.findIndex(horse => { draw -= horse.weight; return draw < 0; });
    order.push(remaining.splice(index, 1)[0].id);
  }
  return order;
}

async function initializeHorseTables(run) {
  // Additive migration: outstanding solo races keep their original 4x payout.
  for (const definition of ['event_id TEXT', 'odds_cents INTEGER NOT NULL DEFAULT 400', 'cancelled INTEGER NOT NULL DEFAULT 0']) {
    try { await run(`ALTER TABLE horse_races ADD COLUMN ${definition}`); }
    catch (error) { if (!String(error.message).includes('duplicate column name')) throw error; }
  }
  await run(`CREATE TABLE IF NOT EXISTS horse_tables (
    id TEXT PRIMARY KEY, host_id INTEGER NOT NULL REFERENCES users(id),
    event_id TEXT, created_at_ms INTEGER NOT NULL
  )`);
  await run(`CREATE TABLE IF NOT EXISTS horse_events (
    id TEXT PRIMARY KEY, table_id TEXT NOT NULL REFERENCES horse_tables(id),
    market TEXT NOT NULL, outcome TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('ready','running','settled')),
    started_at_ms INTEGER, ends_at_ms INTEGER, created_at_ms INTEGER NOT NULL
  )`);
  await run(`CREATE TABLE IF NOT EXISTS horse_table_members (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    table_id TEXT NOT NULL REFERENCES horse_tables(id), joined_at_ms INTEGER NOT NULL
  )`);
  await run('CREATE UNIQUE INDEX IF NOT EXISTS horse_one_bet_per_event ON horse_races(event_id,user_id) WHERE cancelled = 0');
  await run('CREATE INDEX IF NOT EXISTS horse_event_bets ON horse_races(event_id)');
}

function registerHorseTables(deps, helpers) {
  const { app, requireAuth, run, get, all, withDatabaseTransaction, getGameSettings,
    isBettingPaused, isUserInActiveTable, hasActiveCrashBet, addGameHistory, recordBankSettlement } = deps;
  const { HORSES, generateRace, publicRace, settle, route } = helpers;
  const fail = (status, message) => Object.assign(new Error(message), { status });

  async function available() {
    const settings = await getGameSettings('horses');
    if (!settings?.enabled || settings.maintenance || await isBettingPaused()) throw fail(503, 'Les nouvelles courses sont suspendues.');
    return settings;
  }
  async function makeEvent(tableId) {
    const previous = await get('SELECT e.market FROM horse_tables t JOIN horse_events e ON e.id=t.event_id WHERE t.id=?', [tableId]);
    const oldMarket = previous ? JSON.parse(previous.market) : null;
    let market;
    do { market = generateMarket(HORSES); }
    while (oldMarket && market.some((horse, index) => horse.oddsCents === oldMarket[index].oddsCents));
    const order = weightedOrder(market);
    const outcome = generateRace();
    outcome.order = order;
    outcome.trajectories.forEach(entry => { entry.finishMs = 12000 + order.indexOf(entry.id) * 500; });
    const id = crypto.randomUUID();
    await run("INSERT INTO horse_events(id,table_id,market,outcome,status,created_at_ms) VALUES (?,?,?,?,'ready',?)", [id, tableId, JSON.stringify(market), JSON.stringify(outcome), Date.now()]);
    await run('UPDATE horse_tables SET event_id = ? WHERE id = ?', [id, tableId]);
    return id;
  }
  async function settleEvent(event) {
    if (!event || event.status !== 'running' || event.ends_at_ms > Date.now()) return;
    const bets = await all('SELECT * FROM horse_races WHERE event_id = ?', [event.id]);
    for (const bet of bets) await settle(bet);
    await run("UPDATE horse_events SET status = 'settled' WHERE id = ? AND status = 'running'", [event.id]);
  }
  async function settleDue() {
    const events = await all("SELECT * FROM horse_events WHERE status = 'running' AND ends_at_ms <= ?", [Date.now()]);
    for (const event of events) await settleEvent(event);
  }
  async function membership(userId, tableId) {
    const member = await get('SELECT * FROM horse_table_members WHERE user_id = ? AND table_id = ?', [userId, tableId]);
    if (!member) throw fail(403, 'Tu ne fais pas partie de cette table.');
    return member;
  }
  async function state(userId) {
    const user = await get('SELECT chips FROM users WHERE id = ?', [userId]);
    const member = await get('SELECT * FROM horse_table_members WHERE user_id = ?', [userId]);
    let table = null, race = null;
    if (member) {
      const row = await get('SELECT * FROM horse_tables WHERE id = ?', [member.table_id]);
      let event = await get('SELECT * FROM horse_events WHERE id = ?', [row.event_id]);
      await settleEvent(event);
      event = await get('SELECT * FROM horse_events WHERE id = ?', [row.event_id]);
      const players = await all(`SELECT u.id,u.username,b.horse_id AS horseId,b.stake,b.odds_cents AS oddsCents
        FROM horse_table_members m JOIN users u ON u.id = m.user_id
        LEFT JOIN horse_races b ON b.user_id = m.user_id AND b.event_id = ? AND b.cancelled = 0
        WHERE m.table_id = ? ORDER BY m.joined_at_ms,u.id`, [event.id, row.id]);
      const bet = await get('SELECT * FROM horse_races WHERE event_id = ? AND user_id = ? AND cancelled = 0', [event.id, userId]);
      race = publicRace(bet);
      table = { id: row.id, hostId: row.host_id, eventId: event.id, status: event.status,
        horses: JSON.parse(event.market).map(({ weight, ...horse }) => horse), players, maxPlayers: 8 };
    }
    const tables = await all(`SELECT t.id,t.host_id AS hostId,u.username AS hostName,e.status,
      (SELECT COUNT(*) FROM horse_table_members m WHERE m.table_id = t.id) AS playerCount
      FROM horse_tables t JOIN users u ON u.id = t.host_id JOIN horse_events e ON e.id = t.event_id
      WHERE EXISTS(SELECT 1 FROM horse_table_members m WHERE m.table_id = t.id)
      ORDER BY t.created_at_ms DESC LIMIT 50`);
    // Settlement may have updated the balance during this snapshot.
    const balance = member ? (await get('SELECT chips FROM users WHERE id = ?', [userId])).chips : user.chips;
    return { table, tables, race, balance, serverNow: Date.now() };
  }
  const endpoint = work => route(async (req, res) => {
    const payload = await withDatabaseTransaction(() => work(req));
    res.json(payload);
  });

  app.post('/api/horses/tables', requireAuth, endpoint(async req => {
    await available();
    const userId = req.session.userId;
    if (await get('SELECT * FROM horse_table_members WHERE user_id = ?', [userId])) return state(userId);
    if (await get("SELECT id FROM horse_races WHERE user_id = ? AND status != 'settled'", [userId]) || isUserInActiveTable(userId) || await hasActiveCrashBet(userId)) throw fail(409, 'Termine ta partie en cours avant de créer une table.');
    const id = crypto.randomUUID();
    await run('INSERT INTO horse_tables(id,host_id,created_at_ms) VALUES (?,?,?)', [id, userId, Date.now()]);
    await makeEvent(id);
    await run('INSERT INTO horse_table_members(user_id,table_id,joined_at_ms) VALUES (?,?,?)', [userId, id, Date.now()]);
    return state(userId);
  }));
  app.post('/api/horses/tables/:tableId/join', requireAuth, endpoint(async req => {
    await available();
    const userId = req.session.userId, id = req.params.tableId;
    const existing = await get('SELECT * FROM horse_table_members WHERE user_id = ?', [userId]);
    if (existing?.table_id === id) return state(userId);
    if (existing) throw fail(409, 'Quitte ta table actuelle avant d’en rejoindre une autre.');
    const row = await get('SELECT t.*,e.status FROM horse_tables t JOIN horse_events e ON e.id=t.event_id WHERE t.id=?', [id]);
    if (!row) throw fail(404, 'Table introuvable.');
    if (row.status !== 'ready') throw fail(409, 'Cette course a déjà commencé.');
    const count = (await get('SELECT COUNT(*) AS n FROM horse_table_members WHERE table_id=?', [id])).n;
    if (!count) throw fail(404, 'Cette table est fermée.');
    if (count >= 8) throw fail(409, 'La table est complète.');
    if (await get("SELECT id FROM horse_races WHERE user_id=? AND status!='settled'", [userId]) || isUserInActiveTable(userId) || await hasActiveCrashBet(userId)) throw fail(409, 'Termine ta partie en cours avant de rejoindre cette table.');
    await run('INSERT INTO horse_table_members(user_id,table_id,joined_at_ms) VALUES (?,?,?)', [userId, id, Date.now()]);
    return state(userId);
  }));
  app.post('/api/horses/tables/:tableId/bet', requireAuth, endpoint(async req => {
    const userId = req.session.userId, id = req.params.tableId;
    await membership(userId, id);
    const { stake, horseId, requestId, eventId } = req.body || {};
    if (!Number.isSafeInteger(stake) || stake <= 0 || stake > 1_000_000 || !Number.isInteger(horseId) || horseId < 1 || horseId > 5 || typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) throw fail(400, 'Cheval, mise ou identifiant invalide.');
    const table = await get('SELECT * FROM horse_tables WHERE id=?', [id]);
    if (eventId !== table.event_id) throw fail(409, 'Les cotes ont changé : choisis ton pari pour cette nouvelle course.');
    const duplicate = await get('SELECT * FROM horse_races WHERE user_id=? AND request_id=?', [userId, requestId]);
    if (duplicate) {
      if (duplicate.event_id !== eventId || duplicate.stake !== stake || duplicate.horse_id !== horseId || duplicate.cancelled) throw fail(409, 'Cet identifiant correspond à un autre pari.');
      return state(userId);
    }
    const settings = await available();
    if (stake < settings.minBet || stake > settings.maxBet) throw fail(400, `Mise autorisée : ${settings.minBet} à ${settings.maxBet} jetons.`);
    const event = await get('SELECT * FROM horse_events WHERE id=?', [eventId]);
    if (event.status !== 'ready') throw fail(409, 'Les paris sont fermés.');
    if (await get('SELECT id FROM horse_races WHERE event_id=? AND user_id=? AND cancelled=0', [eventId, userId])) throw fail(409, 'Ton pari est déjà validé.');
    if (await get("SELECT id FROM horse_races WHERE user_id=? AND status!='settled'", [userId]) || isUserInActiveTable(userId) || await hasActiveCrashBet(userId)) throw fail(409, 'Termine ta partie en cours.');
    const odds = JSON.parse(event.market).find(horse => horse.id === horseId).oddsCents;
    const user = await get('SELECT chips FROM users WHERE id=?', [userId]);
    if (!Number.isSafeInteger(user.chips - stake + Math.floor(stake * odds / 100))) throw fail(400, 'Le solde maximal serait dépassé.');
    if (!(await run('UPDATE users SET chips=chips-? WHERE id=? AND chips>=?', [stake, userId, stake])).changes) throw fail(400, 'Solde insuffisant.');
    const outcome = JSON.parse(event.outcome);
    await run("INSERT INTO horse_races(id,user_id,request_id,horse_id,stake,winner,outcome,status,created_at_ms,event_id,odds_cents) VALUES (?,?,?,?,?,?,?,'ready',?,?,?)",
      [crypto.randomUUID(), userId, requestId, horseId, stake, outcome.order[0], event.outcome, Date.now(), eventId, odds]);
    return state(userId);
  }));
  app.post('/api/horses/tables/:tableId/start', requireAuth, endpoint(async req => {
    const userId = req.session.userId, id = req.params.tableId;
    await membership(userId, id);
    const table = await get('SELECT * FROM horse_tables WHERE id=?', [id]);
    if (table.host_id !== userId) throw fail(403, 'Seul l’hôte peut lancer la course.');
    const event = await get('SELECT * FROM horse_events WHERE id=?', [table.event_id]);
    if (req.body?.eventId !== event.id) throw fail(409, 'Cette course a changé.');
    if (event.status !== 'ready') return state(userId);
    const members = await all('SELECT user_id FROM horse_table_members WHERE table_id=?', [id]);
    const bets = await all('SELECT id FROM horse_races WHERE event_id=? AND cancelled=0', [event.id]);
    if (members.length < 1 || bets.length !== members.length) throw fail(409, 'Chaque joueur de la table doit avoir validé son pari.');
    const start = Date.now() + 3000, end = start + 14000;
    await run("UPDATE horse_events SET status='running',started_at_ms=?,ends_at_ms=? WHERE id=?", [start, end, event.id]);
    await run("UPDATE horse_races SET status='running',started_at_ms=?,ends_at_ms=? WHERE event_id=? AND cancelled=0", [start, end, event.id]);
    return state(userId);
  }));
  app.post('/api/horses/tables/:tableId/next', requireAuth, endpoint(async req => {
    const id = req.params.tableId, userId = req.session.userId;
    await membership(userId, id);
    await settleDue();
    const table = await get('SELECT * FROM horse_tables WHERE id=?', [id]);
    if (table.host_id !== userId) throw fail(403, 'Seul l’hôte peut préparer la prochaine course.');
    if (req.body?.eventId !== table.event_id) return state(userId);
    const event = await get('SELECT * FROM horse_events WHERE id=?', [table.event_id]);
    if (event.status !== 'settled') throw fail(409, 'La course n’est pas terminée.');
    await available();
    await makeEvent(id);
    return state(userId);
  }));
  app.post('/api/horses/tables/:tableId/leave', requireAuth, endpoint(async req => {
    const userId = req.session.userId, id = req.params.tableId;
    await membership(userId, id);
    await settleDue();
    const table = await get('SELECT * FROM horse_tables WHERE id=?', [id]);
    const event = await get('SELECT * FROM horse_events WHERE id=?', [table.event_id]);
    if (event.status === 'running') throw fail(409, 'Attends la fin de la course pour quitter la table.');
    const bet = await get("SELECT * FROM horse_races WHERE event_id=? AND user_id=? AND status='ready'", [event.id, userId]);
    if (bet) {
      await run('UPDATE users SET chips=chips+? WHERE id=?', [bet.stake, userId]);
      await run("UPDATE horse_races SET status='settled',cancelled=1,payout=stake,settled_at_ms=? WHERE id=?", [Date.now(), bet.id]);
      await addGameHistory(userId, 'horses', bet.stake, 'Pari annulé', bet.stake, 0);
      await recordBankSettlement(userId, 'horses', 0);
    }
    await run('DELETE FROM horse_table_members WHERE user_id=?', [userId]);
    const next = await get('SELECT user_id FROM horse_table_members WHERE table_id=? ORDER BY joined_at_ms,user_id LIMIT 1', [id]);
    if (next && table.host_id === userId) await run('UPDATE horse_tables SET host_id=? WHERE id=?', [next.user_id, id]);
    return state(userId);
  }));
  return { state, settleDue };
}

module.exports = { generateMarket, weightedOrder, initializeHorseTables, registerHorseTables };
