const horsesModule = (() => {
  const state = { horses: [], race: null, selected: 1, balance: 0, pending: false, retry: null,
    active: false, frame: null, offset: 0, config: null, paused: false, dismissed: null, audio: null,
    lastBeep: null, lastHoof: null, lastRank: '', celebrated: null, confetti: [], synced: null, requestVersion: 0,
    table: null, tables: [], multiplayer: false };
  const el = id => document.getElementById(id);
  const feedback = (message, error = false) => {
    el('horseFeedback').textContent = message;
    el('horseFeedback').classList.toggle('is-error', error);
    el('horseLobbyStatus').textContent = state.table ? '' : message;
    el('horseLobbyStatus').classList.toggle('is-error', error);
  };
  const storageKey = () => `underground.horses.pending.${accountUser.id}`;
  async function request(url, body) {
    const response = await fetch(url, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok) throw Object.assign(new Error(payload.error || 'Connexion à l’hippodrome impossible.'), { status: response.status });
    return payload;
  }
  function syncBalance(balance) {
    state.balance = balance;
    const player = getPlayer();
    player.chips = balance;
    savePlayer(player);
    updateTopbar();
    el('horseBalance').textContent = `${formatChips(balance)} €`;
  }
  function accept(payload) {
    if (Object.hasOwn(payload, 'table')) {
      const previousEvent = state.table?.eventId;
      state.multiplayer = true;
      state.table = payload.table;
      state.tables = payload.tables || [];
      if (state.table && previousEvent !== state.table.eventId) {
        state.horses = state.table.horses;
        state.confetti = []; state.lastBeep = null; state.lastRank = '';
        el('horsePodium').replaceChildren();
        renderChoices();
      }
      if (state.retry?.eventId && state.table?.eventId !== state.retry.eventId) {
        state.retry = null; sessionStorage.removeItem(storageKey());
      }
      renderTables();
    }
    state.offset = payload.serverNow - Date.now();
    syncBalance(payload.balance);
    state.race = payload.race?.id === state.dismissed ? null : payload.race;
    if (state.multiplayer && !state.table && state.race?.status === 'settled') state.race = null;
    if (state.race) {
      state.selected = state.race.horseId;
      if (state.retry?.requestId === state.race.requestId) {
        state.retry = null;
        sessionStorage.removeItem(storageKey());
      }
    }
    if (payload.settings) {
      state.config = payload.settings;
      state.paused = payload.paused;
      el('horseStake').min = payload.settings.minBet;
      el('horseStake').max = payload.settings.maxBet;
    }
    if (payload.history) renderHistory(payload.history);
    controls();
    if (state.race?.status === 'settled') showResult();
    else if (state.race?.status === 'ready') feedback(`Pari confirmé : ${horse(state.selected).name}, ${state.race.stake} € à ×${state.race.odds || 4}. ${state.table ? 'L’hôte lance quand tous les joueurs ont misé.' : 'Prêt pour le départ ?'}`);
    else if (state.race) feedback('Les paris sont fermés. Que le meilleur gagne !');
    else feedback(state.multiplayer && !state.table ? 'Crée une table ou rejoins celle de tes amis.' : state.retry ? 'Le précédent envoi est à vérifier. Clique sur Miser pour le reprendre sans double débit.' : 'Choisis ton cheval, puis valide ta mise.');
    wake();
  }
  const horse = id => state.horses.find(entry => entry.id === id);
  function renderTables() {
    el('horseTables').replaceChildren(...state.tables.map(table => {
      const row = document.createElement('div'); row.className = 'race-table-item';
      const label = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = `Table de ${table.hostName}`;
      const detail = document.createElement('small'); detail.textContent = `${table.playerCount}/8 joueurs · ${table.status === 'ready' ? 'Paris ouverts' : table.status === 'running' ? 'Course en cours' : 'Course terminée'}`;
      label.append(name, detail);
      const join = document.createElement('button'); join.type = 'button'; join.className = 'primary-button'; join.textContent = 'Rejoindre';
      join.disabled = state.pending || table.status !== 'ready' || table.playerCount >= 8;
      join.addEventListener('click', () => tableAction(`/api/horses/tables/${table.id}/join`));
      row.append(label, join); return row;
    }));
    if (!state.tables.length) el('horseTables').textContent = 'Aucune table ouverte. Crée la première et invite tes amis à la rejoindre.';
    el('horsePlayers').replaceChildren(...(state.table?.players || []).map(player => {
      const row = document.createElement('div'); row.className = player.stake ? 'is-ready' : '';
      const name = document.createElement('strong'); name.textContent = `${player.username}${player.id === state.table.hostId ? ' · Hôte' : ''}${player.id === Number(accountUser.id) ? ' · Toi' : ''}`;
      const bet = document.createElement('small'); bet.textContent = player.stake ? `${horse(player.horseId).name} · ${player.stake} € · ×${(player.oddsCents / 100).toFixed(2)}` : 'Choisit son cheval…';
      row.append(name, bet); return row;
    }));
    if (state.table) {
      const host = state.table.players.find(player => player.id === state.table.hostId);
      el('horseTableTitle').textContent = `Table de ${host?.username || 'course'} · ${state.table.players.length}/8 joueurs`;
    }
  }
  async function tableAction(url, body = {}) {
    if (state.pending) return;
    state.requestVersion++;
    state.pending = true; controls();
    try { accept(await request(url, body)); }
    catch (error) { feedback(error.message, true); }
    finally { state.pending = false; controls(); }
  }
  async function refresh() {
    if (state.pending) return;
    const version = state.requestVersion;
    try {
      const payload = await request('/api/horses/state');
      if (version !== state.requestVersion || state.pending) return;
      if (!state.horses.length) {
        state.horses = payload.horses;
        renderChoices();
      }
      accept(payload);
    } catch (error) { feedback(error.message, true); }
  }
  function renderChoices() {
    el('horseChoices').replaceChildren(...state.horses.map(entry => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'race-horse-choice';
      button.style.setProperty('--horse-color', entry.color);
      button.dataset.horseId = entry.id;
      const badge = document.createElement('span'); badge.className = 'race-color'; badge.textContent = entry.id;
      const name = document.createElement('strong'); name.textContent = entry.name;
      const odds = document.createElement('small'); odds.textContent = entry.odds ? `${(entry.probability * 100).toFixed(1)} % · Cote ×${entry.odds.toFixed(2)}` : '20 % · Cote ×4';
      button.append(badge, name, odds);
      button.addEventListener('click', () => { state.selected = entry.id; controls(); });
      return button;
    }));
  }
  function controls() {
    const locked = Boolean(state.race) || state.pending || Boolean(state.retry);
    el('horseChoices').querySelectorAll('button').forEach(button => {
      button.disabled = locked;
      button.setAttribute('aria-pressed', String(Number(button.dataset.horseId) === state.selected));
    });
    el('horseStake').disabled = locked;
    el('horseBet').hidden = Boolean(state.race);
    el('horseBet').disabled = state.pending || Boolean(state.race) || (state.multiplayer && !state.table) || !state.config || !state.config.enabled || state.config.maintenance || state.paused;
    const host = !state.table || state.table.hostId === Number(accountUser.id);
    const allReady = !state.table || state.table.players.length >= 1 && state.table.players.every(player => player.stake);
    el('horseStart').hidden = state.race?.status !== 'ready' || !host;
    el('horseStart').disabled = state.pending || !allReady;
    el('horseNew').hidden = state.race?.status !== 'settled' || !host;
    el('horseNew').disabled = state.pending;
    el('horseLeaveTable').disabled = state.pending || state.table?.status === 'running';
    el('horseLeaveTable').hidden = !state.table;
    el('horseCreateTable').disabled = state.pending || !state.config?.enabled || state.config?.maintenance || state.paused;
    el('horseLobby').hidden = Boolean(state.table) || Boolean(state.race && !state.race.eventId);
    el('horseRoom').hidden = !state.table && !(state.race && !state.race.eventId);
    if (state.race) el('horseStake').value = state.race.stake;
  }
  async function bet() {
    if (el('horseBet').disabled) return;
    const stake = Number(el('horseStake').value);
    if (!state.retry && (!isMoney(stake) || stake < state.config.minBet || stake > state.config.maxBet || stake > state.balance)) {
      feedback(`Choisis une mise entre ${state.config.minBet} et ${Math.min(state.balance, state.config.maxBet)} €.`, true);
      return;
    }
    state.retry ??= { stake, horseId: state.selected, ...(state.table ? { tableId: state.table.id, eventId: state.table.eventId } : {}),
      requestId: Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('') };
    sessionStorage.setItem(storageKey(), JSON.stringify(state.retry));
    state.requestVersion++;
    state.pending = true; controls();
    try { accept(await request(state.retry.tableId ? `/api/horses/tables/${state.retry.tableId}/bet` : '/api/horses/bet', state.retry)); }
    catch (error) {
      if (error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) {
        state.retry = null;
        sessionStorage.removeItem(storageKey());
      }
      feedback(state.retry ? `${error.message} Tu peux réessayer le même pari.` : error.message, true);
    }
    finally { state.pending = false; controls(); }
  }
  async function start() {
    if (state.pending || state.race?.status !== 'ready') return;
    unlockAudio();
    state.requestVersion++;
    state.pending = true; controls();
    try {
      accept(await request(state.table ? `/api/horses/tables/${state.table.id}/start` : `/api/horses/${state.race.id}/start`, state.table ? { eventId: state.table.eventId } : {}));
      document.querySelector('#horsesView .race-arena').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) { feedback(error.message, true); }
    finally { state.pending = false; controls(); }
  }
  function progressAt(trajectory, elapsed) {
    const t = Math.max(0, Math.min(1, elapsed / trajectory.finishMs));
    if (t === 1) return 1;
    const step = t * (trajectory.checkpoints.length - 1);
    const index = Math.floor(step);
    const points = trajectory.checkpoints;
    const delta = points[index + 1] - points[index];
    const m0 = index === 0 ? delta : Math.min(delta, points[index] - points[index - 1]);
    const m1 = index + 2 >= points.length ? delta : Math.min(delta, points[index + 2] - points[index + 1]);
    const u = step - index;
    // Monotone Hermite interpolation changes speed smoothly without reversing.
    return Math.min(.999, (2 * u ** 3 - 3 * u ** 2 + 1) * points[index]
      + (u ** 3 - 2 * u ** 2 + u) * m0 + (-2 * u ** 3 + 3 * u ** 2) * points[index + 1]
      + (u ** 3 - u ** 2) * m1);
  }
  function positions(elapsed) {
    return state.horses.map(entry => ({ ...entry, progress: state.race?.trajectories ? progressAt(state.race.trajectories.find(t => t.id === entry.id), elapsed) : 0 }))
      .sort((a, b) => b.progress - a.progress || (state.race?.order ? state.race.order.indexOf(a.id) - state.race.order.indexOf(b.id) : a.id - b.id));
  }
  function ranking(entries) {
    const key = entries.map(entry => `${entry.id}:${Math.floor(entry.progress * 100)}`).join(',');
    if (key === state.lastRank) return;
    state.lastRank = key;
    el('horseRanking').replaceChildren(...entries.map((entry, index) => {
      const row = document.createElement('li');
      const rank = document.createElement('span'); rank.textContent = `${index + 1}.`;
      const badge = document.createElement('span'); badge.className = 'race-color'; badge.style.setProperty('--horse-color', entry.color); badge.textContent = entry.id;
      const name = document.createElement('strong'); name.textContent = entry.name;
      const distance = document.createElement('small'); distance.textContent = entry.progress >= 1 ? 'Arrivé' : `${Math.floor(entry.progress * 100)} %`;
      row.append(rank, badge, name, distance); return row;
    }));
  }
  function unlockAudio() {
    if (!el('horseSound').checked) return;
    try { state.audio ??= new (window.AudioContext || window.webkitAudioContext)(); state.audio.resume().catch(() => {}); } catch {}
  }
  function tone(frequency, duration = .12) {
    if (!el('horseSound').checked || !state.audio) return;
    const oscillator = state.audio.createOscillator(); const gain = state.audio.createGain();
    oscillator.frequency.value = frequency; gain.gain.setValueAtTime(.045, state.audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, state.audio.currentTime + duration);
    oscillator.connect(gain); gain.connect(state.audio.destination); oscillator.start(); oscillator.stop(state.audio.currentTime + duration);
  }
  function showResult() {
    const race = state.race;
    const won = race.payout > 0;
    feedback(`${horse(race.winner).name} remporte la course ! ${won ? `Victoire : ${race.payout} € reçus (bénéfice +${race.payout - race.stake}).` : `Ton cheval ${horse(race.horseId).name} n’a pas gagné. Mise perdue : ${race.stake} €.`}`);
    el('horsePodium').replaceChildren(...race.order.slice(0, 3).map((id, index) => {
      const card = document.createElement('div'); card.textContent = ['🥇', '🥈', '🥉'][index];
      const name = document.createElement('strong'); name.textContent = horse(id).name; card.appendChild(name); return card;
    }));
    if (state.celebrated !== race.id) {
      state.celebrated = race.id;
      if (won) {
        tone(660, .3);
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) state.confetti = Array.from({ length: 75 }, (_, i) => ({ x: Math.random() * 1100, y: -Math.random() * 400, color: state.horses[i % 5].color, started: performance.now() }));
      }
      if (state.synced !== race.id) {
        state.synced = race.id;
        loadAccountData().then(() => { updateTopbar(); renderHomeView(); renderLeaderboard(); renderProfileView(); }).catch(() => { state.synced = null; });
      }
    }
  }
  function renderHistory(entries) {
    el('horseHistory').replaceChildren(...entries.map(race => {
      const row = document.createElement('p');
      row.textContent = race.cancelled ? `Pari annulé · ${race.stake} € remboursés` : `${horse(race.horseId)?.name || 'Cheval'} · ${race.stake} € misés · ×${race.odds || 4} · ${race.payout ? `${race.payout} € reçus` : 'Perdu'} · Gagnant : ${horse(race.winner)?.name || race.winner}`;
      return row;
    }));
  }
  function drawHorse(ctx, x, y, entry, time, running, winner) {
    ctx.save(); ctx.translate(x, y);
    const motion = running && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const phase = time * .018 + entry.id;
    const bounce = motion ? Math.sin(phase * 2) * 2.5 : 0;
    ctx.fillStyle = '#14241455'; ctx.beginPath(); ctx.ellipse(0, 29, 48, 6, 0, 0, Math.PI * 2); ctx.fill();
    if (winner) { ctx.shadowColor = '#ffe68a'; ctx.shadowBlur = 15; }
    const coat = ['#a24e2d', '#59433b', '#b97742', '#c4b397', '#663421'][entry.id - 1];
    ctx.strokeStyle = '#291d17'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    for (let leg = 0; leg < 4; leg++) {
      const front = leg > 1; const swing = motion ? Math.sin(phase + leg * 1.9) : .2 * (leg - 1);
      const hip = front ? 22 : -24; const kneeX = hip + swing * 14; const kneeY = 16 + bounce;
      ctx.strokeStyle = leg % 2 ? coat : '#492d24'; ctx.beginPath(); ctx.moveTo(hip, 0 + bounce); ctx.lineTo(kneeX, kneeY); ctx.lineTo(hip - swing * 19 + (front ? 6 : -4), 29); ctx.stroke();
      ctx.strokeStyle = '#eadbba'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(hip - swing * 19 + (front ? 6 : -4), 26); ctx.lineTo(hip - swing * 19 + (front ? 10 : 0), 29); ctx.stroke(); ctx.lineWidth = 6;
    }
    ctx.translate(0, bounce);
    ctx.strokeStyle = '#30231d'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(-36, -12); ctx.bezierCurveTo(-55, -18, -52, 8, -66, 8); ctx.stroke();
    ctx.fillStyle = coat; ctx.beginPath(); ctx.ellipse(-3, -9, 38, 18, -.08, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(18, -19); ctx.lineTo(33, -45); ctx.quadraticCurveTo(40, -52, 45, -37); ctx.lineTo(57, -28); ctx.quadraticCurveTo(62, -21, 51, -20); ctx.lineTo(34, -28); ctx.lineTo(27, 1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#30231d'; ctx.beginPath(); ctx.moveTo(23, -20); ctx.lineTo(30, -48); ctx.lineTo(35, -45); ctx.lineTo(30, -19); ctx.fill();
    ctx.fillStyle = coat; ctx.beginPath(); ctx.moveTo(35, -45); ctx.lineTo(34, -57); ctx.lineTo(41, -47); ctx.fill();
    ctx.fillStyle = '#121410'; ctx.beginPath(); ctx.arc(43, -37, 2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#e2bd84'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(51, -32); ctx.lineTo(47, -22); ctx.lineTo(7, -25); ctx.stroke();
    ctx.fillStyle = entry.color; ctx.fillRect(-17, -23, 25, 24); ctx.fillStyle = '#131b20'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(entry.id, -5, -5);
    ctx.strokeStyle = '#f5ead5'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(-7, -28); ctx.lineTo(5, -19); ctx.lineTo(-6, -8); ctx.stroke();
    ctx.fillStyle = entry.color; ctx.beginPath(); ctx.ellipse(-3, -35, 17, 9, -.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = entry.color; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(8, -37); ctx.lineTo(17, -27); ctx.lineTo(28, -29); ctx.stroke();
    ctx.fillStyle = '#edbd8e'; ctx.beginPath(); ctx.arc(12, -47, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = entry.color; ctx.beginPath(); ctx.arc(12, -49, 8, Math.PI, Math.PI * 2); ctx.lineTo(23, -48); ctx.fill();
    ctx.restore();
  }
  function draw(now) {
    state.frame = null;
    if (!state.active) return;
    const canvas = el('horseRaceCanvas'); const ctx = canvas.getContext('2d');
    const width = Math.max(1, Math.round(canvas.clientWidth * (window.devicePixelRatio || 1)));
    const height = Math.round(width * 570 / 1100);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.setTransform(canvas.width / 1100, 0, 0, canvas.height / 570, 0, 0);
    const elapsed = state.race?.startedAt ? Date.now() + state.offset - state.race.startedAt : 0;
    const running = state.race?.status === 'running' && elapsed >= 0;
    const entries = positions(elapsed);
    const sky = ctx.createLinearGradient(0, 0, 0, 570); sky.addColorStop(0, '#37705a'); sky.addColorStop(1, '#132e25'); ctx.fillStyle = sky; ctx.fillRect(0, 0, 1100, 570);
    ctx.fillStyle = '#cba973'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('UNDERGROUND • GRAND PRIX NOCTURNE', 28, 32);
    for (let i = 0; i < 30; i++) { ctx.fillStyle = i % 2 ? '#e0cf9b44' : '#c2d6bf22'; ctx.fillRect(i * 40, 48, 24, 12); }
    ctx.fillStyle = '#af9363'; ctx.fillRect(25, 82, 1050, 440);
    state.horses.forEach((entry, i) => { ctx.fillStyle = i % 2 ? '#998052' : '#ad9363'; ctx.fillRect(25, 82 + i * 88, 1050, 88); ctx.strokeStyle = '#edd8a95c'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(25, 82 + i * 88); ctx.lineTo(1075, 82 + i * 88); ctx.stroke();
      ctx.fillStyle = entry.color; ctx.beginPath(); ctx.arc(52, 125 + i * 88, 16, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#18231d'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(entry.id, 52, 131 + i * 88); });
    ctx.fillStyle = '#fff6d7'; ctx.fillRect(163, 82, 3, 440);
    for (let i = 0; i < 44; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? '#f4edda' : '#222c27'; ctx.fillRect(1002 + j * 9, 82 + i * 10, 9, 10); }
    ctx.fillStyle = '#f3dfb0'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('DÉPART', 165, 76); ctx.fillText('ARRIVÉE', 1010, 76);
    for (const entry of entries) {
      const i = entry.id - 1; const x = 105 + entry.progress * 840;
      drawHorse(ctx, x, 141 + i * 88, entry, now, running && entry.progress < 1, entry.progress === 1 && state.race?.winner === entry.id);
    }
    ctx.strokeStyle = '#e5d1a8'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(25, 540); ctx.lineTo(1075, 540); ctx.stroke();
    for (let x = 25; x < 1080; x += 55) { ctx.beginPath(); ctx.moveTo(x, 540); ctx.lineTo(x, 558); ctx.stroke(); }
    state.confetti = state.confetti.filter(p => now - p.started < 3000);
    state.confetti.forEach(p => { ctx.fillStyle = p.color; ctx.fillRect(p.x + Math.sin(now / 200 + p.x) * 20, p.y + (now - p.started) * .3, 6, 10); });
    ranking(entries);
    const countdown = state.race?.status === 'running' && elapsed < 0 ? String(Math.ceil(-elapsed / 1000)) : running && elapsed < 700 ? 'GO !' : '';
    el('horseCountdown').textContent = countdown;
    if (countdown && countdown !== state.lastBeep) { state.lastBeep = countdown; tone(countdown === 'GO !' ? 880 : 440); }
    if (running && elapsed < 14000 && Math.floor(elapsed / 180) !== state.lastHoof) { state.lastHoof = Math.floor(elapsed / 180); tone(85, .035); }
    el('horseRaceTimer').textContent = state.race?.status === 'settled' ? 'COURSE TERMINÉE' : running ? `${(Math.min(elapsed, 14000) / 1000).toFixed(1)} s` : countdown ? 'DÉPART IMMINENT' : 'EN ATTENTE';
    if (state.race?.status === 'running' && Date.now() + state.offset >= state.race.endsAt && !state.pending) finish();
    if (state.race?.status === 'running' || state.confetti.length) state.frame = requestAnimationFrame(draw);
  }
  async function finish() {
    state.requestVersion++;
    state.pending = true;
    try {
      accept(await request(`/api/horses/${state.race.id}/settle`, {}));
      const payload = await request('/api/horses/state');
      renderHistory(payload.history);
    }
    catch (error) { feedback(`${error.message} Le règlement sera vérifié automatiquement.`, true); }
    finally { state.pending = false; controls(); }
  }
  function wake() { if (state.active && state.frame === null) state.frame = requestAnimationFrame(draw); }
  function setActive(active) {
    state.active = active;
    if (active) { refresh(); wake(); }
    else if (state.frame !== null) { cancelAnimationFrame(state.frame); state.frame = null; }
  }
  function initialize() {
    try { state.retry = JSON.parse(sessionStorage.getItem(storageKey())); } catch {}
    el('horseBet').addEventListener('click', bet);
    el('horseStart').addEventListener('click', start);
    el('horseCreateTable').addEventListener('click', () => tableAction('/api/horses/tables'));
    el('horseLeaveTable').addEventListener('click', () => { if (state.table) tableAction(`/api/horses/tables/${state.table.id}/leave`); });
    el('horseNew').addEventListener('click', () => {
      if (state.table) return tableAction(`/api/horses/tables/${state.table.id}/next`, { eventId: state.table.eventId });
      state.requestVersion++; state.dismissed = state.race.id; state.race = null; state.confetti = []; state.lastBeep = null; el('horsePodium').replaceChildren(); controls(); feedback('Nouvelle course : choisis ton champion.'); wake();
    });
    el('horseSound').checked = Boolean(getPlayer().soundEnabled);
    el('horseSound').addEventListener('change', () => { const player = getPlayer(); player.soundEnabled = el('horseSound').checked; savePlayer(player); unlockAudio(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && state.active) refresh(); });
    new ResizeObserver(wake).observe(el('horseRaceCanvas'));
    setInterval(() => { if (state.active) refresh(); }, 1000);
    refresh();
  }
  return { initialize, setActive };
})();
