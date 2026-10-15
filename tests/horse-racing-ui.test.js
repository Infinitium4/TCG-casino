const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { HORSES } = require('../horse-racing');
const { generateMarket } = require('../horse-tables');

function setup(fetch) {
  const elements = new Map();
  const storage = new Map();
  const element = () => ({ value: '25', disabled: false, dataset: {}, children: [], style: { setProperty() {} }, classList: { toggle() {} },
    querySelectorAll() { return this.children.filter(child => child.type === 'button'); },
    addEventListener() {}, setAttribute() {}, append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); }, replaceChildren(...children) { this.children = children; }, scrollIntoView() {} });
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  let key = 0;
  const context = vm.createContext(Object.assign({}, require('../underground/js/money'), {
    fetch, accountUser: { id: 1 }, crypto: { getRandomValues: array => array.fill(++key) },
    document: { getElementById: get, createElement: element, querySelector: element },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    getPlayer: () => ({ chips: 1000 }), savePlayer() {}, updateTopbar() {}, formatChips: String,
    performance: { now: () => 0 }, window: { matchMedia: () => ({ matches: true }) },
    loadAccountData: async () => {}, renderHomeView() {}, renderLeaderboard() {}, renderProfileView() {}
  }));
  const source = fs.readFileSync(path.join(__dirname, '../underground/js/horses.js'), 'utf8');
  vm.runInContext(source.replace('return { initialize, setActive };', 'globalThis.api = { state, accept, bet, start, refresh }; return { initialize, setActive };'), context);
  context.api.state.horses = HORSES;
  context.api.accept({ race: null, balance: 1000, serverNow: Date.now(), settings: { enabled: true, minBet: 1, maxBet: 1000 }, paused: false });
  return { ...context.api, get, storage };
}
const ready = (requestId, stake = 25) => ({ serverNow: Date.now(), balance: 1000 - stake,
  race: { id: 'race-one', requestId, horseId: 1, stake, status: 'ready' } });
const ok = payload => ({ ok: true, json: async () => payload });

test('two rapid bet clicks send one request and preserve the confirmed reserved stake', async () => {
  const bodies = [];
  const ui = setup(async (url, options) => { const body = JSON.parse(options.body); bodies.push(body); return ok(ready(body.requestId)); });
  await Promise.all([ui.bet(), ui.bet()]);
  assert.equal(bodies.length, 1);
  assert.equal(ui.state.balance, 975);
  assert.equal(ui.state.race.status, 'ready');
  assert.equal(ui.get('horseStake').disabled, true);
  assert.equal(ui.get('horseStart').hidden, false);
  assert.equal(ui.get('horseBet').hidden, true);
  assert.equal(ui.storage.size, 0);
});

test('table betting uses the shared event and locks only this player; host waits for every bet', async () => {
  const weights = [8, 12, 20, 28, 40];
  const horses = generateMarket(HORSES, () => weights.shift());
  const table = { id: 'shared-table', eventId: 'event-one', hostId: 1, status: 'ready', horses,
    players: [{ id: 1, username: 'Host' }, { id: 2, username: 'Guest' }] };
  const calls = [];
  const ui = setup(async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body });
    table.players[0] = { ...table.players[0], stake: body.stake, horseId: body.horseId, oddsCents: horses[0].oddsCents };
    return ok({ ...ready(body.requestId), table, tables: [] });
  });
  ui.accept({ table, tables: [], race: null, balance: 1000, serverNow: Date.now() });
  assert.equal(ui.get('horseChoices').children.length, 5);
  assert.ok(ui.get('horseChoices').children[0].children[2].textContent.includes(horses[0].odds.toFixed(2)));
  await ui.bet();
  assert.equal(calls[0].url, '/api/horses/tables/shared-table/bet');
  assert.equal(calls[0].body.eventId, 'event-one');
  assert.equal(ui.get('horseStart').disabled, true);
  table.players[1] = { ...table.players[1], stake: 50, horseId: 1, oddsCents: horses[0].oddsCents };
  ui.accept({ ...ready(calls[0].body.requestId), table, tables: [] });
  assert.equal(ui.get('horseStart').disabled, false);
  const guest = table.players.pop();
  ui.accept({ ...ready(calls[0].body.requestId), table, tables: [] });
  assert.equal(ui.get('horseStart').hidden, false);
  assert.equal(ui.get('horseStart').disabled, false, 'a single player with a confirmed bet can start');
  table.players.push(guest);
  table.hostId = 2;
  ui.accept({ ...ready(calls[0].body.requestId), table, tables: [] });
  assert.equal(ui.get('horseStart').hidden, true);
});

test('an uncertain request reuses its durable ID; a definitive rejection allows editing', async () => {
  const bodies = [];
  const ui = setup(async (url, options) => {
    const body = JSON.parse(options.body); bodies.push(body);
    if (bodies.length === 1) throw new Error('Network interrupted');
    return ok(ready(body.requestId));
  });
  await ui.bet();
  assert.equal(ui.storage.size, 1);
  assert.equal(ui.get('horseStake').disabled, true);
  await ui.bet();
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(ui.state.balance, 975);
  const rejected = setup(async () => ({ ok: false, status: 400, json: async () => ({ error: 'Solde insuffisant' }) }));
  await rejected.bet();
  assert.equal(rejected.state.retry, null);
  assert.equal(rejected.get('horseStake').disabled, false);
  assert.equal(rejected.storage.size, 0);
});

test('a state fetch begun before betting cannot overwrite the confirmed race or balance', async () => {
  let resolveState;
  const ui = setup(async (url, options) => {
    if (!options?.body) return new Promise(resolve => { resolveState = resolve; });
    const body = JSON.parse(options.body); return ok(ready(body.requestId));
  });
  const refreshing = ui.refresh();
  await ui.bet();
  resolveState(ok({ race: null, balance: 1000, serverNow: Date.now() }));
  await refreshing;
  assert.equal(ui.state.balance, 975);
  assert.equal(ui.state.race.id, 'race-one');
});
