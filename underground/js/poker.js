const pokerModule = (() => {
  const state = {
    tables: [],
    currentTableId: null,
    poller: null,
    amountDraft: null
  };

  function getCurrentUserId() {
    return Number(accountUser?.id ?? getPlayer()?.id ?? 0);
  }

  function getCurrentTable() {
    return state.tables.find((table) => String(table.id) === String(state.currentTableId)) || null;
  }

  function initialize() {
    const createButton = document.getElementById("pokerCreateTableBtn");
    const startButton = document.getElementById("pokerStartTableBtn");
    const leaveButton = document.getElementById("pokerLeaveTableBtn");
    const hostStartButton = document.getElementById("pokerHostStartBtn");

    if (createButton) {
      createButton.addEventListener("click", createTable);
    }

    if (startButton) {
      startButton.addEventListener("click", async () => {
        if (!state.currentTableId) {
          showToast("Tu n’es dans aucune table de poker.");
          return;
        }
        await startTable(state.currentTableId);
      });
    }

    if (leaveButton) {
      leaveButton.addEventListener("click", async () => {
        if (!state.currentTableId) {
          return;
        }
        await leaveTable(state.currentTableId);
      });
    }

    if (hostStartButton) {
      hostStartButton.addEventListener("click", async () => {
        if (!state.currentTableId) {
          return;
        }
        await startTable(state.currentTableId);
      });
    }

    refreshTables();
    if (state.poller) {
      clearInterval(state.poller);
    }
    state.poller = setInterval(refreshTables, 2500);
  }

  async function refreshTables() {
    const statusNode = document.getElementById("pokerStatus");
    const listNode = document.getElementById("pokerTableList");
    const roomNode = document.getElementById("pokerWaitingRoom");
    const tableScreen = document.getElementById("pokerTableScreen");

    if (!statusNode || !listNode || !roomNode || !tableScreen) {
      return;
    }

    try {
      const response = await fetch("/api/poker/tables");
      if (!response.ok) {
        throw new Error("Impossible de charger les tables.");
      }

      const payload = await response.json();
      state.tables = payload.tables || [];

      const detectedTable = state.tables.find((table) => table.players.some((player) => Number(player.id) === Number(getCurrentUserId())));
      if (detectedTable) {
        state.currentTableId = String(detectedTable.id);
        if (detectedTable.status === 'in-progress') {
          window.location.href = `/poker/game/${detectedTable.id}`;
          return;
        }
      } else {
        state.currentTableId = null;
      }

      renderTables();
      renderWaitingRoom();
      renderTableView();
      statusNode.textContent = state.tables.length
        ? `${state.tables.length} table(s) disponible(s). Minimum 3 joueurs pour démarrer.`
        : "Aucune table de poker ouverte pour le moment.";
    } catch (error) {
      statusNode.textContent = "Le lobby poker est temporairement indisponible.";
      console.error(error);
    }
  }

  function renderTables() {
    const listNode = document.getElementById("pokerTableList");
    const roomNode = document.getElementById("pokerWaitingRoom");
    const tableScreen = document.getElementById("pokerTableScreen");
    if (!listNode || !roomNode || !tableScreen) {
      return;
    }

    const currentTable = getCurrentTable();
    const shouldShowWaitingRoom = !!state.currentTableId && currentTable && currentTable.status !== 'in-progress';
    const shouldShowTable = !!state.currentTableId && currentTable && currentTable.status === 'in-progress';

    listNode.style.display = shouldShowWaitingRoom || shouldShowTable ? 'none' : 'block';
    roomNode.style.display = shouldShowWaitingRoom ? 'block' : 'none';
    tableScreen.style.display = shouldShowTable ? 'block' : 'none';

    if (!state.tables.length) {
      listNode.innerHTML = '<div class="status-box subtle">Aucune table actuellement ouverte.</div>';
      return;
    }

    if (shouldShowWaitingRoom || shouldShowTable) {
      return;
    }

    listNode.innerHTML = state.tables
      .map((table) => {
        const isCurrent = String(table.id) === String(state.currentTableId);
        const currentUserId = getCurrentUserId();
        const joined = table.players.some((player) => Number(player.id) === Number(currentUserId));

        return `
          <div class="history-item">
            <div>
              <strong>${sanitizeText(table.name || table.id, 24)}</strong><br />
              <small>${table.players.length}/${table.maxPlayers} joueurs</small>
            </div>
            <div>
              <small>${table.status === 'in-progress' ? 'En cours' : 'En attente'}</small><br />
              <small>Min: ${table.minPlayers}</small>
            </div>
            <button class="primary-button" type="button" data-table-id="${table.id}" ${isCurrent || joined || table.status === 'in-progress' ? 'disabled' : ''}>
              ${joined ? 'Déjà présent' : 'Rejoindre'}
            </button>
          </div>
        `;
      })
      .join("");

    if (typeof renderTableModeration === 'function') state.tables.forEach(table => renderTableModeration(listNode, 'poker', table, refreshTables));

    listNode.querySelectorAll("[data-table-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        const tableId = button.dataset.tableId;
        if (!tableId || button.disabled) {
          return;
        }
        await joinTable(tableId);
      });
    });
  }

  function renderWaitingRoom() {
    const roomNode = document.getElementById("pokerWaitingRoom");
    const metaNode = document.getElementById("pokerWaitingMeta");
    const playersNode = document.getElementById("pokerWaitingPlayers");
    const boardNode = document.getElementById("pokerWaitingBoard");
    const hostStartButton = document.getElementById("pokerHostStartBtn");
    const leaveButton = document.getElementById("pokerLeaveTableBtn");

    if (!roomNode || !metaNode || !playersNode || !boardNode) {
      return;
    }

    if (!state.currentTableId) {
      roomNode.style.display = "none";
      return;
    }

    const currentTable = getCurrentTable();
    if (!currentTable || currentTable.status === 'in-progress') {
      roomNode.style.display = "none";
      return;
    }

    const currentUserId = getCurrentUserId();
    const isHost = Number(currentTable.hostId) === Number(currentUserId);
    const isPlayer = currentTable.players.some((player) => Number(player.id) === Number(currentUserId));

    if (!isPlayer) {
      state.currentTableId = null;
      roomNode.style.display = "none";
      return;
    }

    roomNode.style.display = "block";
    metaNode.textContent = `Table: ${sanitizeText(currentTable.name, 30)} • ${currentTable.players.length}/${currentTable.maxPlayers} joueurs • Salle d’attente`;

    playersNode.innerHTML = currentTable.players
      .map((player) => `
        <div class="history-item">
          <div>
            <strong>${sanitizeText(player.username || 'Joueur', 18)}</strong>
            <small>${Number(player.id) === Number(currentTable.hostId) ? '• Hôte' : ''}</small>
          </div>
          <div>
            <small>${formatChips(player.chips)} €</small>
          </div>
        </div>
      `)
      .join("");

    if (typeof renderTableModeration === 'function') renderTableModeration(playersNode, 'poker', currentTable, refreshTables);

    boardNode.textContent = `Le lancement est possible dès 3 joueurs. ${currentTable.players.length}/${currentTable.minPlayers} joueurs présents.`;
    leaveButton.disabled = false;
    hostStartButton.disabled = !(isHost && currentTable.players.length >= currentTable.minPlayers);
    hostStartButton.textContent = isHost ? 'Lancer la partie' : 'En attente de l’hôte';
  }

  function renderTableView() {
    const tableScreen = document.getElementById("pokerTableScreen");
    const tableMeta = document.getElementById("pokerTableMeta");
    const boardNode = document.getElementById("pokerTableBoard");
    const playersNode = document.getElementById("pokerTablePlayers");
    const historyNode = document.getElementById("pokerTableHistory");
    const actionPanel = document.getElementById("pokerActionPanel");

    if (!tableScreen || !tableMeta || !boardNode || !playersNode || !historyNode || !actionPanel) {
      return;
    }

    const currentTable = getCurrentTable();
    if (!currentTable || (currentTable.status !== 'in-progress' && currentTable.round !== 'showdown')) {
      tableScreen.style.display = 'none';
      return;
    }

    tableScreen.style.display = 'block';
    const currentUserId = getCurrentUserId();
    const currentPlayer = currentTable.players.find((player) => Number(player.id) === Number(currentUserId));
    const isMyTurn = Number(currentTable.currentTurn) === currentTable.players.findIndex((player) => Number(player.id) === Number(currentUserId));

    tableMeta.textContent = `${sanitizeText(currentTable.name, 24)} • Pot ${formatChips(currentTable.pot)} • Tour ${currentTable.round} • Mise actuelle ${formatChips(currentTable.currentBet)}`;

    boardNode.innerHTML = Array.from({ length: 5 }, (_, index) => {
      const card = currentTable.board[index];
      return `<div style="width:56px;height:80px;border-radius:10px;border:1px solid rgba(255,255,255,.55);background:${card ? '#fff' : '#121826'};display:flex;align-items:center;justify-content:center;color:${card ? '#111' : '#fff'};font-weight:bold;">${card || '--'}</div>`;
    }).join('');

    playersNode.innerHTML = currentTable.players
      .map((player, index) => {
        const isWinner = !!player.isWinner;
        const handVisible = Number(player.id) === Number(currentUserId) || (currentTable.round === 'showdown' && !player.folded);
        const cards = handVisible && player.hand?.length ? player.hand.join(' ') : '🂠 🂠';
        const isTurn = Number(currentTable.currentTurn) === index;
        const isDealer = !!player.isDealer;
        const isSmallBlind = !!player.isSmallBlind;
        const isBigBlind = !!player.isBigBlind;
        const badge = isWinner ? 'Gagnant' : isDealer ? 'Dealer' : isSmallBlind ? 'Small blind' : isBigBlind ? 'Big blind' : '';
        return `
          <div class="poker-inline-player ${isWinner ? 'winner' : ''}" style="background: rgba(17,24,39,0.85); border: ${isTurn ? '2px solid #fbbf24' : '1px solid rgba(255,255,255,0.18)'}; border-radius: 12px; padding: 0.75rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; margin-bottom:0.5rem;">
              <strong>${sanitizeText(player.username || 'Joueur', 16)}</strong>
              <span>${badge}</span>
            </div>
            <div style="margin-bottom:0.5rem; font-size:0.9rem;">Solde : ${formatChips(player.chips)}</div>
            <div style="margin-bottom:0.5rem; font-size:0.9rem;">Mise: ${formatChips(player.bet)}</div>
            <div style="display:flex; gap:0.4rem; margin-bottom:0.5rem;">${cards}</div>
            <div style="font-size:0.75rem; color:#d3d8e6;">${isWinner ? 'Gagnant' : player.folded ? 'Couché' : isTurn ? 'À jouer' : 'En jeu'}</div>
          </div>
        `;
      })
      .join('');

    historyNode.textContent = currentTable.recentHistory?.length ? currentTable.recentHistory[currentTable.recentHistory.length - 1] : currentTable.lastAction || 'Aucune action';

    if (currentTable.round === 'showdown') {
      actionPanel.innerHTML = '<div class="status-box subtle">Showdown terminé.</div>';
      return;
    }

    const canCheck = isMyTurn && currentPlayer && !currentPlayer.folded && Number(currentTable.currentBet || 0) <= Number(currentPlayer.bet || 0);
    const canCall = isMyTurn && currentPlayer && !currentPlayer.folded && Number(currentTable.currentBet || 0) > Number(currentPlayer.bet || 0) && Number(currentPlayer.chips || 0) > 0;
    const canBet = isMyTurn && currentPlayer && !currentPlayer.folded && Number(currentTable.currentBet || 0) === 0;
    const canRaise = isMyTurn && currentPlayer && !currentPlayer.folded && Number(currentTable.currentBet || 0) > 0;
    const canFold = isMyTurn && currentPlayer && !currentPlayer.folded;
    const canAllIn = isMyTurn && currentPlayer && !currentPlayer.folded && Number(currentPlayer.chips || 0) > 0;

    const actionButtons = [
      canFold ? '<button class="secondary-button" type="button" data-poker-action="fold">Fold</button>' : '',
      canCheck ? '<button class="secondary-button" type="button" data-poker-action="check">Check</button>' : '',
      canCall ? '<button class="primary-button" type="button" data-poker-action="call">Call</button>' : '',
      canBet ? '<button class="primary-button" type="button" data-poker-action="bet">Bet</button>' : '',
      canRaise ? '<button class="gold-button" type="button" data-poker-action="raise">Raise</button>' : '',
      canAllIn ? '<button class="danger-button" type="button" data-poker-action="all-in">All-in</button>' : ''
    ].filter(Boolean).join('');

    const minimumAmount = Math.max(0.01, roundMoney((Number(currentTable.currentBet || 0) > 0
      ? Number(currentTable.currentBet || 0) + Number(currentTable.blinds?.big || 0.01)
      : Number(currentTable.blinds?.big || 0.01)) - Number(currentPlayer.bet || 0)));
    const maxAmount = Number(currentPlayer.chips || 0);
    const amountKey = `${currentPlayer.id}:${currentTable.round}:${formatChips(currentTable.currentBet)}:${formatChips(currentPlayer.bet)}:${maxAmount}:${minimumAmount}`;
    const amountValue = state.amountDraft?.key === amountKey ? state.amountDraft.value : minimumAmount;
    const existingAmountInput = document.getElementById("pokerActionAmount");
    if (existingAmountInput?.dataset.amountKey === amountKey && document.activeElement === existingAmountInput) {
      return;
    }
    actionPanel.innerHTML = `${actionButtons}<input id="pokerActionAmount" data-amount-key="${amountKey}" type="number" min="${minimumAmount}" max="${maxAmount}" step="0.01" value="${amountValue}" style="max-width:120px;" />`;

    const amountInput = document.getElementById("pokerActionAmount");
    amountInput?.addEventListener("input", () => {
      state.amountDraft = { key: amountKey, value: amountInput.value };
    });

    actionPanel.querySelectorAll("[data-poker-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        const action = button.dataset.pokerAction;
        const amountInput = document.getElementById("pokerActionAmount");
        if ((action === "bet" || action === "raise") && !amountInput?.reportValidity()) {
          return;
        }
        const amount = Number(amountInput?.value || 0);
        await sendTableAction(action, amount);
      });
    });
  }

  async function createTable() {
    try {
      const response = await fetch("/api/poker/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableName: `Table Poker ${Date.now()}` })
      });
      if (!response.ok) {
        throw new Error("Impossible de créer une table.");
      }
      const payload = await response.json();
      if (payload.table) {
        state.currentTableId = payload.table.id;
        showToast("Table créée. L’hôte peut lancer la main.");
      }
      await refreshTables();
    } catch (error) {
      console.error(error);
      showToast("La création de la table a échoué.");
    }
  }

  async function joinTable(tableId) {
    try {
      const response = await fetch(`/api/poker/tables/${tableId}/join`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Impossible de rejoindre la table.");
      }
      const payload = await response.json();
      state.currentTableId = payload.table.id;
      showToast(`Tu as rejoint ${payload.table.name}.`);
      await refreshTables();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Tu ne peux pas rejoindre cette table.");
    }
  }

  async function leaveTable(tableId) {
    try {
      const response = await fetch(`/api/poker/tables/${tableId}/leave`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Impossible de quitter la table.");
      }
      const payload = await response.json();
      state.currentTableId = null;
      showToast(payload.committed > 0 ? `Tu as quitté la table et tu as perdu ${payload.committed} €.` : "Tu as quitté la table.");
      await refreshTables();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Impossible de quitter la table.");
    }
  }

  async function startTable(tableId) {
    try {
      const response = await fetch(`/api/poker/tables/${tableId}/start`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Impossible de lancer la partie.");
      }
      const payload = await response.json();
      state.currentTableId = payload.table.id;
      showToast("La partie de poker commence !");
      window.location.href = `/poker/game/${payload.table.id}`;
    } catch (error) {
      console.error(error);
      showToast(error.message || "Le lancement de la partie a échoué.");
    }
  }

  async function sendTableAction(action, amount) {
    if (!state.currentTableId) {
      return;
    }

    try {
      const response = await fetch(`/api/poker/tables/${state.currentTableId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, amount })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Action invalide.");
      }
      await refreshTables();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Action invalide.");
    }
  }

  window.pokerModule = { initialize, refreshTables };
  return { initialize, refreshTables };
})();
