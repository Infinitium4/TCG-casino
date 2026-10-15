const pokerGame = (() => {
  const tableId = window.location.pathname.split('/').filter(Boolean).pop();
  const state = {
    table: null,
    socket: null,
    poller: null,
    amountDraft: null
  };

  function getCurrentUserId() {
    return Number(accountUser?.id ?? getPlayer()?.id ?? 0);
  }

  function getSeatPosition(count, index) {
    const angle = ((Math.PI * 2) / Math.max(count, 1)) * index - Math.PI / 2;
    const x = 50 + Math.cos(angle) * 34;
    const y = 50 + Math.sin(angle) * 27;
    return { x: Math.min(92, Math.max(8, x)), y: Math.min(88, Math.max(12, y)) };
  }

  function cardMarkup(card, isFaceUp = true) {
    if (!isFaceUp || !card) {
      return '<div class="poker-card face-down">?</div>';
    }

    const suit = String(card).slice(-1);
    const rank = String(card).slice(0, -1);
    const displayRank = rank === '10' ? '10' : rank;
    const isRed = ['♥', '♦'].includes(suit);

    return `
      <div class="poker-card ${isRed ? 'card-red' : 'card-black'}">
        <span class="card-rank">${displayRank}</span>
        <span class="card-suit">${suit}</span>
      </div>
    `;
  }

  function renderBoardCards(board = []) {
    const boardNode = document.getElementById('boardCards');
    boardNode.innerHTML = Array.from({ length: 5 }, (_, index) => {
      const card = board[index];
      return cardMarkup(card, !!card);
    }).join('');
  }

  function renderMyHand(table) {
    const currentUserId = getCurrentUserId();
    const myPlayer = table.players.find((player) => Number(player.id) === Number(currentUserId));
    const handNode = document.getElementById('myHand');

    if (!myPlayer || !myPlayer.hand?.length) {
      handNode.innerHTML = '<div class="status-box subtle">Aucune carte visible pour le moment.</div>';
      return;
    }

    handNode.innerHTML = myPlayer.hand.map((card) => cardMarkup(card, true)).join('');
  }

  function renderHistory(table) {
    const historyNode = document.getElementById('historyLog');
    const entries = table.recentHistory && table.recentHistory.length ? table.recentHistory.slice(-6).reverse() : [table.lastAction || 'Aucune action'];
    historyNode.innerHTML = entries
      .map((entry) => `<div class="history-item"><small>${sanitizeText(String(entry), 80)}</small></div>`)
      .join('');
  }

  function renderSeats(table) {
    if (typeof renderTableModeration === 'function') renderTableModeration(document.getElementById('tableBanner')?.parentElement, 'poker', table, refreshTable);
    const currentUserId = getCurrentUserId();
    const seatsNode = document.getElementById('pokerTableSeats');

    seatsNode.innerHTML = table.players
      .map((player, index) => {
        const isMe = Number(player.id) === Number(currentUserId);
        const isTurn = Number(table.currentTurn) === Number(index);
        const isDealer = !!player.isDealer;
        const isSmallBlind = !!player.isSmallBlind;
        const isBigBlind = !!player.isBigBlind;
        const isWinner = !!player.isWinner;
        const revealHand = table.round === 'showdown' && !player.folded;
        const position = getSeatPosition(table.players.length, index);
        const handDisplay = (isMe || revealHand) && player.hand?.length ? player.hand.map((card) => cardMarkup(card, true)).join('') : '<div class="poker-card face-down">?</div><div class="poker-card face-down">?</div>';
        const badge = isWinner ? 'Gagnant' : isDealer ? 'Dealer' : isSmallBlind ? 'SB' : isBigBlind ? 'BB' : '';

        return `
          <div class="poker-seat ${isWinner ? 'winner' : ''}" style="left:${position.x}%; top:${position.y}%">
            <div class="seat-badge ${isTurn ? 'active' : ''} ${isWinner ? 'winner' : ''}">${badge || (isTurn ? 'Tour' : '')}</div>
            <div class="seat-player ${isWinner ? 'winner' : ''}">
              <div class="seat-name">${sanitizeText(player.username || 'Joueur', 14)}</div>
              <div class="seat-chip">${formatChips(player.chips || 0)} €</div>
              <div class="seat-bet">Mise: ${formatChips(player.bet || 0)}</div>
            </div>
            <div class="seat-cards">${handDisplay}</div>
          </div>
        `;
      })
      .join('');
  }

  function getCurrentPlayer(table) {
    const currentUserId = getCurrentUserId();
    return table.players.find((player) => Number(player.id) === Number(currentUserId)) || null;
  }

  function renderActions(table) {
    const banner = document.getElementById('tableBanner');
    const controlsNode = document.getElementById('actionControls');
    const turnInfo = document.getElementById('turnInfo');

    const currentPlayer = getCurrentPlayer(table);
    const currentUserId = getCurrentUserId();
    const activeTurnPlayer = table.players[Number(table.currentTurn)] || null;
    const isMyTurn = !!currentPlayer && !!activeTurnPlayer && Number(activeTurnPlayer.id) === Number(currentPlayer.id);
    const canCheck = isMyTurn && currentPlayer && !currentPlayer.folded && Number(table.currentBet || 0) <= Number(currentPlayer.bet || 0);
    const canCall = isMyTurn && currentPlayer && !currentPlayer.folded && Number(table.currentBet || 0) > Number(currentPlayer.bet || 0) && Number(currentPlayer.chips || 0) > 0;
    const canBet = isMyTurn && currentPlayer && !currentPlayer.folded && Number(table.currentBet || 0) === 0;
    const canRaise = isMyTurn && currentPlayer && !currentPlayer.folded && Number(table.currentBet || 0) > 0;
    const canFold = isMyTurn && currentPlayer && !currentPlayer.folded;
    const canAllIn = isMyTurn && currentPlayer && !currentPlayer.folded && Number(currentPlayer.chips || 0) > 0;

    banner.textContent = `${table.name} • Pot ${formatChips(table.pot || 0)} • Tour ${table.round} • Mise actuelle ${formatChips(table.currentBet || 0)}`;

    if (!currentPlayer) {
      turnInfo.textContent = 'Tu n’es pas autorisé à jouer sur cette table.';
      controlsNode.innerHTML = '<button class="secondary-button" type="button" id="leaveTableAction">Retour au lobby</button>';
      document.getElementById('leaveTableAction')?.addEventListener('click', () => {
        window.location.href = '/game';
      });
      return;
    }

    if (table.round === 'showdown' && table.status !== 'in-progress') {
      const isHost = Number(table.hostId) === currentUserId;
      turnInfo.textContent = isHost ? 'La main est terminée. Tu peux relancer une partie.' : 'La main est terminée. En attente de l’hôte.';
      controlsNode.innerHTML = isHost
        ? '<button class="gold-button" type="button" id="replayPokerHandBtn">Rejouer</button>'
        : '<div class="status-box subtle">En attente de la prochaine main.</div>';
      document.getElementById('replayPokerHandBtn')?.addEventListener('click', startNextRound);
      return;
    }

    if (!isMyTurn && currentUserId > 0 && table.status === 'in-progress') {
      turnInfo.textContent = `C’est le tour de ${activeTurnPlayer?.username || 'un joueur'} .`;
      controlsNode.innerHTML = '<div class="status-box subtle">En attente de votre tour...</div>';
      return;
    }

    turnInfo.textContent = `À toi de jouer. Tu as ${formatChips(currentPlayer.chips || 0)} € restants.`;
    const minimumAmount = Math.max(0.01, roundMoney((Number(table.currentBet || 0) > 0
      ? Number(table.currentBet || 0) + Number(table.blinds?.big || 0.01)
      : Number(table.blinds?.big || 0.01)) - Number(currentPlayer.bet || 0)));
    const maxAmount = Number(currentPlayer.chips || 0);
    const amountKey = `${currentPlayer.id}:${table.round}:${formatChips(table.currentBet)}:${formatChips(currentPlayer.bet)}:${maxAmount}:${minimumAmount}`;
    const amountValue = state.amountDraft?.key === amountKey ? state.amountDraft.value : minimumAmount;
    const existingAmountInput = document.getElementById('pokerAmountInput');
    if (existingAmountInput?.dataset.amountKey === amountKey && document.activeElement === existingAmountInput) {
      return;
    }
    const actionButtons = [
      canFold ? '<button class="secondary-button" type="button" data-action="fold">Fold</button>' : '',
      canCheck ? '<button class="secondary-button" type="button" data-action="check">Check</button>' : '',
      canCall ? '<button class="primary-button" type="button" data-action="call">Call</button>' : '',
      canBet ? '<button class="primary-button" type="button" data-action="bet">Bet</button>' : '',
      canRaise ? '<button class="gold-button" type="button" data-action="raise">Raise</button>' : '',
      canAllIn ? '<button class="danger-button" type="button" data-action="all-in">All-in</button>' : ''
    ].filter(Boolean).join('');

    controlsNode.innerHTML = `
      <div class="action-row stacked">
        ${actionButtons}
      </div>
      <label class="inline-amount">
        <span>Montant</span>
        <input id="pokerAmountInput" data-amount-key="${amountKey}" type="number" min="${minimumAmount}" max="${maxAmount}" step="0.01" value="${amountValue}" />
      </label>
    `;

    const amountInput = document.getElementById('pokerAmountInput');
    amountInput?.addEventListener('input', () => {
      state.amountDraft = { key: amountKey, value: amountInput.value };
    });

    controlsNode.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const action = button.dataset.action;
        const amountInput = document.getElementById('pokerAmountInput');
        if ((action === 'bet' || action === 'raise') && !amountInput?.reportValidity()) {
          return;
        }
        const amount = Number(amountInput?.value || 0);
        await sendAction(action, amount);
      });
    });
  }

  async function sendAction(action, amount) {
    try {
      const response = await fetch(`/api/poker/tables/${tableId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, amount })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Action invalide.');
      }
      await refreshTable();
    } catch (error) {
      console.error(error);
      alert(error.message || 'Action invalide.');
    }
  }

  async function startNextRound() {
    try {
      const response = await fetch(`/api/poker/tables/${tableId}/start`, { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Impossible de relancer la partie.');
      }
      await refreshTable();
    } catch (error) {
      console.error(error);
      alert(error.message || 'Impossible de relancer la partie.');
    }
  }

  async function leaveTable() {
    const leaveButton = document.getElementById('goLobbyBtn');
    if (leaveButton?.disabled) {
      return;
    }
    if (leaveButton) leaveButton.disabled = true;

    try {
      const response = await fetch(`/api/poker/tables/${tableId}/leave`, { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Impossible de quitter la partie.');
      }
      window.location.href = '/game';
    } catch (error) {
      if (leaveButton) leaveButton.disabled = false;
      console.error(error);
      alert(error.message || 'Impossible de quitter la partie.');
    }
  }

  async function refreshTable() {
    try {
      const response = await fetch(`/api/poker/tables/${tableId}`);
      if (!response.ok) {
        if (response.status === 403) {
          window.location.href = '/game';
          return;
        }
        throw new Error('Table introuvable.');
      }

      const payload = await response.json();
      state.table = payload.table;
      renderBoardCards(state.table.board || []);
      renderMyHand(state.table);
      renderSeats(state.table);
      renderHistory(state.table);
      renderActions(state.table);
      document.getElementById('potDisplay').textContent = `Pot : ${formatChips(state.table.pot || 0)}`;
    } catch (error) {
      console.error(error);
      document.getElementById('tableBanner').textContent = 'La table n’est plus accessible.';
    }
  }

  function attachSocket() {
    if (!window.io) {
      return;
    }

    state.socket = window.casinoRealtime?.getSocket() || io();
    const subscribe = () => {
      state.socket.emit('poker:table:join', { tableId });
    };
    if (window.casinoRealtime) window.casinoRealtime.onReady(subscribe);
    else state.socket.on('connect', subscribe);

    state.socket.on('poker:table:update', (payload) => {
      if (String(payload.id) === String(tableId)) {
        state.table = payload;
        renderBoardCards(payload.board || []);
        renderMyHand(payload);
        renderSeats(payload);
        renderHistory(payload);
        renderActions(payload);
        document.getElementById('potDisplay').textContent = `Pot : ${formatChips(payload.pot || 0)}`;
      }
    });
  }

  async function initialize() {
    const ok = await loadAccountData();
    if (!ok) {
      window.location.replace('/');
      return;
    }

    attachSocket();
    await refreshTable();
    if (state.poller) {
      clearInterval(state.poller);
    }
    state.poller = setInterval(() => { if (!document.hidden) refreshTable(); }, 2500);

    document.getElementById('goLobbyBtn').addEventListener('click', leaveTable);
  }

  return { initialize };
})();

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('pokerTableSeats')) {
    pokerGame.initialize();
  }
});
