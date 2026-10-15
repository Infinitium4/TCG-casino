const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

function harness() {
  const nodes = new Map(), requests = [], storage = new Map();
  let player = { chips: 1000 }, loads = 0;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: id === 'diceThreshold' || id === 'diceSlider' ? '50' : '100', children: [], style: {}, attributes: {},
      classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {},
      setAttribute(key, value) { this.attributes[key] = value; },
      replaceChildren(...children) { this.children = children; }, append(child) { this.children.push(child); }
    });
    return nodes.get(id);
  };
  const context = vm.createContext(Object.assign({}, require('../underground/js/money'), {
    document: { hidden: false, getElementById: node, querySelectorAll: () => [], addEventListener() {}, createElement: tag => node(`${tag}-${nodes.size}`) },
    window: { matchMedia: () => ({ matches: false }) }, accountUser: { id: 7, username: 'Alice' },
    getPlayer: () => player, savePlayer: next => { player = next; }, formatChips: String,
    updateTopbar: () => { node('topbarBalance').textContent = String(player.chips); },
    loadAccountData: async () => { loads++; },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    crypto: { getRandomValues: bytes => webcrypto.getRandomValues(bytes) },
    performance: { now: () => 0 }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    AbortController, setTimeout, clearTimeout,
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }))
  }));
  const source = fs.readFileSync(path.join(__dirname, '../underground/js/dice.js'), 'utf8');
  vm.runInContext(source.replace('return { initialize, setActive };', 'globalThis.game = { initialize, setActive, state, quote, launch, refresh, animate, finish }; return { initialize, setActive };'), context);
  context.game.initialize(); context.game.state.active = true;
  context.game.state.config = { settings: { enabled: true, minBet: 1, maxBet: 1000000 } };
  const roll = { id: 1, result: 42, won: true, stake: 100, threshold: 50, mode: 'under', multiplier: 1.98, payout: 198, createdAt: 0 };
  return { game: context.game, nodes, requests, storage, roll, loads: () => loads };
}

test('Dice displays exact quotes and reverses the winning zone in Over mode', () => {
  const h = harness();
  h.nodes.get('diceThreshold').value = '60'; h.game.quote();
  assert.equal(h.nodes.get('diceChance').textContent, '60,00 %');
  assert.equal(h.nodes.get('diceMultiplier').textContent, '1,65x');
  assert.equal(h.nodes.get('dicePotential').textContent, '165 €');
  h.game.state.mode = 'over'; h.game.quote();
  assert.equal(h.nodes.get('diceChance').textContent, '40,00 %');
  assert.equal(h.nodes.get('diceMultiplier').textContent, '2,48x');
  assert.equal(h.nodes.get('dicePotential').textContent, '247.5 €');
  assert.match(h.nodes.get('diceRule').textContent, /supérieur ou égal/);
  assert.match(h.nodes.get('diceTrack').style.background, /#a93f4c 0%/);
});

test('double click sends once and reveals balance, result and history only when the animation ends', async () => {
  const h = harness();
  const launch = h.game.launch(); await h.game.launch();
  assert.equal(h.requests.length, 1);
  assert.equal(h.nodes.get('diceLaunch').disabled, true);
  const request = JSON.parse(h.requests[0].options.body);
  assert.match(request.requestId, /^[a-f0-9]{32}$/);
  h.requests[0].resolve({ ok: true, json: async () => ({ roll: h.roll, balance: 1098 }) });
  await launch;
  assert.equal(h.game.state.balance, 900);
  assert.equal(h.nodes.get('topbarBalance').textContent, '900');
  assert.equal(h.game.state.history.length, 0);
  assert.equal(h.nodes.get('diceResult').textContent, '…');
  assert.equal(h.loads(), 0);
  h.game.animate(550);
  assert.equal(h.game.state.busy, true);
  assert.equal(h.nodes.get('diceResult').textContent, '…');
  await h.game.animate(1100);
  assert.equal(h.game.state.balance, 1098);
  assert.equal(h.nodes.get('topbarBalance').textContent, '1098');
  assert.equal(h.nodes.get('diceResult').textContent, '42,00');
  assert.equal(h.nodes.get('diceMarker').style.left, '42%');
  assert.equal(h.game.state.history.length, 1);
  assert.equal(h.game.state.busy, false);
});

test('a lost response is recovered with exactly the same request and without a second wager', async () => {
  const h = harness();
  const first = h.game.launch();
  const request = h.requests[0].options.body;
  h.requests[0].reject(new Error('Disconnected')); await first;
  assert.equal(h.game.state.busy, false); assert.equal(h.storage.size, 1);
  const retry = h.game.launch();
  assert.equal(h.requests[1].options.body, request);
  h.requests[1].resolve({ ok: true, json: async () => ({ roll: h.roll, balance: 1098, replay: true }) });
  await retry; await h.game.finish();
  assert.equal(h.storage.size, 0); assert.equal(h.game.state.history.length, 1);
});

test('invalid stakes or thresholds never send a request', async () => {
  const h = harness();
  for (const threshold of ['0', '100', '1.001']) {
    h.nodes.get('diceThreshold').value = threshold; await h.game.launch();
  }
  h.nodes.get('diceThreshold').value = '50';
  for (const stake of ['-1', '0', '1001', '0.001']) {
    h.nodes.get('diceStake').value = stake; await h.game.launch();
  }
  assert.equal(h.requests.length, 0);
});
