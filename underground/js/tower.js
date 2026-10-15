const towerModule = (() => {
  const state = { game: null, config: null, balance: 0, history: [], active: false, pending: false,
    retry: null, fall: null, frame: null, offset: 0, camera: 0, particles: [], cuts: [], version: 0, expiryFetched: null, syncing: false };
  const el = id => document.getElementById(id);
  const key = () => `tower-pending-${accountUser.id}`;
  const mult = value => `${Number(value).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`;
  const now = () => Date.now() + state.offset;
  const live = () => state.game && ['PLAYING', 'PLACING'].includes(state.game.status);
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function message(text, error = false) { el('towerFeedback').textContent = text; el('towerFeedback').classList.toggle('is-error', error); }
  function publishBalance() { el('towerBalance').textContent = formatChips(state.balance); savePlayer({ ...getPlayer(), chips: state.balance }); updateTopbar(); }
  function controls() {
    const game = state.game, blocked = state.pending || state.syncing || !!state.retry || !!state.fall || !state.config;
    const ready = live() && now() >= game.readyAt && now() < game.expiresAt;
    el('towerStart').disabled = blocked || live() || !state.config?.settings?.enabled || state.config.settings.maintenance || state.config.paused;
    el('towerPlace').disabled = blocked || !ready;
    el('towerCashout').disabled = blocked || !ready || !game.floor;
    el('towerCashout').textContent = live() && game.floor ? `ENCAISSER ${formatChips(moneyRatio(game.stake, Math.round(game.multiplier * 100), 100))} €` : 'ENCAISSER';
    el('towerRetry').hidden = !state.retry; el('towerRetry').disabled = state.pending;
    el('towerStake').disabled = blocked || live();
    document.querySelectorAll('[data-tower-adjust]').forEach(button => { button.disabled = blocked || live(); });
    const remaining = game && live() ? Math.max(0, Math.ceil((game.expiresAt - now()) / 1000)) : 0;
    el('towerExpiry').textContent = remaining ? `Temps restant pour agir : ${remaining}s` : live() ? 'Vérification de la fin de partie…' : '';
  }
  function hud() {
    const game = state.game, floor = state.fall ? state.fall.from.floor : game?.floor || 0;
    const table = game?.multipliers || state.config?.multipliers || [];
    el('towerFloor').textContent = `${floor} / 8`;
    el('towerMultiplier').textContent = mult(floor ? table[floor - 1] : 1);
    el('towerNext').textContent = table[floor] ? mult(table[floor]) : 'COMPLÈTE';
    el('towerScore').textContent = `${state.fall ? state.fall.from.score || 0 : game?.score || 0} pts`;
    el('towerMaxMultiplier').textContent = table.length ? `jusqu’à ${mult(table[table.length - 1])}` : '8 étages';
    el('towerLadder').replaceChildren(...table.map((value, index) => {
      const rung = document.createElement('div'); rung.className = `tower-rung${index < floor ? ' is-reached' : ''}`;
      const label = document.createElement('small'); label.textContent = `Étage ${index + 1}`;
      const amount = document.createElement('strong'); amount.textContent = mult(value); rung.append(label, amount); return rung;
    }));
    controls();
  }
  function history() {
    el('towerHistory').replaceChildren(...state.history.map(game => {
      const row = document.createElement('div'); row.className = 'tower-history-row';
      const text = document.createElement('div'); text.textContent = `${game.floor} étages · ${mult(game.multiplier)} · ${game.score} pts`;
      const date = document.createElement('small'); date.textContent = `${new Date(game.createdAt).toLocaleString('fr-FR')} · Mise ${formatChips(game.stake)}`; text.append(date);
      const result = document.createElement('strong'); result.className = game.status === 'CASHOUT' ? 'is-win' : 'is-loss';
      result.textContent = game.status === 'CASHOUT' ? `${formatChips(game.payout)} € encaissés` : 'Mise perdue'; row.append(text, result); return row;
    }));
    if (!state.history.length) el('towerHistory').textContent = 'Ta première tour t’attend.';
  }
  function result() {
    const game = state.game;
    const ended = game && ['CASHOUT', 'LOST'].includes(game.status) && !state.fall;
    el('towerResult').hidden = !ended;
    if (!ended) return;
    el('towerResult').classList.toggle('is-loss', game.status === 'LOST');
    el('towerResultTitle').textContent = game.status === 'CASHOUT' ? 'GAINS ENCAISSÉS' : 'LA TOUR EST TOMBÉE';
    el('towerResultValue').textContent = game.status === 'CASHOUT' ? `${formatChips(game.payout)} €` : `−${formatChips(game.stake)} €`;
    el('towerResultDetail').textContent = `${game.floor} étages · ${mult(game.multiplier)} · ${game.score} points`;
  }
  function sound(success, perfect = false) {
    if (!getPlayer().soundEnabled) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      if (!state.audio) state.audio = new Audio();
      state.audio.resume();
      const oscillator = state.audio.createOscillator(), gain = state.audio.createGain(), t = state.audio.currentTime;
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(success ? perfect ? 740 : 440 : 150, t);
      gain.gain.setValueAtTime(.04, t); gain.gain.exponentialRampToValueAtTime(.001, t + .15);
      oscillator.connect(gain); gain.connect(state.audio.destination); oscillator.start(t); oscillator.stop(t + .15);
    } catch {}
  }
  function block(ctx, x, y, width, floor, alpha = 1) {
    ctx.globalAlpha = alpha;
    const colors = ['#a48450', '#bd654f', '#6b9380', '#ae7b61', '#778bab', '#c19f66', '#9e6873', '#77a19b', '#c5a15a'];
    ctx.fillStyle = colors[floor % colors.length]; ctx.fillRect(x - width / 2, y, width, 34);
    ctx.fillStyle = '#ffffff33'; ctx.fillRect(x - width / 2, y, width, 5);
    ctx.fillStyle = '#0004'; ctx.fillRect(x - width / 2, y + 28, width, 6);
    ctx.fillStyle = '#ffe6a06b';
    for (let px = x - width / 2 + 9; px < x + width / 2 - 7; px += 20) ctx.fillRect(px, y + 11, 8, 10);
    ctx.globalAlpha = 1;
  }
  function draw(time = performance.now()) {
    const canvas = el('towerCanvas'), ctx = canvas.getContext('2d'), scale = canvas.width / 600;
    ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.clearRect(0, 0, 600, 560);
    const sky = ctx.createLinearGradient(0, 0, 0, 560); sky.addColorStop(0, '#121d2b'); sky.addColorStop(1, '#332924'); ctx.fillStyle = sky; ctx.fillRect(0, 0, 600, 560);
    ctx.fillStyle = '#e8ddc999'; ctx.beginPath(); ctx.arc(478, 65, 23, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 35; i++) { ctx.fillStyle = '#e8ddc955'; ctx.fillRect((i * 137 + 21) % 600, (i * 73 + 15) % 280, 2, 2); }
    const game = state.game, floor = state.fall ? state.fall.from.floor : game?.floor || 0;
    const target = Math.max(0, floor - 4) * 38;
    state.camera = reduced() ? target : state.camera + (target - state.camera) * .1;
    for (let layer = 0; layer < 2; layer++) {
      for (let i = 0; i < 12; i++) {
        const height = 55 + (i * 59 + layer * 31) % 150, x = i * 56 - layer * 18;
        const bottom = 560 + state.camera * (layer ? .05 : .1);
        ctx.fillStyle = layer ? '#172028' : '#27303a'; ctx.fillRect(x, bottom - height, 42, height);
        for (let row = 0; row < height / 24 - 1; row++) { ctx.fillStyle = '#c5a15a30'; ctx.fillRect(x + 10, bottom - height + 12 + row * 24, 5, 8); ctx.fillRect(x + 27, bottom - height + 12 + row * 24, 5, 8); }
      }
    }
    const platforms = game?.platforms || [{ x: 300, width: 180 }];
    const visible = state.fall?.placement.success ? platforms.slice(0, -1) : platforms;
    visible.forEach((platform, index) => block(ctx, platform.x, 510 - index * 38 + state.camera, platform.width, index));
    if (state.fall) {
      const fall = state.fall, progress = Math.min(1, (time - fall.started) / 700);
      const y = 510 - (fall.from.floor + 1) * 38 + state.camera;
      const drop = fall.placement.success ? 85 * progress * progress : 280 * progress * progress;
      block(ctx, fall.placement.x, y - 85 + drop, fall.from.motion.width, fall.from.floor + 1, 1 - (fall.placement.success ? 0 : progress * .5));
      if (progress >= 1) finishFall(time);
    } else if (live()) {
      const motion = game.motion, x = towerMotion.positionAt(motion, now());
      const y = 510 - (game.floor + 1) * 38 + state.camera - 85;
      ctx.strokeStyle = '#c5a15a25'; ctx.setLineDash([5, 7]); ctx.beginPath(); ctx.moveTo(24, y + 17); ctx.lineTo(576, y + 17); ctx.stroke(); ctx.setLineDash([]);
      block(ctx, x, y, motion.width, game.floor + 1);
    }
    state.particles = state.particles.filter(particle => time - particle.started < 650);
    for (const particle of state.particles) { const p = (time - particle.started) / 650; ctx.fillStyle = particle.perfect ? '#ffe6a0' : '#96d59a'; ctx.globalAlpha = 1 - p; ctx.fillRect(particle.x + particle.vx * p, particle.y + particle.vy * p + 50 * p * p, 3, 3); }
    ctx.globalAlpha = 1;
    state.cuts = state.cuts.filter(cut => time - cut.started < 700);
    for (const cut of state.cuts) { const p = (time - cut.started) / 700; ctx.save(); ctx.translate(cut.x + cut.direction * 40 * p, cut.y + 170 * p * p); ctx.rotate(cut.direction * p); block(ctx, 0, 0, cut.width, cut.floor, 1 - p); ctx.restore(); }
    if (live() && now() >= game.expiresAt && state.expiryFetched !== game.id) { state.expiryFetched = game.id; refresh(); }
    controls();
  }
  function finishFall(time) {
    const fall = state.fall; if (!fall) return;
    state.fall = null;
    const placement = fall.placement, game = state.game;
    if (placement.success) {
      const y = 510 - game.floor * 38 + state.camera;
      if (!reduced()) {
        for (let i = 0; i < 18; i++) state.particles.push({ x: placement.platform.x, y, vx: (i - 9) * 9, vy: -20 - (i * 13) % 70, started: time, perfect: placement.perfect });
        if (!placement.perfect) {
          const left = placement.x - fall.from.motion.width / 2, right = placement.x + fall.from.motion.width / 2;
          const keptLeft = placement.platform.x - placement.platform.width / 2, keptRight = placement.platform.x + placement.platform.width / 2;
          for (const [a, b, direction] of [[left, keptLeft, -1], [keptRight, right, 1]]) if (b > a) state.cuts.push({ x: (a + b) / 2, width: b - a, direction, floor: game.floor, y, started: time });
        }
      }
      message(placement.perfect ? 'PARFAIT ! Largeur conservée · +25 points.' : 'Étage validé. Continue ou encaisse.');
    } else message('La plateforme a manqué la tour. Ta mise est perdue.', true);
    sound(placement.success, placement.perfect);
    state.balance = fall.balance; publishBalance(); hud(); result();
    if (!live()) { recordFinished(); syncAccount(); }
  }
  function recordFinished() { state.history = [state.game, ...state.history.filter(game => game.id !== state.game.id)].slice(0, 20); history(); }
  async function syncAccount() {
    if (state.syncing) return;
    state.syncing = true; state.version += 1; controls();
    try { await loadAccountData(); updateTopbar(); } catch {}
    finally { state.syncing = false; controls(); }
  }
  function animate(time) {
    state.frame = null; draw(time);
    if (state.active && !document.hidden && (live() || state.fall || state.particles.length || state.cuts.length)) state.frame = requestAnimationFrame(animate);
  }
  function startAnimation() { if (state.active && !document.hidden && state.frame === null) state.frame = requestAnimationFrame(animate); }
  function resize() { const canvas = el('towerCanvas'), scale = Math.min(window.devicePixelRatio || 1, 2); canvas.width = 600 * scale; canvas.height = 560 * scale; draw(); }
  async function refresh() {
    if (state.pending || state.syncing || state.fall) return;
    const version = ++state.version, started = Date.now();
    try {
      const response = await fetch('/api/tower/state'); if (!response.ok) throw new Error('Impossible de retrouver ta tour.');
      const payload = await response.json(); if (version !== state.version || state.pending || state.fall) return;
      state.offset = payload.serverNow - (started + Date.now()) / 2;
      state.config = payload; state.game = payload.game; state.balance = payload.balance; state.history = payload.history;
      el('towerStake').min = payload.settings.minBet; el('towerStake').max = Math.min(payload.settings.maxBet, 1_000_000);
      publishBalance(); hud(); history(); result(); resize(); startAnimation();
      message(state.retry ? 'Une action attend confirmation. Récupère-la sans nouveau débit.' : live() ? 'Ta tour est prête. Place la plateforme au bon moment.' : 'Choisis ta mise et commence à construire.');
    } catch (error) { message(error.message, true); }
  }
  function storeRetry(request) { state.retry = request; try { if (request) localStorage.setItem(key(), JSON.stringify(request)); else localStorage.removeItem(key()); } catch {} }
  async function action(type) {
    if (state.pending || state.syncing || state.fall || !state.config) return;
    if (!state.retry && type === 'start') {
      const stake = Number(el('towerStake').value);
      if (!isMoney(stake) || stake < state.config.settings.minBet || stake > Math.min(state.config.settings.maxBet, 1_000_000) || stake > state.balance) { message('Vérifie ta mise et ton solde.', true); return; }
    }
    const request = state.retry || { action: type, body: { requestId: Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''),
      ...(type === 'start' ? { stake: Number(el('towerStake').value) } : { gameId: state.game?.id }), ...(type === 'place' ? { floor: state.game?.floor } : {}) } };
    const previous = state.game, started = Date.now();
    storeRetry(request); state.pending = true; state.version += 1; controls();
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
    let reconcile = false;
    try {
      const response = await fetch(`/api/tower/${request.action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.body), signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) { if (response.status >= 400 && response.status < 500) storeRetry(null); reconcile = [409, 503].includes(response.status); throw new Error(payload.error || 'Action non confirmée.'); }
      storeRetry(null); state.offset = payload.serverNow - (started + Date.now()) / 2; state.game = payload.game;
      if (request.action === 'place' && !payload.replay && previous && payload.game.lastPlacement) {
        state.fall = { from: previous, placement: payload.game.lastPlacement, balance: payload.balance, started: performance.now() };
        if (reduced() || !state.active) finishFall(performance.now());
      } else { state.balance = payload.balance; publishBalance(); if (!live()) { recordFinished(); await syncAccount(); } }
      hud(); result(); startAnimation();
      if (request.action === 'start') message('Tour commencée. Place la plateforme avec le bouton ou Espace.');
      if (request.action === 'cashout') { message(`${formatChips(payload.game.payout)} € encaissés !`); sound(true, true); }
    } catch (error) { message(state.retry ? 'Connexion interrompue. Récupère ton action sans nouvelle mise.' : error.message, true); }
    finally { clearTimeout(timeout); state.pending = false; controls(); if (reconcile) refresh(); }
  }
  function setActive(active) {
    state.active = active;
    if (active) { refresh(); startAnimation(); }
    else if (state.frame !== null) { cancelAnimationFrame(state.frame); state.frame = null; }
  }
  function initialize() {
    try { state.retry = JSON.parse(localStorage.getItem(key()) || 'null'); } catch {}
    state.balance = getPlayer().chips; el('towerBalance').textContent = formatChips(state.balance);
    for (const [id, type] of [['towerStart', 'start'], ['towerPlace', 'place'], ['towerCashout', 'cashout']]) el(id).addEventListener('click', () => action(type));
    el('towerRetry').addEventListener('click', () => { if (state.retry) action(state.retry.action); });
    document.querySelectorAll('[data-tower-adjust]').forEach(button => button.addEventListener('click', () => {
      if (live() || state.pending || !state.config) return;
      const max = Math.min(state.balance, state.config.settings.maxBet, 1_000_000);
      el('towerStake').value = Math.min(max, Math.max(state.config.settings.minBet, button.dataset.towerAdjust === 'max' ? max : roundMoney(Number(el('towerStake').value) * Number(button.dataset.towerAdjust))));
    }));
    document.addEventListener('keydown', event => {
      if (event.code !== 'Space' || event.repeat || !state.active || /INPUT|TEXTAREA|SELECT|BUTTON/.test(event.target.tagName) || event.target.isContentEditable || document.querySelector('dialog[open]')) return;
      event.preventDefault(); if (!el('towerPlace').disabled) action('place');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.frame !== null) { cancelAnimationFrame(state.frame); state.frame = null; }
      else if (!document.hidden && state.active) { refresh(); startAnimation(); }
    });
    resize(); controls();
  }
  return { initialize, setActive };
})();
