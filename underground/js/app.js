document.addEventListener("DOMContentLoaded", initializeApp);

let publicGameSettings = {};

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

  try {
    const response = await fetch("/api/game-settings");
    if (response.ok) {
      const payload = await response.json();
      publicGameSettings = payload.games || {};
      applyGameAvailability();
    }
  } catch (error) {
    console.error("Impossible de charger les paramètres des jeux:", error);
  }

  await crashModule.initialize();
  plinkoModule.initialize();
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
  adminModule.initialize(accountUser.isAdmin, accountUser.supportMode, accountUser.username, accountUser.isPrimaryAdmin);
}

function applyGameAvailability() {
  window.casinoGameSettings = publicGameSettings;
  for (const [game, settings] of Object.entries(publicGameSettings)) {
    const available = settings.enabled && !settings.maintenance;
    document.querySelector(`.nav-item[data-view="${game}"]`)?.toggleAttribute("hidden", !available);
    for (const inputId of game === "roulette" ? ["rouletteCustomStake"]
      : game === "blackjack" ? ["blackjackTableStake"]
        : game === "slots" ? ["slotsStake"]
          : game === "crash" ? ["crashStake"] : []) {
      const input = document.getElementById(inputId);
      if (!input) continue;
      input.min = String(settings.minBet);
      input.max = String(settings.maxBet);
      if (Number(input.value) < settings.minBet) input.value = String(settings.minBet);
      if (Number(input.value) > settings.maxBet) input.value = String(settings.maxBet);
    }
    if (game === "roulette") {
      document.querySelectorAll(".chip-option").forEach((button) => {
        const amount = Number(button.dataset.stake);
        button.hidden = amount < settings.minBet || amount > settings.maxBet;
      });
    }
  }
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

  document.body.addEventListener("click", (event) => {
    const profileButton = event.target.closest("[data-player-profile]");
    if (profileButton) openPlayerProfile(profileButton.dataset.playerProfile);
  });
  const profileDialog = document.getElementById("playerProfileDialog");
  document.getElementById("closePlayerProfileBtn").addEventListener("click", () => profileDialog.close());
  profileDialog.addEventListener("click", (event) => {
    if (event.target === profileDialog) profileDialog.close();
  });
}

function showView(viewName) {
  const settings = publicGameSettings[viewName];
  if ((settings && (!settings.enabled || settings.maintenance)) ||
      (viewName === "crash" && !crashModule.isEnabled())) {
    viewName = "home";
  }

  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `${viewName}View`);
  });

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });
  crashModule.setActive(viewName === "crash");
  plinkoModule.setActive(viewName === "plinko");
}

function updateTopbar() {
  const player = getPlayer();
  document.getElementById("topbarBalance").textContent = player.infiniteMoney ? '∞' : formatChips(player.chips);
  document.getElementById("topbarName").textContent = sanitizeText(player.name, 14);
  setAvatarContent(document.getElementById("topbarAvatar"), player.avatar, player.avatarImage);
}

function setAvatarContent(container, emoji, image) {
  container.replaceChildren();
  const design = getPlayer().design || {};
  container.style.setProperty("--avatar-fit", design.fit || "cover");
  container.style.setProperty("--avatar-position", `${design.position ?? 50}%`);
  if (image) {
    const photo = document.createElement("img");
    photo.src = image;
    photo.alt = "";
    container.append(photo);
  } else {
    container.textContent = emoji || "🎲";
  }
}

function createPlayerProfileButton(player, detail) {
  const button = document.createElement("button");
  button.className = "leaderboard-profile-button";
  button.type = "button";
  button.dataset.playerProfile = String(player.id);
  const avatar = document.createElement("span");
  avatar.className = "player-avatar";
  setAvatarContent(avatar, player.avatar, player.avatar_image);
  const identity = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = player.username;
  const subtitle = document.createElement("small");
  subtitle.textContent = detail;
  identity.append(name, document.createElement("br"), subtitle);
  button.append(avatar, identity);
  return button;
}

