const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(symbolIndexes = [0, 0, 0]) {
  const ids = new Map();
  const timers = [];
  const history = [];
  const player = { chips: 1000, stats: {} };
  const node = () => ({
    dataset: {}, value: '25', children: [], style: { setProperty() {} }, clientHeight: 240,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(name, callback) { this[name] = callback; },
    replaceChildren(...children) { this.children = children; },
    querySelector() { return this.child ??= node(); },
    getAnimations() { return []; }, animate() { return { cancel() {} }; }
  });
  const get = id => { if (!ids.has(id)) ids.set(id, node()); return ids.get(id); };
  const reels = [node(), node(), node()];
  let draws = 0;
  const context = vm.createContext({
    document: { getElementById: get, querySelector: () => get('machine'), querySelectorAll: () => reels, createElement: node },
    window: { matchMedia: () => ({ matches: false }), setTimeout: callback => timers.push(callback), casinoGameSettings: { slots: { minBet: 10, maxBet: 100 } } },
    getPlayer: () => player, savePlayer() {}, formatChips: String, updateTopbar() {}, showToast() {},
    renderHomeView() {}, renderLeaderboard() {}, renderProfileView() {}, addHistoryEntry: entry => history.push(entry)
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../underground/js/utils.js'), 'utf8'), context);
  context.addHistoryEntry = entry => history.push(entry);
  context.randomInt = () => symbolIndexes[draws++] ?? 0;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../underground/js/slots.js'), 'utf8'), context);
  context.window.slotsModule.initialize();
  return { get, player, history, timers, finish() { while (timers.length) timers.shift()(); } };
}

test('slots reserves stake at launch, rejects a second spin and pays only once', () => {
  const ui = setup();
  ui.get('slotsLever').click();
  assert.equal(ui.player.chips, 975);
  assert.equal(ui.get('slotsLever').disabled, true);
  ui.get('slotsLever').click();
  assert.equal(ui.player.chips, 975);
  assert.equal(ui.timers.length, 3);
  ui.finish();
  assert.equal(ui.player.chips, 1025);
  assert.equal(ui.history.length, 1);
  assert.equal(ui.history[0].payout, 50);
  assert.equal(ui.history[0].net, 25);
  assert.equal(ui.get('slotsLever').disabled, false);
  ui.get('slotsLever').click();
  ui.finish();
  assert.equal(ui.history.length, 2);
});

test('slots settles a loss and an adjacent-pair refund without debiting twice', () => {
  for (const [symbols, balance, payout] of [[[0, 1, 2], 975, 0], [[0, 0, 1], 1000, 25]]) {
    const ui = setup(symbols);
    ui.get('slotsLever').click();
    ui.finish();
    assert.equal(ui.player.chips, balance);
    assert.equal(ui.history[0].payout, payout);
    assert.equal(ui.player.stats.gamesPlayed, 1);
  }
});

test('slots refuses stakes outside game limits or available balance', () => {
  const ui = setup();
  for (const value of ['0', '9', '101', '25.5', 'invalid']) {
    ui.get('slotsStake').value = value;
    ui.get('slotsLever').click();
  }
  ui.player.chips = 20;
  ui.get('slotsStake').value = '25';
  ui.get('slotsLever').click();
  assert.equal(ui.player.chips, 20);
  assert.equal(ui.timers.length, 0);
  assert.equal(ui.history.length, 0);
});
