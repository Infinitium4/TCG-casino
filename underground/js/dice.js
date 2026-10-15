const diceModule = (() => {
  const state = { config: null, mode: 'under', balance: 0, history: [], active: false,
    busy: false, retry: null, animation: null, frame: null, version: 0, lastResult: 50 };
  const el = id => document.getElementById(id);
  const key = () => `dice-pending-${accountUser.id}`;
  const decimal = value => Number(value).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function message(text, error = false) {
    el('diceFeedback').textContent = text; el('diceFeedback').classList.toggle('is-error', error);
  }
  function thresholdValue() {
    const value = Number(el('diceThreshold').value);
    return Number.isFinite(value) && value >= 1 && value <= 99 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-8 ? value : null;
  }
  function publishBalance() {
    el('diceBalance').textContent = formatChips(state.balance);
    savePlayer({ ...getPlayer(), chips: state.balance }); updateTopbar();
  }
  function controls() {
    const locked = state.busy || !!state.retry || !state.config;
    const settings = state.config?.settings;
    el('diceLaunch').disabled = state.busy || !state.config || (!state.retry && (!settings?.enabled || settings.maintenance || state.config.paused));
    el('diceLaunch').textContent = state.busy ? 'LANCER EN COURS…' : state.retry ? 'RÉCUPÉRER MON LANCER' : 'LANCER';
    for (const id of ['diceStake', 'diceThreshold', 'diceSlider']) el(id).disabled = locked;
    document.querySelectorAll('[data-dice-adjust], [data-dice-mode]').forEach(button => { button.disabled = locked; });
  }
  function quote() {
    const threshold = thresholdValue();
    if (threshold === null) { message('Le seuil doit être entre 1 et 99, avec deux décimales maximum.', true); return; }
    const units = Math.round(threshold * 100);
    const outcomes = state.mode === 'under' ? units : 10000 - units;
    const chance = outcomes / 100, multiplier = 9900 / outcomes;
    el('diceChance').textContent = `${decimal(chance)} %`;
    el('diceMultiplier').textContent = `${decimal(multiplier)}x`;
    const stake = Number(el('diceStake').value);
    el('dicePotential').textContent = isMoney(stake) && stake > 0 ? `${formatChips(moneyRatio(stake, 9900, outcomes))} €` : '—';
    el('diceSlider').value = threshold;
    el('diceSlider').setAttribute('aria-valuetext', `Seuil ${decimal(threshold)}, ${state.mode === 'under' ? 'strictement inférieur' : 'supérieur ou égal'}, chance ${decimal(chance)} %`);
    const [left, right] = state.mode === 'under' ? ['#37936b', '#a93f4c'] : ['#a93f4c', '#37936b'];
    el('diceTrack').style.background = `linear-gradient(to right, ${left} 0%, ${left} ${threshold}%, ${right} ${threshold}%, ${right} 100%)`;
    el('diceRule').textContent = `Gagne avec un résultat ${state.mode === 'under' ? 'strictement inférieur' : 'supérieur ou égal'} à ${decimal(threshold)}.`;
    document.querySelectorAll('[data-dice-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.diceMode === state.mode)));
  }
  function renderHistory() {
    el('diceHistory').replaceChildren(...state.history.map(roll => {
      const row = document.createElement('tr');
      const net = roundMoney(roll.payout - roll.stake);
      for (const [index, value] of [new Date(roll.createdAt).toLocaleString('fr-FR'), formatChips(roll.stake),
        `${roll.mode === 'under' ? 'Under <' : 'Over ≥'} ${decimal(roll.threshold)}`, decimal(roll.result),
        `${decimal(roll.multiplier)}x`, `${net >= 0 ? '+' : ''}${formatChips(net)} €`].entries()) {
        const cell = document.createElement('td'); cell.textContent = value;
        if (index === 3 || index === 5) cell.className = roll.won ? 'is-win' : 'is-loss';
        row.append(cell);
      }
      row.title = `Gain total rendu : ${formatChips(roll.payout)} €`;
      return row;
    }));
    el('diceEmpty').hidden = state.history.length > 0;
  }
  function storeRetry(request) {
    state.retry = request;
    try { if (request) localStorage.setItem(key(), JSON.stringify(request)); else localStorage.removeItem(key()); } catch {}
  }
  async function refresh() {
    if (state.busy) return;
    const version = ++state.version;
    try {
      const response = await fetch('/api/dice/state');
      if (!response.ok) throw new Error('Impossible de charger Dice.');
      const config = await response.json();
      if (version !== state.version || state.busy) return;
      state.config = config; state.balance = config.balance; state.history = config.history;
      el('diceStake').min = config.settings.minBet; el('diceStake').max = Math.min(config.settings.maxBet, 1_000_000);
      if (state.retry) {
        state.mode = state.retry.mode; el('diceThreshold').value = state.retry.threshold; el('diceStake').value = state.retry.stake;
      }
      publishBalance(); quote(); renderHistory(); controls();
      message(state.retry ? 'Un lancer attend confirmation. Récupère-le sans nouvelle mise.' : !config.settings.enabled || config.settings.maintenance || config.paused ? 'Les mises Dice sont suspendues.' : 'Choisis ton seuil et lance le dé.');
    } catch (error) { message(error.message, true); }
  }
  async function finish() {
    const animation = state.animation;
    if (!animation) return;
    state.animation = null;
    if (state.frame !== null) { cancelAnimationFrame(state.frame); state.frame = null; }
    const { roll, balance } = animation.payload;
    state.lastResult = roll.result;
    el('diceMarker').style.left = `${roll.result}%`;
    el('diceMarker').textContent = decimal(roll.result);
    el('diceResult').textContent = decimal(roll.result);
    el('diceOutcome').textContent = roll.won ? 'LANCER GAGNANT' : 'LANCER PERDANT';
    el('diceGain').textContent = roll.won ? `${formatChips(roll.payout)} € rendus · ${decimal(roll.multiplier)}x` : `−${formatChips(roll.stake)} €`;
    el('diceBoard').classList.toggle('is-win', roll.won); el('diceBoard').classList.toggle('is-loss', !roll.won);
    state.balance = balance; publishBalance();
    state.history = [roll, ...state.history.filter(entry => entry.id !== roll.id)].slice(0, 20); renderHistory();
    message(roll.won ? `Résultat ${decimal(roll.result)} : gagné !` : `Résultat ${decimal(roll.result)} : perdu.`);
    try { await loadAccountData(); updateTopbar(); } catch { /* The confirmed roll stays valid. */ }
    finally { state.busy = false; controls(); }
  }
  function animate(now) {
    state.frame = null;
    if (!state.animation) return;
    const progress = Math.min(1, Math.max(0, (now - state.animation.started) / 1100));
    const eased = 1 - (1 - progress) ** 3;
    el('diceMarker').style.left = `${state.lastResult + (state.animation.payload.roll.result - state.lastResult) * eased}%`;
    if (progress === 1) return finish();
    else if (!document.hidden) state.frame = requestAnimationFrame(animate);
  }
  async function launch() {
    if (state.busy || !state.config) return;
    const stake = Number(el('diceStake').value), threshold = thresholdValue();
    if (!state.retry && (threshold === null || !isMoney(stake) || stake < state.config.settings.minBet ||
        stake > Math.min(state.config.settings.maxBet, 1_000_000) || stake > state.balance)) {
      message('Vérifie ta mise, ton seuil et ton solde disponible.', true); return;
    }
    const request = state.retry || { stake, mode: state.mode, threshold,
      requestId: Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('') };
    storeRetry(request); state.busy = true; state.version += 1; controls();
    el('diceBoard').classList.remove('is-win', 'is-loss');
    el('diceResult').textContent = '…'; el('diceOutcome').textContent = 'Le dé roule…'; el('diceGain').textContent = '';
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/dice/roll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) storeRetry(null);
        throw new Error(payload.error || 'Lancer non confirmé.');
      }
      storeRetry(null);
      state.balance = payload.balance - payload.roll.payout; publishBalance();
      state.animation = { payload, started: performance.now() };
      el('diceMarker').hidden = false; el('diceMarker').textContent = '◆';
      message('Mise débitée. Le résultat arrive…');
      if (!state.active || window.matchMedia('(prefers-reduced-motion: reduce)').matches) await finish();
      else if (!document.hidden) state.frame = requestAnimationFrame(animate);
    } catch (error) {
      state.busy = false; controls();
      message(state.retry ? 'Connexion interrompue. Récupère ton lancer sans nouvelle mise.' : error.message, true);
      el('diceOutcome').textContent = state.retry ? 'Confirmation en attente' : 'Lancer refusé';
    } finally { clearTimeout(timeout); }
  }
  function setActive(active) {
    state.active = active;
    if (!active && state.animation) finish();
    else if (active) refresh();
  }
  function initialize() {
    try { state.retry = JSON.parse(localStorage.getItem(key()) || 'null'); } catch {}
    state.balance = getPlayer().chips;
    el('diceBalance').textContent = formatChips(state.balance);
    el('diceLaunch').addEventListener('click', launch);
    el('diceStake').addEventListener('input', quote);
    el('diceThreshold').addEventListener('input', quote);
    el('diceSlider').addEventListener('input', () => { el('diceThreshold').value = Number(el('diceSlider').value).toFixed(2); quote(); });
    document.querySelectorAll('[data-dice-mode]').forEach(button => button.addEventListener('click', () => {
      if (state.busy || state.retry) return; state.mode = button.dataset.diceMode; quote();
    }));
    document.querySelectorAll('[data-dice-adjust]').forEach(button => button.addEventListener('click', () => {
      if (!state.config || state.busy || state.retry) return;
      const max = Math.min(state.balance, state.config.settings.maxBet, 1_000_000);
      el('diceStake').value = Math.min(max, Math.max(state.config.settings.minBet, button.dataset.diceAdjust === 'max' ? max : roundMoney(Number(el('diceStake').value) * Number(button.dataset.diceAdjust))));
      quote();
    }));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.frame !== null) { cancelAnimationFrame(state.frame); state.frame = null; }
      else if (!document.hidden && state.animation && state.frame === null) state.frame = requestAnimationFrame(animate);
    });
    quote(); controls();
  }
  return { initialize, setActive };
})();
