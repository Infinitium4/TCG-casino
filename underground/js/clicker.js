const clickerModule = (() => {
  let config = null, busy = false, active = false, timer = null, pending = null;
  const el = id => document.getElementById(id);
  const key = () => `clicker-pending-${accountUser.id}`;
  function remember(value) {
    pending = value;
    try { if (value) localStorage.setItem(key(), JSON.stringify(value)); else localStorage.removeItem(key()); } catch {}
  }
  function render() {
    el('clickerButton').disabled = busy || !config || (!pending && !config.remaining);
    el('clickerButton').textContent = pending ? 'CONFIRMER LE CLIC' : config && !config.remaining ? 'SOLDE DE 1 000 ATTEINT' : '+1 JETON';
    if (!config) return;
    el('clickerBalance').textContent = formatChips(config.balance);
    el('clickerRemaining').textContent = config.remaining;
    el('clickerProgress').value = Math.min(config.balance, config.limit);
    savePlayer({ ...getPlayer(), chips: config.balance }); updateTopbar();
  }
  function accept(data) { config = data; render(); }
  async function refresh() {
    if (busy) return;
    busy = true; render();
    try {
      const response = await fetch('/api/clicker/state', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      accept(data);
    } catch (error) { el('clickerFeedback').textContent = error.message; }
    finally { busy = false; render(); }
  }
  async function click() {
    if (busy || !config) return;
    busy = true;
    if (!pending) remember({ requestId: Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('') });
    render();
    try {
      const response = await fetch('/api/clicker/click', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending) });
      const data = await response.json();
      if (!response.ok) {
        if (response.status < 500) remember(null);
        throw new Error(data.error);
      }
      remember(null); accept(data);
      el('clickerFeedback').textContent = data.remaining ? (data.replay ? 'Clic déjà crédité.' : '+1 jeton validé !') : 'Solde de 1 000 jetons atteint. Le Clicker sera disponible si ton solde redescend.';
      if (!data.replay && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el('clickerButton').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }], { duration: 160 });
      }
    } catch (error) { el('clickerFeedback').textContent = error.message; }
    finally { busy = false; render(); }
  }
  return {
    initialize() {
      try { const value = JSON.parse(localStorage.getItem(key())); if (value && typeof value.requestId === 'string') pending = value; } catch {}
      el('clickerButton').addEventListener('click', click);
      document.addEventListener('visibilitychange', () => { if (active && !document.hidden) refresh(); });
    },
    setActive(value) {
      active = value; clearInterval(timer); timer = null;
      if (active) { refresh(); timer = setInterval(refresh, 5000); }
    }
  };
})();
