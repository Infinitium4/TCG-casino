const plinkoModule = (() => {
  const state = { config: null, balance: 0, active: false, pending: false, retry: null,
    balls: [], frame: null, socket: null, history: [], recent: [], flashes: [], seen: new Set(), unrevealed: new Map(), syncing: false, requestVersion: 0 };
  const STEP = 32, GAP = 30, TOP = 38, CENTER = 360, DURATION = 3450;
  const COLORS = ['#ff084a', '#ff1643', '#ff3439', '#ff5430', '#ff7125', '#ff8e1c', '#ffa718', '#ffbb13', '#ffcb16', '#ffbb13', '#ffa718', '#ff8e1c', '#ff7125', '#ff5430', '#ff3439', '#ff1643', '#ff084a'];
  const el = id => document.getElementById(id);
  const key = () => `plinko-pending-${accountUser.id}`;
  const formatMultiplier = value => `${Number(value).toLocaleString('fr-FR')}x`;
  const feedback = (text, error = false) => { el('plinkoFeedback').textContent = text; el('plinkoFeedback').classList.toggle('is-error', error); };

  // Each peg is approached from above, skirted on a radius of 12px, then left
  // toward the next row. Peg (3px) + ball (5px) never overlap on this route.
  function ballPosition(path, elapsed) {
    if (elapsed < 200) return { x: CENTER, y: 8 + (TOP - 12 - 8) * Math.max(0, elapsed / 200), row: -1 };
    const progress = (elapsed - 200) / 190;
    const row = Math.min(15, Math.floor(progress));
    let rights = 0;
    for (let i = 0; i < row; i++) rights += path[i];
    const x = CENTER + (2 * rights - row) * STEP / 2;
    const y = TOP + row * GAP;
    if (progress >= 16) {
      const slot = path.reduce((sum, value) => sum + value, 0);
      const t = Math.min(1, (elapsed - 3240) / (DURATION - 3240));
      return { x: CENTER + (2 * slot - 16) * STEP / 2, y: TOP + 15 * GAP + 20 + t * 27, row: 16 };
    }
    const t = progress - Math.floor(progress), direction = path[row] ? 1 : -1;
    if (t < .55) {
      const angle = -Math.PI / 2 + direction * (2 * Math.PI / 3) * t / .55;
      return { x: x + Math.cos(angle) * 12, y: y + Math.sin(angle) * 12, row };
    }
    const u = (t - .55) / .45;
    const exitX = x + direction * Math.sqrt(3) * 6;
    return { x: exitX + (x + direction * STEP / 2 - exitX) * u, y: y + 6 + (GAP - 18) * u, row };
  }

  function draw(now = performance.now()) {
    const canvas = el('plinkoCanvas');
    const ctx = canvas.getContext('2d');
    const scale = canvas.width / 720;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, 720, 584);
    state.flashes = state.flashes.filter(flash => now - flash.time < 250);
    for (let row = 0; row < 16; row++) {
      const count = row + 3;
      for (let column = 0; column < count; column++) {
        const x = CENTER + (column - (count - 1) / 2) * STEP;
        const y = TOP + row * GAP;
        const flash = state.flashes.find(f => f.row === row && f.column === column);
        if (flash) {
          ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(110,231,199,${.4 * (1 - (now - flash.time) / 250)})`; ctx.fill();
        }
        ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fillStyle = '#f5f8f7'; ctx.fill();
      }
    }
    state.balls = state.balls.filter(ball => {
      const elapsed = now - ball.started;
      if (elapsed >= DURATION) { finish(ball.drop); return false; }
      const position = ballPosition(ball.drop.path, elapsed);
      if (position.row >= 0 && position.row < 16 && position.row !== ball.lastRow) {
        const rights = ball.drop.path.slice(0, position.row).reduce((sum, value) => sum + value, 0);
        state.flashes.push({ row: position.row, column: rights + 1, time: now });
        ball.lastRow = position.row;
      }
      ctx.shadowColor = '#ffdd7a'; ctx.shadowBlur = 15;
      ctx.beginPath(); ctx.arc(position.x, position.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffe7a0'; ctx.fill(); ctx.shadowBlur = 0;
      return true;
    });
    updateControls();
  }
  function animate(now) {
    state.frame = null;
    draw(now);
    if (state.active && !document.hidden && (state.balls.length || state.flashes.length)) state.frame = requestAnimationFrame(animate);
  }
  function startAnimation() {
    if (state.active && !document.hidden && state.frame === null) state.frame = requestAnimationFrame(animate);
  }
  function resize() {
    const canvas = el('plinkoCanvas');
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(720 * scale); canvas.height = Math.round(584 * scale);
    draw();
  }
  function updateControls() {
    const config = state.config;
    const disabled = state.pending || state.syncing || !config;
    el('plinkoLaunch').disabled = disabled || (!state.retry && (!config?.settings?.enabled || config.settings.maintenance || config.paused));
    el('plinkoLaunch').textContent = state.pending ? 'ENVOI EN COURS…' : state.retry ? 'RÉCUPÉRER MON LANCER' : 'LANCER UNE BILLE';
    el('plinkoBallCount').textContent = state.balls.length;
    el('plinkoBalance').textContent = formatChips(state.balance);
    el('plinkoStake').disabled = state.pending || !!state.retry;
    document.querySelectorAll('[data-plinko-adjust]').forEach(button => { button.disabled = state.pending || !!state.retry; });
  }
  function renderHistory() {
    el('plinkoHistory').replaceChildren(...state.history.map(drop => {
      const chip = document.createElement('span');
      chip.className = `plinko-history-chip${drop.payout > drop.stake ? ' is-profit' : ''}`;
      chip.textContent = formatMultiplier(drop.multiplier);
      chip.title = `Mise ${formatChips(drop.stake)} · Gain ${formatChips(drop.payout)} · ${new Date(drop.createdAt).toLocaleString('fr-FR')}`;
      return chip;
    }));
    if (!state.history.length) el('plinkoHistory').textContent = 'Ta première bille t’attend.';
  }
  function renderRecent() {
    el('plinkoRecent').replaceChildren(...state.recent.filter(drop => !state.unrevealed.has(drop.id) &&
      !(state.pending && drop.username === accountUser.username)).slice(0, 20).map(drop => {
      const row = document.createElement('div'); row.className = 'plinko-feed-row';
      for (const [tag, text] of [['span', drop.username], ['strong', formatMultiplier(drop.multiplier)], ['span', `${formatChips(drop.payout)} €`]]) {
        const node = document.createElement(tag); node.textContent = text; row.append(node);
      }
      return row;
    }));
    if (!state.recent.length) el('plinkoRecent').textContent = 'Les prochains lancers apparaîtront ici.';
  }
  function finish(drop) {
    if (state.unrevealed.delete(drop.id)) {
      state.balance += drop.payout;
      publishBalance();
      state.history = [drop, ...state.history.filter(entry => entry.id !== drop.id)].slice(0, 20);
      renderHistory(); renderRecent();
    }
    el('plinkoLastMultiplier').textContent = formatMultiplier(drop.multiplier);
    el('plinkoLastPayout').textContent = `${formatChips(drop.payout)} €`;
    const bin = el('plinkoBins').children[drop.slot];
    bin.classList.remove('is-winner'); void bin.offsetWidth; bin.classList.add('is-winner');
    if (!state.pending && !state.retry) feedback(`${formatMultiplier(drop.multiplier)} · ${drop.payout >= drop.stake ? 'Gain' : 'Retour'} : ${formatChips(drop.payout)} €.`);
    syncAccount();
  }
  function publishBalance() {
    savePlayer({ ...getPlayer(), chips: state.balance });
    updateTopbar();
  }
  async function syncAccount() {
    if (state.unrevealed.size || state.pending || state.retry || state.syncing) return;
    state.syncing = true; state.requestVersion += 1; updateControls();
    try { await loadAccountData(); updateTopbar(); } catch { /* Retry through the next state refresh. */ }
    finally { state.syncing = false; updateControls(); }
  }
  async function refresh() {
    if (state.pending || state.syncing) return;
    const requestVersion = ++state.requestVersion;
    try {
      const response = await fetch('/api/plinko/state');
      if (!response.ok) throw new Error('Impossible de charger Plinko.');
      const config = await response.json();
      if (state.pending || requestVersion !== state.requestVersion) return;
      state.config = config;
      state.balance = config.balance - [...state.unrevealed.values()].reduce((sum, drop) => sum + drop.payout, 0);
      publishBalance();
      state.history = config.history.filter(drop => !state.unrevealed.has(drop.id)); state.recent = config.recent;
      el('plinkoStake').min = config.settings.minBet;
      el('plinkoStake').max = Math.min(config.settings.maxBet, 1_000_000);
      el('plinkoRtp').textContent = `${(config.rtp * 100).toLocaleString('fr-FR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} %`;
      el('plinkoBins').replaceChildren(...config.multipliers.map((value, index) => {
        const bin = document.createElement('span'); bin.className = 'plinko-bin';
        bin.style.backgroundColor = COLORS[index]; bin.textContent = value >= 100 ? String(value) : formatMultiplier(value);
        bin.title = `${formatMultiplier(value)} · Probabilité ${(config.probabilities[index] * 100).toLocaleString('fr-FR', { maximumFractionDigits: 5 })} %`;
        return bin;
      }));
      renderHistory(); renderRecent(); resize();
      feedback(state.retry ? 'Un lancer attend confirmation. Récupère-le sans nouvelle mise.' : config.paused || !config.settings.enabled || config.settings.maintenance ? 'Les mises Plinko sont suspendues.' : 'Choisis ta mise et lance une bille.');
    } catch (error) { feedback(error.message, true); }
    updateControls();
  }
  function storeRetry(value) {
    state.retry = value;
    try { if (value) localStorage.setItem(key(), JSON.stringify(value)); else localStorage.removeItem(key()); } catch {}
  }
  async function launch() {
    if (state.pending || state.syncing || !state.config) return;
    const stake = Number(el('plinkoStake').value);
    if (!state.retry && (!isMoney(stake) || stake < state.config.settings.minBet || stake > Math.min(state.config.settings.maxBet, 1_000_000) || stake > state.balance)) {
      feedback('Choisis une mise autorisée et disponible dans ton solde.', true); return;
    }
    // getRandomValues also works when the VM is accessed over plain HTTP.
    const request = state.retry || { stake, risk: 'high', rows: 16,
      requestId: Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('') };
    storeRetry(request); state.pending = true; state.requestVersion += 1; updateControls();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/plinko/drop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) storeRetry(null);
        throw new Error(payload.error || 'Lancer non confirmé. Récupère-le pour vérifier son résultat.');
      }
      storeRetry(null);
      if (!state.seen.has(payload.drop.id)) {
        state.seen.add(payload.drop.id);
        state.unrevealed.set(payload.drop.id, payload.drop);
        state.balance = payload.balance - [...state.unrevealed.values()].reduce((sum, drop) => sum + drop.payout, 0);
        publishBalance(); renderRecent();
        if (state.seen.size > 100) state.seen.delete(state.seen.values().next().value);
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish(payload.drop);
        else { state.balls.push({ drop: payload.drop, started: performance.now(), lastRow: -1 }); startAnimation(); }
      }
      if (state.unrevealed.size) feedback('Bille lancée · attends son arrivée pour découvrir le gain.');
    } catch (error) { feedback(state.retry ? 'Connexion interrompue. Récupère ton lancer : aucune seconde mise ne sera débitée.' : error.message, true); }
    finally { clearTimeout(timeout); state.pending = false; updateControls(); renderRecent(); syncAccount(); }
  }
  function setActive(active) {
    state.active = active;
    if (state.socket?.connected) state.socket.emit(active ? 'plinko:subscribe' : 'plinko:unsubscribe');
    if (active) { refresh(); startAnimation(); }
    else if (state.frame !== null) { cancelAnimationFrame(state.frame); state.frame = null; }
  }
  function initialize() {
    try { state.retry = JSON.parse(localStorage.getItem(key()) || 'null'); } catch { state.retry = null; }
    state.balance = getPlayer().chips;
    el('plinkoLaunch').addEventListener('click', launch);
    document.querySelectorAll('[data-plinko-adjust]').forEach(button => button.addEventListener('click', () => {
      const input = el('plinkoStake'), config = state.config;
      if (!config) return;
      const max = Math.min(state.balance, config.settings.maxBet, 1_000_000);
      input.value = Math.min(max, Math.max(config.settings.minBet, button.dataset.plinkoAdjust === 'max' ? max : roundMoney(Number(input.value) * Number(button.dataset.plinkoAdjust))));
    }));
    state.socket = window.io ? io() : null;
    state.socket?.on('session:ready', () => { if (state.active) state.socket.emit('plinko:subscribe'); });
    state.socket?.on('plinko:drop', drop => {
      state.recent = [drop, ...state.recent.filter(entry => entry.id !== drop.id)].slice(0, 20); renderRecent();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.frame !== null) { cancelAnimationFrame(state.frame); state.frame = null; }
      else if (!document.hidden) startAnimation();
    });
    resize(); updateControls();
  }
  return { initialize, setActive };
})();
