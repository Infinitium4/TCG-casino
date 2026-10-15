const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('cashout stops the flight and keeps confirmed winnings through later round updates', () => {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      value: '25', textContent: '', attributes: {}, classes: new Set(),
      classList: {
        toggle(name, enabled) { enabled ? elements.get(id).classes.add(name) : elements.get(id).classes.delete(name); },
        remove(...names) { names.forEach(name => elements.get(id).classes.delete(name)); }
      },
      setAttribute(name, value) { this.attributes[name] = value; },
      append() {}, replaceChildren() {}
    });
    return elements.get(id);
  };
  let nextFrame = 0;
  const frames = new Map();
  const context = vm.createContext(Object.assign({}, require('../underground/js/money'), {
    document: { hidden: false, getElementById: element, querySelectorAll: () => [], createElement: () => element(`new-${elements.size}`) },
    window: {}, Date, Number, Math, console,
    getPlayer: () => ({ chips: 1000 }), formatChips: String,
    requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); }
  }));
  const source = fs.readFileSync(path.join(__dirname, '../underground/js/crash.js'), 'utf8');
  vm.runInContext(source.replace('return { initialize,', 'globalThis.flight = { updateState, setActive, animate }; return { initialize,'), context);
  const round = { id: 'round-one', status: 'running', serverNow: Date.now(), startedAt: Date.now() - 1000, crashAt: Date.now() + 60000, multiplier: 1.5 };
  const active = { id: 'bet-one', status: 'active', stake: 25 };
  const update = (ownBet, nextRound = round) => context.flight.updateState({ round: nextRound, ownBet, balance: 1000, bets: [], history: [] });
  update(active);
  context.flight.setActive(true);
  assert.equal(frames.size, 1);
  const frameId = [...frames.keys()][0];
  const callback = frames.get(frameId);
  frames.delete(frameId);
  callback();
  const rocketPosition = element('crashAircraft').attributes.transform;
  const cashout = { ...active, status: 'cashed_out', cashoutMultiplier: 1.5, payout: 37 };
  update(cashout);
  assert.equal(frames.size, 0);
  assert.equal(element('crashPhaseLabel').textContent, 'Gains retirés');
  assert.equal(element('crashMultiplier').textContent, '1.50x');
  assert.equal(element('crashPotential').textContent, '37 €');
  update(active, { ...round, serverNow: Date.now() + 10, multiplier: 3 });
  assert.equal(frames.size, 0, 'a delayed active update cannot restart a confirmed cashout');
  update(cashout, { ...round, serverNow: Date.now() + 20, status: 'crashed', crashMultiplier: 4 });
  assert.equal(element('crashMultiplier').textContent, '1.50x');
  assert.equal(element('crashAircraft').attributes.transform, rocketPosition);
  assert.equal(element('crashSky').classes.has('is-crashed'), false);
  update({ ...active, id: 'bet-two' }, { ...round, id: 'round-two', status: 'betting', startedAt: Date.now() + 8000, bettingEndsAt: Date.now() + 8000 });
  assert.equal(frames.size, 1, 'a new game starts a new flight');
  assert.equal(element('crashSky').classes.has('is-cashed-out'), false);
});

