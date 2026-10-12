const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const SQLiteStore = require('connect-sqlite3')(session);
const { rateLimit } = require('express-rate-limit');

const app = express();
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
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
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessaie dans 15 minutes.' }
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
      'INSERT INTO users (username, password_hash, avatar, chips) VALUES (?, ?, ?, ?)',
      [adminUsername, passwordHash, '🕶️', 1500]
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

app.post('/api/register', authLimiter, async (req, res) => {
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

app.post('/api/login', authLimiter, async (req, res) => {
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

  await run(
    'INSERT INTO game_history (user_id, game_name, bet, result, payout, net) VALUES (?, ?, ?, ?, ?, ?)',
    [req.session.userId, String(game), Number(bet), String(result), Number(payout || 0), Number(net || 0)]
  );

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

app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://${HOST}:${PORT}`);
});
