window.screenTimeModule = (() => {
  const tabId = crypto.randomUUID?.() || `tab_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  let started = false, timer = null, queue = Promise.resolve();
  const format = seconds => {
    const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
    return hours ? `${hours} h ${minutes} min` : minutes ? `${minutes} min` : `${seconds} s`;
  };
  function render(payload) {
    const today = document.getElementById('screenTimeToday');
    const total = document.getElementById('screenTimeTotal');
    if (today) today.textContent = format(payload.todaySeconds);
    if (total) total.textContent = format(payload.totalSeconds);
    const status = document.getElementById('screenTimeStatus');
    if (status) status.textContent = 'Comptage sur les pages visibles du casino, sans doublon entre les onglets. Journée : heure de Paris.';
  }
  function send(active) {
    queue = queue.catch(() => {}).then(async () => {
      const response = await fetch('/api/screen-time/heartbeat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabId, active }), keepalive: true
      });
      if (!response.ok) throw new Error('Compteur indisponible');
      render(await response.json());
    }).catch(() => {
      const status = document.getElementById('screenTimeStatus');
      if (status) status.textContent = 'Synchronisation du temps momentanément indisponible. Nouvelle tentative automatique.';
    });
    return queue;
  }
  function heartbeat() {
    if (started) return send(!document.hidden);
  }
  function start(user) {
    if (started || user.supportMode) return;
    started = true;
    heartbeat();
    timer = setInterval(() => { if (!document.hidden) heartbeat(); }, 10000);
    document.addEventListener('visibilitychange', heartbeat);
    window.addEventListener('pageshow', heartbeat);
    window.addEventListener('pagehide', () => {
      navigator.sendBeacon('/api/screen-time/heartbeat', new Blob([
        JSON.stringify({ tabId, active: false })
      ], { type: 'application/json' }));
    });
  }
  function stop() {
    if (!started) return Promise.resolve();
    started = false;
    clearInterval(timer);
    return send(false);
  }
  return { start, stop };
})();
