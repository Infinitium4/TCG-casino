const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit'
});
function dayAt(timestamp) {
  const parts = Object.fromEntries(dayFormatter.formatToParts(timestamp).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function splitDays(start, end) {
  if (end <= start) return [];
  const day = dayAt(start);
  if (day === dayAt(end - 1)) return [[day, end - start]];
  let low = start, high = end;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (dayAt(mid) === day) low = mid; else high = mid;
  }
  return [[day, high - start], ...splitDays(high, end)];
}
async function initializeScreenTimeSchema(run) {
  await run(`CREATE TABLE IF NOT EXISTS screen_time_days (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL, duration_ms INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id,day))`);
  await run(`CREATE TABLE IF NOT EXISTS screen_time_clock (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    accounted_at INTEGER NOT NULL)`);
  await run(`CREATE TABLE IF NOT EXISTS screen_time_presence (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tab_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
    PRIMARY KEY(user_id,tab_id))`);
}
function registerScreenTimeRoutes({ app, requireAuth, handleAsync, run, get, withDatabaseTransaction, now = Date.now }) {
  async function snapshot(userId, timestamp, tabId, active) {
    const clock = await get('SELECT accounted_at FROM screen_time_clock WHERE user_id=?', [userId]);
    const presence = await get('SELECT MAX(expires_at) AS expires FROM screen_time_presence WHERE user_id=?', [userId]);
    const end = Math.min(timestamp, Number(presence?.expires || 0));
    for (const [day, duration] of splitDays(clock?.accounted_at ?? timestamp, end)) {
      await run(`INSERT INTO screen_time_days(user_id,day,duration_ms) VALUES (?,?,?)
        ON CONFLICT(user_id,day) DO UPDATE SET duration_ms=duration_ms+excluded.duration_ms`, [userId, day, duration]);
    }
    await run(`INSERT INTO screen_time_clock(user_id,accounted_at) VALUES (?,?)
      ON CONFLICT(user_id) DO UPDATE SET accounted_at=excluded.accounted_at`, [userId, timestamp]);
    await run('DELETE FROM screen_time_presence WHERE user_id=? AND expires_at<=?', [userId, timestamp]);
    if (tabId) {
      if (active) await run(`INSERT INTO screen_time_presence(user_id,tab_id,expires_at) VALUES (?,?,?)
        ON CONFLICT(user_id,tab_id) DO UPDATE SET expires_at=excluded.expires_at`, [userId, tabId, timestamp + 30000]);
      else await run('DELETE FROM screen_time_presence WHERE user_id=? AND tab_id=?', [userId, tabId]);
    }
    const day = dayAt(timestamp);
    const today = await get('SELECT duration_ms FROM screen_time_days WHERE user_id=? AND day=?', [userId, day]);
    const total = await get('SELECT COALESCE(SUM(duration_ms),0) AS duration_ms FROM screen_time_days WHERE user_id=?', [userId]);
    return { todaySeconds: Math.floor((today?.duration_ms || 0) / 1000),
      totalSeconds: Math.floor(total.duration_ms / 1000), day, timezone: 'Europe/Paris' };
  }
  app.get('/api/screen-time', requireAuth, handleAsync(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await withDatabaseTransaction(() => snapshot(req.session.userId, now())));
  }));
  app.post('/api/screen-time/heartbeat', requireAuth, handleAsync(async (req, res) => {
    const { tabId, active } = req.body || {};
    if (typeof tabId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(tabId) || typeof active !== 'boolean') {
      return res.status(400).json({ error: 'Présence invalide.' });
    }
    // Support mode must not add an administrator's browsing time to a player.
    if (req.session.supportOriginalUserId) return res.status(403).json({ error: 'Compteur en pause en vue support.' });
    res.set('Cache-Control', 'no-store');
    res.json(await withDatabaseTransaction(() => snapshot(req.session.userId, now(), tabId, active)));
  }));
}
module.exports = { initializeScreenTimeSchema, registerScreenTimeRoutes, dayAt, splitDays };
