const AVATAR_OPTIONS = ["🎲", "🃏", "🕶️", "💎", "🦊", "♠️", "♦️", "💰", "🎯", "🤵"];
const SLOT_SYMBOLS = [
  { name: "Cherry", symbol: "🍒", payout: 2 },
  { name: "Lemon", symbol: "🍋", payout: 3 },
  { name: "Bell", symbol: "🔔", payout: 5 },
  { name: "Diamond", symbol: "💎", payout: 10 },
  { name: "RedSeven", symbol: "7️⃣", payout: 20 },
  { name: "Joker", symbol: "🃏", payout: 50 }
];

function clampNumber(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function sanitizeText(value, maxLength = 18) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength) || "Joueur";
}

function formatChips(value) {
  return Number(value || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRouletteColor(number) {
  const value = String(number);
  if (value === "00" || Number(value) === 0) return "green";
  return [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(Number(value))
    ? "red"
    : "black";
}

function getRouletteColorName(number) {
  const color = getRouletteColor(number);
  return color === "green" ? "Vert" : color === "red" ? "Rouge" : "Noir";
}

function calculateHandValue(cards) {
  let total = 0;
  let aces = 0;

  cards.forEach((card) => {
    const value = Number(card.value);
    if (Number.isNaN(value)) {
      total += 10;
      return;
    }

    if (value === 1) {
      aces += 1;
      total += 11;
    } else {
      total += value;
    }
  });

  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }

  return {
    total,
    soft: aces > 0 && total <= 21
  };
}

function buildDeck() {
  const suits = ["♠", "♥", "♦", "♣"];
  const ranks = [
    { label: "A", value: 1 },
    { label: "2", value: 2 },
    { label: "3", value: 3 },
    { label: "4", value: 4 },
    { label: "5", value: 5 },
    { label: "6", value: 6 },
    { label: "7", value: 7 },
    { label: "8", value: 8 },
    { label: "9", value: 9 },
    { label: "10", value: 10 },
    { label: "J", value: 10 },
    { label: "Q", value: 10 },
    { label: "K", value: 10 }
  ];

  const deck = [];
  suits.forEach((suit) => {
    ranks.forEach((card) => {
      deck.push({
        suit,
        label: card.label,
        value: card.value,
        color: ["♥", "♦"].includes(suit) ? "red" : "black"
      });
    });
  });

  return deck;
}

function shuffleDeck(deck) {
  const nextDeck = [...deck];
  for (let i = nextDeck.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i);
    [nextDeck[i], nextDeck[j]] = [nextDeck[j], nextDeck[i]];
  }
  return nextDeck;
}

function getPlayerSummary(player) {
  const totalGames = Number(player.stats.gamesPlayed || 0);
  const wins = Number(player.stats.wins || 0);
  const winRate = totalGames > 0 ? ((wins / totalGames) * 100).toFixed(1) : "0.0";

  return {
    totalGames,
    wins,
    winRate,
    bestWin: Number(player.stats.bestWin || 0),
    chips: Number(player.chips || 0),
    lastPlayed: player.stats.lastPlayed || null
  };
}

function addHistoryEntry(entry) {
  const history = getHistory();
  history.unshift({
    id: Date.now() + Math.random(),
    date: new Date().toISOString(),
    ...entry
  });
  saveHistory(history.slice(0, 50));
  syncGameResult(entry).catch((error) => {
    console.error(error);
    showToast("La partie n'a pas pu être enregistrée sur le compte.");
  });
}

function renderChipValue(value) {
  return `${formatChips(value)} €`;
}

function renderTableModeration(container, game, table, refresh) {
  const user = typeof accountUser === 'undefined' ? null : accountUser;
  if (!container || !user) return;
  const id = `moderation-${game}-${table.id}`;
  document.getElementById(id)?.remove();
  if (!user.isAdmin && Number(table.hostId) !== Number(user.id)) return;
  const panel = document.createElement('div');
  panel.id = id;
  panel.className = 'status-box subtle';
  const title = document.createElement('strong');
  title.textContent = `Gestion des joueurs · ${table.name || 'Table'}`;
  panel.append(title);
  const running = ['in-progress', 'running'].includes(table.status);
  for (const player of table.players || []) {
    if (Number(player.id) === Number(user.id)) continue;
    const row = document.createElement('div');
    row.className = 'history-item';
    const name = document.createElement('span');
    name.textContent = player.username;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-button';
    button.textContent = 'Expulser';
    button.disabled = running;
    button.title = running ? 'Disponible à la fin de la manche' : `Expulser ${player.username}`;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const response = await fetch(`/api/${game}/tables/${encodeURIComponent(table.id)}/kick`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId: Number(player.id) })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Expulsion impossible.');
        await refresh();
      } catch (error) {
        if (typeof showToast === 'function') showToast(error.message);
        else window.alert(error.message);
      } finally {
        button.disabled = running;
      }
    });
    row.append(name, button);
    panel.append(row);
  }
  container.append(panel);
}
