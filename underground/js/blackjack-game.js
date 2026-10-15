const blackjackGame = (() => {
  const tableId = window.location.pathname.split('/').filter(Boolean).pop();
  const state = { table: null, socket: null, poller: null, actionPending: false, requestVersion: 0 };

  function getCurrentUserId() {
    return Number(accountUser?.id ?? getPlayer()?.id ?? 0);
  }

  function calculateHandValue(cards = []) {
    let total = 0;
    let aces = 0;
    for (const card of cards) {
      const rank = String(card).slice(0, -1);
      if (rank === 'A') {
        total += 11;
        aces += 1;
      } else if (['J', 'Q', 'K'].includes(rank)) {
        total += 10;
      } else {
        total += Number(rank);
      }
    }
    while (total > 21 && aces > 0) {
      total -= 10;
      aces -= 1;
    }
    return total;
  }

  function dealDelay(order) {
    return `${Math.min(Math.max(order, 0) * 105, 1575)}ms`;
  }

  function setCardFace(node, card) {
    node.dataset.card = card || 'hidden';
    node.classList.toggle('face-down', !card);
    node.classList.toggle('card-red', !!card && ['♥', '♦'].includes(String(card).slice(-1)));
    node.classList.toggle('card-black', !!card && !['♥', '♦'].includes(String(card).slice(-1)));
    if (!card) {
      node.textContent = '?';
      return;
    }

    const suit = String(card).slice(-1);
    const rank = String(card).slice(0, -1);
    node.innerHTML = `<span class="card-rank">${rank}</span><span class="card-suit">${suit}</span>`;
  }

  function animateCard(node, animation) {
    node.classList.remove('blackjack-card-enter', 'blackjack-card-flip');
    node.classList.add(animation);
    node.addEventListener('animationend', () => node.classList.remove(animation), { once: true });
  }

  function syncCardRow(container, cards, roundNumber, getOrder) {
    const roundKey = String(roundNumber || 0);
    if (container.dataset.round !== roundKey) {
      container.replaceChildren();
      container.dataset.round = roundKey;
    }

    while (container.children.length > cards.length) {
      container.lastElementChild.remove();
    }

    cards.forEach((card, index) => {
      const order = getOrder(index);
      const delay = dealDelay(order);
      let node = container.children[index];
      if (!node) {
        node = document.createElement('div');
        node.className = 'poker-card blackjack-playing-card';
        node.style.setProperty('--deal-delay', delay);
        setCardFace(node, card);
        node.classList.add('blackjack-card-enter');
        node.addEventListener('animationend', () => node.classList.remove('blackjack-card-enter'), { once: true });
        container.append(node);
        return;
      }

      if (node.dataset.card !== (card || 'hidden')) {
        node.style.setProperty('--deal-delay', delay);
        setCardFace(node, card);
        animateCard(node, 'blackjack-card-flip');
      }
    });
  }

  function getCurrentPlayer(table) {
    return table.players.find((player) => Number(player.id) === getCurrentUserId()) || null;
  }

  function renderDealer(table) {
    const dealerCards = table.dealerCards || [];
    const playerCount = table.players.length;
    syncCardRow(
      document.getElementById('dealerCards'),
      dealerCards,
      table.roundNumber,
      (index) => index === 0 ? 0 : index === 1 ? playerCount + 1 : playerCount * 2 + index
    );
    document.getElementById('dealerTotal').textContent = table.dealerTotal === null
      ? 'Score : ?'
      : `Score : ${table.dealerTotal}`;
    document.getElementById('dealerStatus').textContent = table.dealerRevealed
      ? 'Croupier • main révélée'
      : 'Croupier';
  }

  function renderSeats(table) {
    const currentUserId = getCurrentUserId();
    const seatsNode = document.getElementById('blackjackTableSeats');
    const existingSeats = new Map([...seatsNode.children].map((seat) => [seat.dataset.playerId, seat]));
    const seatIds = table.players.map((player) => String(player.id));
    const currentSeatIds = [...seatsNode.children].map((seat) => seat.dataset.playerId);
    if (seatIds.join('|') !== currentSeatIds.join('|')) {
      seatsNode.replaceChildren();
    }

    table.players.forEach((player, index) => {
      const isMe = Number(player.id) === currentUserId;
      const isTurn = table.status === 'in-progress' && Number(table.currentTurn) === index;
      const detail = player.outcome
        ? ({ blackjack: 'Blackjack', win: 'Gagné', push: 'Égalité', loss: 'Perdu' }[player.outcome] || '')
        : isTurn ? 'À toi de jouer' : player.finished ? 'Terminé' : table.status === 'in-progress' ? 'En attente' : 'Prêt';
      let seat = existingSeats.get(String(player.id));
      if (!seat || !seat.isConnected) {
        seat = document.createElement('div');
        seat.className = 'blackjack-player-seat';
        seat.dataset.playerId = String(player.id);
        seat.innerHTML = '<div class="blackjack-player-heading"><span class="blackjack-player-name"></span><span class="blackjack-player-status"></span></div><div class="seat-cards blackjack-seat-cards"></div><div class="blackjack-player-footer"><span class="blackjack-player-total"></span><span class="blackjack-player-balance"></span></div>';
        seatsNode.append(seat);
      }

      seat.classList.toggle('is-turn', isTurn);
      seat.classList.toggle('is-current-player', isMe);
      seat.querySelector('.blackjack-player-name').textContent = player.username || 'Joueur';
      seat.querySelector('.blackjack-player-status').textContent = detail;
      seat.querySelector('.blackjack-player-total').textContent = player.hand?.length
        ? `Score ${calculateHandValue(player.hand)} · Mise ${formatChips(player.bet || 0)}`
        : `Mise ${formatChips(player.bet || 0)}`;
      seat.querySelector('.blackjack-player-balance').textContent = `${formatChips(player.chips || 0)} €`;

      const cardCount = player.hand?.length || player.handCount || 0;
      const cards = player.hand?.length ? player.hand : Array(cardCount).fill(null);
      syncCardRow(seat.querySelector('.seat-cards'), cards, table.roundNumber, (cardIndex) => {
        if (cardIndex === 0) return index + 1;
        if (cardIndex === 1) return table.players.length + index + 2;
        return 0;
      });
      let splitArea = seat.querySelector('.blackjack-split-hands');
      if (player.hands?.length > 1) {
        seat.querySelector('.seat-cards').hidden = true;
        if (!splitArea) {
          splitArea = document.createElement('div');
          splitArea.className = 'blackjack-split-hands';
          seat.querySelector('.seat-cards').after(splitArea);
        }
        while (splitArea.children.length < player.hands.length) {
          const group = document.createElement('div');
          group.className = 'blackjack-split-hand';
          group.innerHTML = '<small></small><div class="blackjack-seat-cards"></div>';
          splitArea.append(group);
        }
        player.hands.forEach((hand, handIndex) => {
          const group = splitArea.children[handIndex];
          group.classList.toggle('is-active-hand', isTurn && player.activeHand === handIndex);
          const result = { win: 'Gagné', loss: 'Perdu', push: 'Égalité' }[hand.outcome] || (hand.finished ? 'Terminée' : '');
          group.querySelector('small').textContent = `Main ${handIndex + 1} · ${hand.cards.length ? calculateHandValue(hand.cards) : '?'} · Mise ${formatChips(hand.bet)} ${result}`;
          syncCardRow(group.querySelector('.blackjack-seat-cards'), hand.cards.length ? hand.cards : Array(hand.handCount).fill(null), `${table.roundNumber}-${handIndex}`, () => 0);
        });
      } else {
        seat.querySelector('.seat-cards').hidden = false;
        splitArea?.remove();
      }
    });
  }

  function renderHistory(table) {
    const entries = table.recentHistory?.length
      ? table.recentHistory.slice(-6).reverse()
      : [table.lastAction || 'En attente de la première manche.'];
    document.getElementById('historyLog').innerHTML = entries
      .map((entry) => `<div class="history-item"><small>${sanitizeText(String(entry), 100)}</small></div>`)
      .join('');
  }

  function renderActions(table) {
    const controlsNode = document.getElementById('actionControls');
    const turnInfo = document.getElementById('turnInfo');
    const nextBetValue = document.getElementById('blackjackNextBet')?.value;
    const currentUserId = getCurrentUserId();
    const player = getCurrentPlayer(table);
    const activePlayer = table.players[Number(table.currentTurn)] || null;
    const isHost = Number(table.hostId) === currentUserId;
    const isMyTurn = table.status === 'in-progress' && Number(activePlayer?.id) === currentUserId;
    const leaveButton = document.getElementById('goLobbyBtn');

    if (!player) {
      turnInfo.textContent = 'Tu n’es pas inscrit à cette table.';
      controlsNode.innerHTML = '';
      leaveButton.disabled = false;
      return;
    }

    if (table.status === 'in-progress') {
      leaveButton.disabled = true;
      if (!isMyTurn) {
        turnInfo.textContent = `C’est au tour de ${activePlayer?.username || 'un joueur'}.`;
        controlsNode.innerHTML = '<div class="status-box subtle">En attente du joueur...</div>';
        return;
      }
      turnInfo.textContent = `À toi. Main : ${calculateHandValue(player.hand || [])} • Mise : ${formatChips(player.bet)} €.`;
      if (player.hands?.length > 1) {
        const hand = player.hands[player.activeHand];
        turnInfo.textContent = `À toi · Main ${player.activeHand + 1}/${player.hands.length} · Score ${calculateHandValue(hand.cards)} · Mise ${formatChips(hand.bet)} €.`;
      }
      controlsNode.innerHTML = `
        <div class="action-row stacked">
          <button class="primary-button" type="button" data-blackjack-action="hit">Tirer</button>
          <button class="gold-button" type="button" data-blackjack-action="stand">Rester</button>
          <button class="secondary-button" type="button" data-blackjack-action="double" ${player.canDouble ? '' : 'disabled'} title="Double la mise, reçoit une carte puis termine la main">Doubler</button>
          <button class="secondary-button" type="button" data-blackjack-action="split" ${player.canSplit ? '' : 'disabled'} title="Sépare une paire en deux mains avec une mise supplémentaire">Séparer</button>
        </div>
        <small>Double : 1 carte puis arrêt. Split : 2 mains, une mise par main. As séparés : 1 carte chacun.</small>
      `;
      controlsNode.querySelectorAll('[data-blackjack-action]').forEach((button) => {
        if (state.actionPending) button.disabled = true;
        button.addEventListener('click', () => sendAction(button.dataset.blackjackAction));
      });
      return;
    }

    leaveButton.disabled = false;
    const outcome = player.outcome
      ? ({ blackjack: 'Blackjack naturel', win: 'Manche gagnée', push: 'Égalité', loss: 'Manche perdue' }[player.outcome])
      : '';
    turnInfo.textContent = table.round === 'finished'
      ? `${outcome}. Gain rendu : ${formatChips(player.payout)} €.`
      : 'La table est prête. L’hôte peut lancer une manche.';

    if (isHost) {
      controlsNode.innerHTML = `
        <label class="inline-amount">
          <span>Mise commune</span>
          <input id="blackjackNextBet" type="number" min="0.01" step="0.01" value="${Number(table.betAmount || 0.05)}" />
        </label>
        <button class="gold-button" type="button" id="startBlackjackRound">
          ${table.round === 'finished' ? 'Rejouer' : 'Lancer la manche'}
        </button>
      `;
      const nextBetInput = document.getElementById('blackjackNextBet');
      if (nextBetValue !== undefined) {
        nextBetInput.value = nextBetValue;
      }
      document.getElementById('startBlackjackRound')?.addEventListener('click', startNextRound);
    } else {
      controlsNode.innerHTML = '<div class="status-box subtle">En attente de l’hôte.</div>';
    }
  }

  function renderTable(table) {
    state.table = table;
    document.getElementById('tableBanner').textContent = `${sanitizeText(table.name, 30)} • Manche ${table.roundNumber || 0} • Mise ${formatChips(table.betAmount || 0)} €`;
    renderDealer(table);
    renderSeats(table);
    renderHistory(table);
    renderActions(table);
  }

  async function sendAction(action) {
    if (state.actionPending) return;
    state.actionPending = true;
    state.requestVersion += 1;
    renderActions(state.table);
    try {
      const response = await fetch(`/api/blackjack/tables/${tableId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Action invalide.');
      renderTable(payload.table);
      await loadAccountData();
    } catch (error) {
      console.error(error);
      window.alert(error.message || 'Action invalide.');
    } finally {
      state.actionPending = false;
      if (state.table) renderActions(state.table);
    }
  }

  async function startNextRound() {
    const betAmount = Number(document.getElementById('blackjackNextBet')?.value || state.table?.betAmount || 0);
    if (!isMoney(betAmount) || betAmount <= 0) {
      window.alert('La mise doit être positive, avec deux décimales maximum.');
      return;
    }
    try {
      const response = await fetch(`/api/blackjack/tables/${tableId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ betAmount })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Impossible de lancer la manche.');
      renderTable(payload.table);
      if (payload.table.round === 'finished') await loadAccountData();
    } catch (error) {
      console.error(error);
      window.alert(error.message || 'Impossible de lancer la manche.');
    }
  }

  async function refreshTable() {
    if (state.actionPending) return;
    const requestVersion = ++state.requestVersion;
    try {
      const response = await fetch(`/api/blackjack/tables/${tableId}`);
      if (state.actionPending || requestVersion !== state.requestVersion) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          window.location.replace('/game');
          return;
        }
        throw new Error('Table inaccessible.');
      }
      const payload = await response.json();
      if (state.actionPending || requestVersion !== state.requestVersion) return;
      const wasFinished = state.table?.round === 'finished';
      renderTable(payload.table);
      if (payload.table.round === 'finished' && !wasFinished) await loadAccountData();
    } catch (error) {
      console.error(error);
      document.getElementById('tableBanner').textContent = 'La table est temporairement inaccessible.';
    }
  }

  function attachSocket() {
    if (!window.io) return;
    state.socket = io();
    state.socket.on('connect', () => state.socket.emit('blackjack:table:join', { tableId }));
    state.socket.on('blackjack:table:update', (table) => {
      if (String(table.id) === String(tableId)) refreshTable();
    });
  }

  async function leaveTable() {
    if (state.table?.status === 'in-progress') return;
    try {
      const response = await fetch(`/api/blackjack/tables/${tableId}/leave`, { method: 'POST' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Impossible de quitter la table.');
      }
      window.location.href = '/game';
    } catch (error) {
      console.error(error);
      window.alert(error.message || 'Impossible de quitter la table.');
    }
  }

  async function initialize() {
    const loaded = await loadAccountData();
    if (!loaded) {
      window.location.replace('/');
      return;
    }
    attachSocket();
    await refreshTable();
    state.poller = setInterval(refreshTable, 2500);
    document.getElementById('goLobbyBtn').addEventListener('click', leaveTable);
  }

  return { initialize };
})();

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('blackjackTableSeats')) blackjackGame.initialize();
});
