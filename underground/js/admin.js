const adminModule = (() => {
  const state = { accounts: [], offset: 0, total: 0, search: '' };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function actionButton(label, action, account, className = 'secondary-button') {
    const button = element('button', className, label);
    button.type = 'button';
    button.dataset.adminAction = action;
    button.dataset.accountId = String(account.id);
    button.disabled = Boolean(account.is_admin && action !== 'details');
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

  function renderAccounts(accounts) {
    const body = document.getElementById('adminAccountsBody');
    for (const account of accounts) {
      const row = element('tr');
      const identity = element('td');
      identity.append(element('strong', '', `${account.avatar || '🎲'} ${account.username}`));
      identity.append(element('small', 'admin-meta', `ID ${account.id} · Créé le ${account.created_at || 'inconnu'}`));
      row.append(identity);
      row.append(element('td', '', formatChips(account.chips)));
      row.append(element('td', '', String(account.games_played)));
      const statusText = account.is_admin ? 'Admin' : account.is_banned ? 'Banni' : 'Actif';
      const statusClass = account.is_banned ? 'admin-banned' : 'admin-active';
      row.append(element('td', statusClass, statusText));

      const actions = element('td', 'admin-actions');
      actions.append(actionButton('Détails', 'details', account));
      if (!account.is_admin) {
        actions.append(actionButton('Jetons', 'chips', account));
        actions.append(actionButton(account.is_banned ? 'Débannir' : 'Bannir', 'ban', account, account.is_banned ? 'secondary-button' : 'danger-button'));
        if (!account.is_banned) {
          actions.append(actionButton('Vue support', 'support', account));
        }
      } else {
        actions.append(element('small', 'admin-meta', 'Administrateur protégé'));
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

      content.append(element('h4', '', 'Journal administratif'));
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
      content.append(auditList);
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

    if (button.dataset.adminAction === 'support') {
      if (!window.confirm(`Ouvrir une vue support temporaire pour ${account.username} ?`)) return;
      await request(`/api/admin/support/${accountId}/start`, { method: 'POST', body: '{}' });
      window.location.reload();
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

  function initialize(isAdmin, supportMode, username) {
    const navButton = document.getElementById('adminNavButton');
    const supportBanner = document.getElementById('supportModeBanner');
    if (!isAdmin) return;

    if (supportMode) {
      supportBanner.hidden = false;
      document.getElementById('supportModeUsername').textContent = username;
      navButton.hidden = true;
      document.getElementById('endSupportModeBtn').addEventListener('click', endSupportMode);
      return;
    }

    navButton.hidden = false;
    document.getElementById('adminSearchForm').addEventListener('submit', (event) => {
      event.preventDefault();
      loadAccounts();
    });
    document.getElementById('adminRefreshBtn').addEventListener('click', () => loadAccounts());
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
    loadAccounts();
  }

  return { initialize };
})();
