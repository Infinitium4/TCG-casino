const adminModule = (() => {
  const state = { accounts: [], offset: 0, total: 0, search: '', isPrimaryAdmin: false, username: '', bettingPaused: false };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function updateInfiniteControl() {
    const enabled = Boolean(getPlayer().infiniteMoney);
    document.getElementById('adminInfiniteMoneyBtn').textContent = enabled ? 'Désactiver l’argent infini' : 'Activer sur mon compte';
    document.getElementById('adminInfiniteStatus').textContent = enabled
      ? 'Actif : tes jetons se rechargent automatiquement. La désactivation restaure ton solde précédent.'
      : 'Réservé à admin1. Active un solde automatiquement réapprovisionné pour jouer.';
  }

  function actionButton(label, action, account, className = 'secondary-button') {
    const button = element('button', className, label);
    button.type = 'button';
    button.dataset.adminAction = action;
    button.dataset.accountId = String(account.id);
    button.disabled = Boolean(account.is_bank || (account.is_primary_admin && !['details', 'reset'].includes(action)) ||
      (account.is_admin && !state.isPrimaryAdmin && action !== 'details'));
    return button;
  }

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || 'La demande administrateur a échoué.');
    }
    return payload;
  }

  async function loadAccounts(reset = true) {
    const status = document.getElementById('adminAccountsStatus');
    const body = document.getElementById('adminAccountsBody');
    const moreButton = document.getElementById('adminLoadMoreBtn');
    if (reset) {
      state.offset = 0;
      state.accounts = [];
      state.search = document.getElementById('adminSearchInput').value.trim();
      body.replaceChildren();
    }
    status.textContent = 'Chargement des comptes...';
    try {
      const params = new URLSearchParams({
        search: state.search,
        limit: '25',
        offset: String(state.offset)
      });
      const payload = await request(`/api/admin/accounts?${params}`);
      state.total = payload.total;
      state.accounts = reset ? payload.accounts : [...state.accounts, ...payload.accounts];
      state.offset = state.accounts.length;
      renderAccounts(payload.accounts);
      document.getElementById('adminAccountCount').textContent = `${state.total} compte(s)`;
      moreButton.hidden = state.offset >= state.total;
      status.textContent = state.total ? '' : 'Aucun compte ne correspond à cette recherche.';
    } catch (error) {
      console.error(error);
      status.textContent = error.message || 'Impossible de charger les comptes.';
    }
  }

  async function loadBank() {
    const summary = document.getElementById('adminBankSummary');
    const ledger = document.getElementById('adminBankLedger');
    if (!summary || !ledger) return;
    summary.textContent = 'Chargement de la banque...';
    ledger.replaceChildren();
    try {
      const payload = await request('/api/admin/bank');
      summary.textContent = `${payload.bank.username} · solde ${formatChips(payload.bank.chips)} · collecté ${formatChips(payload.totals.collected)} · payé aux joueurs ${formatChips(Math.abs(payload.totals.paid))} · ${payload.totals.settlements} règlement(s)`;
      if (!payload.recent.length) {
        ledger.append(element('li', '', 'Aucun règlement enregistré.'));
        return;
      }
      for (const entry of payload.recent) {
        const bankDelta = Number(entry.bank_delta);
        const signedDelta = `${bankDelta > 0 ? '+' : ''}${formatChips(bankDelta)}`;
        ledger.append(element(
          'li',
          '',
          `${entry.created_at} · ${entry.player_username} · ${entry.game_name} · net joueur ${formatChips(entry.player_net)} · banque ${signedDelta}`
        ));
      }
    } catch (error) {
      console.error(error);
      summary.textContent = error.message || 'Impossible de charger le compte banque.';
    }
  }

  async function loadOverview() {
    try {
      const payload = await request('/api/admin/overview');
      const stats = document.getElementById('adminOverviewStats');
      const values = [
        ['Joueurs', payload.stats.players],
        ['Connectés', payload.stats.online],
        ['Jetons en circulation', formatChips(payload.stats.chips)],
        ['Parties jouées', payload.stats.games],
        ['Mises cumulées', formatChips(payload.stats.wagered)],
        ['Gains cumulés', formatChips(payload.stats.payouts)]
      ];
      stats.replaceChildren(...values.map(([label, value]) => {
        const tile = element('div', 'admin-overview-tile');
        tile.append(element('small', '', label), element('strong', '', String(value)));
        return tile;
      }));

      const online = document.getElementById('adminOnlinePlayers');
      if (!payload.onlinePlayers.length) {
        online.textContent = 'Aucun joueur connecté.';
      } else {
        online.replaceChildren(...payload.onlinePlayers.map((player) => {
          const row = element('div', 'admin-live-row');
          row.append(element('strong', '', player.username), element('span', '', player.game || 'En ligne'));
          if (player.username !== state.username) {
            const disconnectButton = element('button', 'danger-button', 'Déconnecter');
            disconnectButton.type = 'button';
            disconnectButton.addEventListener('click', async () => {
              await request(`/api/admin/accounts/${player.id}/disconnect`, { method: 'POST', body: '{}' });
              await loadOverview();
              await loadAccounts();
            });
            row.append(disconnectButton);
          }
          return row;
        }));
      }

      const games = document.getElementById('adminActiveGames');
      if (!payload.activeGames.length) {
        games.textContent = 'Aucune partie en cours.';
      } else {
        games.replaceChildren(...payload.activeGames.map((game) => element(
          'div',
          'admin-live-row',
          `${game.game} · ${game.players.map((player) => `${player.username} (${formatChips(player.stake)})`).join(', ')} · mises ${formatChips(game.wagered)}`
        )));
      }
    } catch (error) {
      document.getElementById('adminOnlinePlayers').textContent = error.message || 'Supervision indisponible.';
    }
  }

  async function loadAudit() {
    const list = document.getElementById('adminGlobalAudit');
    if (!list || !state.isPrimaryAdmin) return;
    try {
      const payload = await request('/api/admin/audit?limit=50');
      if (!payload.entries.length) {
        list.replaceChildren(element('li', '', 'Aucune action enregistrée.'));
        return;
      }
      list.replaceChildren(...payload.entries.map((entry) => {
        const amount = entry.amount === null ? '' : ` (${entry.amount > 0 ? '+' : ''}${formatChips(entry.amount)})`;
        return element('li', '', `${entry.created_at} · ${entry.admin_username} · ${entry.action}${amount} · ${entry.target_username || 'système'} · ${entry.reason}`);
      }));
    } catch (error) {
      list.replaceChildren(element('li', '', error.message || 'Journal indisponible.'));
    }
  }

  async function loadSettings() {
    const container = document.getElementById('adminGameSettings');
    if (!container) return;
    try {
      const payload = await request('/api/admin/settings');
      state.bettingPaused = payload.bettingPaused;
      const pauseButton = document.getElementById('adminEmergencyPauseBtn');
      pauseButton.hidden = !state.isPrimaryAdmin;
      pauseButton.textContent = state.bettingPaused ? 'Reprendre les mises' : 'Arrêter temporairement les mises';
      document.getElementById('adminEmergencyStatus').textContent = state.bettingPaused
        ? 'Arrêt d’urgence actif : les nouvelles mises sont bloquées.'
        : 'Les mises sont ouvertes.';
      document.getElementById('adminRootPanel').hidden = !state.isPrimaryAdmin;
      if (!state.isPrimaryAdmin) return;
      const labels = { roulette: 'Roulette', blackjack: 'Blackjack', poker: 'Poker', slots: 'Machine à sous', crash: 'Crash' };
      container.replaceChildren(...payload.games.map((game) => {
        const row = element('div', 'admin-game-setting');
        row.append(element('strong', '', labels[game.game] || game.game));
        const enabledLabel = element('label', 'admin-setting-toggle');
        const enabled = document.createElement('input');
        enabled.type = 'checkbox';
        enabled.checked = game.enabled;
        enabledLabel.append(enabled, element('span', '', 'Activé'));
        const maintenanceLabel = element('label', 'admin-setting-toggle');
        const maintenance = document.createElement('input');
        maintenance.type = 'checkbox';
        maintenance.checked = game.maintenance;
        maintenanceLabel.append(maintenance, element('span', '', 'Maintenance'));
        const minBet = document.createElement('input');
        minBet.type = 'number';
        minBet.min = '1';
        minBet.max = '2147483647';
        minBet.value = String(game.minBet);
        minBet.setAttribute('aria-label', `Mise minimale ${labels[game.game] || game.game}`);
        const maxBet = document.createElement('input');
        maxBet.type = 'number';
        maxBet.min = '1';
        maxBet.max = '2147483647';
        maxBet.value = String(game.maxBet);
        maxBet.setAttribute('aria-label', `Mise maximale ${labels[game.game] || game.game}`);
        const save = element('button', 'secondary-button', 'Enregistrer');
        save.type = 'button';
        save.addEventListener('click', async () => {
          const reason = window.prompt(`Motif du changement pour ${labels[game.game] || game.game} :`);
          if (!reason?.trim()) return;
          await request(`/api/admin/games/${game.game}`, {
            method: 'PATCH',
            body: JSON.stringify({
              enabled: enabled.checked,
              maintenance: maintenance.checked,
              minBet: Number(minBet.value),
              maxBet: Number(maxBet.value),
              reason
            })
          });
          window.location.reload();
        });
        row.append(enabledLabel, maintenanceLabel);
        row.append(element('label', '', 'Min'), minBet, element('label', '', 'Max'), maxBet);
        row.append(save);
        return row;
      }));
    } catch (error) {
      container.textContent = error.message || 'Réglages indisponibles.';
    }
  }

  function renderAccounts(accounts) {
    const body = document.getElementById('adminAccountsBody');
    for (const account of accounts) {
      const row = element('tr');
      const identity = element('td');
      identity.append(element('strong', '', `${account.avatar || '🎲'} ${account.username}`));
      identity.append(element('small', 'admin-meta', `ID ${account.id} · Créé le ${account.created_at || 'inconnu'}`));
      row.append(identity);
      row.append(element('td', '', account.infinite_money ? '∞ · Illimité' : formatChips(account.chips)));
      row.append(element('td', '', String(account.games_played)));
      const statusText = account.is_bank ? 'Banque interne' : account.is_primary_admin ? 'Admin principal'
        : account.is_banned ? 'Banni' : account.is_suspended ? 'Suspendu temporairement'
          : account.is_admin ? 'Admin' : 'Actif';
      const statusClass = account.is_banned || account.is_suspended ? 'admin-banned' : 'admin-active';
      row.append(element('td', statusClass, statusText));
      row.append(element('td', account.is_online ? 'admin-online' : 'admin-meta', account.is_online ? 'En ligne' : 'Hors ligne'));

      const actions = element('td', 'admin-actions');
      actions.append(actionButton('Détails', 'details', account));
      if (state.isPrimaryAdmin && !account.is_bank) actions.append(actionButton('Réinitialiser', 'reset', account, 'danger-button'));
      if (state.isPrimaryAdmin && !account.is_primary_admin && !account.is_bank) {
        actions.append(actionButton(account.is_admin ? 'Retirer admin' : 'Nommer admin', 'adminRole', account));
      }
      if ((!account.is_admin || state.isPrimaryAdmin) && !account.is_bank && !account.is_primary_admin) {
        actions.append(actionButton('Jetons', 'chips', account));
        actions.append(actionButton(account.is_banned ? 'Débannir' : 'Bannir', 'ban', account, account.is_banned ? 'secondary-button' : 'danger-button'));
        if (!account.is_banned) actions.append(actionButton(account.is_suspended ? 'Lever suspension' : 'Suspendre', 'suspend', account));
        if (!account.is_banned) {
          actions.append(actionButton('Vue support', 'support', account));
        }
        actions.append(actionButton('Supprimer', 'delete', account, 'danger-button'));
      }
      if (account.is_online && !account.is_primary_admin) actions.append(actionButton('Déconnecter', 'disconnect', account, 'danger-button'));
      if (actions.children.length > 1) {
        const menu = element('details', 'admin-account-menu');
        menu.append(element('summary', '', 'Gérer le compte'));
        const buttons = element('div', 'admin-account-menu-buttons');
        [...actions.children].slice(1).forEach(button => buttons.append(button));
        menu.append(buttons); actions.append(menu);
      }
      row.append(actions);
      body.append(row);
    }
  }

  async function showDetails(accountId) {
    const title = document.getElementById('adminDetailTitle');
    const content = document.getElementById('adminAccountDetails');
    title.textContent = 'Chargement des détails...';
    content.replaceChildren();
    try {
      const payload = await request(`/api/admin/accounts/${accountId}`);
      title.textContent = `${payload.account.username} · détails`;

      const historyTitle = element('h4', '', 'Dernières parties');
      content.append(historyTitle);
      const historyList = element('ul', 'admin-detail-list');
      for (const entry of payload.history) {
        historyList.append(element(
          'li',
          '',
          `${entry.created_at} · ${entry.game_name} · mise ${formatChips(entry.bet)} · ${entry.result} · net ${formatChips(entry.net)}`
        ));
      }
      if (!payload.history.length) historyList.append(element('li', '', 'Aucune partie enregistrée.'));
      content.append(historyList);

      const auditSection = element('details', 'admin-log');
      auditSection.append(element('summary', '', 'Journal administratif'));
      const auditList = element('ul', 'admin-detail-list');
      for (const entry of payload.audit) {
        const amount = entry.amount === null ? '' : ` (${entry.amount > 0 ? '+' : ''}${formatChips(entry.amount)})`;
        auditList.append(element(
          'li',
          '',
          `${entry.created_at} · ${entry.admin_username} · ${entry.action}${amount} · ${entry.reason}`
        ));
      }
      if (!payload.audit.length) auditList.append(element('li', '', 'Aucune action administrative enregistrée.'));
      auditSection.append(auditList);
      content.append(auditSection);
    } catch (error) {
      console.error(error);
      title.textContent = 'Détails indisponibles';
      content.textContent = error.message || 'Impossible de charger les détails du compte.';
    }
  }

  async function handleAction(button) {
    const accountId = button.dataset.accountId;
    const account = state.accounts.find((entry) => String(entry.id) === accountId);
    if (!account) return;

    if (button.dataset.adminAction === 'details') {
      await showDetails(accountId);
      return;
    }
    if (button.dataset.adminAction === 'reset') {
      if (!window.confirm(`Réinitialiser ${account.username} ? Solde remis à 1 000, historique et personnalisation effacés. Pseudo, mot de passe et droits conservés. Cette action est irréversible.`)) return;
      const reason = window.prompt('Motif de réinitialisation :');
      if (!reason?.trim()) return;
      await request(`/api/admin/accounts/${accountId}/reset`, { method: 'POST', body: JSON.stringify({ reason }) });
      await loadAccounts(); await loadOverview(); await loadAudit(); await showDetails(accountId);
      if (account.username === state.username) { await loadAccountData(); updateTopbar(); renderProfileView(); updateInfiniteControl(); }
      return;
    }

    if (button.dataset.adminAction === 'support') {
      if (!window.confirm(`Ouvrir une vue support temporaire pour ${account.username} ?`)) return;
      await request(`/api/admin/support/${accountId}/start`, { method: 'POST', body: '{}' });
      window.location.reload();
      return;
    }

    if (button.dataset.adminAction === 'disconnect') {
      if (!window.confirm(`Déconnecter ${account.username} ?`)) return;
      await request(`/api/admin/accounts/${accountId}/disconnect`, { method: 'POST', body: '{}' });
      await loadAccounts();
      await loadOverview();
      return;
    }

    if (button.dataset.adminAction === 'adminRole') {
      const isAdmin = !account.is_admin;
      if (!window.confirm(`${isAdmin ? 'Donner les droits admin à' : 'Retirer les droits admin de'} ${account.username} ?`)) return;
      const reason = window.prompt('Motif obligatoire pour le journal de sécurité :');
      if (!reason?.trim()) return;
      await request(`/api/admin/accounts/${accountId}/permissions`, {
        method: 'POST',
        body: JSON.stringify({ isAdmin, reason })
      });
      await loadAccounts();
      await loadAudit();
      return;
    }

    if (button.dataset.adminAction === 'chips') {
      const amountText = window.prompt('Variation des jetons (ex. 500 ou -100) :');
      if (amountText === null) return;
      const delta = Number(amountText);
      if (!Number.isSafeInteger(delta) || delta === 0) {
        window.alert('Entre un nombre entier non nul.');
        return;
      }
      const reason = window.prompt('Motif obligatoire pour le journal :');
      if (!reason?.trim()) return;
      await request(`/api/admin/accounts/${accountId}/chips`, {
        method: 'POST',
        body: JSON.stringify({ delta, reason })
      });
      await loadAccounts();
      await showDetails(accountId);
      return;
    }

    if (button.dataset.adminAction === 'ban') {
      const banned = !account.is_banned;
      if (!window.confirm(`${banned ? 'Bannir' : 'Débannir'} le compte ${account.username} ?`)) return;
      const reason = window.prompt('Motif obligatoire pour le journal :');
      if (!reason?.trim()) return;
      await request(`/api/admin/accounts/${accountId}/ban`, {
        method: 'POST',
        body: JSON.stringify({ banned, reason })
      });
      await loadAccounts();
      await showDetails(accountId);
      return;
    }

    if (button.dataset.adminAction === 'suspend') {
      const minutesText = window.prompt('Durée en minutes (0 pour lever la suspension) :', account.is_suspended ? '0' : '30');
      if (minutesText === null) return;
      const minutes = Number(minutesText);
      if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 10_080) {
        window.alert('La durée doit être comprise entre 0 et 10 080 minutes.');
        return;
      }
      const reason = window.prompt('Motif obligatoire pour le journal administratif :');
      if (!reason?.trim()) return;
      await request(`/api/admin/accounts/${accountId}/suspend`, {
        method: 'POST',
        body: JSON.stringify({ minutes, reason })
      });
      await loadAccounts();
      await showDetails(accountId);
      return;
    }

    if (button.dataset.adminAction === 'delete') {
      if (!window.confirm(`Supprimer définitivement le compte ${account.username} et son historique de parties ? Cette action est irréversible.`)) return;
      if (window.prompt(`Pour confirmer, saisis exactement le pseudo : ${account.username}`) !== account.username) {
        window.alert('Le pseudo ne correspond pas. Suppression annulée.');
        return;
      }
      const reason = window.prompt('Motif obligatoire pour le journal administratif :');
      if (!reason?.trim()) return;
      await request(`/api/admin/accounts/${accountId}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason })
      });
      document.getElementById('adminDetailTitle').textContent = 'Détails du compte';
      document.getElementById('adminAccountDetails').replaceChildren();
      await loadAccounts();
    }
  }

  async function endSupportMode() {
    try {
      await request('/api/admin/support/end', { method: 'POST', body: '{}' });
      window.location.reload();
    } catch (error) {
      console.error(error);
      window.alert(error.message || 'Impossible de revenir au compte administrateur.');
    }
  }

  function initialize(isAdmin, supportMode, username, isPrimaryAdmin) {
    const navButton = document.getElementById('adminNavButton');
    const supportBanner = document.getElementById('supportModeBanner');
    if (!isAdmin) return;
    state.isPrimaryAdmin = Boolean(isPrimaryAdmin);
    state.username = username;

    if (supportMode) {
      supportBanner.hidden = false;
      document.getElementById('supportModeUsername').textContent = username;
      navButton.hidden = true;
      document.getElementById('endSupportModeBtn').addEventListener('click', endSupportMode);
      return;
    }

    navButton.hidden = false;
    const panel = document.querySelector('#adminView .admin-panel');
    const navigation = element('nav', 'admin-section-nav');
    navigation.setAttribute('aria-label', 'Sections administrateur');
    for (const [target, label] of [['adminSupervision', 'Vue d’ensemble'], ['adminQuickActions', 'Commandes'], ['adminRootPanel', 'Admin1'], ['adminSearchForm', 'Comptes']]) {
      if (target === 'adminRootPanel' && !state.isPrimaryAdmin) continue;
      const link = element('a', '', label); link.href = `#${target}`; navigation.append(link);
    }
    const logsButton = element('button', 'secondary-button', 'Afficher les logs');
    logsButton.type = 'button';
    logsButton.addEventListener('click', () => {
      const open = logsButton.getAttribute('aria-expanded') !== 'true';
      panel.querySelectorAll('details.admin-log').forEach(log => { log.open = open; });
      logsButton.setAttribute('aria-expanded', String(open));
      logsButton.textContent = open ? 'Cacher les logs' : 'Afficher les logs';
    });
    logsButton.setAttribute('aria-expanded', 'false');
    navigation.append(logsButton); panel.querySelector('.section-heading').after(navigation);
    updateInfiniteControl();
    document.getElementById('adminInfiniteMoneyBtn').addEventListener('click', async (event) => {
      if (!state.isPrimaryAdmin) return;
      event.target.disabled = true;
      try {
        await request('/api/admin/infinite-money', { method: 'POST', body: JSON.stringify({ enabled: !getPlayer().infiniteMoney }) });
        await loadAccountData(); updateTopbar(); updateInfiniteControl(); await loadAccounts(); await loadAudit();
      } catch (error) { window.alert(error.message); }
      finally { event.target.disabled = false; }
    });
    document.getElementById('adminSearchForm').addEventListener('submit', (event) => {
      event.preventDefault();
      loadAccounts();
    });
    document.getElementById('adminRefreshBtn').addEventListener('click', () => {
      loadAccounts();
      loadBank();
      loadOverview();
      loadAudit();
      loadSettings();
    });
    document.getElementById('adminLoadMoreBtn').addEventListener('click', () => loadAccounts(false));
    document.getElementById('adminAccountsBody').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-admin-action]');
      if (!button || button.disabled) return;
      try {
        await handleAction(button);
      } catch (error) {
        console.error(error);
        window.alert(error.message || 'L’action administrateur a échoué.');
      }
    });
    document.getElementById('adminDistributionForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const amount = Number(document.getElementById('adminDistributionAmount').value);
      const reason = document.getElementById('adminDistributionReason').value.trim();
      if (!Number.isSafeInteger(amount) || amount < 1 || !reason) return;
      if (!window.confirm(`Distribuer ${formatChips(amount)} jetons à chaque joueur ?`)) return;
      try {
        const payload = await request('/api/admin/chips/distribute', {
          method: 'POST',
          body: JSON.stringify({ amount, reason })
        });
        window.alert(`Distribution terminée : ${payload.recipients} joueur(s).`);
        await loadAccounts();
        await loadOverview();
        await loadAudit();
      } catch (error) {
        window.alert(error.message || 'Distribution impossible.');
      }
    });
    document.getElementById('adminEmergencyPauseBtn').addEventListener('click', async () => {
      if (!state.isPrimaryAdmin) return;
      const paused = !state.bettingPaused;
      if (!window.confirm(paused ? 'Bloquer immédiatement toutes les nouvelles mises ?' : 'Réouvrir les mises ?')) return;
      const reason = window.prompt('Motif obligatoire pour le journal de sécurité :');
      if (!reason?.trim()) return;
      try {
        await request('/api/admin/security/pause-bets', {
          method: 'POST',
          body: JSON.stringify({ paused, reason })
        });
        await loadSettings();
        await loadAudit();
      } catch (error) {
        window.alert(error.message || 'Impossible de modifier l’arrêt d’urgence.');
      }
    });
    loadAccounts();
    loadBank();
    loadOverview();
    loadSettings();
    loadAudit();
    window.setInterval(loadOverview, 5000);
  }

  return { initialize };
})();