function offlineHarness() {
  let now = 1000, nextId = 0, requests = 0;
  const frames = new Map(), timers = new Map(), elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '0.05', textContent: '', disabled: false,
      classList: { toggle() {}, remove() {} }, setAttribute() {}, replaceChildren() {}, append() {}
    });
    return elements.get(id);
  };
  const round = { id: 'offline-round', status: 'betting', serverNow: now,
    startedAt: 1200, bettingEndsAt: 1200, crashAt: 3000, multiplier: 1, timeScaleMs: 500 };
  const bet = { id: 'offline-bet', status: 'active', stake: 0.05 };
  const payload = () => ({ balance: 0.95, round: { ...round, serverNow: now,
    status: now >= 3000 ? 'crashed' : now >= 1200 ? 'running' : 'betting',
    ...(now >= 3000 ? { crashMultiplier: 2 } : {}) },
    ownBet: { ...bet, status: now >= 3000 ? 'lost' : 'active' }, bets: [], history: [] });
  const context = vm.createContext({ ...require('../underground/js/money'),
    Date: class extends Date { static now() { return now; } }, console,
    document: { hidden: false, getElementById: element, querySelectorAll: () => [], createElement: () => element(`new-${nextId++}`) },
    window: {}, getPlayer: () => ({ chips: 0.95 }), formatChips: String,
    fetch: async () => { requests++; return { ok: true, json: async () => payload() }; },
    requestAnimationFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setInterval(callback) { const id = ++nextId; timers.set(id, callback); return id; },
    clearInterval(id) { timers.delete(id); }
  });
  const source = fs.readFileSync(path.join(__dirname, '../underground/js/crash.js'), 'utf8');
  vm.runInContext(source.replace('return { initialize,', 'globalThis.flight = { state, updateState, setActive, refreshState, submitAction, animate }; return { initialize,'), context);
  return { context, element, frames, timers, payload, requests: () => requests,
    time(value) { now = value; }, tick() {
      const [id, callback] = frames.entries().next().value;
      frames.delete(id); callback();
    } };
}

test('without a socket, takeoff unlocks cashout and a crash unlocks the next game', async () => {
  const h = offlineHarness(), flight = h.context.flight;
  flight.state.enabled = true;
  flight.updateState(h.payload());
  flight.setActive(true);
  await flight.refreshState();
  assert.equal(h.timers.size, 1);
  assert.equal(h.element('crashBetButton').disabled, true);
  h.time(1400); h.tick();
  assert.equal(h.element('crashPhaseLabel').textContent, 'En vol');
  assert.equal(h.element('crashBetButton').disabled, false);
  assert.match(h.element('crashBetButton').textContent, /Retirer/);
  assert.notEqual(h.element('crashMultiplier').textContent, '1.00x');
  const previousRequests = h.requests();
  [...h.timers.values()][0]();
  await flight.refreshState();
  assert.ok(h.requests() > previousRequests);
  h.time(3000); h.tick();
  await flight.refreshState();
  assert.equal(flight.state.ownBet.status, 'lost');
  assert.equal(h.element('crashBetButton').disabled, false);
  assert.equal(h.element('crashBetButton').textContent, 'Lancer ma partie');
  flight.setActive(false);
  assert.equal(h.timers.size, 0);
});

test('a rejected wager keeps its error visible after the controls unlock', async () => {
  const h = offlineHarness();
  h.context.flight.state.balance = 0.95;
  h.context.fetch = async () => ({ ok: false, json: async () => ({ error: 'Termine ta partie en cours.' }) });
  h.context.console = { error() {} };
  await h.context.flight.submitAction();
  assert.equal(h.element('crashFeedback').textContent, 'Termine ta partie en cours.');
  assert.equal(h.element('crashBetButton').disabled, false);
});

test('fallback refreshes share one in-flight request', async () => {
  const h = offlineHarness();
  let calls = 0, resolve;
  h.context.fetch = () => { calls++; return new Promise(done => { resolve = done; }); };
  const first = h.context.flight.refreshState();
  const second = h.context.flight.refreshState();
  assert.equal(first, second); assert.equal(calls, 1);
  resolve({ ok: true, json: async () => h.payload() });
  await first;
  assert.equal(h.context.flight.state.refreshPromise, null);
});

test('the crash multiplier stays at the flight deadline while the server response is delayed', () => {
  const h = offlineHarness();
  const payload = h.payload();
  payload.round.crashAt = 1200 + Math.log(2) * 500;
  h.context.flight.updateState(payload);
  h.context.fetch = () => new Promise(() => {});
  h.context.flight.setActive(true);
  h.time(1600);
  h.tick();
  assert.equal(h.element('crashMultiplier').textContent, '2.00x');
  assert.match(h.element('crashStatusMessage').textContent, /Crash à 2\.00x/);
  assert.equal(h.context.flight.state.ownBet.status, 'lost');
  assert.equal(h.element('crashBetButton').disabled, false);
  assert.equal(h.frames.size, 0);
});
