document.addEventListener("DOMContentLoaded", initializeApp);

async function initializeApp() {
  try {
    const loaded = await loadAccountData();
    if (!loaded) {
      window.location.replace("/");
      return;
    }
  } catch (error) {
    console.error(error);
    window.location.replace("/");
    return;
  }

  bindNavigation();
  bindGlobalButtons();
  updateTopbar();
  renderHomeView();
  renderProfileView();
  renderLeaderboard();
  rouletteModule.initialize();
  blackjackModule.initialize();
  pokerModule.initialize();
  slotsModule.initialize();
  adminModule.initialize(accountUser.isAdmin, accountUser.supportMode, accountUser.username);
}

function bindNavigation() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      const viewName = button.dataset.view;
      showView(viewName);
    });
  });
}

function bindGlobalButtons() {
  document.getElementById("openSettingsBtn").addEventListener("click", () => {
    showView("profile");
    document.getElementById("profileNameInput")?.focus();
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    const response = await fetch("/api/logout", { method: "POST" });
    if (response.ok) {
      window.location.replace("/");
    }
  });
}

function showView(viewName) {
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `${viewName}View`);
  });

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });
}

function updateTopbar() {
  const player = getPlayer();
  document.getElementById("topbarBalance").textContent = formatChips(player.chips);
  document.getElementById("topbarName").textContent = sanitizeText(player.name, 14);
  document.getElementById("topbarAvatar").textContent = player.avatar || "🎲";
}

function renderHomeView() {
  const player = getPlayer();
  const summary = getPlayerSummary(player);

  const cards = [
    {
      name: "Roulette",
      icon: "🎰",
      description: "Faites vos jeux. Rien ne va plus.",
      action: "REJOINDRE LA TABLE",
      view: "roulette"
    },
    {
      name: "Blackjack",
      icon: "🂠",
      description: "Approchez-vous de 21 sans le dépasser.",
      action: "JOUER AU BLACKJACK",
      view: "blackjack"
    },
    {
      name: "Poker",
      icon: "♠",
      description: "Texas Hold'em multi-joueurs, tables et blinds.",
      action: "REJOINDRE LE POKER",
      view: "poker"
    },
    {
      name: "Machine à sous",
      icon: "🪙",
      description: "Trois rouleaux. Une combinaison gagnante.",
      action: "LANCER LES ROULEAUX",
      view: "slots"
    }
  ];

  const homeCards = document.getElementById("homeCards");
  homeCards.innerHTML = cards
    .map(
      (card) => `
        <article class="game-card">
          <div class="game-art">${card.icon}</div>
          <div>
            <h3>${card.name}</h3>
            <p>${card.description}</p>
          </div>
          <button class="primary-button" type="button" data-home-view="${card.view}">${card.action}</button>
        </article>
      `
    )
    .join("");

  homeCards.querySelectorAll("[data-home-view]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.homeView));
  });

  const statTiles = [
    { label: "Parties", value: summary.totalGames },
    { label: "Victoires", value: summary.wins },
    { label: "Taux", value: `${summary.winRate}%` },
    { label: "Meilleur gain", value: `${formatChips(summary.bestWin)} ` },
    { label: "Solde", value: `${formatChips(summary.chips)}` },
    { label: "Dernière partie", value: summary.lastPlayed ? new Date(summary.lastPlayed).toLocaleDateString("fr-FR") : "Aucune" }
  ];

  document.getElementById("homeStats").innerHTML = statTiles
    .map(
      (tile) => `
        <div class="stat-tile">
          <span>${tile.label}</span>
          <strong>${tile.value}</strong>
        </div>
      `
    )
    .join("");

  renderHistoryList(document.getElementById("homeRecent"), getHistory().slice(0, 5), true);
  renderLeaderboardMini();
}

