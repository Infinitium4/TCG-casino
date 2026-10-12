const STORAGE_KEYS = {
  player: "underground.player.v1",
  history: "underground.history.v1"
};

function getDefaultPlayer() {
  return {
    name: "Joueur",
    avatar: "🎲",
    chips: 1000,
    soundEnabled: false,
    stats: {
      gamesPlayed: 0,
      wins: 0,
      bestWin: 0,
      lastPlayed: null
    },
    createdAt: Date.now()
  };
}

function parseStoredJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch (error) {
    console.warn("Lecture du stockage impossible:", error);
    return fallback;
  }
}

function getPlayer() {
  const player = parseStoredJson(STORAGE_KEYS.player, getDefaultPlayer());
  const defaultPlayer = getDefaultPlayer();

  const safePlayer = {
    ...defaultPlayer,
    ...player,
    stats: {
      ...defaultPlayer.stats,
      ...(player && player.stats ? player.stats : {})
    }
  };

  if (!safePlayer.name || safePlayer.name.trim() === "") {
    safePlayer.name = defaultPlayer.name;
  }

  if (!safePlayer.avatar) {
    safePlayer.avatar = defaultPlayer.avatar;
  }

  if (Number.isNaN(Number(safePlayer.chips))) {
    safePlayer.chips = defaultPlayer.chips;
  }

  safePlayer.chips = Number(safePlayer.chips) || 0;
  safePlayer.stats.gamesPlayed = Number(safePlayer.stats.gamesPlayed || 0);
  safePlayer.stats.wins = Number(safePlayer.stats.wins || 0);
  safePlayer.stats.bestWin = Number(safePlayer.stats.bestWin || 0);

  return safePlayer;
}

function savePlayer(player) {
  try {
    localStorage.setItem(STORAGE_KEYS.player, JSON.stringify(player));
  } catch (error) {
    console.warn("Sauvegarde du profil impossible:", error);
  }
}

function getHistory() {
  return parseStoredJson(STORAGE_KEYS.history, []);
}

function saveHistory(history) {
  try {
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(history.slice(0, 50)));
  } catch (error) {
    console.warn("Sauvegarde de l'historique impossible:", error);
  }
}

function resetPlayerData() {
  const freshPlayer = getDefaultPlayer();
  savePlayer(freshPlayer);
  saveHistory([]);
  return freshPlayer;
}

function updatePlayerStats(gameName, didWin, amountWon, betAmount) {
  const player = getPlayer();
  player.stats.gamesPlayed = Number(player.stats.gamesPlayed || 0) + 1;
  if (didWin) {
    player.stats.wins = Number(player.stats.wins || 0) + 1;
  }

  player.stats.bestWin = Math.max(Number(player.stats.bestWin || 0), Number(amountWon || 0));
  player.stats.lastPlayed = new Date().toISOString();

  savePlayer(player);
  return player;
}

function ensureInitialPlayer() {
  const existing = parseStoredJson(STORAGE_KEYS.player, null);
  if (!existing) {
    const fresh = getDefaultPlayer();
    savePlayer(fresh);
  }
}
