const minesModule = (() => {
  const state = { config: null, balance: 0, game: null, active: false, busy: false, retry: null, needsRefresh: false };
  const cellNodes = [];
  const el = id => document.getElementById(id);
  const storageKey = () => `mines-pending-${accountUser.id}`;
  const formatMultiplier = value => `${Number(value).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`;
  const requestId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');

  function feedback(text, error = false) {
    el('minesFeedback').textContent = text;
    el('minesFeedback').classList.toggle('is-error', error);
  }

  function publishBalance() {
    el('minesBalance').textContent = formatChips(state.balance);
    savePlayer({ ...getPlayer(), chips: state.balance });
    updateTopbar();
  }

  function storeRetry(request) {
    state.retry = request;
    try {
      if (request) localStorage.setItem(storageKey(), JSON.stringify(request));
      else localStorage.removeItem(storageKey());
    } catch {}
  }

  function buildBoard() {
    el('minesBoard').replaceChildren();
    cellNodes.length = 0;
    for (let cell = 0; cell < 25; cell += 1) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mines-cell';
      button.setAttribute('aria-label', `Case ${cell + 1}, cachée`);
      button.addEventListener('click', () => reveal(cell));
      cellNodes.push(button);
      el('minesBoard').append(button);
    }
  }

  function renderBoard() {
    const game = state.game;
    const revealed = new Set(game?.revealed || []);
    const mines = new Set(game?.mines || []);
    const activeGame = game?.status === 'active';
    cellNodes.forEach((button, cell) => {
      button.className = 'mines-cell';
      button.textContent = '';
      const isRevealed = revealed.has(cell);
      const isMine = mines.has(cell);
      if (isMine) {
        button.classList.add('is-mine');
        button.textContent = '💣';
        button.setAttribute('aria-label', `Case ${cell + 1}, mine`);
      } else if (isRevealed) {
        button.classList.add('is-safe');
        button.textContent = '💎';
        button.setAttribute('aria-label', `Case ${cell + 1}, diamant`);
      } else if (game && !activeGame) {
        button.classList.add('is-disabled');
        button.setAttribute('aria-label', `Case ${cell + 1}, non révélée`);
      } else {
        button.setAttribute('aria-label', `Case ${cell + 1}, cachée`);
      }
      button.disabled = state.busy || !!state.retry || !activeGame || isRevealed;
    });
    const safeCount = game?.safeCount || 0;
    el('minesBoardStatus').textContent = !game ? 'À toi de jouer' : ({
      active: 'Partie en cours', lost: 'Mine touchée · partie terminée',
      cashed_out: 'Gain encaissé', won: 'Plateau terminé · gagné'
    })[game.status] || 'Partie terminée';
    el('minesDiamonds').textContent = safeCount;
    el('minesMineCount').textContent = game?.mineCount || Number(el('minesCount').value);
    el('minesSafeCount').textContent = safeCount;
    el('minesMultiplier').textContent = game ? formatMultiplier(game.multiplier) : '1,00x';
    el('minesPotentialLabel').textContent = activeGame ? 'Gain brut potentiel' : 'Gain brut final';
    el('minesPotential').textContent = game ? `${formatChips(activeGame ? game.potential : game.payout)} €` : '—';
  }

  function updateControls() {
    const activeGame = state.game?.status === 'active';
    const settings = state.config?.settings;
    const suspended = !settings?.enabled || settings.maintenance || state.config?.paused;
    const locked = state.busy || !!state.retry;
    el('minesStart').hidden = activeGame;
    el('minesStart').disabled = locked || !state.config || suspended;
    el('minesStart').textContent = suspended ? 'MISES SUSPENDUES' : 'LANCER LA PARTIE';
    el('minesCashout').hidden = !activeGame;
    el('minesCashout').disabled = locked;
    el('minesRetry').hidden = !state.retry || state.busy;
    el('minesStake').disabled = activeGame || locked;
    el('minesCount').disabled = activeGame || locked;
    document.querySelectorAll('[data-mines-adjust]').forEach(button => { button.disabled = activeGame || locked || !state.config; });
    if (settings) {
      el('minesStake').min = settings.minBet;
      el('minesStake').max = Math.min(settings.maxBet, 1_000_000);
    }
    renderBoard();
  }

  async function refresh() {
    if (state.busy || !state.active) return;
    try {
      const response = await fetch('/api/mines/state');
      if (!response.ok) throw new Error('Impossible de charger Mines.');
      state.config = await response.json();
      state.game = state.config.game;
      state.balance = state.config.balance;
      publishBalance();
      if (state.retry) {
        feedback('Une action attend confirmation. Vérification sans nouvelle mise.');
        await sendRequest(state.retry);
        return;
      }
      if (state.game?.status === 'active') {
        feedback('Partie en cours récupérée. Les mines restent cachées.');
      } else if (!state.config.settings.enabled || state.config.settings.maintenance || state.config.paused) {
        feedback('Les mises Mines sont suspendues.');
      } else {
        feedback('Choisis ta mise et ton nombre de mines.');
      }
    } catch (error) {
      feedback(error.message, true);
    }
    updateControls();
  }

  async function sendRequest(request) {
    if (state.busy) return;
    storeRetry(request);
    state.busy = true;
    updateControls();
    const endpoints = { start: '/api/mines/start', reveal: '/api/mines/reveal', cashout: '/api/mines/cashout' };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(endpoints[request.action], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
        signal: controller.signal
      });
      const payload = await response.json();
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) storeRetry(null);
        if (response.status === 409) state.needsRefresh = true;
        throw new Error(payload.error || 'Action Mines non confirmée.');
      }
      storeRetry(null);
      state.game = payload.game;
      state.balance = payload.balance;
      publishBalance();
      if (request.action === 'start') feedback('Partie lancée. Révèle une case.');
      else if (request.action === 'cashout') {
        const net = roundMoney(payload.game.payout - payload.game.stake);
        feedback(`Gain encaissé : ${formatChips(payload.game.payout)} € bruts · ${net >= 0 ? '+' : '−'}${formatChips(Math.abs(net))} net.`);
      } else if (payload.hitMine) feedback(`Mine touchée. Mise perdue : ${formatChips(payload.game.stake)} €.`);
      else if (payload.game.status === 'won') feedback(`Toutes les cases sûres révélées : ${formatChips(payload.game.payout)} € gagnés.`);
      else feedback(`Diamant trouvé · ${formatMultiplier(payload.game.multiplier)} · ${formatChips(payload.game.potential)} € à encaisser.`);
    } catch (error) {
      feedback(state.retry ? 'Connexion interrompue. Réessaie cette action sans nouvelle mise.' : error.message, true);
    } finally {
      clearTimeout(timeout);
      state.busy = false;
      updateControls();
      if (state.needsRefresh) {
        state.needsRefresh = false;
        refresh();
      }
    }
  }

  function start() {
    if (state.busy || state.retry || state.game?.status === 'active' || !state.config) return;
    const stake = Number(el('minesStake').value);
    const mineCount = Number(el('minesCount').value);
    const minBet = state.config.settings.minBet;
    const maxBet = Math.min(state.config.settings.maxBet, 1_000_000);
    if (!isMoney(stake) || stake < minBet || stake > maxBet || stake > state.balance || !Number.isInteger(mineCount) || mineCount < 1 || mineCount > 24) {
      feedback('Vérifie ta mise, ton nombre de mines et ton solde disponible.', true);
      return;
    }
    sendRequest({ action: 'start', body: { stake, mineCount, requestId: requestId() } });
  }

  function reveal(cell) {
    if (state.busy || state.retry || state.game?.status !== 'active' || state.game.revealed.includes(cell)) return;
    sendRequest({ action: 'reveal', body: { gameId: state.game.id, cell, requestId: requestId() } });
  }

  function cashout() {
    if (state.busy || state.retry || state.game?.status !== 'active') return;
    sendRequest({ action: 'cashout', body: { gameId: state.game.id, requestId: requestId() } });
  }

  function initialize() {
    for (let mineCount = 1; mineCount <= 24; mineCount += 1) {
      const option = document.createElement('option');
      option.value = String(mineCount);
      option.textContent = `${mineCount} mine${mineCount === 1 ? '' : 's'}`;
      el('minesCount').append(option);
    }
    el('minesCount').value = '3';
    try { state.retry = JSON.parse(localStorage.getItem(storageKey()) || 'null'); } catch { state.retry = null; }
    state.balance = getPlayer().chips;
    buildBoard();
    el('minesStart').addEventListener('click', start);
    el('minesCashout').addEventListener('click', cashout);
    el('minesRetry').addEventListener('click', () => { if (state.retry) sendRequest(state.retry); });
    el('minesCount').addEventListener('change', () => { el('minesMineCount').textContent = el('minesCount').value; });
    document.querySelectorAll('[data-mines-adjust]').forEach(button => button.addEventListener('click', () => {
      if (!state.config || state.game?.status === 'active' || state.retry) return;
      const input = el('minesStake');
      const max = Math.min(state.balance, state.config.settings.maxBet, 1_000_000);
      input.value = Math.min(max, Math.max(state.config.settings.minBet,
        button.dataset.minesAdjust === 'max' ? max : roundMoney(Number(input.value) * Number(button.dataset.minesAdjust))));
    }));
    updateControls();
  }

  function setActive(active) {
    state.active = active;
    if (active) refresh();
  }

  return { initialize, setActive };
})();