function renderHistoryList(container, historyList, compact = false) {
  if (!historyList || historyList.length === 0) {
    container.innerHTML = `<div class="status-box subtle">Aucun historique pour le moment.</div>`;
    return;
  }

  container.innerHTML = historyList
    .slice(0, compact ? 5 : historyList.length)
    .map((entry) => {
      const resultClass = entry.net >= 0 ? "success" : "danger";
      const prefix = entry.net >= 0 ? "+" : "";
      const gameLabel = entry.game.charAt(0).toUpperCase() + entry.game.slice(1);
      return `
        <div class="history-item">
          <div>
            <strong>${gameLabel}</strong><br />
            <small>${new Date(entry.date).toLocaleString("fr-FR")}</small>
          </div>
          <div>
            <small>${entry.result}</small><br />
            <small>${renderChipValue(entry.bet || 0)}</small>
          </div>
          <div style="text-align: right; color: ${resultClass === "success" ? "#9ae6a8" : "#ffb0a5"};">
            <strong>${prefix}${formatChips(entry.net || 0)}</strong><br />
            <small>${entry.payout || 0} payouts</small>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderLeaderboardMini() {
  const player = getPlayer();
  const summary = getPlayerSummary(player);
  const rankList = [
    { name: player.name, wins: summary.wins, winRate: summary.winRate, chips: player.chips }
  ];

  const container = document.getElementById("homeLeaderboard");
  container.innerHTML = rankList
    .map(
      (row, index) => `
        <div class="leaderboard-row">
          <span class="rank">${index + 1}</span>
          <div>
            <strong>${sanitizeText(row.name, 12)}</strong><br />
            <small>${row.wins} victoires</small>
          </div>
          <div>
            <small>Taux</small><br />
            <strong>${row.winRate}%</strong>
          </div>
          <strong>${formatChips(row.chips)}</strong>
        </div>
      `
    )
    .join("");
}

function renderLeaderboard() {
  const player = getPlayer();
  const summary = getPlayerSummary(player);
  const container = document.getElementById("leaderboardBoard");

  container.innerHTML = `
    <div class="leaderboard-row">
      <span class="rank">1</span>
      <div>
        <strong>${sanitizeText(player.name, 18)}</strong><br />
        <small>Classement local</small>
      </div>
      <div>
        <small>Victoires</small><br />
        <strong>${summary.wins}</strong>
      </div>
      <div>
        <small>Solde</small><br />
        <strong>${formatChips(player.chips)}</strong>
      </div>
    </div>
  `;
}

function renderProfileView() {
  const player = getPlayer();
  const nameInput = document.getElementById("profileNameInput");
  const soundToggle = document.getElementById("soundToggle");
  const avatarChoices = document.getElementById("avatarChoices");
  const historyFilter = document.getElementById("historyFilter");

  nameInput.value = player.name;
  nameInput.readOnly = true;
  soundToggle.checked = !!player.soundEnabled;

  avatarChoices.innerHTML = AVATAR_OPTIONS.map(
    (avatar) => `
      <button
        class="avatar-option ${player.avatar === avatar ? "active" : ""}"
        type="button"
        data-avatar="${avatar}"
        aria-label="Choisir l'avatar ${avatar}"
      >
        ${avatar}
      </button>
    `
  ).join("");

  avatarChoices.querySelectorAll("[data-avatar]").forEach((button) => {
    button.addEventListener("click", () => {
      const playerData = getPlayer();
      playerData.avatar = button.dataset.avatar;
      savePlayer(playerData);
      updateTopbar();
      renderProfileView();
      showToast("Avatar mis à jour.");
    });
  });

  soundToggle.onchange = () => {
    const playerData = getPlayer();
    playerData.soundEnabled = soundToggle.checked;
    savePlayer(playerData);
    showToast(soundToggle.checked ? "Sons activés." : "Sons désactivés.");
  };

  historyFilter.onchange = () => renderFilteredHistory();
  document.getElementById("resetProfileBtn").onclick = () => {
    const confirmed = window.confirm("Réinitialiser le solde et l'historique de ce compte ? Cette action est irréversible.");
    if (!confirmed) return;
    fetch("/api/reset", { method: "POST" })
      .then((response) => {
        if (!response.ok) throw new Error("Réinitialisation impossible.");
        window.location.reload();
      })
      .catch((error) => {
        console.error(error);
        showToast("Réinitialisation impossible.");
      });
  };

  renderFilteredHistory();
}

function renderFilteredHistory() {
  const filter = document.getElementById("historyFilter").value;
  const history = getHistory();
  const filtered = filter === "all" ? history : history.filter((entry) => entry.game === filter);
  renderHistoryList(document.getElementById("profileHistory"), filtered, false);
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast.timeoutId);
  showToast.timeoutId = setTimeout(() => {
    toast.classList.remove("visible");
  }, 1800);
}

window.getPlayer = getPlayer;
window.savePlayer = savePlayer;
window.showToast = showToast;
window.updateTopbar = updateTopbar;
window.renderHomeView = renderHomeView;
