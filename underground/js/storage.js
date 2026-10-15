const STORAGE_KEYS = {
  player: "underground.player.v1",
  history: "underground.history.v1"
};

let accountUser = null;
let syncedAvatar = null;

function getDefaultPlayer() {
  return {
    name: "Joueur",
    avatar: "🎲",
    avatarImage: null,
    chips: 0,
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
  if (accountUser) {
    player.name = accountUser.username;
  }

  try {
    localStorage.setItem(STORAGE_KEYS.player, JSON.stringify(player));
  } catch (error) {
    console.warn("Sauvegarde du profil impossible:", error);
  }

  if (accountUser && player.avatar !== syncedAvatar) {
    fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatar: player.avatar })
    })
      .then((response) => {
        if (!response.ok) throw new Error("Mise à jour du profil impossible.");
        syncedAvatar = player.avatar;
      })
      .catch((error) => console.error(error));
  }
}

async function loadAccountData() {
  const [accountResponse, historyResponse] = await Promise.all([
    fetch("/api/me"),
    fetch("/api/history")
  ]);

  if (accountResponse.status === 401 || historyResponse.status === 401) {
    return false;
  }
  if (!accountResponse.ok || !historyResponse.ok) {
    throw new Error("Chargement des données du compte impossible.");
  }

  const accountResponseData = await accountResponse.json();
  const { user, stats } = accountResponseData;
  const { history } = await historyResponse.json();
  const player = {
    ...getDefaultPlayer(),
    ...parseStoredJson(STORAGE_KEYS.player, {}),
    name: user.username,
    avatar: user.avatar || "🎲",
    avatarImage: user.avatar_image || null,
    infiniteMoney: Boolean(user.infinite_money),
    design: JSON.parse(user.profile_design || "{}"),
    chips: Number(user.chips),
    createdAt: user.created_at,
    stats: {
      gamesPlayed: Number(stats.gamesPlayed || 0),
      wins: Number(stats.wins || 0),
      bestWin: Number(stats.bestWin || 0),
      lastPlayed: stats.lastPlayed || null
    }
  };

  accountUser = {
    ...user,
    isAdmin: Boolean(accountResponseData.isAdmin),
    isPrimaryAdmin: Boolean(accountResponseData.isPrimaryAdmin),
    supportMode: Boolean(accountResponseData.supportMode)
  };
  syncedAvatar = player.avatar;
  localStorage.setItem(STORAGE_KEYS.player, JSON.stringify(player));
  saveHistory(history.map((entry) => ({
    id: entry.id,
    game: entry.game_name,
    bet: Number(entry.bet),
    result: entry.result,
    payout: Number(entry.payout),
    net: Number(entry.net),
    date: entry.created_at
  })));
  return true;
}

async function syncGameResult(entry) {
  const response = await fetch("/api/result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry)
  });

  if (response.status === 401) {
    window.location.replace("/");
    return;
  }
  if (!response.ok) {
    throw new Error("Résultat de partie non enregistré sur le compte.");
  }

  const { user } = await response.json();
  const player = getPlayer();
  player.chips = Number(user.chips);
  localStorage.setItem(STORAGE_KEYS.player, JSON.stringify(player));
  updateTopbar();
  renderHomeView();
  renderLeaderboard();
  renderProfileView();
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
