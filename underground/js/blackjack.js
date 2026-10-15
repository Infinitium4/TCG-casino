const blackjackModule = (() => {
  const state = {
    tables: [],
    currentTableId: null,
    poller: null
  };

  function getCurrentUserId() {
    return Number(accountUser?.id ?? getPlayer()?.id ?? 0);
  }

  function getCurrentTable() {
    return state.tables.find((table) => String(table.id) === String(state.currentTableId)) || null;
  }

  function initialize() {
    document.getElementById('blackjackCreateTableBtn')?.addEventListener('click', createTable);
    document.getElementById('blackjackHostStartBtn')?.addEventListener('click', startRound);
    document.getElementById('blackjackLeaveTableBtn')?.addEventListener('click', leaveTable);

    refreshTables();
    if (state.poller) clearInterval(state.poller);
    state.poller = setInterval(refreshTables, 2500);
  }

  async function refreshTables() {
    const statusNode = document.getElementById('blackjackStatus');
    const listNode = document.getElementById('blackjackTableList');
    const roomNode = document.getElementById('blackjackWaitingRoom');
    if (!statusNode || !listNode || !roomNode) return;

    try {
      const response = await fetch('/api/blackjack/tables');
      if (!response.ok) throw new Error('Impossible de charger les tables.');
      const payload = await response.json();
      state.tables = payload.tables || [];

      const userId = getCurrentUserId();
      const joinedTable = state.tables.find((table) => table.players.some((player) => Number(player.id) === userId));
      if (joinedTable) {
        state.currentTableId = String(joinedTable.id);
        if (joinedTable.status === 'in-progress') {
          window.location.href = `/blackjack/game/${joinedTable.id}`;
          return;
        }
      } else if (!state.tables.some((table) => String(table.id) === String(state.currentTableId))) {
        state.currentTableId = null;
      }

      renderTables();
      renderWaitingRoom();
      statusNode.textContent = state.tables.length
        ? `${state.tables.length} table(s) ouverte(s). Jusqu’à ${state.tables[0].maxPlayers} joueurs par table.`
        : 'Aucune table ouverte. Crée la première.';
    } catch (error) {
      statusNode.textContent = 'Le lobby blackjack est temporairement indisponible.';
      console.error(error);
    }
  }

  function renderTables() {
    const listNode = document.getElementById('blackjackTableList');
    const roomNode = document.getElementById('blackjackWaitingRoom');
    if (!listNode || !roomNode) return;

    const currentTable = getCurrentTable();
    const inRoom = !!state.currentTableId && currentTable?.status === 'waiting';
    listNode.style.display = inRoom ? 'none' : 'block';
    roomNode.style.display = inRoom ? 'block' : 'none';
    if (inRoom) return;

    if (!state.tables.length) {
      listNode.innerHTML = '<div class="status-box subtle">Aucune table actuellement ouverte.</div>';
      return;
    }

    const userId = getCurrentUserId();
    listNode.innerHTML = state.tables.map((table) => {
      const joined = table.players.some((player) => Number(player.id) === userId);
      const unavailable = joined || table.status !== 'waiting' || table.players.length >= table.maxPlayers;
      return `
        <div class="history-item">
          <div>
            <strong>${sanitizeText(table.name || table.id, 24)}</strong><br />
            <small>${table.players.length}/${table.maxPlayers} joueurs</small>
          </div>
          <small>${table.status === 'in-progress' ? 'En cours' : 'En attente'}</small>
          <button class="primary-button" type="button" data-blackjack-table="${table.id}" ${unavailable ? 'disabled' : ''}>
            ${joined ? 'Déjà présent' : 'Rejoindre'}
          </button>
        </div>
      `;
    }).join('');

    listNode.querySelectorAll('[data-blackjack-table]').forEach((button) => {
      button.addEventListener('click', () => joinTable(button.dataset.blackjackTable));
    });
  }

  function renderWaitingRoom() {
    const roomNode = document.getElementById('blackjackWaitingRoom');
    const metaNode = document.getElementById('blackjackWaitingMeta');
    const playersNode = document.getElementById('blackjackWaitingPlayers');
    const boardNode = document.getElementById('blackjackWaitingBoard');
    const stakeInput = document.getElementById('blackjackTableStake');
    const startButton = document.getElementById('blackjackHostStartBtn');
    const leaveButton = document.getElementById('blackjackLeaveTableBtn');
    const table = getCurrentTable();
    if (!roomNode || !metaNode || !playersNode || !boardNode || !table) return;

    const userId = getCurrentUserId();
    const isHost = Number(table.hostId) === userId;
    metaNode.textContent = `${sanitizeText(table.name, 30)} • ${table.players.length}/${table.maxPlayers} joueurs • Salle d’attente`;
    playersNode.innerHTML = table.players.map((player) => `
      <div class="history-item">
        <div>
          <strong>${sanitizeText(player.username || 'Joueur', 18)}</strong>
          <small>${Number(player.id) === Number(table.hostId) ? ' • Hôte' : ''}</small>
        </div>
        <small>${formatChips(player.chips)} €</small>
      </div>
    `).join('');

    boardNode.textContent = `L’hôte choisit la mise commune. Chaque joueur doit avoir assez de € (${table.players.length}/${table.maxPlayers} places).`;
    stakeInput.disabled = !isHost;
    stakeInput.value = String(table.betAmount || stakeInput.value || 0.05);
    startButton.disabled = !isHost;
    startButton.textContent = isHost ? (table.round === 'finished' ? 'Rejouer la manche' : 'Lancer la manche') : 'En attente de l’hôte';
    leaveButton.disabled = false;
  }

  async function createTable() {
    try {
      const response = await fetch('/api/blackjack/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableName: `Table Blackjack ${Date.now()}` })
      });
      if (!response.ok) throw new Error('Impossible de créer une table.');
      const payload = await response.json();
      state.currentTableId = String(payload.table.id);
      showToast('Table créée. Invite les autres joueurs avant de lancer la manche.');
      await refreshTables();
    } catch (error) {
      console.error(error);
      showToast(error.message || 'La création de la table a échoué.');
    }
  }

  async function joinTable(tableId) {
    try {
      const response = await fetch(`/api/blackjack/tables/${tableId}/join`, { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Impossible de rejoindre la table.');
      state.currentTableId = String(payload.table.id);
      showToast(`Tu as rejoint ${payload.table.name}.`);
      await refreshTables();
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Tu ne peux pas rejoindre cette table.');
    }
  }

  async function leaveTable() {
    if (!state.currentTableId) return;
    try {
      const response = await fetch(`/api/blackjack/tables/${state.currentTableId}/leave`, { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Impossible de quitter la table.');
      state.currentTableId = null;
      await refreshTables();
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Impossible de quitter la table.');
    }
  }

  async function startRound() {
    if (!state.currentTableId) return;
    const betAmount = Number(document.getElementById('blackjackTableStake')?.value || 0);
    if (!isMoney(betAmount) || betAmount <= 0) {
      showToast('La mise commune doit être positive, avec deux décimales maximum.');
      return;
    }

    try {
      const response = await fetch(`/api/blackjack/tables/${state.currentTableId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ betAmount })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Impossible de lancer la manche.');
      window.location.href = `/blackjack/game/${payload.table.id}`;
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Le lancement de la manche a échoué.');
    }
  }

  window.blackjackModule = { initialize, refreshTables };
  return { initialize, refreshTables };
})();