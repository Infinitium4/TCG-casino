type Faction = 'crs' | 'manifestants';
type Parameters = (string | number | null)[];
interface Request { session: { userId: number }; body?: { faction?: unknown } }
interface Response { status(code: number): Response; json(payload: unknown): void }
type Handler = (request: Request, response: Response) => unknown;
interface Dependencies {
  app: { get(path: string, ...handlers: Handler[]): void; post(path: string, ...handlers: Handler[]): void };
  requireAuth: Handler;
  handleAsync(handler: Handler): Handler;
  run(sql: string, params?: Parameters): Promise<unknown>;
  get<T>(sql: string, params?: Parameters): Promise<T | undefined>;
  all<T>(sql: string, params?: Parameters): Promise<T[]>;
  withDatabaseTransaction<T>(work: () => Promise<T>): Promise<T>;
}

export const factions = {
  crs: {
    id: 'crs', name: 'CRS / Gouvernement', specialty: 'Résistance, défenses et unités équipées.',
    description: 'Bâtis ton organisation à partir d’un petit poste de police municipale.',
    headquarters: ['Poste de police municipale', 'Commissariat de quartier', 'Commissariat central', 'Caserne de CRS', 'Préfecture de police', 'Centre de commandement', 'Ministère de l’Intérieur', 'Quartier général national', 'Complexe gouvernemental', 'Palais de l’Élysée']
  },
  manifestants: {
    id: 'manifestants', name: 'Manifestants / Insurgés', specialty: 'Nombre, mobilité et coordination.',
    description: 'Développe un mouvement fictif à partir d’un lycée révolté.',
    headquarters: ['Lycée révolté', 'Université occupée', 'Campus contestataire', 'Quartier militant', 'Commune autonome', 'Zone autonome', 'Ville insurgée', 'Fédération de villes insurgées', 'Capitale révolutionnaire', 'République insurrectionnelle fictive']
  }
} as const;

export async function initializeCrsSchema(run: Dependencies['run']): Promise<void> {
  await run(`CREATE TABLE IF NOT EXISTS crs_players (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    faction TEXT NOT NULL CHECK(faction IN ('crs', 'manifestants')),
    supplies INTEGER NOT NULL DEFAULT 250 CHECK(supplies >= 0),
    rating INTEGER NOT NULL DEFAULT 1000,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS crs_citadels (
    user_id INTEGER PRIMARY KEY REFERENCES crs_players(user_id) ON DELETE CASCADE,
    headquarters_level INTEGER NOT NULL DEFAULT 1 CHECK(headquarters_level BETWEEN 1 AND 10),
    grid_width INTEGER NOT NULL DEFAULT 12,
    grid_height INTEGER NOT NULL DEFAULT 12,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS crs_buildings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES crs_citadels(user_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind = 'headquarters'),
    level INTEGER NOT NULL DEFAULT 1 CHECK(level BETWEEN 1 AND 10),
    x INTEGER NOT NULL CHECK(x BETWEEN 0 AND 11),
    y INTEGER NOT NULL CHECK(y BETWEEN 0 AND 11),
    UNIQUE(user_id, x, y), UNIQUE(user_id, kind)
  )`);
  await run(`CREATE TRIGGER IF NOT EXISTS crs_faction_is_permanent
    BEFORE UPDATE OF faction ON crs_players WHEN NEW.faction <> OLD.faction
    BEGIN SELECT RAISE(ABORT, 'Faction is permanent'); END`);
}

interface Player { user_id: number; faction: Faction; supplies: number; rating: number; created_at: string }
interface Citadel { headquarters_level: number; grid_width: number; grid_height: number; updated_at: string }
interface Building { id: number; kind: string; level: number; x: number; y: number }

export function registerCrsRoutes(deps: Dependencies): void {
  const { app, requireAuth, handleAsync, get, all, run, withDatabaseTransaction } = deps;
  async function state(userId: number) {
    const account = await get<{ chips: number; username: string }>('SELECT chips, username FROM users WHERE id = ?', [userId]);
    const player = await get<Player>('SELECT * FROM crs_players WHERE user_id = ?', [userId]);
    return {
      phase: 1, factions, account: { username: account?.username, chips: Number(account?.chips || 0) },
      player: player || null,
      citadel: player ? await get<Citadel>('SELECT headquarters_level, grid_width, grid_height, updated_at FROM crs_citadels WHERE user_id = ?', [userId]) : null,
      buildings: player ? await all<Building>('SELECT id, kind, level, x, y FROM crs_buildings WHERE user_id = ? ORDER BY id', [userId]) : []
    };
  }
  app.get('/api/crs/state', requireAuth, handleAsync(async (req, res) => {
    res.json(await state(req.session.userId));
  }));
  app.post('/api/crs/faction', requireAuth, handleAsync(async (req, res) => {
    const faction = req.body?.faction;
    if (faction !== 'crs' && faction !== 'manifestants') {
      res.status(400).json({ error: 'Choisis CRS ou Manifestants.' }); return;
    }
    const created = await withDatabaseTransaction(async () => {
      if (await get<Player>('SELECT user_id FROM crs_players WHERE user_id = ?', [req.session.userId])) return false;
      await run('INSERT INTO crs_players (user_id, faction) VALUES (?, ?)', [req.session.userId, faction]);
      await run('INSERT INTO crs_citadels (user_id) VALUES (?)', [req.session.userId]);
      await run("INSERT INTO crs_buildings (user_id, kind, x, y) VALUES (?, 'headquarters', 5, 5)", [req.session.userId]);
      return true;
    });
    if (!created) { res.status(409).json({ error: 'Ta faction est déjà choisie et ne peut plus être changée.' }); return; }
    res.status(201).json(await state(req.session.userId));
  }));
}
