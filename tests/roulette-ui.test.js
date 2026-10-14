const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  const nodes = [];
  const ids = new Map();
  function node() {
    const classes = new Set();
    const item = {
      children: [], dataset: {}, style: { setProperty() {} }, value: '7',
      offsetWidth: 400, disabled: false, hidden: false, attributes: {}, events: {},
      classList: {
        add(...values) { values.forEach(value => classes.add(value)); },
        remove(...values) { values.forEach(value => classes.delete(value)); },
        toggle(value, enabled) { enabled ? classes.add(value) : classes.delete(value); },
        contains(value) { return classes.has(value); }
      },
      append(...children) { children.forEach(child => { child.parent = item; item.children.push(child); }); },
      appendChild(child) { item.append(child); },
      replaceChildren(...children) { item.children = []; item.append(...children); },
      remove() { this.parent.children = this.parent.children.filter(child => child !== this); },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, callback) { this.events[name] = callback; },
      scrollIntoView(options) { this.scrollOptions = options; },
      animate(frames, options) { this.animation = { frames, options }; },
      querySelector(selector) { return this.children.find(child => child.className === selector.slice(1)) || null; }
    };
    nodes.push(item);
    return item;
  }
  const get = id => { if (!ids.has(id)) ids.set(id, node()); return ids.get(id); };
  const board = node(); board.dataset.boardNumber = '7';
  const zone = node(); zone.dataset.bet = 'red'; zone.classList.add('active');
  const switches = ['wheel', 'track'].map(view => { const button = node(); button.dataset.rouletteView = view; return button; });
  const stage = node();
  const player = { chips: 1000, stats: {} };
  const history = [];
  let settle;
  const document = {
    getElementById: id => nodes.find(item => item.id === id) || get(id), createElement: node, createElementNS: node,
    querySelector: selector => selector === '.roulette-stage' ? stage : zone,
    querySelectorAll(selector) {
      if (selector === '.bet-choice') return [zone];
      if (selector === '[data-roulette-view]') return switches;
      if (selector.startsWith('.board-cell')) return nodes.filter(item => item.dataset.boardNumber !== undefined);
      return [];
    }
  };
  const context = vm.createContext({ document, window: { casinoGameSettings: { roulette: { minBet: 5, maxBet: 100 } } },
    ResizeObserver: class { observe() {} },
    getPlayer: () => player, savePlayer() {}, updateTopbar() {}, showToast() {},
    getRouletteColor: value => ['0', '00'].includes(String(value)) ? 'green' : String(value) === '7' ? 'red' : 'black',
    randomInt: () => 6, setTimeout: callback => { settle = callback; },
    addHistoryEntry: entry => history.push(entry), renderHomeView() {}, renderLeaderboard() {}, renderFilteredHistory() {}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../underground/js/roulette.js'), 'utf8'), context);
  get('rouletteCustomStake').value = '10';
  context.window.rouletteModule.initialize();
  return { get, board, zone, switches, stage, player, history, document, finish: () => settle() };
}

test('roulette initializes all 38 track pockets and keeps bets across views and zone selection', () => {
  const ui = setup();
  const pockets = ui.get('rouletteRacetrackNumbers').children.filter(item => item.dataset.boardNumber);
  assert.equal(pockets.length, 38);
  assert.equal(new Set(pockets.map(item => item.dataset.boardNumber)).size, 38);
  ui.board.events.click();
  ui.get('rouletteCustomStake').value = '25';
  pockets.find(item => item.dataset.boardNumber === '00').events.click();
  assert.equal(ui.player.chips, 965);
  assert.equal(ui.get('rouletteBets').children.length, 2);
  ui.switches[1].events.click();
  assert.equal(ui.stage.hidden, true);
  assert.equal(ui.get('rouletteRacetrack').hidden, false);
  ui.zone.events.click();
  assert.equal(ui.board.classList.contains('active'), true);
  ui.switches[0].events.click();
  assert.equal(ui.stage.hidden, false);
  assert.equal(ui.get('rouletteBets').children.length, 2);
  ui.get('rouletteBets').children[1].children[1].events.click();
  assert.equal(ui.player.chips, 990);
  assert.equal(ui.get('rouletteBets').children.length, 1);
});

test('roulette applies pulled stake limits and locks, settles and resets independent bets', () => {
  const ui = setup();
  for (const amount of ['4', '101', '5.5']) {
    ui.get('rouletteCustomStake').value = amount;
    ui.board.events.click();
  }
  assert.equal(ui.player.chips, 1000);
  ui.get('rouletteCustomStake').value = '10';
  ui.board.events.click();
  ui.get('rouletteCustomStake').value = '25';
  ui.get('rouletteRacetrackNumbers').children.find(item => item.dataset.boardNumber === '8').events.click();
  ui.get('rouletteSpinBtn').events.click();
  assert.equal(ui.stage.scrollOptions.block, 'center');
  const ball = ui.document.getElementById('rouletteTrackBall');
  assert.equal(ball.hidden, false);
  assert.equal(ball.animation.options.duration, 3000);
  assert.equal(ball.style.left, '42.5%');
  assert.equal(ball.style.top, '15%');
  assert.equal(ui.board.disabled, true);
  ui.board.events.click();
  ui.get('rouletteBets').children[0].children[1].events.click();
  assert.equal(ui.player.chips, 965);
  ui.finish();
  assert.equal(ui.player.chips, 1325);
  assert.equal(ui.history.length, 1);
  assert.equal(ui.history[0].bet, 35);
  assert.equal(ui.history[0].payout, 360);
  assert.equal(ui.history[0].net, 325);
  assert.equal(ui.get('rouletteBets').children.length, 0);
  assert.equal(ui.board.disabled, false);
  assert.equal(ui.get('rouletteSpinBtn').disabled, true);
});

test('stakes on all six rounded pockets render outside the clipped buttons and are removed on refund', () => {
  const ui = setup();
  const track = ui.get('rouletteRacetrackNumbers');
  const ends = track.children.filter(item => item.classList.contains('track-end'));
  assert.equal(ends.length, 6);
  for (const pocket of ends) pocket.events.click();
  for (const pocket of ends) {
    const marker = pocket.betMarker;
    assert.equal(marker.textContent, 10);
    assert.equal(marker.parent, track);
    assert.ok(Number.parseFloat(marker.style.left) < 10 || Number.parseFloat(marker.style.left) > 90);
    assert.ok(Number.parseFloat(marker.style.top) > 0 && Number.parseFloat(marker.style.top) < 100);
  }
  assert.equal(track.children.filter(item => item.className === 'bet-marker track-bet-marker').length, 6);
  while (ui.get('rouletteBets').children.length) ui.get('rouletteBets').children[0].children[1].events.click();
  assert.equal(track.children.filter(item => item.className === 'bet-marker track-bet-marker').length, 0);
  assert.equal(ui.player.chips, 1000);
});

test('spinning in racetrack view scrolls to the track and animates the same winning number', () => {
  const ui = setup();
  ui.switches[1].events.click();
  ui.board.events.click();
  ui.get('rouletteSpinBtn').events.click();
  assert.equal(ui.get('rouletteRacetrack').scrollOptions.block, 'center');
  assert.equal(ui.stage.scrollOptions, undefined);
  const ball = ui.document.getElementById('rouletteTrackBall');
  assert.ok(ball.animation.frames.length > 38);
  assert.equal(ball.animation.frames.at(-1).left, '42.5%');
  ui.finish();
  assert.equal(ui.history[0].number, '7');
});

test('main page loads every app module and has unique element IDs', () => {
  const html = fs.readFileSync(path.join(__dirname, '../underground/index.html'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const name of ['roulette', 'crash', 'blackjack', 'poker', 'slots', 'admin', 'plinko']) {
    assert.ok(html.includes(`src="js/${name}.js"`), `missing ${name} module`);
  }
  for (const file of ['index.html', 'js/roulette.js', 'css/style.css']) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../underground', file), 'utf8'), /^(?:<{7}|={7}|>{7})/m);
  }
});
