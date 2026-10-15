const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { createMotion, MULTIPLIERS } = require('../tower');
function harness() {
  const nodes = new Map(), requests = [], storage = new Map(), events = new Map();
  const html = fs.readFileSync(path.join(__dirname, '../underground/index.html'), 'utf8');
  const ids = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), match => match[1]));
  let player = { chips: 1000, soundEnabled: false }, clock = 1000;
  const ctx = new Proxy({ createLinearGradient: () => ({ addColorStop() {} }) }, { get(target, key) { return target[key] || (() => {}); } });
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '100', children: [], style: {}, hidden: false,
      classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {},
      append(child) { this.children.push(child); }, replaceChildren(...children) { this.children = children; }, getContext: () => ctx });
    return nodes.get(id);
  };
  const context = vm.createContext(Object.assign({}, require('../underground/js/money'), { document: { hidden: false, getElementById: id => ids.has(id) ? node(id) : null, querySelectorAll: () => [], querySelector: () => null,
    addEventListener: (name, fn) => events.set(name, fn), createElement: tag => node(`${tag}-${nodes.size}`) },
    window: { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) }, accountUser: { id: 7, username: 'Alice' },
    getPlayer: () => player, savePlayer: next => { player = next; }, updateTopbar() { node('topbarBalance').textContent = String(player.chips); },
    formatChips: String, loadAccountData: async () => true,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    crypto: { getRandomValues: bytes => webcrypto.getRandomValues(bytes) },
    Date: class extends Date { static now() { return clock; } }, performance: { now: () => 0 },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, AbortController, setTimeout, clearTimeout,
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })) }));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../underground/js/tower-motion.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../underground/js/tower.js'), 'utf8').replace('return { initialize, setActive };', 'globalThis.game = { initialize, state, action, draw, controls, hud }; return { initialize, setActive };'), context);
  context.game.initialize(); context.game.state.active = true;
  context.game.state.config = { settings: { enabled: true, minBet: 1, maxBet: 1000000 }, multipliers: MULTIPLIERS };
  const playing = { id: '00000000-0000-4000-8000-000000000001', stake: 100, status: 'PLAYING', floor: 0, score: 0, payout: 0,
    platforms: [{ x: 300, width: 180 }], motion: { ...createMotion(180, 0, 0, .25), speed: 0 },
    multipliers: MULTIPLIERS, multiplier: 1, nextMultiplier: MULTIPLIERS[0], readyAt: 0, expiresAt: 121000, createdAt: 1000 };
  return { game: context.game, nodes, requests, storage, events, playing, setClock: value => { clock = value; } };
}

test('Tower HUD renders against the elements present in the page', () => {
  const h = harness();
  h.game.hud();
  assert.equal(h.nodes.get('towerFloor').textContent, '0 / 8');
  assert.equal(h.nodes.get('towerMaxMultiplier').textContent, 'jusqu’à 3,65x');
  assert.equal(h.nodes.get('towerLadder').children.length, 8);
  assert.equal(Boolean(h.nodes.get('towerStart').disabled), false);
});
test('Tower sends one start on double click and unlocks Place only after ready time', async () => {
  const h = harness(), first = h.game.action('start'); await h.game.action('start');
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve({ ok: true, json: async () => ({ game: h.playing, balance: 900, serverNow: 1000 }) }); await first;
  assert.equal(h.game.state.balance, 900);
  assert.equal(h.nodes.get('towerPlace').disabled, false);
  assert.equal(h.nodes.get('towerCashout').disabled, true);
});
test('validated floor animates before revealing the new floor, then cashout credits the gain', async () => {
  const h = harness(); h.game.state.game = h.playing; h.game.state.balance = 900;
  const placed = { ...h.playing, status: 'PLACING', floor: 1, score: 125, multiplier: 1.08, readyAt: 1700,
    platforms: [...h.playing.platforms, { x: 300, width: 180, perfect: true }],
    lastPlacement: { success: true, perfect: true, x: 300, platform: { x: 300, width: 180 } } };
  const placing = h.game.action('place');
  const request = JSON.parse(h.requests[0].options.body);
  assert.equal(request.floor, 0); assert.equal(Object.hasOwn(request, 'x'), false); assert.equal(Object.hasOwn(request, 'timestamp'), false);
  h.requests[0].resolve({ ok: true, json: async () => ({ game: placed, balance: 900, serverNow: 1000 }) }); await placing;
  assert.equal(h.nodes.get('towerFloor').textContent, '0 / 8');
  assert.equal(h.nodes.get('towerPlace').disabled, true);
  h.setClock(1701); h.game.draw(700);
  assert.equal(h.nodes.get('towerFloor').textContent, '1 / 8');
  assert.equal(h.nodes.get('towerPlace').disabled, false);
  assert.equal(h.nodes.get('towerCashout').disabled, false);
  const cashout = h.game.action('cashout');
  h.requests[1].resolve({ ok: true, json: async () => ({ game: { ...placed, status: 'CASHOUT', payout: 108 }, balance: 1008, serverNow: 1701 }) }); await cashout;
  assert.equal(h.nodes.get('towerResult').hidden, false);
  assert.equal(h.nodes.get('towerResultValue').textContent, '108 €');
  assert.equal(h.nodes.get('topbarBalance').textContent, '1008');
  assert.equal(h.game.state.history.length, 1);
});
test('Tower preserves an unknown action and retries with the same ID', async () => {
  const h = harness(), first = h.game.action('start'); const original = h.requests[0].options.body;
  h.requests[0].reject(new Error('Disconnected')); await first;
  assert.equal(h.storage.size, 1);
  const retry = h.game.action('start'); assert.equal(h.requests[1].options.body, original);
  h.requests[1].resolve({ ok: true, json: async () => ({ game: h.playing, balance: 900, serverNow: 1000, replay: true }) }); await retry;
  assert.equal(h.storage.size, 0); assert.equal(h.game.state.balance, 900);
});
test('Space respects focused inputs, repeated keys and inactive views', () => {
  const h = harness(), space = h.events.get('keydown');
  for (const [tagName, repeat] of [['INPUT', false], ['BUTTON', false], ['DIV', true]]) {
    space({ code: 'Space', target: { tagName }, repeat, preventDefault() { throw new Error('Should not capture this key'); } });
  }
  assert.equal(h.requests.length, 0);
});
