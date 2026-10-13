const crashModule = (() => {
  const state = {
    socket: null,
    round: null,
    ownBet: null,
    bets: [],
    history: [],
    balance: 0,
    serverOffset: 0,
    enabled: false,
    active: false,
    animationFrame: null,
    requestPending: false,
    lastOutcome: null
  };

  async function initialize() {
    try {
      const response = await fetch('/api/crash/status');
      const payload = await response.json();
      state.enabled = response.ok && payload.enabled === true;
    } catch (error) {
      console.error('Impossible de vérifier la disponibilité du jeu Crash :', error);
    }
    if (!state.enabled) {
      document.querySelector('[data-view="crash"]')?.remove();
      document.getElementById('crashView')?.remove();
      document.querySelector('#historyFilter option[value="crash"]')?.remove();
      return false;
    }

    document.getElementById('crashBetButton')?.addEventListener('click', submitAction);
    document.querySelectorAll('[data-crash-stake]').forEach((button) => {
      button.addEventListener('click', () => {
        document.getElementById('crashStake').value = button.dataset.crashStake;
        renderControls();
      });
    });
    document.getElementById('crashStake')?.addEventListener('input', renderControls);
    document.querySelectorAll('[data-crash-adjust]').forEach((button) => {
      button.addEventListener('click', () => {
        if (state.ownBet?.status === 'active' || state.requestPending) return;
        const input = document.getElementById('crashStake');
        const limits = window.casinoGameSettings?.crash || { minBet: 1, maxBet: 1000000 };
        input.value = Math.max(limits.minBet, Math.min(limits.maxBet, state.balance, Math.floor(Number(input.value || limits.minBet) * Number(button.dataset.crashAdjust))));
        renderControls();
      });
    });
    document.addEventListener('visibilitychange', updateAnimation);

    if (window.io) {
      state.socket = io();
      state.socket.on('connect', () => {
        state.socket.emit('crash:sync', (payload) => {
          if (payload?.ok) updateState(payload);
        });
      });
      state.socket.on('crash:state', updateState);
      state.socket.on('crash:error', (payload) => {
        setFeedback(payload?.message || 'La connexion au jeu Crash a échoué.', true);
      });
      state.socket.on('connect_error', () => {
        setFeedback('Connexion temps réel interrompue. Reconnexion en cours...', true);
      });
    }

    refreshState();
    return true;
  }

  async function refreshState() {
    try {
      const response = await fetch('/api/crash/state');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Impossible de charger le jeu Crash.');
      updateState(payload);
    } catch (error) {
      console.error(error);
      setFeedback(error.message || 'Le jeu Crash est temporairement indisponible.', true);
    }
  }

  function updateState(payload) {
    if (!Object.prototype.hasOwnProperty.call(payload, 'round')) return;
    const incomingRound = payload.round;
    if (state.round && incomingRound && state.round.id === incomingRound.id) {
      if (Number(incomingRound.serverNow) < Number(state.round.serverNow)) return;
      if (getRoundStatus(state.round) === 'crashed' && incomingRound.status !== 'crashed') return;
    }
    if (state.ownBet && state.ownBet.status !== 'active' &&
        (!payload.ownBet || payload.ownBet.id !== state.ownBet.id)) {
      state.lastOutcome = { ...state.ownBet, roundId: state.round?.id };
    }
    state.round = incomingRound || null;
    const confirmedCashout = state.ownBet?.status === 'cashed_out' &&
      state.ownBet.id === payload.ownBet?.id;
    state.ownBet = confirmedCashout ? state.ownBet : payload.ownBet || null;
    state.bets = payload.bets || [];
    state.history = payload.history || [];
    state.serverOffset = Number(payload.round?.serverNow || Date.now()) - Date.now();
    if (Number.isFinite(Number(payload.balance))) {
      state.balance = Number(payload.balance);
      syncBalance(state.balance);
    }
    if (state.ownBet) state.lastOutcome = null;
    render();
  }

  function syncBalance(balance) {
    const player = getPlayer();
    if (Number(player.chips) === balance) return;
    player.chips = balance;
    localStorage.setItem(STORAGE_KEYS.player, JSON.stringify(player));
    updateTopbar();
    renderHomeView();
    renderLeaderboard();
    renderProfileView();
  }

  function currentMultiplier(now = Date.now()) {
    if (state.ownBet?.status === 'cashed_out') return Number(state.ownBet.cashoutMultiplier);
    if (!state.round) return 1;
    const status = getRoundStatus(state.round, now);
    if (status === 'crashed') {
      return Number(state.round.crashMultiplier || state.round.multiplier || 1);
    }
    return Number(state.round.multiplier || 1);
  }

  function getRoundStatus(round, now = Date.now()) {
    if (!round) return null;
    const serverNow = now + state.serverOffset;
    if (round.status === 'crashed' || (Number(round.crashAt) > 0 && serverNow >= Number(round.crashAt))) {
      return 'crashed';
    }
    if (round.status === 'betting' && serverNow >= Number(round.startedAt)) return 'running';
    return round.status;
  }

  function synchronizeRoundDeadline() {
    if (state.ownBet?.status === 'cashed_out') return;
    if (!state.round || state.round.status === 'crashed' || getRoundStatus(state.round) !== 'crashed') return;
    state.round = {
      ...state.round,
      status: 'crashed',
      crashedAt: state.round.crashedAt || state.round.crashAt
    };
    if (state.ownBet?.status === 'active') {
      state.ownBet = { ...state.ownBet, status: 'lost' };
      state.bets = state.bets.map((bet) => ({ ...bet, status: 'lost' }));
    }
    refreshState();
  }

  function render() {
    synchronizeRoundDeadline();
    renderRound();
    renderControls();
    renderBets();
    renderHistory();
    updateAnimation();
  }

  function renderRound() {
    const round = state.round;
    const label = document.getElementById('crashRoundLabel');
    const phaseLabel = document.getElementById('crashPhaseLabel');
    const message = document.getElementById('crashStatusMessage');
    const stage = document.getElementById('crashSky');
    const cashedOut = state.ownBet?.status === 'cashed_out';
    stage.classList.toggle('is-cashed-out', cashedOut);
    if (cashedOut) {
      label.textContent = `Partie ${round?.id.slice(0, 8) || ''}`;
      phaseLabel.textContent = 'Gains retirés';
      document.getElementById('crashMultiplier').textContent = `${currentMultiplier().toFixed(2)}x`;
      message.textContent = `Vol terminé : ${formatChips(state.ownBet.payout)} jetons récupérés. Prêt pour le prochain décollage ?`;
      stage.classList.remove('is-flying', 'is-crashed');
      return;
    }
    if (!round) {
      label.textContent = 'Prêt à jouer';
      phaseLabel.textContent = 'Au sol';
      document.getElementById('crashMultiplier').textContent = '1.00x';
      message.textContent = 'Choisis ta mise pour lancer ta partie.';
      stage.classList.remove('is-flying', 'is-crashed');
      return;
    }
    const status = getRoundStatus(round);
    const multiplier = currentMultiplier();
    document.getElementById('crashMultiplier').textContent = `${multiplier.toFixed(2)}x`;
    label.textContent = `Partie ${round.id.slice(0, 8)}`;
    stage.classList.toggle('is-flying', status === 'running');
    stage.classList.toggle('is-crashed', status === 'crashed');
    if (status === 'betting') {
      document.getElementById('crashFlightPath').setAttribute('d', 'M 55 428');
      document.getElementById('crashAircraft').setAttribute('transform', 'translate(15 413) rotate(-18)');
    }

    if (status === 'betting') {
      const seconds = Math.max(0, Math.ceil((Number(round.bettingEndsAt) - (Date.now() + state.serverOffset)) / 1000));
      phaseLabel.textContent = 'Mise acceptée';
      message.textContent = `Décollage dans ${seconds} seconde${seconds === 1 ? '' : 's'}.`;
    } else if (status === 'running') {
      phaseLabel.textContent = 'En vol';
      message.textContent = state.ownBet?.status === 'active'
        ? 'Retire tes gains avant le crash.'
        : 'Le vol continue jusqu’au crash.';
    } else {
      phaseLabel.textContent = 'Vol terminé';
      message.textContent = state.ownBet?.status === 'lost'
        ? `Crash à ${Number(round.crashMultiplier || round.multiplier || 1).toFixed(2)}x. Ta mise est perdue.`
        : `Crash à ${Number(round.crashMultiplier || round.multiplier || 1).toFixed(2)}x. Lance une nouvelle partie quand tu veux.`;
    }
  }

  function renderControls() {
    const input = document.getElementById('crashStake');
    const button = document.getElementById('crashBetButton');
    const potential = document.getElementById('crashPotential');
    const stake = Number(input?.value);
    const limits = window.casinoGameSettings?.crash || { minBet: 1, maxBet: 1_000_000 };
    const validStake = Number.isSafeInteger(stake) && stake >= limits.minBet && stake <= limits.maxBet;
    const ownBet = state.ownBet;
    input.disabled = ownBet?.status === 'active' || state.requestPending;
    document.querySelectorAll('[data-crash-stake], [data-crash-adjust]').forEach((control) => { control.disabled = input.disabled; });
    const roundStatus = getRoundStatus(state.round);
    const canPlace = ownBet?.status !== 'active' && validStake &&
      stake <= state.balance && !state.requestPending;
    const canCashout = roundStatus === 'running' && ownBet?.status === 'active' &&
      !state.requestPending;

    if (ownBet?.status === 'active') {
      button.textContent = canCashout ? `Retirer ${formatChips(Math.floor(ownBet.stake * currentMultiplier()))}` : 'Mise en cours';
      button.classList.toggle('crash-cashout-button', canCashout);
      button.disabled = !canCashout;
    } else {
      button.textContent = 'Lancer ma partie';
      button.classList.remove('crash-cashout-button');
      button.disabled = !canPlace;
    }

    const estimate = ownBet?.status === 'cashed_out' ? ownBet.payout : validStake ? Math.floor((ownBet?.status === 'active' ? ownBet.stake : stake) * currentMultiplier()) : 0;
    potential.textContent = `${formatChips(estimate)} jetons`;
    document.getElementById('crashBalance').textContent = formatChips(state.balance);
    if (!state.round && !state.requestPending) {
      setFeedback(validStake && stake <= state.balance ? 'Prêt au décollage. Lance ta partie quand tu veux.' : 'Choisis une mise valide adaptée à ton solde.', false);
    }
    if (state.requestPending) button.textContent = 'Traitement en cours…';
    if (ownBet?.status === 'cashed_out') {
      setFeedback(`Retrait réussi à ${Number(ownBet.cashoutMultiplier).toFixed(2)}x : ${formatChips(ownBet.payout)} jetons crédités.`, false);
    } else if (ownBet?.status === 'lost') {
      setFeedback(`Crash : ta mise de ${formatChips(ownBet.stake)} jetons est perdue.`, true);
    } else if (ownBet?.status === 'active') {
      setFeedback(roundStatus === 'running' ? 'Ta partie est en jeu. Tu peux retirer à tout moment.' : 'Mise acceptée. Décollage imminent.', false);
    }
  }

  function renderBets() {
    const list = document.getElementById('crashBetsList');
    if (!state.bets.length) {
      list.innerHTML = '<div class="status-box subtle">Aucune mise pour cette partie.</div>';
      return;
    }
    list.replaceChildren(...state.bets.map((bet) => {
      const row = document.createElement('div');
      row.className = 'crash-bet-row';
      const identity = document.createElement('span');
      identity.className = 'crash-bet-name';
      identity.textContent = bet.username;
      const detail = document.createElement('span');
      detail.className = `crash-bet-result crash-bet-${bet.status}`;
      if (bet.status === 'cashed_out') {
        detail.textContent = `${Number(bet.cashoutMultiplier).toFixed(2)}x · +${formatChips(bet.payout)}`;
      } else if (bet.status === 'lost') {
        detail.textContent = 'Crash';
      } else {
        detail.textContent = `${formatChips(bet.stake)} jetons · en jeu`;
      }
      row.append(identity, detail);
      return row;
    }));
  }

  function renderHistory() {
    const container = document.getElementById('crashHistory');
    if (!state.history.length) {
      container.innerHTML = '<div class="status-box subtle">Lance ta première partie pour remplir l’historique.</div>';
      return;
    }
    container.replaceChildren(...state.history.map((entry) => {
      const chip = document.createElement('span');
      const value = Number(entry.multiplier);
      chip.className = `crash-history-chip ${value < 2 ? 'crash-history-low' : value < 10 ? 'crash-history-mid' : 'crash-history-high'}`;
      chip.textContent = `${value.toFixed(2)}x`;
      chip.title = new Date(entry.crashedAt).toLocaleString('fr-FR');
      return chip;
    }));
  }

  function setFeedback(message, isError) {
    const feedback = document.getElementById('crashFeedback');
    if (!feedback) return;
    feedback.textContent = message;
    feedback.classList.toggle('is-error', Boolean(isError));
  }

  async function submitAction() {
    if (state.requestPending) return;
    const bet = state.ownBet;
    if (bet?.status === 'active' && getRoundStatus(state.round) === 'running') {
      await cashout(bet.id);
      return;
    }
    const stake = Number(document.getElementById('crashStake').value);
    const limits = window.casinoGameSettings?.crash || { minBet: 1, maxBet: 1_000_000 };
    if (!Number.isSafeInteger(stake) || stake < limits.minBet || stake > limits.maxBet) {
      setFeedback(`Choisis une mise entière comprise entre ${limits.minBet} et ${limits.maxBet} jetons.`, true);
      return;
    }
    if (stake > state.balance) {
      setFeedback('Ton solde est insuffisant pour cette mise.', true);
      return;
    }
    state.requestPending = true;
    renderControls();
    try {
      const response = await fetch('/api/crash/bets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stake })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'La mise a été refusée.');
      state.balance = Number(payload.balance);
      syncBalance(state.balance);
      setFeedback(payload.duplicate ? 'Cette mise avait déjà été enregistrée.' : 'Ta partie démarre. Bonne chance !', false);
      await refreshState();
    } catch (error) {
      console.error(error);
      setFeedback(error.message || 'Impossible de lancer la partie.', true);
    } finally {
      state.requestPending = false;
      renderControls();
    }
  }

  async function cashout(betId) {
    state.requestPending = true;
    renderControls();
    try {
      const response = await fetch(`/api/crash/bets/${encodeURIComponent(betId)}/cashout`, {
        method: 'POST'
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Le retrait a été refusé.');
      state.balance = Number(payload.balance);
      state.ownBet = payload.bet;
      render();
      syncBalance(state.balance);
      setFeedback(
        `${payload.duplicate ? 'Retrait déjà enregistré' : 'Retrait réussi'} à ${Number(payload.bet.cashoutMultiplier).toFixed(2)}x : ${formatChips(payload.bet.payout)} jetons.`,
        false
      );
      await refreshState();
    } catch (error) {
      console.error(error);
      setFeedback(error.message || 'Impossible de retirer les gains.', true);
      await refreshState();
    } finally {
      state.requestPending = false;
      render();
    }
  }

  function animate() {
    state.animationFrame = null;
    if (state.ownBet?.status === 'cashed_out') return;
    synchronizeRoundDeadline();
    if (!state.active || document.hidden || !state.round || !['betting', 'running'].includes(getRoundStatus(state.round))) return;
    if (getRoundStatus(state.round) === 'betting') {
      renderRound();
      renderControls();
      state.animationFrame = requestAnimationFrame(animate);
      return;
    }
    const round = state.round;
    const elapsed = Math.max(0, Date.now() + state.serverOffset - Number(round.startedAt));
    const multiplier = currentMultiplier();
    const graphProgress = Math.min(1, elapsed / 18000);
    const x = 55 + graphProgress * 875;
    const y = Math.max(68, 428 - Math.log(multiplier) * 115);
    const path = document.getElementById('crashFlightPath');
    const aircraft = document.getElementById('crashAircraft');
    path.setAttribute('d', `M 55 428 C 250 426, ${Math.max(280, x - 210)} ${Math.min(426, y + 145)}, ${x} ${y}`);
    aircraft.setAttribute('transform', `translate(${x - 40} ${y - 15}) rotate(-18)`);
    document.getElementById('crashMultiplier').textContent = `${multiplier.toFixed(2)}x`;
    document.getElementById('crashPotential').textContent = `${formatChips(Math.floor(Number(document.getElementById('crashStake').value || 0) * multiplier))} jetons`;
    if (state.ownBet?.status === 'active' && getRoundStatus(round) === 'running' && !state.requestPending) {
      const button = document.getElementById('crashBetButton');
      button.textContent = `Retirer ${formatChips(Math.floor(state.ownBet.stake * multiplier))}`;
    }
    state.animationFrame = requestAnimationFrame(animate);
  }

  function updateAnimation() {
    synchronizeRoundDeadline();
    const shouldAnimate = state.active && !document.hidden && state.ownBet?.status !== 'cashed_out' && ['betting', 'running'].includes(getRoundStatus(state.round));
    if (!shouldAnimate && state.animationFrame !== null) {
      cancelAnimationFrame(state.animationFrame);
      state.animationFrame = null;
    } else if (shouldAnimate && state.animationFrame === null) {
      state.animationFrame = requestAnimationFrame(animate);
    }
  }

  function setActive(active) {
    state.active = active;
    updateAnimation();
  }

  return { initialize, isEnabled: () => state.enabled, setActive };
})();