async function openPlayerProfile(playerId) {
  const dialog = document.getElementById("playerProfileDialog");
  const content = document.getElementById("playerProfileContent");
  content.textContent = "Chargement du profil…";
  if (!dialog.open) dialog.showModal();
  try {
    const response = await fetch(`/api/players/${encodeURIComponent(playerId)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Profil indisponible.");
    const profile = payload.profile;
    const avatar = document.createElement("div");
    avatar.className = "player-profile-avatar";
    setAvatarContent(avatar, profile.avatar, profile.avatar_image);
    const name = document.createElement("h3");
    name.textContent = profile.username;
    const stats = document.createElement("div");
    stats.className = "player-profile-stats";
    const values = [
      ["Solde", `${formatChips(profile.chips)} jetons`],
      ["Parties", profile.gamesPlayed],
      ["Victoires", profile.wins],
      ["Taux de victoire", `${profile.winRate}%`],
      ["Meilleur gain", `${formatChips(profile.bestWin)} jetons`],
      ["Bilan net", `${profile.net > 0 ? "+" : ""}${formatChips(profile.net)} jetons`]
    ];
    for (const [label, value] of values) {
      const stat = document.createElement("div");
      stat.className = "player-profile-stat";
      const caption = document.createElement("span");
      caption.textContent = label;
      const result = document.createElement("strong");
      result.textContent = String(value);
      stat.append(caption, result);
      stats.append(stat);
    }
    const design = JSON.parse(profile.profile_design || '{}');
    const banner = document.createElement('div');
    banner.className = 'profile-banner';
    content.dataset.style = design.style || 'aurora';
    content.style.setProperty('--profile-accent', design.accent || '#6ee7c7');
    if (design.banner) banner.style.backgroundImage = `url("${design.banner}")`;
    avatar.style.setProperty('--avatar-fit', design.fit || 'cover');
    avatar.style.setProperty('--avatar-position', `${design.position ?? 50}%`);
    const bio = document.createElement('p');
    bio.textContent = design.bio || '';
    content.replaceChildren(banner, avatar, name, bio, stats);
  } catch (error) {
    content.textContent = error.message || "Profil indisponible.";
  }
}

async function saveProfileImage(image) {
  const status = document.getElementById("avatarUploadStatus");
  status.textContent = "Enregistrement…";
  try {
    const response = await fetch("/api/profile/avatar", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Enregistrement de la photo impossible.");
    accountUser.avatar_image = payload.user.avatar_image;
    const player = getPlayer();
    player.avatarImage = payload.user.avatar_image;
    localStorage.setItem(STORAGE_KEYS.player, JSON.stringify(player));
    updateTopbar();
    renderHomeView();
    renderLeaderboard();
    renderProfileView();
    document.getElementById("avatarUploadStatus").textContent = image ? "Photo de profil mise à jour." : "Photo retirée.";
  } catch (error) {
    status.textContent = error.message || "Enregistrement de la photo impossible.";
  }
}

function renderHomeView() {
  const player = getPlayer();
  const summary = getPlayerSummary(player);

  const cards = [
    { name: "Plinko", icon: "◉", description: "16 rebonds. Une case. Jusqu’à 110 fois ta mise.", action: "LANCER UNE BILLE", view: "plinko" },
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
    },
    {
      name: "Jet Crash",
      icon: "✈",
      description: "Retire tes gains avant que le vol ne s’arrête.",
      action: "PRENDRE SON ENVOL",
      view: "crash"
    }
  ].filter((card) => {
    const settings = publicGameSettings[card.view];
    return (card.view !== "crash" || crashModule.isEnabled()) &&
      (!settings || (settings.enabled && !settings.maintenance));
  });

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
  const container = document.getElementById("homeLeaderboard");
  fetch("/api/leaderboard")
    .then((response) => response.ok ? response.json() : Promise.reject(new Error("Classement indisponible")))
    .then(({ leaderboard }) => {
      container.replaceChildren(...leaderboard.slice(0, 5).map((row, index) => {
        const entry = document.createElement("div");
        entry.className = "leaderboard-row";
        const rank = document.createElement("span");
        rank.className = "rank";
        rank.textContent = String(index + 1);
        const balance = document.createElement("strong");
        balance.textContent = formatChips(row.chips);
        entry.append(rank, createPlayerProfileButton(row, `${Number(row.wins)} victoires`), balance);
        return entry;
      }));
    })
    .catch(() => { container.textContent = "Classement indisponible."; });
}

function renderLeaderboard() {
  const container = document.getElementById("leaderboardBoard");
  fetch("/api/leaderboard")
    .then((response) => response.ok ? response.json() : Promise.reject(new Error("Classement indisponible")))
    .then(({ leaderboard }) => {
      container.replaceChildren(...leaderboard.map((row, index) => {
        const entry = document.createElement("div");
        entry.className = "leaderboard-row";
        const rank = document.createElement("span");
        rank.className = "rank";
        rank.textContent = String(index + 1);
        const identity = createPlayerProfileButton(row, `${Number(row.games_played)} parties · ${Number(row.wins)} victoires`);
        const wins = document.createElement("div");
        wins.innerHTML = `<small>Meilleur gain</small><br /><strong>${formatChips(row.best_win || 0)}</strong>`;
        const balance = document.createElement("div");
        balance.innerHTML = `<small>Solde</small><br /><strong>${formatChips(row.chips)}</strong>`;
        entry.append(rank, identity, wins, balance);
        return entry;
      }));
    })
    .catch(() => { container.textContent = "Classement indisponible."; });
}

function renderProfileView() {
  const player = getPlayer();
  const nameInput = document.getElementById("profileNameInput");
  const soundToggle = document.getElementById("soundToggle");
  const avatarChoices = document.getElementById("avatarChoices");
  const historyFilter = document.getElementById("historyFilter");

  initializeProfileDesign(player);
  nameInput.value = player.name;
  nameInput.readOnly = true;
  soundToggle.checked = !!player.soundEnabled;
  const profileImage = document.getElementById("profileAvatarImage");
  profileImage.hidden = !player.avatarImage;
  profileImage.src = player.avatarImage || "";
  document.getElementById("profileAvatarFallback").hidden = !!player.avatarImage;
  document.getElementById("profileAvatarFallback").textContent = player.avatar || "🎲";
  document.getElementById("removeAvatarImageBtn").hidden = !player.avatarImage;

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
      if (playerData.avatarImage) {
        saveProfileImage(null);
      } else {
        renderProfileView();
      }
      showToast("Avatar mis à jour.");
    });
  });

  document.getElementById("avatarImageInput").onchange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 1_000_000) {
      document.getElementById("avatarUploadStatus").textContent = "Choisis une image PNG, JPEG ou WebP de 1 Mo maximum.";
      event.target.value = "";
      return;
    }
    const image = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Lecture de l’image impossible."));
      reader.readAsDataURL(file);
    }).catch((error) => {
      document.getElementById("avatarUploadStatus").textContent = error.message;
      return null;
    });
    if (image) await saveProfileImage(image);
    event.target.value = "";
  };
  document.getElementById("removeAvatarImageBtn").onclick = () => saveProfileImage(null);

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

function initializeProfileDesign(player) {
  const saved = { accent: '#6ee7c7', style: 'aurora', banner: null, fit: 'cover', position: 50, bio: '', ...player.design };
  let banner = saved.banner;
  const form = document.getElementById('profileDesignForm');
  const field = (name) => document.getElementById(`profile${name}`);
  for (const key of ['Accent', 'Style', 'Fit', 'Position', 'Bio']) field(key).value = saved[key.toLowerCase()];
  const read = () => ({ accent: field('Accent').value, style: field('Style').value, fit: field('Fit').value, position: Number(field('Position').value), bio: field('Bio').value, banner });
  const preview = () => {
    const design = read();
    const hero = document.getElementById('profileHero');
    hero.dataset.style = design.style;
    hero.style.setProperty('--profile-accent', design.accent);
    document.getElementById('profileBanner').style.backgroundImage = banner ? `url("${banner}")` : '';
    document.getElementById('profileHeroName').textContent = player.name;
    document.getElementById('profileHeroBio').textContent = design.bio || 'Écris ton histoire. Affirme ton style.';
    const avatar = document.getElementById('profileHeroAvatar');
    setAvatarContent(avatar, player.avatar, player.avatarImage);
    for (const frame of [avatar, document.getElementById('profileAvatarPreview')]) {
      frame.style.setProperty('--avatar-fit', design.fit);
      frame.style.setProperty('--avatar-position', `${design.position}%`);
    }
  };
  form.oninput = preview;
  field('BannerInput').onchange = async (event) => {
    const file = event.target.files[0];
    const status = field('DesignStatus');
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1000000) {
      status.textContent = 'Choisis une image PNG, JPEG ou WebP de 1 Mo maximum.';
      event.target.value = ''; return;
    }
    try {
      banner = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
      status.textContent = 'Aperçu mis à jour. Enregistre pour conserver ta bannière.';
      preview();
    } catch { status.textContent = 'Lecture de la bannière impossible.'; }
    event.target.value = '';
  };
  document.getElementById('removeProfileBanner').onclick = () => { banner = null; preview(); };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const response = await fetch('/api/profile/design', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(read()) });
      if (response.status === 404) {
        throw new Error('Le serveur ne dispose pas de la personnalisation du profil. Redémarre le serveur avec la dernière version ; avec Docker, reconstruis l’image avec docker compose up -d --build. Ta bannière reste dans l’aperçu pour réessayer.');
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Enregistrement impossible.');
      const current = getPlayer(); current.design = payload.design; savePlayer(current);
      updateTopbar(); field('DesignStatus').textContent = 'Ton style est enregistré.';
    } catch (error) { field('DesignStatus').textContent = error.message; }
    finally { button.disabled = false; }
  };
  preview();
}
