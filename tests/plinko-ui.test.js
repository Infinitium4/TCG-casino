const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

function harness() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '100', children: [], style: {}, classList: { toggle() {}, add() {}, remove() {} },
      addEventListener() {}, replaceChildren(...children) { this.children = children; },
      append(child) { this.children.push(child); },
      getContext: () => ({ setTransform() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {} })
    });
    return elements.get(id);
  };
  const storage = new Map(), requests = [];
  const context = vm.createContext({
    document: { hidden: false, getElementById: element, querySelectorAll: () => [],
      createElement: tag => element(`new-${tag}-${elements.size}`), addEventListener() {} },
    window: { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) },
    accountUser: { id: 7 }, getPlayer: () => ({ chips: 1000 }), formatChips: String,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    // Deliberately no randomUUID: plain HTTP VMs must still be able to launch.
    crypto: { getRandomValues: array => webcrypto.getRandomValues(array) },
    performance: { now: () => 0 }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    AbortController, setTimeout, clearTimeout,
    loadAccountData: async () => true, updateTopbar() {},
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }))
  });
  const source = fs.readFileSync(path.join(__dirname, '../underground/js/plinko.js'), 'utf8');
  vm.runInContext(source.replace('return { initialize, setActive };', 'globalThis.game = { initialize, state, launch, refresh, draw }; return { initialize, setActive };'), context);
  context.game.initialize();
  context.game.state.config = { settings: { enabled: true, minBet: 1, maxBet: 1000000 }, maxBalls: 8 };
  element('plinkoBins').children = Array.from({ length: 17 }, (_, index) => element(`bin-${index}`));
  const drop = { id: 1, path: Array(16).fill(0), slot: 0, multiplier: 110, payout: 11000, stake: 100, createdAt: 0 };
  return { game: context.game, elements, storage, requests, drop };
}

test('double click sends one launch over HTTP and animates only the confirmed server result', async () => {
  const h = harness();
  const pending = h.game.launch();
  await h.game.launch();
  assert.equal(h.requests.length, 1);
  assert.equal(h.game.state.pending, true);
  const body = JSON.parse(h.requests[0].options.body);
  assert.match(body.requestId, /^[a-f0-9]{32}$/);
  assert.equal(body.stake, 100);
  h.requests[0].resolve({ ok: true, json: async () => ({ drop: h.drop, balance: 11900 }) });
  await pending;
  assert.equal(h.game.state.pending, false);
  assert.equal(h.game.state.balance, 11900);
  assert.equal(h.game.state.balls.length, 1);
  assert.equal(h.storage.size, 0);
  h.game.draw(3500);
  assert.equal(h.game.state.balls.length, 0);
  assert.equal(h.elements.get('plinkoLastMultiplier').textContent, '110x');
  assert.equal(h.elements.get('plinkoLastPayout').textContent, '11000 jetons');
});

test('an interrupted launch reuses its durable request ID without inventing a new result', async () => {
  const h = harness();
  const first = h.game.launch();
  const original = JSON.parse(h.requests[0].options.body);
  h.requests[0].reject(new Error('Disconnected'));
  await first;
  assert.equal(h.game.state.balls.length, 0);
  assert.equal(h.storage.size, 1);
  assert.equal(h.elements.get('plinkoLaunch').textContent, 'RÉCUPÉRER MON LANCER');
  const retry = h.game.launch();
  assert.deepEqual(JSON.parse(h.requests[1].options.body), original);
  h.requests[1].resolve({ ok: true, json: async () => ({ drop: h.drop, balance: 11900, replay: true }) });
  await retry;
  assert.equal(h.storage.size, 0);
  assert.equal(h.game.state.balls.length, 1);
});

test('eight simultaneous balls prevent new launches', async () => {
  const h = harness();
  h.game.state.balls = Array(8).fill({});
  await h.game.launch();
  assert.equal(h.requests.length, 0);
});

test('an outdated state response cannot undo a confirmed balance', async () => {
  const h = harness();
  const refresh = h.game.refresh();
  const launch = h.game.launch();
  h.requests[1].resolve({ ok: true, json: async () => ({ drop: h.drop, balance: 11900 }) });
  await launch;
  h.requests[0].resolve({ ok: true, json: async () => ({ balance: 1000 }) });
  await refresh;
  assert.equal(h.game.state.balance, 11900);
});
